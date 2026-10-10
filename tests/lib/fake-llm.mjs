// 测试工具：本机的假翻译服务（OpenAI 兼容接口），模拟额度用完、下线、不回话、译到一半断开、连不上、正常。
// 请求里带 stream_options.include_usage 时，最后报告用量：发送 100 + 段数，接收 10 × 段数（svc.usage = false 就不报）；
// svc.rejectUsage = true 时像有的服务那样不认 stream_options，回 400。
// svc.aborted：还没回完、对方就断开的请求数（扩展停下了请求）。
import http from 'node:http';

/** 假的 OpenAI 兼容服务。mode 可以中途改；hits 记下每次请求收到的段落。 */
export function fakeService(mode) {
  const svc = { mode, hits: [], usage: true, rejectUsage: false, aborted: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    res.on('close', () => { if (!res.writableEnded) svc.aborted++; });
    req.on('end', () => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'm-' + svc.mode }] }));
        return;
      }
      let j = {};
      try { j = JSON.parse(body); } catch (e) { /* 空 */ }
      const user = (j.messages || []).find((m) => m.role === 'user');
      const segs = [...String(user ? user.content : '').matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => m[2]);
      const sys = (j.messages || []).find((m) => m.role === 'system');
      const src = /read it as (\w+)/.exec(sys ? sys.content : '');
      const tgt = /into ([^.]+)\. Each input/.exec(sys ? sys.content : '');
      svc.hits.push({ mode: svc.mode, segments: segs, streamOptions: !!j.stream_options, thinking: !!j.thinking, target: tgt ? tgt[1] : '',
        source: src ? ({ Chinese: 'zh', English: 'en', Japanese: 'ja', Korean: 'ko', Indonesian: 'id' })[src[1]] || src[1] : 'auto' });
      if (svc.rejectUsage && j.stream_options) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"Unrecognized request argument supplied: stream_options"}}');
        return;
      }
      if (svc.mode === 'pay') {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"Insufficient Balance"}}');
        return;
      }
      if (svc.mode === 'gone') {
        res.writeHead(410);
        res.end('gone');
        return;
      }
      if (svc.mode === 'hang') return;           // 一直不回话
      if (svc.delay) {
        setTimeout(() => answer(j, segs, res), svc.delay);
        return;
      }
      answer(j, segs, res);
    });
  });
  const answer = (j, segs, res) => {
      if (res.destroyed || res.writableEnded) return;   // 等的时候对方已经断开
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (text) => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
      if (svc.mode === 'half') {                 // 译出前几段后连接断开
        send(segs.slice(0, 3).map((s, i) => `[${i + 1}] H:${s}`).join('\n') + '\n');
        setTimeout(() => res.destroy(), 80);
        return;
      }
      send(segs.map((s, i) => `[${i + 1}] ${svc.tag || 'B'}:${s}`).join('\n'));
      if (svc.usage && j.stream_options && j.stream_options.include_usage) {
        const usage = { prompt_tokens: 100 + segs.length, completion_tokens: 10 * segs.length, total_tokens: 100 + 11 * segs.length };
        res.write('data: ' + JSON.stringify({ choices: [], usage }) + '\n\n');
      }
      res.write('data: [DONE]\n\n');
      res.end();
  };
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    svc.url = `http://127.0.0.1:${server.address().port}`;
    svc.close = () => { server.closeAllConnections(); server.close(); };
    resolve(svc);
  }));
}

/** 一个没人听的端口（连不上）。 */
export function deadPort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
}
