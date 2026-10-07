// 测试工具：本地网页服务、把内容脚本注入到隔离环境（和扩展的内容脚本一样）、翻译后端（假翻译或本机 Ollama）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sleep } from './cdp.mjs';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const T = require(path.join(ROOT, 'extension/content/text.js'));
const LLM = require(path.join(ROOT, 'extension/llm.js'));

export const CONTENT_FILES = ['text.js', 'copy.js', 'units.js', 'frame.js', 'main.js'];

export function bundle() {
  return CONTENT_FILES.map((f) => fs.readFileSync(path.join(ROOT, 'extension/content', f), 'utf8')).join('\n;\n');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json' };

/** 只服务 tests/pages 的本地网页服务，端口随机。 */
export function serve(dir = path.join(ROOT, 'tests/pages')) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const file = path.join(dir, decodeURIComponent(u.pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=60' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: (p) => `http://127.0.0.1:${server.address().port}/${p}`, close: () => server.close() });
  }));
}

export function mockTranslator(mode, delay = 40) {
  return async (req, send) => {
    await sleep(delay);
    req.segments.forEach((s, i) => send({ type: 'seg', id: req.id, i, text: T.mockTranslate(s, req.target, mode) }));
    send({ type: 'done', id: req.id });
  };
}

/** 本机 Ollama（OpenAI 兼容接口），不用任何 Key。 */
export function ollamaTranslator(model = 'gemma4:12b', log = null) {
  return async (req, send) => {
    const t0 = Date.now();
    try {
      await LLM.translateBatch(T, { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model }, req,
        (i, text) => send({ type: 'seg', id: req.id, i, text }));
      send({ type: 'done', id: req.id });
      if (log) log.push({ n: req.segments.length, ms: Date.now() - t0, src: req.segments });
    } catch (e) {
      send({ type: 'done', id: req.id, error: String(e.message || e) });
    }
  };
}

/** 打开一个标签页；每次导航都把内容脚本注入名为 dm 的隔离环境，翻译请求经 CDP 绑定交给 translate。 */
export async function openPage(browser, { translate, verbose = true } = {}) {
  const { cdp } = browser;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);
  const page = { cdp, sessionId, targetId, send, ctx: null, frameId: null, errors: [] };
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    const aux = context.auxData || {};
    if (context.name === 'dm' && aux.frameId === page.frameId) page.ctx = context.id;
  }, sessionId);
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
    const text = (d.exception && d.exception.description) || d.text;
    page.errors.push(text);
    if (verbose) console.log('  [页面异常]', text.split('\n').slice(0, 3).join(' | '));
  }, sessionId);
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (!verbose || (p.type !== 'error' && p.type !== 'warning' && p.type !== 'log')) return;
    const text = p.args.map((a) => a.value !== undefined ? a.value : a.description).join(' ');
    if (p.type === 'log' && !String(text).startsWith('[dm]')) return;
    console.log(`  [console.${p.type}]`, String(text).slice(0, 300));
  }, sessionId);
  cdp.on('Runtime.bindingCalled', ({ name, payload, executionContextId }) => {
    if (name !== 'dmBackend') return;
    const req = JSON.parse(payload);
    const reply = (msg) => send('Runtime.evaluate', {
      contextId: executionContextId, expression: `__dm.backendReply(${JSON.stringify(msg)})`,
    }).catch(() => {});
    (translate || mockTranslator('zh'))(req, reply);
  }, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  const { frameTree } = await send('Page.getFrameTree');
  page.frameId = frameTree.frame.id;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: bundle(), worldName: 'dm' });
  await send('Runtime.addBinding', { name: 'dmBackend', executionContextName: 'dm' });

  page.goto = async (url, settle = 300) => {
    page.ctx = null;
    const loaded = cdp.wait('Page.loadEventFired', sessionId, 45000);
    await send('Page.navigate', { url });
    await loaded;
    for (let i = 0; i < 100 && !page.ctx; i++) await sleep(50);
    if (!page.ctx) throw new Error('isolated world not created');
    await sleep(settle);
  };
  page.eval = async (expr) => {
    const r = await send('Runtime.evaluate', { contextId: page.ctx, expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    }
    return r.result.value;
  };
  page.evalMain = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  page.shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.data, 'base64');
    if (file) fs.writeFileSync(file, buf);
    return buf;
  };
  /** 等翻译都排完（没有排队、没有在途的请求）。 */
  page.settle = async (timeout = 60000) => {
    const t0 = Date.now();
    let quiet = 0;
    while (Date.now() - t0 < timeout) {
      const st = await page.eval(`(() => { const u = __dm.session && __dm.session.units;
        return u ? { q: u.queue.length, w: u.waiting.size, f: u.inflight } : null; })()`);
      if (st && !st.q && !st.w && !st.f) {
        if (++quiet >= 3) return true;
      } else quiet = 0;
      await sleep(150);
    }
    return false;
  };
  page.close = () => cdp.send('Target.closeTarget', { targetId });
  return page;
}
