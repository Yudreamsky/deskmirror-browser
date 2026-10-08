// 桌面魔镜浏览器版：请求翻译服务，流式解析 “[n] 译文”。
//  - ollama：Ollama 原生接口 /api/chat（think=false 关掉思考，num_ctx 和桌面版一致，免得 Ollama 重新加载模型）
//  - openai：OpenAI 兼容接口 /chat/completions（DeepSeek、通义千问、硅基流动、LM Studio……）；
//    默认带 thinking=disabled（DeepSeek 默认会思考，翻译用不着，关掉快得多也省钱），服务不认就去掉重发并记住
// 后台（service worker）用 importScripts 载入，Node 测试用 require 载入。
(function (root) {
  'use strict';

  const levelOf = new Map();           // 服务地址 → 用哪一档请求（见 translateBatch：0 全部参数 + 用量，1 不要用量，2 最基本的）
  let uiLang = 'zh';                    // 错误提示用的界面语言（中文 / 英文）

  function setUiLang(lang) {
    uiLang = lang === 'en' ? 'en' : 'zh';
  }

  function msg(zh, en) {
    return uiLang === 'en' ? en : zh;
  }

  function trimBase(base) {
    return String(base || '').trim().replace(/\/+$/, '');
  }

  /** 带 HTTP 状态的错误（备用阵列按状态判断：Key、额度、模型这类一时好不了，先跳过久一些）。 */
  function httpError(status, text) {
    const e = new Error(text);
    e.status = status;
    return e;
  }

  /** 设置没填好（没有地址、没有模型名）。 */
  function configError(text) {
    const e = new Error(text);
    e.config = true;
    return e;
  }

  /** 按 HTTP 状态说人话；ollama=true 时是 Ollama（云端模型 402 是订阅/免费额度不含这个模型）。 */
  function explain(status, detail, ollama) {
    if (status === 402) {
      return httpError(402, ollama
        ? msg('这个云端模型要付费额度：Ollama 订阅已到期，或免费额度不含它。请换一个模型（设置里“拉取模型”会找出账号现在能用的）',
          'This cloud model needs paid usage: the Ollama subscription has expired or the free tier does not include it. Pick another model (Get models in Settings finds the ones your account can use)')
        : msg('账户余额或额度不足，或订阅已到期', 'Out of balance or credit, or the subscription has expired') + ' (HTTP 402)');
    }
    if (status === 410) return httpError(410, msg('这个模型已经下线了，请换一个', 'This model has been retired; pick another') + ' (HTTP 410)');
    if (ollama && status === 404) {
      return httpError(404, msg('本机 Ollama 没有这个模型，先用 ollama pull 下载，或换一个', 'Ollama on this PC does not have this model; pull it first or pick another') + ' (HTTP 404)');
    }
    return null;
  }

  async function errorOf(res) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) { /* 没有正文 */ }
    const known = explain(res.status, detail, false);
    if (known) return known;
    if (res.status === 401 || res.status === 403) {
      return httpError(res.status, msg('API Key 不对或没有权限', 'Wrong API key or no access') + ' (HTTP ' + res.status + ')');
    }
    if (res.status === 404) return httpError(404, msg('地址或模型名不对', 'Wrong address or model name') + ' (HTTP 404)' + (detail ? ' ' + detail : ''));
    if (res.status === 429) return httpError(429, msg('请求太频繁或额度用完', 'Too many requests or out of credit') + ' (HTTP 429)');
    return httpError(res.status, msg('服务返回错误', 'The service returned an error') + ' HTTP ' + res.status + (detail ? ' ' + detail : ''));
  }

  /** fetch 本身失败（服务没开、地址写错、断网）时给一句看得懂的话。 */
  async function post(url, init, what) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (init.signal && init.signal.aborted) throw e;
      const where = url.replace(/\/(api\/chat|api\/tags|chat\/completions|v1\/models|models)$/, '');
      const err = new Error(what === 'ollama'
        ? msg('连不上 Ollama，它开着吗（' + where + '）', 'Cannot reach Ollama. Is it running? (' + where + ')')
        : msg('连不上翻译服务（' + where + '）', 'Cannot reach the translation service (' + where + ')'));
      err.network = true;
      throw err;
    }
  }

  async function* lines(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        yield buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
      }
    }
    if (buf.trim()) yield buf.trim();
  }

  /**
   * 翻译一批文字块。每段完整后回调 onSeg(i, text)；返回收到的段数。
   * cfg: { protocol, baseUrl, model, apiKey, extra }；req: { segments, source, target, context }
   * extra 是各家关掉“思考”的参数（见 presets.js），服务不认的话去掉重发一次并记住。
   * meter（可选）：填上这一次的用量 { in: 发送的 token, out: 接收的 token, est: 是不是按字数估的 }——
   * 服务报告了就用报告的（Ollama 的 prompt_eval_count / eval_count，OpenAI 兼容接口的 usage），没报告按字数估。
   */
  async function translateBatch(T, cfg, req, onSeg, signal, meter) {
    const base = trimBase(cfg.baseUrl);
    if (!base) throw configError(msg('还没有填写翻译服务地址', 'No service address yet'));
    if (!String(cfg.model || '').trim()) throw configError(msg('还没有填写模型名', 'No model name yet'));
    const messages = [
      { role: 'system', content: T.systemPrompt(req.target, req.source) },
      { role: 'user', content: T.userMessage(req.segments, req.context) },
    ];
    const parser = new T.SegmentParser(req.segments.length, onSeg);
    const use = meter || {};
    const started = () => {
      use.in = T.estimateTokens(messages.map((m) => m.content).join('\n'));
      use.out = 0;
      use.est = true;
    };
    try {
      if (cfg.protocol === 'ollama') {
        const body = { model: cfg.model, messages, stream: true, think: false, keep_alive: '30m',
          options: { temperature: 0.2, num_ctx: 4096 } };
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;   // 直连 ollama.com 云端
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await post(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify(body), signal }, 'ollama');
          if (res.status === 401 || res.status === 403) throw await errorOf(res);
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            if (attempt === 0 && res.status === 400 && /think/i.test(text)) {
              delete body.think;   // 这个模型没有思考开关：去掉参数重发
              continue;
            }
            throw explain(res.status, text, true)
              || httpError(res.status, msg('Ollama 返回错误', 'Ollama returned an error') + ' HTTP ' + res.status + ' ' + text.slice(0, 160));
          }
          started();
          for await (const line of lines(res)) {
            if (!line) continue;
            let j;
            try { j = JSON.parse(line); } catch (e) { continue; }
            if (j.error) throw new Error('Ollama: ' + String(j.error).slice(0, 160));
            const piece = j.message && j.message.content;
            if (piece) parser.feedRaw(piece);
            if (j.done) {
              if (j.prompt_eval_count != null || j.eval_count != null) {
                use.in = j.prompt_eval_count || 0;
                use.out = j.eval_count || 0;
                use.est = false;
              }
              break;
            }
          }
          break;
        }
      } else {
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
        const plain = { model: cfg.model, messages, stream: true };
        // DeepSeek、智谱、豆包等默认会“思考”，翻译用不着，关掉快得多也省钱（思考的字数按输出计费）；
        // 有的模型只接受默认温度（OpenAI 的推理模型）。请求分三档：附加参数 + 报告用量 → 只要附加参数 → 最基本的；
        // 服务不认（400/422）就降一档重发，并记住这个地址用哪一档
        const full = Object.assign({}, plain, { temperature: 0.2, thinking: { type: 'disabled' } }, cfg.extra || {});
        const bodies = [Object.assign({}, full, { stream_options: { include_usage: true } }), full, plain];
        let lv = levelOf.get(base) || 0;
        for (;;) {
          const res = await post(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(bodies[lv]), signal }, 'service');
          if (!res.ok) {
            if (lv < 2 && (res.status === 400 || res.status === 422)) {
              lv++;
              levelOf.set(base, lv);
              continue;
            }
            throw await errorOf(res);
          }
          started();
          for await (const line of lines(res)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') break;
            let j;
            try { j = JSON.parse(data); } catch (e) { continue; }
            if (j.error) throw new Error(msg('服务报错：', 'Service error: ') + JSON.stringify(j.error).slice(0, 160));
            if (j.usage && (j.usage.prompt_tokens != null || j.usage.completion_tokens != null)) {
              use.in = j.usage.prompt_tokens || 0;
              use.out = j.usage.completion_tokens || 0;
              use.est = false;
            }
            const d = j.choices && j.choices[0] && j.choices[0].delta;
            if (d && d.content) parser.feedRaw(d.content);
          }
          break;
        }
      }
      parser.close();
      return parser.done.size;
    } finally {
      if (use.est) use.out = T.estimateTokens(parser.raw);
    }
  }

  // 明显不是聊天模型的（向量、语音、画图、审核、重排序）不列出来
  const NOT_CHAT = /embed|whisper|tts|speech|audio|dall-e|image|moderation|rerank|transcri|realtime|search-preview|sora/i;

  /**
   * 拉取服务上能用的模型。Ollama：/api/tags（本机装了的）；OpenAI 兼容：/models（要带 Key）。
   * 返回 [{ id, name, note }]。
   */
  async function listModels(cfg) {
    const base = trimBase(cfg.baseUrl);
    if (!base) throw new Error(msg('还没有填写服务地址', 'No service address yet'));
    if (cfg.protocol === 'ollama') {
      const res = await post(base + '/api/tags', { method: 'GET', headers: cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {} }, 'ollama');
      if (!res.ok) throw await errorOf(res);
      const j = await res.json();
      return (j.models || []).map((m) => ({
        id: m.name,
        note: /cloud$/.test(m.name) ? msg('云端（要登录 Ollama 账号，文字会出本机）', 'cloud (needs an Ollama sign-in; text leaves this PC)')
          : (m.details && m.details.parameter_size ? m.details.parameter_size : ''),
      }));
    }
    const headers = {};
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    let res = await post(base + '/models', { method: 'GET', headers }, 'service');
    if (res.status === 404 && !/\/v\d+$/.test(base)) res = await post(base + '/v1/models', { method: 'GET', headers }, 'service');
    if (!res.ok) throw await errorOf(res);
    const j = await res.json();
    const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
    return list
      .map((m) => ({ id: m.id || m.name, name: m.name && m.name !== m.id ? m.name : '',
        note: m.context_window ? msg('上下文 ', 'context ') + Math.round(m.context_window / 1000) + 'K' : '' }))
      .filter((m) => m.id && !NOT_CHAT.test(m.id));
  }

  /** 试一下这个模型现在能不能用：只让它说 1 个字。能用返回 true，不能用抛出看得懂的错误。 */
  async function probeModel(cfg, model) {
    const base = trimBase(cfg.baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    if (cfg.protocol === 'ollama') {
      const res = await post(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ model, stream: false, think: false,
        messages: [{ role: 'user', content: 'Hi' }], options: { num_predict: 1, num_ctx: 4096 } }) }, 'ollama');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw explain(res.status, text, true) || httpError(res.status, 'HTTP ' + res.status + ' ' + text.slice(0, 120));
      }
      return true;
    }
    const res = await post(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model, stream: false,
      max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }) }, 'service');
    if (!res.ok) throw await errorOf(res);
    return true;
  }

  /** 设置页的“测试连接”：翻一句话。 */
  async function testConnection(T, cfg, target) {
    let out = '';
    await translateBatch(T, cfg, { segments: ['Hello, <g1>world</g1>!'], target, context: '' }, (i, text) => { out = text; });
    if (!out) throw new Error(msg('服务有回应，但没有返回译文', 'The service answered but returned no translation'));
    return out;
  }

  const api = { translateBatch, testConnection, listModels, probeModel, setUiLang, msg };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).llm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
