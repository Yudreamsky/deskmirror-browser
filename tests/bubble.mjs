// 收起成气泡、拖动吸附、弹回来，和两套皮肤（经典 / 液态玻璃）：
//  1. 点标签上的“–”：边线一路缩成圆形飞到页面边缘（逐帧取样：越来越小，没有掉帧），变成气泡；译文那层隐藏，停止翻译
//  2. 用鼠标把气泡拖到左边松开：带回弹吸到左边缘；停一会儿藏进边缘一部分，鼠标移上去滑出来
//  3. 点一下气泡：变回镜框，回到原来的位置，标签、译文都回来，接着翻译
//  4. 液态玻璃：标签有磨砂（backdrop-filter），开口是圆角；收起、弹出一样能用；截图
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
const mouse = (type, x, y, extra) => page.send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, extra || {}));
const hover = (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const box = (expr) => page.eval(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const state = () => page.eval(`(() => { const s = __dm.session, f = s.frame; const vis = (e) => getComputedStyle(e).display !== 'none';
  return { folded: f.folded, busy: !!f._busy, bubble: vis(f.bubble), line: vis(f.line), tab: vis(f.tab), clip: getComputedStyle(s.copy.clip).visibility,
    hidden: !!s.units.hidden, rect: f.rect, bub: f.bub, cw: document.documentElement.clientWidth }; })()`);
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

    // 2. 拖到左边：吸附；停一会儿藏进去一部分；鼠标移上去滑出来
    const cx = bb.x + 23, cy = bb.y + 23;
    await mouse('mousePressed', cx, cy);
    for (let i = 1; i <= 12; i++) await mouse('mouseMoved', cx + (300 - cx) * i / 12, cy + (500 - cy) * i / 12);
    const dragging = await box('__dm.session.frame.bubble');
    await mouse('mouseReleased', 300, 500);
    await sleep(700);
    const left = await box('__dm.session.frame.bubble');
    const f2 = await state();
    check(Math.abs(dragging.x + dragging.w / 2 - 300) < 6 && Math.abs(left.x - 10) < 3 && f2.bub.side === 'left' && f2.folded,
      `拖动时跟着鼠标走，松开吸到左边缘（x=${Math.round(left.x)}，y=${Math.round(left.y)}），还是气泡`);
    await hover(700, 300);
    await sleep(2200);
    const tucked = await box('__dm.session.frame.bubble');
    await hover(6, left.y + 23);
    await sleep(500);
    const out = await box('__dm.session.frame.bubble');
    check(tucked.x < 0 && Math.abs(out.x - 10) < 3, `停一会儿藏进边缘（x=${Math.round(tucked.x)}），鼠标移上去滑出来（x=${Math.round(out.x)}）`);

    // 3. 点一下：弹回原来的位置
    await mouse('mousePressed', out.x + 23, out.y + 23);
    await mouse('mouseReleased', out.x + 23, out.y + 23);
    await sleep(220);
    await page.shot(path.join(OUT, `bubble-${skin}-opening.png`));
    await sleep(500);
    const f3 = await state();
    check(!f3.folded && !f3.bubble && f3.line && f3.tab && f3.clip === 'visible' && !f3.hidden
      && JSON.stringify(f3.rect) === JSON.stringify(before.rect), `点一下弹回原处（${f3.rect.x},${f3.rect.y} ${f3.rect.w}×${f3.rect.h}），标签、译文都回来了，接着翻译`);
    await page.shot(path.join(OUT, `bubble-${skin}-reopened.png`));
    await page.eval('__dm.stop(), 1');
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
