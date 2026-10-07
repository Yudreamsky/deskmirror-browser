// 设置页和升级流程：
//  1. 中文、英文、日文浏览器下第一次装：母语自动选好，界面语言跟着变（截图）
//  2. 镜框标签上的语言按钮：换翻译方向后马上按新方向重翻，设置里也记下；设置里改了，标签跟着变
//  3. 升级：扩展文件夹里的版本比正在运行的新 → 设置页检查到 → “更新”按钮重新加载扩展 → 更新后打开设置页列出改动；
//     重新加载后页面上旧的镜子自己关掉
// node tests/options.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep } from './lib/cdp.mjs';
import { ROOT, serve } from './lib/harness.mjs';
import { launchWithExtension } from './lib/ext.mjs';

const OUT = path.join(ROOT, 'tests/out');
let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};
const lines = (s) => String(s).split(/\r?\n/);

function copyExtension(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmb-extcopy-'));
  fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
  const mf = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.version = version;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return dir;
}

async function swOf(b, extId) {
  const t = await b.waitTarget((x) => x.type === 'service_worker' && x.url.includes(extId));
  return b.attach(t.targetId);
}

async function firstRun(lang) {
  const b = await launchWithExtension({ lang });
  try {
    const id = await b.load(path.join(ROOT, 'extension'));
    const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('welcome'));
    const p = await b.attach(t.targetId);
    await sleep(1200);
    const st = await p.eval(`(async () => ({ native: document.getElementById('native').value,
      target: document.getElementById('target').value, title: document.title,
      banner: document.getElementById('banner').textContent, saved: (await chrome.storage.local.get('settings')).settings }))()`);
    await p.shot(path.join(OUT, `options-${lang}.png`));
    return st;
  } finally {
    await b.close();
  }
}

async function main() {
  // 1. 第一次装
  const zh = await firstRun('zh-CN');
  check(zh.native === 'zh-Hans' && zh.target === 'zh-Hans' && /桌面魔镜/.test(zh.title) && /欢迎/.test(zh.banner),
    `中文浏览器：母语 ${zh.native}、译成 ${zh.target}、标题“${zh.title}”、欢迎语`);
  check(zh.saved && zh.saved.native === 'zh-Hans', '第一次打开就记下了母语');
  const en = await firstRun('en-US');
  check(en.native === 'en' && en.target === 'en' && /DeskMirror/.test(en.title) && /Welcome/.test(en.banner),
    `英文浏览器：母语 ${en.native}、译成 ${en.target}、标题“${en.title}”、欢迎语`);
  const ja = await firstRun('ja');
  check(ja.native === 'ja' && /DeskMirror/.test(ja.title), `日文浏览器：母语 ${ja.native}，界面英文`);

  // 2 和 3：装一个“旧版本”（0.1.0）的副本
  const server = await serve();
  const dir = copyExtension('0.1.0');
  const b = await launchWithExtension({ lang: 'zh-CN' });
  try {
    const extId = await b.load(dir);
    const sw = await swOf(b, extId);
    await sw.eval(`chrome.storage.local.set({ settings: { preset: 'mock', protocol: 'mock', native: 'zh-Hans', source: 'auto', target: 'zh-Hans' } }).then(() => 1)`);
    const url = server.url('article.html');
    const tab = await b.cdp.send('Target.createTarget', { url });
    const page = await b.attach(tab.targetId);
    await sleep(1200);
    await sw.eval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); return 1; })`);
    await sleep(1500);
    const ctx = page.isolated(extId);
    check(!!ctx, '找到了内容脚本的隔离环境');
    const before = await page.eval(`(() => { const s = __dm.session; return { label: s.frame.lang.textContent,
      rendered: [...s.units.byNode.values()].filter((u) => u.rendered).length }; })()`, ctx);
    check(before.label === '自动→中' && before.rendered > 0, `标签语言按钮“${before.label}”，已排进 ${before.rendered} 块`);
    // 点语言按钮 → 选“日本語”
    const after = await page.eval(`(async () => { const f = __dm.session.frame; f.lang.click();
      const item = [...f.menu.querySelectorAll('.item')].find((x) => x.textContent === '日本語'); item.click();
      await new Promise((r) => setTimeout(r, 1200));
      const s = __dm.session; const done = [...s.units.byNode.values()].filter((u) => u.rendered);
      return { label: f.lang.textContent, target: s.units.opts.target, rendered: done.length,
        keys: done.slice(0, 3).map((u) => u.key.split(String.fromCharCode(1)).slice(0, 2).join('>')),
        saved: (await chrome.storage.local.get('settings')).settings.target }; })()`, ctx);
    check(after.label === '自动→日' && after.target === 'ja' && after.rendered > 0 && after.keys.every((k) => k === 'auto>ja'),
      `换成日文：按钮“${after.label}”，重排 ${after.rendered} 块（${after.keys.join(', ')}）`);
    check(after.saved === 'ja', '设置里也记下了译成日文');
    // 设置页里改成英→中，打开着的镜子跟着换
    await sw.eval(`chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, source: 'en', target: 'zh-Hans' } })).then(() => 1)`);
    await sleep(1200);
    const synced = await page.eval(`__dm.session.frame.lang.textContent`, ctx);
    check(synced === '英→中', `设置里改成英→中，标签跟着变成“${synced}”`);
    await page.shot(path.join(OUT, 'options-tab-lang.png'));

    // 3. 升级：文件夹里换成新版本
    const mf = path.join(dir, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.version = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    const opt = await b.cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/options.html` });
    const op = await b.attach(opt.targetId);
    await sleep(1500);
    const up = await op.eval(`({ msg: document.getElementById('updateMsg').textContent,
      btn: document.getElementById('upgrade').hidden ? '' : document.getElementById('upgrade').textContent,
      notes: document.getElementById('updateNotes').children.length, ver: document.getElementById('version').textContent })`);
    check(/有新版本/.test(up.msg) && up.btn && up.notes > 0,
      `设置页：“${up.ver}”，“${up.msg.slice(0, 30)}…”，按钮“${up.btn}”，更新内容 ${up.notes} 条`);
    await op.shot(path.join(OUT, 'options-update.png'));
    // “更新”按钮调用 chrome.runtime.reload()。测试浏览器里用 CDP 装的扩展重新加载后不会回来，这里先换成桩确认按钮接对了
    const wired = await op.eval(`(() => { let n = 0; chrome.runtime.reload = () => { n++; };
      document.getElementById('upgrade').click(); return n; })()`);
    check(wired === 1, '“更新”按钮会重新加载扩展');
    // 重新加载后后台收到 onInstalled(update)：打开设置页说明更新了什么
    await sw.eval(`onInstalled({ reason: 'update', previousVersion: '0.0.9' }); 1`);
    const upd = await b.waitTarget((x) => x.type === 'page' && x.url.includes(extId) && x.url.includes('#updated'), 15000);
    const np = await b.attach(upd.targetId);
    await sleep(1200);
    const banner = await np.eval(`document.getElementById('banner').innerText`);
    check(/已更新到/.test(banner) && lines(banner).length >= 2,
      `更新后打开的设置页：“${lines(banner)[0]}”，下面列了 ${lines(banner).length - 1} 条`);
    await np.shot(path.join(OUT, 'options-updated.png'));
    // 真的重新加载：页面上旧版本的镜子要自己关掉
    await sw.eval(`setTimeout(() => chrome.runtime.reload(), 50); 1`).catch(() => {});
    await sleep(3500);
    const gone = await page.eval(`document.querySelectorAll('[data-deskmirror]').length`);
    check(gone === 0, '扩展重新加载后，页面上旧的镜子自己关掉了');
  } finally {
    await b.close();
    server.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 稍后 */ }
  }
  console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
