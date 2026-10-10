// 所有网页默认显示魔镜气泡。装的是扩展的一份副本：“访问所有网站”多放进必需权限（装上就有），
// 因为无头 Chrome 里没人点权限弹窗（设置页请求时就直接拿到）；其余文件和源码一模一样。都用真的鼠标、键盘：
//  1. 没打开这个选项：网页上什么都没有
//  2. 设置页点勾选框：后台登记内容脚本；已经开着的网页补上气泡；新开的网页一打开就有气泡——
//     藏进边缘一半、冷的（没复制网页、没发翻译请求）
//  3. 点气泡：弹出魔镜、复制网页、开始翻译；点 ✕：缩回气泡、冷下来（复制品拿掉，还没译完的请求马上停下，滚动也不再请求）
//  4. 只有气泡时点工具栏图标：弹开；再点：缩回气泡
//  5. 没打开过魔镜的网页上，输入框连按三次空格也能翻译
//  6. 取消勾选：取消登记；冷气泡拿掉，开着的魔镜留着（再关就整个拿掉）；新开的网页没有气泡
//  7. 扩展更新（同一个文件夹再装一次；CDP 装的扩展 chrome.runtime.reload() 会直接卸掉）：开着的网页换上新的气泡，点开照样翻译
// node tests/auto.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep } from './lib/cdp.mjs';
import { ROOT, serve } from './lib/harness.mjs';
import { launchWithExtension } from './lib/ext.mjs';
import { fakeService } from './lib/fake-llm.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};
const OUT = path.join(ROOT, 'tests/out');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmb-auto-'));
fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
man.host_permissions.push('https://*/*', 'http://*/*');
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 2));

const svc = await fakeService('ok');
svc.tag = '译';
const pages = await serve();
const b = await launchWithExtension({ lang: 'zh-CN' });
try {
  const id = await b.load(dir);
  const opT = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
  const op = await b.attach(opT.targetId);
  const swOf = async () => b.attach((await b.waitTarget((x) => x.type === 'service_worker' && x.url.includes(id))).targetId);
  let sw = await swOf();
  await sleep(1000);
  await op.eval(`chrome.storage.local.set({ settings: { native: 'zh-Hans', target: 'zh-Hans', source: 'auto', inputTarget: 'en', savedAt: Date.now(),
    chain: [{ preset: 'openai-custom', protocol: 'openai', baseUrl: ${JSON.stringify(svc.url + '/v1')}, model: 'm', apiKey: 'test-key' }] } }).then(() => 1)`);

  const open = async (file) => {
    const url = pages.url(file);
    const tab = await b.cdp.send('Target.createTarget', { url });
    const page = await b.attach(tab.targetId);
    page.url = url;
    await sleep(1300);
    return page;
  };
  const send = (page, m, p) => b.cdp.send(m, p, page.sessionId);
  const click = async (page, x, y) => {
    await send(page, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await send(page, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send(page, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  // 后台标签页里动画不走（收起、弹出要等动画放完），所以动它之前先切到前台，和真的用户一样
  const front = async (page) => {
    await send(page, 'Page.bringToFront', {});
    await sleep(200);
  };
  const hover = (page, x, y) => send(page, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  const centerOf = (page, expr, ctx) => page.eval(`(() => { const e = ${expr}; e.scrollIntoView && e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top }; })()`, ctx);
  const hosts = (page) => page.eval(`document.querySelectorAll('[data-deskmirror]').length`);
  const state = (page) => page.eval(`(() => { const s = __dm.session; if (!s) return null; const f = s.frame; const r = f.bubble.getBoundingClientRect();
    return { cold: !!s.cold, folded: f.folded, bubble: getComputedStyle(f.bubble).display !== 'none', tab: getComputedStyle(f.tab).display !== 'none',
      bx: Math.round(r.left), by: Math.round(r.top), cw: document.documentElement.clientWidth, copy: !!s.copy,
      frames: s.shell.root.querySelectorAll('iframe').length, alive: !!(__dm.loadedRuntime && __dm.loadedRuntime.id),
      units: s.units ? [...s.units.byNode.values()].filter((u) => u.rendered).length : -1 }; })()`, page.isolated(id));
  const registered = () => sw.eval(`chrome.scripting.getRegisteredContentScripts().then((l) => l.map((x) => x.id + ':' + x.js.join(',')))`);
  const toggle = async (page) => (await front(page), sw.eval(`chrome.tabs.query({}).then(async (ts) => { const t = ts.find((x) => x.url === ${JSON.stringify(page.url)}); await toggle(t); return !!t; })`));
  const clickBox = async () => {
    await front(op);
    const c = await centerOf(op, `document.getElementById('autoBubble')`);
    await click(op, c.x, c.y);
  };
  /** 冷气泡藏在边上一半：鼠标移上去滑出来，再点中间。 */
  const clickBubble = async (page) => {
    await front(page);
    const s = await state(page);
    await hover(page, s.cw - 8, s.by + 23);
    await sleep(450);
    const c = await centerOf(page, '__dm.session.frame.bubble', page.isolated(id));
    await click(page, c.x, c.y);
  };

  // 1. 没打开这个选项
  const pageA = await open('article.html?a');
  check(await hosts(pageA) === 0 && (await registered()).length === 0, '没打开选项：网页上什么都没有，后台也没登记内容脚本');

  // 2. 设置页点勾选框
  await clickBox();
  await sleep(1800);
  const reg = await registered();
  const msg = await op.eval(`document.getElementById('autoMsg').textContent`);
  check(reg.length === 1 && reg[0].startsWith('dm-auto:content/auto.js,') && reg[0].endsWith('content/main.js') && /已打开/.test(msg),
    `设置页勾上：“${msg}”；后台登记了内容脚本（auto.js 打头，共 ${reg[0] ? reg[0].split(',').length : 0} 个文件）`);
  const a = await state(pageA);
  check(a && a.cold && a.folded && a.bubble && !a.copy && a.frames === 0 && a.bx > a.cw - 46 && a.bx < a.cw && svc.hits.length === 0,
    `已经开着的网页补上了气泡：藏在右边缘一半（x=${a && a.bx}，页面宽 ${a && a.cw}），冷的（没复制网页，没有翻译请求）`);
  const pageB = await open('article.html?b');
  const bb = await state(pageB);
  check(bb && bb.cold && bb.bubble && !bb.copy && await hosts(pageB) === 1 && svc.hits.length === 0,
    '新开的网页一打开就有气泡，也是冷的；没有任何翻译请求');
  await pageB.shot(path.join(OUT, 'auto-bubble.png'));
  await send(pageB, 'Emulation.setEmulatedMedia', { media: 'print' });
  const printed = await pageB.eval(`getComputedStyle(__dm.session.frame.bubble).display`, pageB.isolated(id));
  await send(pageB, 'Emulation.setEmulatedMedia', { media: '' });
  check(printed === 'none', '打印网页时不印气泡');
  // 液态玻璃皮肤的冷气泡（截图看样子）
  await op.eval(`chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: Object.assign({}, settings, { skin: 'glass' }) })).then(() => 1)`);
  await sleep(500);
  await front(pageB);
  const g = await state(pageB);
  await hover(pageB, g.cw - 8, g.by + 23);
  await sleep(500);
  const glass = await pageB.eval(`__dm.session.shell.host.getAttribute('data-skin') + ' ' + getComputedStyle(__dm.session.frame.bubble).backdropFilter`, pageB.isolated(id));
  check(/^glass .*dm-lg-bubble/.test(glass), `换成液态玻璃，冷气泡跟着换（${glass}）`);
  await pageB.shot(path.join(OUT, 'auto-bubble-glass.png'));
  await hover(pageB, 600, 400);
  await op.eval(`chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: Object.assign({}, settings, { skin: 'classic' }) })).then(() => 1)`);
  await sleep(2200);

  // 3. 点气泡：弹出魔镜、翻译；点 ✕：缩回气泡、冷下来
  await clickBubble(pageB);
  await sleep(2600);
  const o = await state(pageB);
  check(o && !o.cold && !o.folded && o.tab && o.copy && o.frames === 1 && o.units > 0 && svc.hits.length > 0,
    `点气泡：弹出魔镜，复制网页、开始翻译（${svc.hits.length} 批请求，排进 ${o && o.units} 块）`);
  await pageB.shot(path.join(OUT, 'auto-opened.png'));
  svc.delay = 2500;                                       // 让下一批请求在路上
  await pageB.eval(`window.scrollBy(0, 700), 1`);
  await sleep(900);
  const inflight = svc.hits.length;
  await front(pageB);
  const x = await centerOf(pageB, '__dm.session.frame.closeBtn', pageB.isolated(id));
  await click(pageB, x.x, x.y);
  await sleep(1400);
  const c = await state(pageB);
  check(c && c.cold && c.folded && c.bubble && !c.copy && c.frames === 0 && await hosts(pageB) === 1,
    '点 ✕：缩回气泡、冷下来（复制品拿掉了），网页上还是一个气泡');
  check(svc.aborted >= 1, `关掉时还没译完的请求马上停下（停下 ${svc.aborted} 个，不再消耗 token）`);
  svc.delay = 0;
  await pageB.eval(`window.scrollBy(0, 900), 1`);
  await sleep(1500);
  check(svc.hits.length === inflight, `冷下来以后滚动网页也不再请求（请求数还是 ${svc.hits.length}）`);

  // 4. 只有气泡时点工具栏图标：弹开；再点：缩回气泡
  await toggle(pageB);
  await sleep(1800);
  const t1 = await state(pageB);
  await toggle(pageB);
  await sleep(1300);
  const t2 = await state(pageB);
  check(t1 && !t1.cold && !t1.folded && t1.copy && t2 && t2.cold && t2.folded && t2.bubble,
    '只有气泡时点工具栏图标：弹开成魔镜；再点一次：缩回气泡');

  // 5. 没打开过魔镜的网页上，输入框连按三次空格
  const pageC = await open('fields.html');
  await pageC.eval(`(() => { const e = document.querySelector('#ta'); e.focus(); return 1; })()`);
  await send(pageC, 'Input.insertText', { text: '你好' });
  for (let i = 0; i < 3; i++) {
    if (i) await sleep(120);
    await send(pageC, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
    await send(pageC, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  }
  await sleep(1500);
  const typed = await pageC.eval(`document.querySelector('#ta').value`);
  const cs = await state(pageC);
  check(typed === '译:你好' && cs && cs.cold, `没打开过魔镜的网页上，输入框连按三次空格也能翻译：“${typed}”（魔镜还是冷气泡）`);

  // 6. 取消勾选
  await toggle(pageA);                                      // 先在网页 A 打开魔镜
  await sleep(1800);
  await clickBox();
  await sleep(1500);
  const reg2 = await registered();
  const aOpen = await state(pageA);
  const hb = await hosts(pageB), hc = await hosts(pageC);
  check(reg2.length === 0 && hb === 0 && hc === 0 && aOpen && !aOpen.cold && !aOpen.folded,
    '取消勾选：取消登记；只是气泡的网页上拿掉了，开着的魔镜留着' + (process.env.DEBUG ? JSON.stringify({ reg2, hb, hc, aOpen }) : ''));
  await toggle(pageA);
  await sleep(800);
  const pageD = await open('article.html?d');
  check(await hosts(pageA) === 0 && await hosts(pageD) === 0, '这时再点图标就整个关掉（不留气泡）；新开的网页也没有气泡');

  // 7. 扩展更新（同一个文件夹再装一次）
  await clickBox();
  await sleep(1500);
  const hitsBefore = svc.hits.length;
  const id2 = (await b.cdp.send('Extensions.loadUnpacked', { path: dir })).id;
  await sleep(4000);
  sw = await swOf();
  await sleep(1000);
  const reg3 = await registered();
  const n = await state(pageB);
  check(id2 === id && reg3.length === 1 && n && n.cold && n.bubble && n.alive && await hosts(pageB) === 1,
    `扩展更新以后：内容脚本还登记着，开着的网页换上了新的气泡（旧的拿掉了，网页上只有 ${await hosts(pageB)} 个）`);
  await clickBubble(pageB);
  await sleep(2600);
  const n2 = await state(pageB);
  check(n2 && !n2.cold && n2.units > 0 && svc.hits.length > hitsBefore, `新气泡点开照样翻译（排进 ${n2 && n2.units} 块）`
    + (process.env.DEBUG ? JSON.stringify({ n, n2, hits: svc.hits.length, hitsBefore }) : ''));
} finally {
  await b.close();
  svc.close();
  pages.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
