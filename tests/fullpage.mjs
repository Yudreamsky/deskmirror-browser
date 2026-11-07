// 拖到页面顶端整页翻译，都用真的鼠标，经典和液态玻璃两套皮肤：
//  1. 收起成气泡，按住气泡拖出来、再拖到页面最上沿：虚线框一路张开到整个页面（逐帧取样：越来越大，量帧间隔），
//     开口是整个页面，离原来镜框很远的字也翻了；气泡变成顶端的半球，跟着鼠标左右走；放开藏进顶端一点
//  2. 只点一下顶端的半球：整个页面缩回原来的镜框（位置、大小都对），标签回来
//  3. 再到整页，按住半球往下拖：缩回原来那么大的虚线框跟着鼠标走（一直在翻译），放开就是镜框
//  4. 从边上的气泡贴着边一直往上拖到顶端：也整页
//  5. 拖着标签上的抓手到顶端：只是挪镜框，不整页
//  6. 整页时窗口变小：开口跟着变
//  7. 整页时点图标关掉（打开了“所有网页默认显示魔镜气泡”）：缩成气泡；再点开回到原来的镜框
//  8. 整页时网页照常能用（其实是在和译文那一页打交道）：按钮、链接、输入框、下拉框、悬停弹出的菜单、Tab；
//     点了按钮、旁边的字变了，按钮上的字还是译文；拖着选字：译文上有高亮，复制出来是译文；双击选一个词；
//     按住 Ctrl+Alt+O 看原文时复制的是原文，松开高亮还在；点链接选区不变、高亮也还在；
//     普通镜框里：按在高亮的字上拖走，拖走的是译文；点一下空白处高亮没了；重新选字，复制出来是镜框里的译文
// node tests/fullpage.mjs
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, serve, openPage, mockTranslator } from './lib/harness.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};
const OUT = path.join(ROOT, 'tests/out');
const HOME = { x: 300, y: 150, w: 640, h: 420 };

const server = await serve();
const browser = await launch({ width: 1280, height: 860 });
const page = await openPage(browser, { translate: mockTranslator('zh'), verbose: false });
const mouse = (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const hover = (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const box = (expr) => page.eval(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const state = () => page.eval(`(() => { const s = __dm.session, f = s.frame; const vis = (e) => getComputedStyle(e).display !== 'none';
  return { full: !!f.full, folded: f.folded, live: !!f._live, bubble: vis(f.bubble), line: vis(f.line), tab: vis(f.tab), morph: vis(f.morph),
    dash: f.morph.classList.contains('dash'), open: f.open, radius: f.radius, rect: f.rect, bub: f.bub, hidden: s.units ? !!s.units.hidden : null,
    clip: s.copy ? s.copy.clip.style.clipPath : '', cw: document.documentElement.clientWidth, ch: document.documentElement.clientHeight }; })()`);
const drag = async (from, to, steps = 12, wait = 16) => {
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    await sleep(wait);
  }
};
/** 每一帧记下变形的那一层多宽、是不是虚线，和最长帧间隔。 */
const sample = (ms) => page.eval(`new Promise((ok) => { const m = __dm.session.frame.morph; const t0 = performance.now(); const out = []; let last = t0, worst = 0;
  const step = (now) => { worst = Math.max(worst, now - last); last = now;
    if (getComputedStyle(m).display !== 'none') out.push({ w: Math.round(m.getBoundingClientRect().width), dash: m.classList.contains('dash') });
    if (now - t0 < ${ms}) requestAnimationFrame(step); else ok({ out, worst: Math.round(worst) }); };
  requestAnimationFrame(step); })`);
const monotone = (ws) => ws.every((v, i) => i === 0 || v >= ws[i - 1] - 1);
const same = (a, b) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= 1);
/** 剪裁路径的第一圈是不是整个页面（浏览器读回来时命令之间可能加了空格）。 */
const fullClip = (st) => {
  const m = /M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*H\s*([\d.]+)\s*V\s*([\d.]+)\s*H\s*(-?[\d.]+)\s*Z/.exec(st.clip || '');
  return !!m && +m[1] === 0 && +m[2] === 0 && Math.abs(+m[3] - st.cw) <= 1 && Math.abs(+m[4] - st.ch) <= 1 && +m[5] === 0;
};
/** 镜框收起成气泡、移上去让它滑出来，返回气泡中心。 */
async function ballCenter() {
  const st = await state();
  if (!st.folded) {
    const f = await box('__dm.session.frame.foldBtn');
    await mouse('mousePressed', f.x + f.w / 2, f.y + f.h / 2);
    await mouse('mouseReleased', f.x + f.w / 2, f.y + f.h / 2);
    await sleep(800);
  }
  const s2 = await state();
  await hover(s2.bub.side === 'left' ? 10 : s2.cw - 10, s2.bub.y + 23);
  await sleep(450);
  const b = await box('__dm.session.frame.bubble');
  return { x: b.x + 23, y: b.y + 23 };
}
/** 视口里要翻的块：排进了译文的有几个、一共几个（跳过不用翻的）。 */
const viewUnits = () => page.eval(`(() => { const u = [...__dm.session.units.byNode.values()];
  const vis = u.filter((x) => { const el = x.kind === 'leaf' ? x.container : x.node; if (!el || !el.isConnected || x.state === 'skip') return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; });
  return { n: vis.length, done: vis.filter((x) => x.rendered).length }; })()`);

try {
  for (const skin of ['classic', 'glass']) {
    await page.goto(server.url('article.html'), 600);
    await page.eval(`(() => { __dm.start({ rect: ${JSON.stringify(HOME)}, target: 'zh-Hans', skin: '${skin}' }); return 1; })()`);
    await page.settle(20000);
    await sleep(300);

    // 1. 气泡拖出来、再拖到页面最上沿：张开到整个页面
    let c = await ballCenter();
    await mouse('mousePressed', c.x, c.y);
    await drag(c, { x: 640, y: 420 }, 12, 18);
    await sleep(500);
    const grow = sample(800);
    await drag({ x: 640, y: 420 }, { x: 700, y: 4 }, 10, 18);
    await sleep(200);
    const mid = await state();
    await page.shot(path.join(OUT, `fullpage-${skin}-opening.png`));
    const g = await grow;
    const ws = g.out.map((o) => o.w);
    check(ws.length >= 8 && monotone(ws.slice(ws.indexOf(Math.min(...ws)))) && ws[ws.length - 1] >= mid.cw && g.worst < 40,
      `拖到页面最上沿：边框一路张开到整个页面（${ws.length} 帧，宽到 ${ws[ws.length - 1]} px，页面 ${mid.cw} px，最长帧间隔 ${g.worst} ms）`);
    await sleep(500);
    let st = await state();
    const ball = await box('__dm.session.frame.bubble');
    const bc = { x: ball.x + ball.w / 2, y: ball.y + ball.h / 2 };
    check(st.full && !st.folded && !st.line && !st.tab && !st.morph && st.bubble && st.bub.side === 'top' && Math.abs(bc.y - 33) < 2
      && Math.abs(bc.x - 700) < 2 && same(st.open, { x: 0, y: 0, w: st.cw, h: st.ch }) && st.radius === 0,
      `整页：开口是整个页面（${st.open.w}×${st.open.h}，圆角 ${st.radius}），镜框和标签藏起来，气泡贴在顶端、在鼠标下面（中心 ${Math.round(bc.x)}, ${Math.round(bc.y)}）`);
    await drag({ x: 700, y: 4 }, { x: 420, y: 6 }, 6, 16);
    const moved = await box('__dm.session.frame.bubble');
    await mouse('mouseReleased', 420, 6);
    await sleep(900);
    st = await state();
    const tucked = await box('__dm.session.frame.bubble');
    check(Math.abs(moved.x + moved.w / 2 - 420) < 2 && st.bub.tucked && tucked.y < 0 && tucked.y > -30 && st.full,
      `半球跟着鼠标左右走（x=${Math.round(moved.x)}），放开藏进顶端一点（y=${Math.round(tucked.y)}）`);
    const clipFull = fullClip(st);
    await sleep(1500);
    const v1 = await viewUnits();
    await page.shot(path.join(OUT, `fullpage-${skin}-full.png`));
    await page.eval('scrollBy(0, 1400), 1');
    await sleep(2000);
    const v2 = await viewUnits();
    const st2 = await state();
    await page.shot(path.join(OUT, `fullpage-${skin}-scrolled.png`));
    await page.eval('scrollTo(0, 0), 1');
    await sleep(500);
    check(clipFull && v1.done === v1.n && v2.done === v2.n && fullClip(st2),
      `整页都是译文：剪裁是整个页面，视口里 ${v1.done}/${v1.n} 块都是译文；往下滚 1400 px，新露出来的 ${v2.done}/${v2.n} 块也是`);

    // 2. 只点一下顶端的半球：缩回原来的镜框
    await hover(tucked.x + 23, 4);
    await sleep(450);
    const top = await box('__dm.session.frame.bubble');
    await mouse('mousePressed', top.x + 23, top.y + 23);
    await mouse('mouseReleased', top.x + 23, top.y + 23);
    await sleep(900);
    st = await state();
    check(!st.full && !st.folded && st.line && st.tab && !st.bubble && same(st.rect, HOME) && !fullClip(st),
      `点一下顶端的半球：缩回原来的镜框（${JSON.stringify(st.rect)}），标签回来`);

    // 3. 再到整页，按住半球往下拖：原来那么大的虚线框，放开就是镜框
    c = await ballCenter();
    await mouse('mousePressed', c.x, c.y);
    await drag(c, { x: 640, y: 420 }, 10, 18);
    await drag({ x: 640, y: 420 }, { x: 640, y: 3 }, 10, 18);
    await mouse('mouseReleased', 640, 3);
    await sleep(1000);
    await hover(640, 4);
    await sleep(450);
    const top2 = await box('__dm.session.frame.bubble');
    await mouse('mousePressed', top2.x + 23, top2.y + 23);
    await drag({ x: top2.x + 23, y: top2.y + 23 }, { x: 500, y: 380 }, 12, 18);
    await sleep(500);
    st = await state();
    check(!st.full && st.morph && st.dash && !st.hidden && st.rect.w === HOME.w && st.rect.h === HOME.h,
      `按住半球往下拖：缩回 ${st.rect.w}×${st.rect.h} 的虚线框跟着鼠标走，一直在翻译`);
    await mouse('mouseReleased', 500, 380);
    await sleep(800);
    st = await state();
    check(!st.full && !st.folded && st.line && st.tab && !st.morph && st.rect.w === HOME.w && Math.abs(st.rect.x - (500 - 16)) <= 2,
      `放开：落定成镜框（x=${st.rect.x}，抓手在鼠标下面）`);

    // 4. 从边上的气泡贴着边一直往上拖到顶端
    c = await ballCenter();
    await mouse('mousePressed', c.x, c.y);
    await drag(c, { x: c.x + 8, y: 3 }, 12, 18);
    await sleep(700);
    st = await state();
    check(st.full && st.bub.side === 'top', '从边上的气泡贴着边往上拖到顶端：也整页');
    await mouse('mouseReleased', c.x + 8, 3);
    await sleep(700);
    await hover(c.x + 8, 4);
    await sleep(450);
    const top3 = await box('__dm.session.frame.bubble');
    await mouse('mousePressed', top3.x + 23, top3.y + 23);
    await mouse('mouseReleased', top3.x + 23, top3.y + 23);
    await sleep(900);

    // 5. 拖着标签上的抓手到顶端：只是挪镜框
    const grip = await box('__dm.session.frame.grip');
    const gc = { x: grip.x + grip.w / 2, y: grip.y + grip.h / 2 };
    await mouse('mousePressed', gc.x, gc.y);
    await drag(gc, { x: gc.x + 40, y: 2 }, 10, 18);
    await mouse('mouseReleased', gc.x + 40, 2);
    await sleep(500);
    st = await state();
    check(!st.full && st.line && st.tab, `拖着抓手到页面顶端：只是挪镜框（y=${st.rect.y}），不整页`);
    await page.eval(`(() => { __dm.session.frame._set(${JSON.stringify(HOME)}, true); return 1; })()`);
    await sleep(300);

    // 6. 整页时窗口变小：开口跟着变
    c = await ballCenter();
    await mouse('mousePressed', c.x, c.y);
    await drag(c, { x: 640, y: 420 }, 10, 18);
    await drag({ x: 640, y: 420 }, { x: 640, y: 3 }, 10, 18);
    await mouse('mouseReleased', 640, 3);
    await sleep(900);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    st = await state();
    check(st.full && same(st.open, { x: 0, y: 0, w: st.cw, h: st.ch }) && st.cw < 1000 && st.ch <= 700,
      `整页时窗口变小：开口跟着变成 ${st.open.w}×${st.open.h}`);
    await page.send('Emulation.clearDeviceMetricsOverride', {});
    await sleep(600);

    // 7. 整页时点图标关掉（打开了“所有网页默认显示魔镜气泡”）：缩成气泡；再点开回到原来的镜框
    await page.eval(`(() => { __dm.session.cfg.autoBubble = true; __dm.close(); return 1; })()`);
    await sleep(900);
    st = await state();
    const folded = st.folded && !st.full && st.bubble && st.bub.side !== 'top';
    await page.eval(`(() => { __dm.session.frame.unfold(); return 1; })()`);
    await sleep(900);
    st = await state();
    check(folded && !st.folded && !st.full && same(st.rect, HOME) && st.line,
      `整页时点图标关掉：缩成边上的气泡；再点开回到原来的镜框（${JSON.stringify(st.rect)}）`);
    await page.eval('__dm.stop(), 1');
  }

  // ---------------------------------------------------------------- 8. 整页时网页照常能用；选字、复制的是译文
  {
    await page.goto(server.url('interact.html'), 600);
    await page.eval(`(() => { __dm.start({ rect: ${JSON.stringify(HOME)}, target: 'zh-Hans' }); return 1; })()`);
    await page.settle(20000);
    await sleep(300);
    // 网页自己记下复制事件：有没有被换成译文、换成了什么
    await page.eval(`(() => { window.__copies = []; window.addEventListener('copy', (e) => __copies.push({ prevented: e.defaultPrevented,
      text: e.clipboardData ? e.clipboardData.getData('text/plain') : '' })); return 1; })()`);
    const el = (sel) => box(`document.querySelector('${sel}')`);
    const copyNode = (sel) => `__dm.session.copy.map.get(document.querySelector('${sel}'))`;
    const key = async (k, code, vk, mods = 0, commands) => {
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(commands ? { commands } : {}) });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
    };
    const copyNow = async () => {
      await key('c', 'KeyC', 67, 2, ['copy']);
      await sleep(200);
      return page.eval('__copies[__copies.length - 1] || null');
    };
    const c0 = await ballCenter();
    await mouse('mousePressed', c0.x, c0.y);
    await drag(c0, { x: 640, y: 420 }, 10, 18);
    await drag({ x: 640, y: 420 }, { x: 1100, y: 3 }, 10, 18);
    await mouse('mouseReleased', 1100, 3);
    await sleep(1800);
    let st = await state();
    check(st.full, '（整页翻译打开）');

    const btn = await el('#btn');
    const btnBefore = await page.eval(`${copyNode('#btn')}.textContent`);
    await mouse('mousePressed', btn.x + btn.w / 2, btn.y + btn.h / 2);
    await mouse('mouseReleased', btn.x + btn.w / 2, btn.y + btn.h / 2);
    await sleep(1500);
    const after = await page.eval(`(() => ({ count: document.getElementById('count').textContent, btn: ${copyNode('#btn')}.textContent }))()`);
    check(after.count === '1' && after.btn === btnBefore && after.btn !== 'Save changes',
      `点按钮：网页收到点击（计数 ${after.count}）；旁边的字变了，按钮上还是译文“${after.btn}”`);

    const menu = await el('#menu');
    await hover(menu.x + 10, menu.y + menu.h / 2);
    await sleep(500);
    const drop = await page.eval(`(() => { const c = ${copyNode('#drop')}; return { real: getComputedStyle(document.getElementById('drop')).display,
      copy: c.ownerDocument.defaultView.getComputedStyle(c).display }; })()`);
    check(drop.real === 'block' && drop.copy === 'block', '鼠标移到菜单上：弹出来的菜单在译文页上也弹出来');
    await hover(640, 700);
    await sleep(300);

    const inp = await el('#name');
    await mouse('mousePressed', inp.x + 20, inp.y + inp.h / 2);
    await mouse('mouseReleased', inp.x + 20, inp.y + inp.h / 2);
    await sleep(200);
    await page.send('Input.insertText', { text: 'Lin' });
    const sel = await el('#sel');
    await mouse('mousePressed', sel.x + 20, sel.y + sel.h / 2);
    await mouse('mouseReleased', sel.x + 20, sel.y + sel.h / 2);
    await sleep(200);
    await key('Escape', 'Escape', 27);
    await key('ArrowDown', 'ArrowDown', 40);
    await sleep(300);
    await page.eval('document.getElementById("btn").focus(), 1');
    await key('Tab', 'Tab', 9);
    await sleep(200);
    const forms = await page.eval(`({ name: document.getElementById('name').value, sel: document.getElementById('sel').value,
      focus: document.activeElement.id })`);
    check(forms.name === 'Lin' && forms.sel === 'b' && forms.focus === 'lnk', `输入框打字（“${forms.name}”）、下拉框换选项（${forms.sel}）、Tab 换焦点（${forms.focus}）都照常`);

    // 拖着选字：译文上有高亮，复制出来是译文
    const para = await el('#para');
    const a = { x: para.x + 2, y: para.y + 12 }, z = { x: para.x + 300, y: para.y + 12 };
    await mouse('mousePressed', a.x, a.y);
    await drag(a, z, 10, 16);
    await mouse('mouseReleased', z.x, z.y);
    await sleep(300);
    const picked = await page.eval(`(() => { const cs = __dm.session.copy.cdoc.getSelection();
      return { real: getSelection().toString(), copy: cs.toString(), inPara: ${copyNode('#para')}.textContent.includes(cs.toString()) }; })()`);
    await page.shot(path.join(OUT, 'fullpage-select.png'));
    const cp = await copyNow();
    check(picked.copy.length >= 5 && picked.inPara && picked.copy !== picked.real && cp && cp.prevented && cp.text === picked.copy,
      `拖着选字：选中的是译文“${picked.copy}”（高亮画在译文上，下面网页选中的是“${picked.real}”），复制出来也是这段译文`);

    // 双击选一个词
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: para.x + 60, y: para.y + 12, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: para.x + 60, y: para.y + 12, button: 'left', buttons: 0, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: para.x + 60, y: para.y + 12, button: 'left', buttons: 1, clickCount: 2 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: para.x + 60, y: para.y + 12, button: 'left', buttons: 0, clickCount: 2 });
    await sleep(300);
    const word = await page.eval('__dm.session.copy.cdoc.getSelection().toString()');
    check(word.length >= 1 && word.length <= 8, `双击：选中译文里的一个词“${word}”`);

    // 按住 Ctrl+Alt+O 看原文：复制的是原文；松开以后译文上的高亮还在，复制的又是译文
    const copySel = () => page.eval('__dm.session.copy.cdoc.getSelection().toString()');
    await mouse('mousePressed', a.x, a.y);
    await drag(a, z, 10, 16);
    await mouse('mouseReleased', z.x, z.y);
    await sleep(300);
    const before = await copySel();
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79, modifiers: 3 });
    await sleep(300);
    const peekHidden = await page.eval(`getComputedStyle(__dm.session.copy.clip).visibility`);
    await page.send('Runtime.evaluate', { expression: 'document.execCommand("copy")', userGesture: true });
    await sleep(200);
    const pc = await page.eval('__copies[__copies.length - 1]');
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79, modifiers: 3 });
    await sleep(300);
    const back = await copySel();
    const pc2 = await copyNow();
    check(before.length >= 5 && peekHidden === 'hidden' && pc && !pc.prevented && back === before && pc2 && pc2.prevented && pc2.text === before,
      `按住 Ctrl+Alt+O 看原文时：复制出来是原文；松开以后高亮还在译文“${back}”上，复制的又是译文`);

    // 链接：跳过去还是整页；选区没动，高亮也还在
    const lnk = await el('#lnk');
    await mouse('mousePressed', lnk.x + 10, lnk.y + lnk.h / 2);
    await mouse('mouseReleased', lnk.x + 10, lnk.y + lnk.h / 2);
    await sleep(1500);
    const nav = await page.eval(`({ hash: location.hash, y: scrollY, real: getSelection().toString() })`);
    st = await state();
    const kept = await copySel();
    check(nav.hash === '#second' && nav.y > 1000 && st.full && fullClip(st) && nav.real && kept === before,
      `点链接：跳到 ${nav.hash}，还是整页翻译；网页的选区没动，译文上的高亮也还在`);

    // 普通镜框里选字也一样：镜框里选的复制出来是译文
    await page.eval('scrollTo(0, 0), 1');
    await sleep(400);
    const top = await page.eval(`(() => { const r = __dm.session.frame.bubble.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await hover(top.x, 4);
    await sleep(450);
    const top2 = await page.eval(`(() => { const r = __dm.session.frame.bubble.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await mouse('mousePressed', top2.x, top2.y);
    await mouse('mouseReleased', top2.x, top2.y);
    await sleep(900);
    await page.eval(`(() => { __dm.session.frame._set({ x: 10, y: 300, w: 900, h: 200 }, true); return 1; })()`);
    await sleep(1500);
    const para2 = await el('#para');
    // 按在高亮的字上拖走（浏览器拖的是选中的字）：拖走的是译文
    await page.send('Input.setInterceptDrags', { enabled: true });
    const dragged = page.cdp.wait('Input.dragIntercepted', page.sessionId, 5000).catch(() => null);
    const p0 = { x: para2.x + 40, y: para2.y + 12 }, p1 = { x: para2.x + 200, y: para2.y + 110 };
    await mouse('mousePressed', p0.x, p0.y);
    await drag(p0, p1, 8, 20);
    const dd = await dragged;
    if (dd) await page.send('Input.dispatchDragEvent', { type: 'dragCancel', x: p1.x, y: p1.y, data: dd.data }).catch(() => {});
    await mouse('mouseReleased', p1.x, p1.y);
    await page.send('Input.setInterceptDrags', { enabled: false });
    await sleep(300);
    const items = dd ? dd.data.items : [];
    const plain = (items.find((i) => i.mimeType === 'text/plain') || {}).data;
    check(!!dd && plain === before && !items.some((i) => i.mimeType === 'text/html'),
      `普通镜框里按在高亮的字上拖走：拖走的是译文“${plain}”`);
    // 点一下空白处：选区、高亮都没了
    await mouse('mousePressed', 600, 470);
    await mouse('mouseReleased', 600, 470);
    await sleep(300);
    const cleared = { real: await page.eval('getSelection().toString()'), copy: await copySel() };
    check(!cleared.real && !cleared.copy, '点一下空白处：网页的选区和译文上的高亮都没了');
    const a2 = { x: para2.x + 2, y: para2.y + 12 }, z2 = { x: para2.x + 260, y: para2.y + 12 };
    await mouse('mousePressed', a2.x, a2.y);
    await drag(a2, z2, 10, 16);
    await mouse('mouseReleased', z2.x, z2.y);
    await sleep(300);
    const small = await copySel();
    const sc = await copyNow();
    check(!(await state()).full && small.length >= 10 && sc && sc.prevented && sc.text === small, `普通镜框里重新选字：复制出来是镜框里的译文“${small}”`);
    await page.eval('__dm.stop(), 1');
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
