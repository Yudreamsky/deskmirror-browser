// 桌面魔镜浏览器版：请求 OpenAI 兼容接口（DeepSeek、通义千问、Ollama 的 /v1 等），流式解析 “[n] 译文”。
// 后台（service worker）用 importScripts 载入，Node 测试用 require 载入。
(function (root) {
  'use strict';

  function chatUrl(base) {
    return base.replace(/\/+$/, '') + '/chat/completions';
  }

  /**
   * 翻译一批文字块。每段完整后回调 onSeg(i, text)；返回收到的段数。
   * cfg: { baseUrl, model, apiKey }；req: { segments, target, context }
   */
  async function translateBatch(T, cfg, req, onSeg, signal) {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    const body = {
      model: cfg.model,
      stream: true,
      temperature: 0.2,
      messages: [
        { role: 'system', content: T.systemPrompt(req.target) },
        { role: 'user', content: T.userMessage(req.segments, req.context) },
      ],
    };
    const res = await fetch(chatUrl(cfg.baseUrl), { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) { /* 没有正文 */ }
      throw new Error('HTTP ' + res.status + (detail ? ' ' + detail : ''));
    }
    const parser = new T.SegmentParser(req.segments.length, onSeg);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && j.choices[0].delta;
          if (d && d.content) parser.feedRaw(d.content);
        } catch (e) { /* 不完整的行 */ }
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

  const api = { translateBatch, testConnection, chatUrl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).llm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
