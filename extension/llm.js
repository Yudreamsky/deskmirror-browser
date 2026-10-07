// 桌面魔镜浏览器版：请求翻译服务，流式解析 “[n] 译文”。
//  - ollama：Ollama 原生接口 /api/chat（think=false 关掉思考，num_ctx 和桌面版一致，免得 Ollama 重新加载模型）
//  - openai：OpenAI 兼容接口 /chat/completions（DeepSeek、通义千问、硅基流动、LM Studio……）；
//    默认带 thinking=disabled（DeepSeek 默认会思考，翻译用不着，关掉快得多也省钱），服务不认就去掉重发并记住
// 后台（service worker）用 importScripts 载入，Node 测试用 require 载入。
(function (root) {
  'use strict';

  const noThinkingParam = new Set();   // 不认 thinking 参数的服务地址

  function trimBase(base) {
    return String(base || '').trim().replace(/\/+$/, '');
  }

  async function errorOf(res) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) { /* 没有正文 */ }
    if (res.status === 401 || res.status === 403) return new Error('API Key 不对或没有权限（HTTP ' + res.status + '）');
    if (res.status === 404) return new Error('地址或模型名不对（HTTP 404）' + (detail ? ' ' + detail : ''));
    if (res.status === 429) return new Error('请求太频繁或额度用完（HTTP 429）');
    return new Error('服务返回错误 HTTP ' + res.status + (detail ? ' ' + detail : ''));
  }

  /** fetch 本身失败（服务没开、地址写错、断网）时给一句看得懂的话。 */
  async function post(url, init, what) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (init.signal && init.signal.aborted) throw e;
      throw new Error('连不上' + what + '（' + url.replace(/\/(api\/chat|chat\/completions)$/, '') + '）');
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
    if (!base) throw new Error('还没有填写翻译服务地址');
    if (!String(cfg.model || '').trim()) throw new Error('还没有填写模型名');
    const messages = [
      { role: 'system', content: T.systemPrompt(req.target) },
      { role: 'user', content: T.userMessage(req.segments, req.context) },
    ];
    const parser = new T.SegmentParser(req.segments.length, onSeg);
    if (cfg.protocol === 'ollama') {
      const body = { model: cfg.model, messages, stream: true, think: false, keep_alive: '30m',
        options: { temperature: 0.2, num_ctx: 4096 } };
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await post(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal }, ' Ollama，它开着吗');
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          if (attempt === 0 && res.status === 400 && /think/i.test(text)) {
            delete body.think;   // 这个模型没有思考开关：去掉参数重发
            continue;
          }
          throw new Error('Ollama 返回错误 HTTP ' + res.status + ' ' + text.slice(0, 160));
        }
        for await (const line of lines(res)) {
          if (!line) continue;
          let j;
          try { j = JSON.parse(line); } catch (e) { continue; }
          if (j.error) throw new Error('Ollama 报错：' + String(j.error).slice(0, 160));
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
        const res = await post(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal }, '翻译服务');
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
          if (j.error) throw new Error('服务报错：' + JSON.stringify(j.error).slice(0, 160));
          const d = j.choices && j.choices[0] && j.choices[0].delta;
          if (d && d.content) parser.feedRaw(d.content);
        }
        break;
      }
    }
    parser.close();
    return parser.done.size;
  }

  /** 设置页的“测试连接”：翻一句话。 */
  async function testConnection(T, cfg, target) {
    let out = '';
    await translateBatch(T, cfg, { segments: ['Hello, <g1>world</g1>!'], target, context: '' }, (i, text) => { out = text; });
    if (!out) throw new Error('服务有回应，但没有返回译文');
    return out;
  }

  const api = { translateBatch, testConnection };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).llm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
