// 桌面魔镜浏览器版：请求翻译服务，流式解析 “[n] 译文”。
//  - ollama：Ollama 原生接口 /api/chat（think=false 关掉思考，num_ctx 和桌面版一致，免得 Ollama 重新加载模型）
//  - openai：OpenAI 兼容接口 /chat/completions（DeepSeek、通义千问、硅基流动、LM Studio……）；
//    默认带 thinking=disabled（DeepSeek 默认会思考，翻译用不着，关掉快得多也省钱），服务不认就去掉重发并记住
// 后台（service worker）用 importScripts 载入，Node 测试用 require 载入。
(function (root) {
  'use strict';

  const noThinkingParam = new Set();   // 不认 thinking 参数的服务地址
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

  async function errorOf(res) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) { /* 没有正文 */ }
    if (res.status === 401 || res.status === 403) {
      return new Error(msg('API Key 不对或没有权限', 'Wrong API key or no access') + ' (HTTP ' + res.status + ')');
    }
    if (res.status === 404) return new Error(msg('地址或模型名不对', 'Wrong address or model name') + ' (HTTP 404)' + (detail ? ' ' + detail : ''));
    if (res.status === 429) return new Error(msg('请求太频繁或额度用完', 'Too many requests or out of credit') + ' (HTTP 429)');
    return new Error(msg('服务返回错误', 'The service returned an error') + ' HTTP ' + res.status + (detail ? ' ' + detail : ''));
  }

  /** fetch 本身失败（服务没开、地址写错、断网）时给一句看得懂的话。 */
  async function post(url, init, what) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (init.signal && init.signal.aborted) throw e;
      const where = url.replace(/\/(api\/chat|api\/tags|chat\/completions|v1\/models|models)$/, '');
      throw new Error(what === 'ollama'
        ? msg('连不上 Ollama，它开着吗（' + where + '）', 'Cannot reach Ollama. Is it running? (' + where + ')')
        : msg('连不上翻译服务（' + where + '）', 'Cannot reach the translation service (' + where + ')'));
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
   * cfg: { protocol, baseUrl, model, apiKey }；req: { segments, target, context }
   */
  async function translateBatch(T, cfg, req, onSeg, signal) {
    const base = trimBase(cfg.baseUrl);
    if (!base) throw new Error(msg('还没有填写翻译服务地址', 'No service address yet'));
    if (!String(cfg.model || '').trim()) throw new Error(msg('还没有填写模型名', 'No model name yet'));
    const messages = [
      { role: 'system', content: T.systemPrompt(req.target, req.source) },
      { role: 'user', content: T.userMessage(req.segments, req.context) },
    ];
    const parser = new T.SegmentParser(req.segments.length, onSeg);
    if (cfg.protocol === 'ollama') {
      const body = { model: cfg.model, messages, stream: true, think: false, keep_alive: '30m',
        options: { temperature: 0.2, num_ctx: 4096 } };
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await post(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal }, 'ollama');
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          if (attempt === 0 && res.status === 400 && /think/i.test(text)) {
            delete body.think;   // 这个模型没有思考开关：去掉参数重发
            continue;
          }
          throw new Error(msg('Ollama 返回错误', 'Ollama returned an error') + ' HTTP ' + res.status + ' ' + text.slice(0, 160));
        }
        for await (const line of lines(res)) {
          if (!line) continue;
          let j;
          try { j = JSON.parse(line); } catch (e) { continue; }
          if (j.error) throw new Error('Ollama: ' + String(j.error).slice(0, 160));
          const piece = j.message && j.message.content;
          if (piece) parser.feedRaw(piece);
          if (j.done) break;
        }
        break;
      }
    } else {
      const headers = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
      const body = { model: cfg.model, messages, stream: true, temperature: 0.2 };
      if (!noThinkingParam.has(base)) body.thinking = { type: 'disabled' };
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await post(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal }, 'service');
        if (!res.ok) {
          if (attempt === 0 && body.thinking && (res.status === 400 || res.status === 422)) {
            delete body.thinking;   // 可能不认这个参数：去掉重发一次，成功就记住这个服务
            continue;
          }
          throw await errorOf(res);
        }
        if (attempt === 1) noThinkingParam.add(base);
        for await (const line of lines(res)) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') break;
          let j;
          try { j = JSON.parse(data); } catch (e) { continue; }
          if (j.error) throw new Error(msg('服务报错：', 'Service error: ') + JSON.stringify(j.error).slice(0, 160));
          const d = j.choices && j.choices[0] && j.choices[0].delta;
          if (d && d.content) parser.feedRaw(d.content);
        }
        break;
      }
    }
    parser.close();
    return parser.done.size;
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
      const res = await post(base + '/api/tags', { method: 'GET' }, 'ollama');
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

  /** 设置页的“测试连接”：翻一句话。 */
  async function testConnection(T, cfg, target) {
    let out = '';
    await translateBatch(T, cfg, { segments: ['Hello, <g1>world</g1>!'], target, context: '' }, (i, text) => { out = text; });
    if (!out) throw new Error(msg('服务有回应，但没有返回译文', 'The service answered but returned no translation'));
    return out;
  }

  const api = { translateBatch, testConnection, listModels, setUiLang };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).llm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
