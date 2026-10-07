// 测试工具：装着扩展的无头 Chrome（Chrome 137 起正式版不认 --load-extension，
// 改用 CDP 的 Extensions.loadUnpacked，它要求 --remote-debugging-pipe 连接）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME, sleep } from './cdp.mjs';

export class PipeCDP {
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

  on(fn) {
    this.handlers.push(fn);
  }
}

export async function launchWithExtension({ lang = 'zh-CN' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmb-ext-'));
  const proc = spawn(CHROME, [
    `--user-data-dir=${dir}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,860', '--force-device-scale-factor=1',
    `--lang=${lang}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = new PipeCDP(proc.stdio[3], proc.stdio[4]);
  const b = {
    cdp,
    async load(extPath) {
      const { id } = await cdp.send('Extensions.loadUnpacked', { path: extPath });
      return id;
    },
    async targets() {
      return (await cdp.send('Target.getTargets')).targetInfos;
    },
    async waitTarget(pred, timeout = 15000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const t = (await b.targets()).find(pred);
        if (t) return t;
        await sleep(150);
      }
      throw new Error('target not found');
    },
    /** 连上一个目标，返回 eval(expr, contextId?) 和截图函数。 */
    async attach(targetId) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const contexts = [];
      cdp.on((m) => {
        if (m.sessionId === sessionId && m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
      });
      await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
      const evalIn = async (expr, contextId) => {
        const p = { expression: expr, awaitPromise: true, returnByValue: true };
        if (contextId) p.contextId = contextId;
        const r = await cdp.send('Runtime.evaluate', p, sessionId);
        if (r.exceptionDetails) {
          throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
        }
        return r.result.value;
      };
      return {
        sessionId,
        contexts,
        eval: evalIn,
        async shot(file) {
          const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
          if (file) fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
          return Buffer.from(r.data, 'base64');
        },
        /** 扩展内容脚本所在的隔离环境（名字是扩展的名字）。 */
        isolated(extId) {
          // 主框架里的那个（复制品 iframe 里也会有同一个扩展的隔离环境）
          const c = [...contexts].reverse().find((x) => x.auxData && x.auxData.type === 'isolated'
            && x.auxData.frameId === targetId && (!extId || String(x.origin).includes(extId)));
          return c && c.id;
        },
      };
    },
    async close() {
      try { await cdp.send('Browser.close'); } catch (e) { /* 已关 */ }
      await sleep(500);
      try { proc.kill(); } catch (e) { /* 已退出 */ }
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch (e) { /* 稍后 */ }
    },
  };
  return b;
}
