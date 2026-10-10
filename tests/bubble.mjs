// 收起成气泡、拖到边缘吸成球、从边上拖出来，和两套皮肤（经典 / 液态玻璃）。都用真的鼠标：
//  1. 点标签上的“–”：边线一路缩成圆形飞到页面边缘（逐帧取样：越来越小，没有掉帧），变成气泡；译文那层隐藏，停止翻译
//  2. 按住气泡拖到页面中间：球变成虚线框跟着鼠标走（逐帧取样：越来越大），开始翻译；接着拖到左边缘：又缩成球，停止翻译；
//     放开：吸在左边、藏进边缘一半（半球）；鼠标移上去滑出来，移开过一会儿藏回去
//  3. 点一下气泡：变回镜框，回到原来的位置，标签、译文都回来，接着翻译
//  4. 拖着标签左头的抓手，让鼠标到页面右边缘：镜框缩成球吸在边上（停止翻译）；放开藏进边缘一半；以后点开回到拖之前的地方
//  5. 从边上把气泡拖出来放开：虚线框落定成镜框（实线、标签淡入），在鼠标抓着的地方，接着翻译
//  6. 冷气泡（“所有网页默认显示魔镜气泡”，还没复制网页）拖出来：这时才复制网页、开始翻译
//  液态玻璃：标签有磨砂（backdrop-filter），开口是圆角；以上一样能用；截图
// node tests/bubble.mjs
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, serve, openPage, mockTranslator } from './lib/harness.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};
const OUT = path.join(ROOT, 'tests/out');

const server = await serve();
const browser = await launch({ width: 1280, height: 860 });
const page = await openPage(browser, { translate: mockTranslator('zh'), verbose: false });
const mouse = (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const hover = (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const box = (expr) => page.eval(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const state = () => page.eval(`(() => { const s = __dm.session, f = s.frame; const vis = (e) => getComputedStyle(e).display !== 'none';
  return { folded: f.folded, busy: !!f._busy, live: !!f._live, bubble: vis(f.bubble), line: vis(f.line), tab: vis(f.tab), morph: vis(f.morph),
    dash: f.morph.classList.contains('dash'), clip: s.copy ? getComputedStyle(s.copy.clip).visibility : 'none', cold: !!s.cold,
    hidden: s.units ? !!s.units.hidden : null, rect: f.rect, bub: f.bub, cw: document.documentElement.clientWidth }; })()`);
/** 按住、一步步拖到 (x, y)（每步之间等一会儿，像真的手在拖）。 */
const drag = async (from, to, steps = 12, wait = 16) => {
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    await sleep(wait);
  }
};
/** 页面里每一帧记下变形的样子（morph 在不在、是不是虚线、多宽）和帧间隔，ms 毫秒。 */
const sample = (ms) => page.eval(`new Promise((ok) => { const f = __dm.session.frame, m = f.morph; const t0 = performance.now(); const out = []; let last = t0, worst = 0;
  const step = (now) => { worst = Math.max(worst, now - last); last = now;
    if (getComputedStyle(m).display !== 'none') out.push({ w: Math.round(m.getBoundingClientRect().width), dash: m.classList.contains('dash') });
    if (now - t0 < ${ms}) requestAnimationFrame(step); else ok({ out, worst: Math.round(worst) }); };
  requestAnimationFrame(step); })`);
const monotone = (ws, up) => ws.every((v, i) => i === 0 || (up ? v >= ws[i - 1] - 1 : v <= ws[i - 1] + 1));

try {
  for (const skin of ['classic', 'glass']) {
    await page.goto(server.url('article.html'), 600);
    await page.eval(`(() => { __dm.start({ rect: { x: 300, y: 150, w: 640, h: 420 }, target: 'zh-Hans', skin: '${skin}' }); return 1; })()`);
    await page.settle(20000);
    await sleep(300);
    if (skin === 'glass') {
      const g = await page.eval(`(() => { const f = __dm.session.frame; const cs = getComputedStyle(f.tab);
        return { skin: f.root.host.getAttribute('data-skin'), blur: cs.backdropFilter, radius: cs.borderRadius, corner: getComputedStyle(f.corners[0]).display,
          clip: __dm.session.copy.clip.style.clipPath }; })()`);
      check(g.skin === 'glass' && /blur/.test(g.blur) && g.radius === '13px' && g.corner === 'none' && /A ?12 12/.test(g.clip),
        `液态玻璃：标签 ${g.blur}、圆角 ${g.radius}；镜框四角的方块藏起来，开口是圆角（剪裁路径里有圆弧）`);
      const rf = await page.eval(`(() => { const f = __dm.session.frame; const fl = f.root.querySelector('filter#dm-lg-tab');
        const img = fl && fl.querySelector('feImage'); const tr = f.tab.getBoundingClientRect();
        return { url: getComputedStyle(f.tab).backdropFilter.includes('dm-lg-tab'), map: img ? img.getAttribute('href').slice(0, 22) : '',
          w: fl ? +fl.getAttribute('width') : 0, tab: Math.round(tr.width), maps: f.root.querySelectorAll('feDisplacementMap').length }; })()`);
      check(rf.url && rf.map === 'data:image/png;base64,' && Math.abs(rf.w - rf.tab) <= 1 && rf.maps >= 6,
        `边缘折射：标签用位移滤镜（位移图 ${rf.w} px 宽，和标签一样宽；红绿蓝三路位移，共 ${rf.maps} 个）`);
    }
    const grip = await page.eval(`(() => { const g = __dm.session.frame.grip; const r = g.getBoundingClientRect(); const cs = getComputedStyle(g);
      return { w: Math.round(r.width), h: Math.round(r.height), cursor: cs.cursor, dots: cs.backgroundImage.includes('radial-gradient'), first: g === g.parentNode.firstElementChild, title: g.title }; })()`);
    check(grip.first && grip.w >= 16 && grip.h >= 18 && grip.cursor === 'grab' && grip.dots && grip.title,
      `标签左头有抓手：${grip.w}×${grip.h}，六个点，鼠标是“抓”的样子，提示“${grip.title}”`);
    await page.shot(path.join(OUT, `bubble-${skin}-open.png`));
    const before = await state();

    // 1. 收起：逐帧取样边线变形，量帧间隔
    const fold = await box('__dm.session.frame.foldBtn');
    const sampled = page.eval(`new Promise((ok) => { const f = __dm.session.frame, m = f.morph; const t0 = performance.now(); const out = []; let last = t0, worst = 0;
      const step = (now) => { worst = Math.max(worst, now - last); last = now;
        if (getComputedStyle(m).display !== 'none') { const t = new DOMMatrix(getComputedStyle(m).transform); out.push([Math.round(now - t0), +t.a.toFixed(3), Math.round(t.e)]); }
        if (now - t0 < 700) requestAnimationFrame(step); else ok({ out, worst: Math.round(worst) }); };
      requestAnimationFrame(step); })`);
    await mouse('mousePressed', fold.x + fold.w / 2, fold.y + fold.h / 2);
    await mouse('mouseReleased', fold.x + fold.w / 2, fold.y + fold.h / 2);
    await sleep(200);
    await page.shot(path.join(OUT, `bubble-${skin}-folding.png`));
    const s1 = await sampled;
    const scales = s1.out.map((x) => x[1]);
    const shrinking = scales.length >= 8 && scales.every((v, i) => i === 0 || v <= scales[i - 1] + 1e-6) && scales[scales.length - 1] < 0.15;
    check(shrinking && s1.worst < 40, `收起：边线逐帧缩小（${scales.length} 帧，${scales[0]} → ${scales[scales.length - 1]}），最长帧间隔 ${s1.worst} ms`);
    await sleep(300);
    const f1 = await state();
    const bb = await box('__dm.session.frame.bubble');
    const atEdge = Math.abs(bb.x - (f1.cw - 46 - 10)) < 2 || Math.abs(bb.x - 10) < 2;
    check(f1.folded && f1.bubble && !f1.line && !f1.tab && f1.clip === 'hidden' && f1.hidden && atEdge,
      `变成气泡贴在${f1.bub.side === 'left' ? '左' : '右'}边（x=${Math.round(bb.x)}），镜框、标签、译文都收起来了，停止翻译`);
    await page.shot(path.join(OUT, `bubble-${skin}-bubble.png`));

    // 2. 按住气泡拖到页面中间：变成虚线框、开始翻译；再拖到左边缘：变回球、停止翻译；放开：吸在左边、藏进一半
    await hover(f1.bub.side === 'left' ? 10 : f1.cw - 10, bb.y + 23);  // 可能已经藏进去一半了：先移上去让它滑出来
    await sleep(400);
    const bb2 = await box('__dm.session.frame.bubble');
    const c0 = { x: bb2.x + 23, y: bb2.y + 23 };
    await mouse('mousePressed', c0.x, c0.y);
    const grow = sample(900);
    await drag(c0, { x: 560, y: 480 }, 14, 18);
    await sleep(450);
    const mid = await state();
    const g1 = await grow;
    const ws = g1.out.filter((o) => o.dash).map((o) => o.w);
    check(mid.morph && mid.dash && !mid.folded && !mid.hidden && mid.clip === 'visible' && ws.length >= 8 && monotone(ws, true) && ws[ws.length - 1] > 600 && g1.worst < 40,
      `拖到中间：球变成虚线框（${ws.length} 帧里从 ${ws[0]} 一路长到 ${ws[ws.length - 1]} px 宽，最长帧间隔 ${g1.worst} ms），译文那层露出来，开始翻译`);
    await page.shot(path.join(OUT, `bubble-${skin}-dashed.png`));
    await drag({ x: 560, y: 480 }, { x: 6, y: 500 }, 12, 18);
    await sleep(700);
    const f2a = await state();
    check(f2a.folded && f2a.bubble && !f2a.morph && f2a.hidden && f2a.bub.side === 'left',
      '接着拖到左边缘：又缩成球（换成真的气泡），停止翻译');
    await mouse('mouseReleased', 6, 500);
    await sleep(800);
    const left = await box('__dm.session.frame.bubble');
    const f2 = await state();
    check(f2.folded && f2.bub.side === 'left' && f2.bub.tucked && left.x < 0 && left.x > -30 && f2.hidden,
      `放开：吸在左边、藏进边缘一半成了半球（x=${Math.round(left.x)}，y=${Math.round(left.y)}），还是不翻译`);
    await hover(left.x + 30, left.y + 23);
    await sleep(500);
    const out = await box('__dm.session.frame.bubble');
    await hover(700, 300);
    await sleep(2200);
    const tucked = await box('__dm.session.frame.bubble');
    check(Math.abs(out.x - 10) < 3 && tucked.x < 0, `鼠标移上去滑出来（x=${Math.round(out.x)}），移开过一会儿藏回去（x=${Math.round(tucked.x)}）`);

    // 3. 点一下：弹回原处
    await hover(6, tucked.y + 23);
    await sleep(500);
    const out2 = await box('__dm.session.frame.bubble');
    await mouse('mousePressed', out2.x + 23, out2.y + 23);
    await mouse('mouseReleased', out2.x + 23, out2.y + 23);
    await sleep(220);
    await page.shot(path.join(OUT, `bubble-${skin}-opening.png`));
    await sleep(500);
    const f3 = await state();
    check(!f3.folded && !f3.bubble && f3.line && f3.tab && f3.clip === 'visible' && !f3.hidden
      && JSON.stringify(f3.rect) === JSON.stringify(before.rect), `点一下弹回原处（${f3.rect.x},${f3.rect.y} ${f3.rect.w}×${f3.rect.h}），标签、译文都回来了，接着翻译`);
    await page.shot(path.join(OUT, `bubble-${skin}-reopened.png`));

    // 4. 拖着抓手，让鼠标到页面右边缘：缩成球吸在边上；放开藏进边缘一半
    const gp = await box('__dm.session.frame.grip');
    const g0 = { x: gp.x + gp.w / 2, y: gp.y + gp.h / 2 };
    await mouse('mousePressed', g0.x, g0.y);
    const shrink = sample(800);
    await drag(g0, { x: f3.cw - 4, y: 300 }, 14, 18);
    await sleep(350);
    const s4 = await shrink;
    const ws4 = s4.out.map((o) => o.w);
    const f4a = await state();
    check(f4a.folded && f4a.hidden && !f4a.line && !f4a.tab && ws4.length >= 6 && monotone(ws4, false) && ws4[ws4.length - 1] < 60 && s4.worst < 40,
      `抓手拖到右边缘：镜框逐帧缩成球（${ws4.length} 帧，${ws4[0]} → ${ws4[ws4.length - 1]} px，最长帧间隔 ${s4.worst} ms），停止翻译`);
    await page.shot(path.join(OUT, `bubble-${skin}-docking.png`));
    await mouse('mouseReleased', f3.cw - 4, 300);
    await sleep(800);
    const right = await box('__dm.session.frame.bubble');
    const f4 = await state();
    check(f4.folded && f4.bubble && f4.bub.side === 'right' && f4.bub.tucked && right.x > f4.cw - 46 && f4.hidden
      && JSON.stringify(f4.rect) === JSON.stringify(before.rect),
      `放开：吸在右边、藏进一半成了半球（x=${Math.round(right.x)}，页面宽 ${f4.cw}）；以后点开回到拖之前的地方`);
    await page.shot(path.join(OUT, `bubble-${skin}-docked.png`));

    // 5. 从边上把气泡拖出来放开：落定成镜框，在鼠标抓着的地方，接着翻译
    await hover(f4.cw - 8, right.y + 23);
    await sleep(500);
    const r5 = await box('__dm.session.frame.bubble');
    const p5 = { x: r5.x + 23, y: r5.y + 23 };
    await mouse('mousePressed', p5.x, p5.y);
    await drag(p5, { x: 520, y: 300 }, 14, 18);
    await sleep(400);
    await mouse('mouseReleased', 520, 300);
    await sleep(700);
    const f5 = await state();
    const gy = 2 + (skin === 'glass' ? 6 : 0) + 13;
    check(!f5.folded && f5.line && f5.tab && !f5.morph && !f5.hidden && f5.clip === 'visible'
      && Math.abs(f5.rect.x - (520 - 16)) <= 1 && Math.abs(f5.rect.y - (300 + gy)) <= 1 && f5.rect.w === before.rect.w,
      `拖出来放开：落定成镜框（实线、标签回来了），抓手在鼠标底下（${f5.rect.x},${f5.rect.y}），接着翻译`);
    await page.shot(path.join(OUT, `bubble-${skin}-landed.png`));
    await page.eval('__dm.stop(), 1');
  }

  // 6. 冷气泡：拖出来时才复制网页、开始翻译
  await page.goto(server.url('article.html'), 600);
  await page.eval(`(() => { __dm.start({ docked: true, rect: { x: 600, y: 160, w: 560, h: 380 }, target: 'zh-Hans' }); return 1; })()`);
  await sleep(500);
  const cold = await state();
  const cb = await box('__dm.session.frame.bubble');
  await hover(cold.cw - 8, cb.y + 23);
  await sleep(500);
  const cb2 = await box('__dm.session.frame.bubble');
  await mouse('mousePressed', cb2.x + 23, cb2.y + 23);
  await drag({ x: cb2.x + 23, y: cb2.y + 23 }, { x: 420, y: 260 }, 14, 18);
  await sleep(500);
  await mouse('mouseReleased', 420, 260);
  await page.settle(15000);
  await sleep(300);
  const warm = await state();
  const done = await page.eval(`[...__dm.session.units.byNode.values()].filter((u) => u.rendered).length`);
  check(cold.cold && cold.bubble && cold.clip === 'none' && !warm.cold && !warm.folded && warm.clip === 'visible' && done > 0,
    `冷气泡（还没复制网页）拖出来：这时才复制网页、开始翻译（排进 ${done} 块）`);
  await page.shot(path.join(OUT, 'bubble-cold-dragged.png'));
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
