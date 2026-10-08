// 画布当底、上面压着网页元素做的节点（Comfy Cloud 节点 2.0 的结构，tests/pages/canvas-nodes.html）：
//  1. 假中文：Markdown 说明、参数说明这些压在画布上的块，镜子里露出译文；
//     输入框、下拉框、提示词文本框、节点里的小画布、空白画布照旧露出真网页
//  2. 译文=原文：镜子里和真网页几乎一样（只有直接画在画布上、没有底色的标签会多一块底）
//  3. 平移画布（改容器的 transform，Comfy 拖动画布就是这样）后，露出来的译文跟着走
// node tests/canvas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, serve, openPage, mockTranslator } from './lib/harness.mjs';
import { decodePNG, encodePNG, diffImages } from './lib/png.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};
const pct = (d) => (d.ratio * 100).toFixed(2) + '%';

const OUT = path.join(ROOT, 'tests/out');
const rect = { x: 20, y: 60, w: 780, h: 600 };
const server = await serve();
const browser = await launch({ width: 1280, height: 860 });
try {
  for (const mode of ['zh', 'identity']) {
    const page = await openPage(browser, { translate: mockTranslator(mode), verbose: false });
    await page.goto(server.url('canvas-nodes.html'), 500);
    await page.eval(`(() => { __dm.start({ rect: ${JSON.stringify(rect)}, target: 'zh-Hans', concurrency: 3, compositorSync: false }); return 1; })()`);
    await page.settle(20000);
    await sleep(500);
    // 同一画面：开着镜子 / 把复制品藏起来（就是真网页）
    const pair = async (name) => {
      const a = await page.shot(path.join(OUT, `canvas-${mode}-${name}.png`));
      await page.eval(`__dm.session.copy.clip.classList.add('peek')`);
      await sleep(150);
      const b = await page.shot();
      await page.eval(`__dm.session.copy.clip.classList.remove('peek')`);
      await sleep(150);
      return [decodePNG(a), decodePNG(b)];
    };
    const regions = () => page.eval(`(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left) + 2, y: Math.round(b.top) + 2, w: Math.round(b.width) - 4, h: Math.round(b.height) - 4 }; };
      const $ = (s) => document.querySelector(s);
      return { md: r($('.md')), help: r($('#sampler p')), textarea: r($('textarea')), input: r($('#sampler input')), select: r($('select')),
        preview: r($('#three')), empty: { x: 700, y: 600, w: 90, h: 50 } }; })()`);
    const [a, b] = await pair('before');
    const R = await regions();
    const d = Object.fromEntries(Object.entries(R).map(([k, v]) => [k, diffImages(a, b, v)]));
    const clip = await page.eval(`__dm.session.copy.clip.style.clipPath`);
    const rings = (clip.match(/M/g) || []).length;
    if (mode === 'zh') {
      check(d.md.ratio > 0.05 && d.help.ratio > 0.05,
        `压在画布上的块露出译文：Markdown 说明 ${pct(d.md)} 的像素变了，参数说明 ${pct(d.help)}（剪裁路径 ${rings} 段）`);
      check(d.textarea.ratio === 0 && d.input.ratio === 0 && d.select.ratio === 0,
        `输入框、下拉框、提示词文本框照旧是真网页（${pct(d.input)}、${pct(d.select)}、${pct(d.textarea)}）`);
      check(d.preview.ratio === 0 && d.empty.ratio === 0, `节点里的小画布、空白画布照旧是真网页（${pct(d.preview)}、${pct(d.empty)}）`);
      const scrolled = await page.eval(`(() => { const s = __dm.session; const md = document.querySelector('.md'); md.scrollTop = 60;
        return new Promise((ok) => setTimeout(() => ok(s.copy.map.get(md).scrollTop), 400)); })()`);
      const [a2, b2] = await pair('scrolled');
      const d2 = diffImages(a2, b2, (await regions()).md);
      check(scrolled === 60 && d2.ratio > 0.05, `说明框里往下滚：复制品跟着滚到 ${scrolled}，露出的还是译文（${pct(d2)}）`);
    } else {
      const all = diffImages(a, b, rect);
      fs.writeFileSync(path.join(OUT, 'canvas-identity-diff.png'), encodePNG(all.image));
      check(all.ratio < 0.003, `译文=原文：镜框内 ${pct(all)} 的像素不同（${all.bad} 个，只应在没有底色的画布标签那里）`);
    }
    // 平移画布：容器的 transform 变了，露出来的块跟着走
    await page.eval(`(() => { document.getElementById('layer').style.transform = 'matrix(1.1, 0, 0, 1.1, 120, 70)'; return 1; })()`);
    await sleep(400);
    const [a3, b3] = await pair('panned');
    const R3 = await regions();
    if (mode === 'zh') {
      const dm = diffImages(a3, b3, R3.md), dt = diffImages(a3, b3, R3.textarea);
      check(dm.ratio > 0.05 && dt.ratio === 0, `平移以后：说明块的译文跟着走（${pct(dm)}），文本框照旧是真网页（${pct(dt)}）`);
    } else {
      const all = diffImages(a3, b3, rect);
      check(all.ratio < 0.003, `平移以后，译文=原文：镜框内 ${pct(all)} 不同`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
