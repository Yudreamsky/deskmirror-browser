// 测试工具：启动一个独立的无头 Chrome（临时用户目录，用完删掉），用 CDP 控制它。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.calls = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const c = this.calls.get(msg.id);
        if (!c) return;
        this.calls.delete(msg.id);
        if (msg.error) c.reject(new Error(`${c.method}: ${msg.error.message} ${msg.error.data || ''}`));
        else c.resolve(msg.result);
        return;
      }
      for (const key of [`${msg.sessionId || ''}:${msg.method}`, `*:${msg.method}`]) {
        for (const h of this.handlers.get(key) || []) h(msg.params, msg.sessionId);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.calls.set(id, { resolve, reject, method }));
  }

  on(method, fn, sessionId = '') {
    const key = `${sessionId}:${method}`;
    if (!this.handlers.has(key)) this.handlers.set(key, []);
    this.handlers.get(key).push(fn);
    return () => {
      const list = this.handlers.get(key);
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  wait(method, sessionId = '', timeout = 30000, pred = () => true) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (p) => {
        if (!pred(p)) return;
        off();
        clearTimeout(t);
        resolve(p);
      }, sessionId);
      const t = setTimeout(() => {
        off();
        reject(new Error(`timeout waiting for ${method}`));
      }, timeout);
    });
  }
}

export async function launch({ headless = true, width = 1280, height = 860, args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmb-chrome-'));
  const argv = [
    `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-sync', '--mute-audio', '--disable-features=Translate,MediaRouter,OptimizationHints',
    `--window-size=${width},${height}`, '--force-device-scale-factor=1', ...args,
  ];
  if (headless) argv.push('--headless=new');
  argv.push('about:blank');
  const proc = spawn(CHROME, argv, { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  let txt = '';
  for (let i = 0; i < 300; i++) {
    if (fs.existsSync(portFile)) {
      txt = fs.readFileSync(portFile, 'utf8');
      if (txt.includes('\n')) break;
    }
    await sleep(50);
  }
  const [port, wsPath] = txt.trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);
  return {
    cdp,
    async close() {
      try { await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch (e) { /* 已关 */ }
      try { proc.kill(); } catch (e) { /* 已退出 */ }
      await sleep(400);
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch (e) { /* 稍后系统会清 */ }
    },
  };
}
