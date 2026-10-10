// 会自己动的卡片行：复制品里的卡片要和真网页一直对齐（像 labs.google/playground 的 Swiper 轮播）。
// 在过渡进行到一半时打开魔镜，之后每一帧量复制品里的卡片和真网页差多少（要经过一次无缝循环的瞬间跳回）：
//  1. 影子 DOM 里的轮播（CSS 过渡；到头先瞬间跳回去、再接着过渡）
//  2. CSS 动画（@keyframes）跑马灯
//  3. 脚本用 element.animate() 建的动画
// node tests/anim.mjs            （加 --no-sync：关掉动画对齐，看看原来错开多少）
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, serve, openPage, mockTranslator } from './lib/harness.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};

const server = await serve();
const browser = await launch({ width: 1280, height: 860 });
try {
  const page = await openPage(browser, { translate: mockTranslator('zh'), verbose: false });
  await page.goto(server.url('carousel.html'), 600);
  await sleep(2300);                                       // 第二段过渡走到一半
  if (process.argv.includes('--no-sync')) await page.eval(`(() => { __dm.LiveCopy.prototype._syncAnim = () => {}; return 1; })()`);
  await page.eval(`(() => { __dm.start({ rect: { x: 180, y: 40, w: 760, h: 600 }, target: 'zh-Hans' }); return 1; })()`);
  await page.settle(15000);
  // 页面里每一帧量（不靠 CDP 来回），7 秒：轮播一圈 6 秒，中间有一次瞬间跳回
  const r = await page.eval(`new Promise((ok) => { const map = __dm.session.copy.map;
    const sc = document.querySelector('x-carousel');
    const rows = { carousel: [...sc.shadowRoot.querySelectorAll('.card')], marquee: [...document.querySelectorAll('#marquee .card')],
      script: [...document.querySelectorAll('#waapi .card')] };
    const names = Object.keys(rows);
    const worst = {}, jumps = {}, last = {};
    for (const k of names) { worst[k] = 0; jumps[k] = 0; last[k] = null; }
    const t0 = performance.now(); let frames = 0;
    const step = () => { frames++;
      for (const k of names) {
        const real = rows[k][0], copy = map.get(real);
        if (!copy) { worst[k] = Infinity; continue; }
        const x = real.getBoundingClientRect().left;
        worst[k] = Math.max(worst[k], Math.abs(copy.getBoundingClientRect().left - x));
        if (last[k] !== null && x - last[k] > 200) jumps[k]++;
        last[k] = x;
      }
      if (performance.now() - t0 < 7000) requestAnimationFrame(step);
      else ok({ frames, worst, jumps, mirrors: __dm.session.copy.mirrors.size });
    };
    requestAnimationFrame(step); })`);
  const w = r.worst;
  const fmt = (v) => (v === Infinity ? '找不到' : v.toFixed(1) + ' px');
  check(w.carousel < 2 && r.jumps.carousel >= 1,
    `影子 DOM 里的轮播（CSS 过渡、到头瞬间跳回 ${r.jumps.carousel} 次）：${r.frames} 帧里复制品和真网页最多差 ${fmt(w.carousel)}`);
  check(w.marquee < 2, `CSS 动画跑马灯：最多差 ${fmt(w.marquee)}`);
  check(w.script < 2, `脚本建的动画（element.animate）：最多差 ${fmt(w.script)}；复制品里照着建了 ${r.mirrors} 个`);
  await page.shot(path.join(ROOT, 'tests/out/anim.png'));
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
