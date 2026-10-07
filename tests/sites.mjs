// 真实网站：复制是否走样（译文=原文时开口内像素对比）、启动耗时、节点数、内存、滚动时每帧耗时。
// node tests/sites.mjs [网址…]    不给网址就测默认几个
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, openPage, mockTranslator } from './lib/harness.mjs';
import { decodePNG, encodePNG, diffImages } from './lib/png.mjs';

const OUT = path.join(ROOT, 'tests/out');
const DEFAULT = [
  'https://en.wikipedia.org/wiki/Glacier',
  'https://github.com/microsoft/TypeScript',
  'https://developer.mozilla.org/en-US/docs/Web/CSS/position',
  'https://news.ycombinator.com/',
  'https://www.bbc.com/news',
];
const urls = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const W = 1280, H = 860;

const name = (u) => u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 50);

async function metrics(page) {
  const { metrics: m } = await page.send('Performance.getMetrics');
  const o = {};
  for (const x of m) o[x.name] = x.value;
  return o;
}

/** 滚动时每帧耗时：在页面里用 rAF 记帧间隔，同时用 CDP 发一段滚动手势。 */
async function scrollFrames(page) {
  await page.evalMain(`window.__fr = []; (function f(t){ window.__fr.push(t); if (window.__fr.length < 400) requestAnimationFrame(f); })(performance.now()); 0`);
  await page.send('Input.synthesizeScrollGesture', { x: 200, y: 400, yDistance: -2400, speed: 1600, gestureSourceType: 'mouse' });
  const fr = await page.evalMain('window.__fr');
  const d = fr.slice(1).map((t, i) => t - fr[i]).filter((x) => x > 0).slice(2, 120);
  d.sort((a, b) => a - b);
  await page.evalMain('scrollTo(0, 0)');
  return { p50: d[Math.floor(d.length * 0.5)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] };
}

async function one(browser, url) {
  const page = await openPage(browser, { translate: mockTranslator('identity'), verbose: false });
  await page.send('Performance.enable');
  const res = { url };
  try {
    await page.goto(url, 2500);
    await page.evalMain('document.querySelectorAll("[data-deskmirror]").length');
    const before = await metrics(page);
    res.framesBefore = await scrollFrames(page);
    await sleep(300);
    const rect = { x: 260, y: 140, w: 760, h: 560 };
    const st = await page.eval(`(() => { const s = __dm.start({ rect: ${JSON.stringify(rect)}, compositorSync: false });
      return { startMs: s.startMs, nodes: s.copy.stats.nodes, buildMs: s.copy.stats.buildMs, fixedMs: s.copy.stats.fixedMs,
        units: s.units.stats.units, scanMs: s.units.stats.scanMs, fixed: s.copy.fixed.size, mode: document.compatMode }; })()`);
    Object.assign(res, st);
    await page.settle(30000);
    await sleep(1200);
    const a = decodePNG(await page.shot());
    await page.eval(`__dm.session.copy.clip.classList.add('peek')`);
    await sleep(150);
    const b = decodePNG(await page.shot());
    await page.eval(`__dm.session.copy.clip.classList.remove('peek')`);
    const d = diffImages(a, b, rect);
    res.diff = +(d.ratio * 100).toFixed(3);
    if (d.ratio > 0.0005) {
      fs.writeFileSync(path.join(OUT, `site-${name(url)}-diff.png`), encodePNG(d.image));
      fs.writeFileSync(path.join(OUT, `site-${name(url)}-mirror.png`), encodePNG(a));
    }
    // 再开一次带合成器同步的，看滚动帧耗时和内存
    await page.eval('__dm.stop()');
    await page.eval(`__dm.start({ rect: ${JSON.stringify(rect)} }); 0`);
    await page.settle(30000);
    const after = await metrics(page);
    res.heapMB = +((after.JSHeapUsedSize - before.JSHeapUsedSize) / 1048576).toFixed(1);
    res.domNodes = [before.Nodes, after.Nodes];
    res.framesAfter = await scrollFrames(page);
    const s2 = await page.eval(`(() => { const c = __dm.session.copy; return { mut: c.stats.mutBatches, mutMs: +c.stats.mutMs.toFixed(1), maxMutMs: +c.stats.maxMutMs.toFixed(1), fixed: c.fixed.size }; })()`);
    Object.assign(res, s2);
    res.errors = page.errors.length;
  } catch (e) {
    res.error = String(e.message || e).slice(0, 200);
  }
  await page.close().catch(() => {});
  return res;
}

async function main() {
  const browser = await launch({ width: W, height: H, args: ['--enable-smooth-scrolling'] });
  const list = urls.length ? urls : DEFAULT;
  for (const u of list) {
    const r = await one(browser, u);
    const f = (x) => (x ? `${x.p50.toFixed(1)}/${x.p95.toFixed(1)}/${x.max.toFixed(0)}` : '-');
    if (r.error) console.log(`✗ ${u}\n   ${r.error}`);
    else {
      console.log(`● ${u}\n   ${r.mode} 节点 ${r.nodes}，启动 ${r.startMs.toFixed(0)} ms（复制 ${r.buildMs.toFixed(0)}，固定元素 ${r.fixed} 个 ${r.fixedMs.toFixed(0)} ms，找块 ${r.units} 个 ${r.scanMs.toFixed(0)} ms）`
        + `\n   像素不一致 ${r.diff}%；内存 +${r.heapMB} MB；DOM 节点 ${r.domNodes.join('→')}`
        + `\n   滚动帧间隔 p50/p95/最大（ms）：开镜前 ${f(r.framesBefore)}，开镜后 ${f(r.framesAfter)}；变化 ${r.mut} 批 共 ${r.mutMs} ms 最长 ${r.maxMutMs} ms；页面异常 ${r.errors}`);
    }
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
