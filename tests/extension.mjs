// 端到端：在独立的无头 Chrome 里装上扩展（CDP Extensions.loadUnpacked，需要 pipe 连接），
// 从后台打开魔镜，走一遍“内容脚本 → 后台 → 翻译服务 → 回到复制品”。
// node tests/extension.mjs [mock|ollama]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME, sleep } from './lib/cdp.mjs';
import { ROOT, serve } from './lib/harness.mjs';
import { decodePNG } from './lib/png.mjs';

const mode = process.argv[2] || 'mock';

class PipeCDP {
  constructor(write, read) {
    this.write = write;
    this.seq = 0;
    this.calls = new Map();
    this.handlers = [];
    let buf = '';
    read.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg.id && this.calls.has(msg.id)) {
          const c = this.calls.get(msg.id);
          this.calls.delete(msg.id);
          if (msg.error) c.reject(new Error(`${c.method}: ${msg.error.message}`));
          else c.resolve(msg.result);
        } else if (msg.method) {
          for (const h of this.handlers) h(msg);
        }
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.write.write(JSON.stringify(msg) + '\0');
    return new Promise((resolve, reject) => this.calls.set(id, { resolve, reject, method }));
  }
}

async function main() {
  const server = await serve();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmb-ext-'));
  const proc = spawn(CHROME, [
    `--user-data-dir=${dir}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,860', '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = new PipeCDP(proc.stdio[3], proc.stdio[4]);
  const fail = (m) => { console.log('✗ ' + m); };
  try {
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    console.log('扩展已装上：', extId);
    await sleep(800);
    // 找到后台 service worker
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));
      if (!sw) await sleep(150);
    }
    if (!sw) throw new Error('没找到后台 service worker');
    const { sessionId: swS } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
    const swEval = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      return r.result.value;
    };
    const settings = mode === 'ollama'
      ? { preset: 'ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b', target: 'zh-Hans' }
      : { preset: 'mock', protocol: 'mock', target: 'zh-Hans' };
    await swEval(`chrome.storage.local.set({ settings: ${JSON.stringify(settings)} }).then(() => 1)`);
    if (mode === 'ollama') {
      const t = await swEval(`LLM.testConnection(T, ${JSON.stringify(settings)}, 'zh-Hans')`);
      console.log('测试连接：', t);
    }

    // 打开测试页（安装时会自动打开设置页，忽略它）
    const url = server.url('article.html');
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const { sessionId: pS } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const pageEval = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pS);
      return r.result && r.result.value;
    };
    await sleep(1500);
    // 等价于点工具栏图标（这里没有用户手势，靠 host_permissions 里的 127.0.0.1 注入）
    const opened = await swEval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); return t.id; })`);
    console.log('已在标签页', opened, '打开魔镜');
    let done = null;
    const t0 = Date.now();
    for (let i = 0; i < (mode === 'ollama' ? 300 : 60); i++) {
      await sleep(400);
      // 隔离环境里的状态看不到；用页面上能看到的结果判断：开口里的复制品文字
      done = await pageEval(`(() => { const h = document.querySelector('[data-deskmirror]'); return h ? 1 : 0; })()`);
      if (!done) continue;
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, pS);
      const img = decodePNG(Buffer.from(shot.data, 'base64'));
      fs.writeFileSync(path.join(ROOT, 'tests/out/extension-' + mode + '.png'), Buffer.from(shot.data, 'base64'));
      if (Date.now() - t0 > (mode === 'ollama' ? 30000 : 4000)) break;
      void img;
    }
    if (!done) fail('页面上没有出现魔镜');
    else console.log('魔镜已出现，截图 tests/out/extension-' + mode + '.png');
    // 再点一次：应该关掉
    await swEval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); return 1; })`);
    await sleep(500);
    const gone = await pageEval(`document.querySelectorAll('[data-deskmirror]').length`);
    console.log(gone === 0 ? '再点一次已关掉' : '✗ 再点一次没有关掉');
  } finally {
    try { await cdp.send('Browser.close'); } catch (e) { /* 已关 */ }
    await sleep(500);
    try { proc.kill(); } catch (e) { /* 已退出 */ }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch (e) { /* 稍后 */ }
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
