// 自测入口：node tests/run.mjs <命令> [网址或测试页] [--ollama] [--keep]
//   identity  译文=原文：开口里应该和真网页像素一致（检验复制和锁大小有没有走样）
//   zh        假中文译文：检查每块在复制品里的位置和原文一致，存截图
//   real      本机 Ollama 真翻译，存截图
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, serve, openPage, mockTranslator, ollamaTranslator } from './lib/harness.mjs';
import { decodePNG, encodePNG, diffImages } from './lib/png.mjs';

const OUT = path.join(ROOT, 'tests/out');
fs.mkdirSync(OUT, { recursive: true });

const [cmd = 'identity', target = 'article.html', ...flags] = process.argv.slice(2);
const has = (f) => flags.includes(f);
const W = 1280, H = 860;

function nameOf(u) {
  return u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
}

async function main() {
  const server = await serve();
  const url = /^https?:/.test(target) ? target : server.url(target);
  const browser = await launch({ width: W, height: H });
  const log = [];
  const translate = cmd === 'identity' ? mockTranslator('identity')
    : cmd === 'real' ? ollamaTranslator(process.env.MODEL || 'gemma4:12b', log) : mockTranslator('zh');
  const page = await openPage(browser, { translate });
  try {
    await page.goto(url, 800);
    const vp = await page.eval('({ w: innerWidth, h: innerHeight, mode: document.compatMode })');
    const rect = { x: 300, y: 120, w: 700, h: 560 };
    const t0 = Date.now();
    const started = await page.eval(`(() => { const s = __dm.start({ rect: ${JSON.stringify(rect)}, target: 'zh-Hans', concurrency: ${cmd === 'real' ? 1 : 3} });
      return { startMs: s.startMs, nodes: s.copy.stats.nodes, buildMs: s.copy.stats.buildMs, units: s.units.stats.units, scanMs: s.units.stats.scanMs }; })()`);
    console.log(`页面 ${vp.w}x${vp.h} ${vp.mode}；启动 ${started.startMs.toFixed(0)} ms（复制 ${started.nodes} 个节点 ${started.buildMs.toFixed(0)} ms，找到 ${started.units} 块 ${started.scanMs.toFixed(0)} ms）`);
    const ok = await page.settle(cmd === 'real' ? 240000 : 30000);
    await sleep(500);
    const st = await page.eval(`(() => { const u = __dm.session.units; const c = __dm.session.copy;
      return { ...u.stats, mut: c.stats.mutBatches, mutMs: c.stats.mutMs, maxMutMs: c.stats.maxMutMs, error: u.error }; })()`);
    console.log(`翻译${ok ? '完成' : '未完成'}，用时 ${((Date.now() - t0) / 1000).toFixed(1)} s：`, JSON.stringify(st));

    const base = path.join(OUT, `${cmd}-${nameOf(url)}`);
    const withMirror = decodePNG(await page.shot(base + '-mirror.png'));
    await page.eval(`__dm.session.copy.frame.classList.add('peek')`);
    await sleep(120);
    const plain = decodePNG(await page.shot(base + '-plain.png'));
    await page.eval(`__dm.session.copy.frame.classList.remove('peek')`);

    if (cmd === 'identity') {
      const d = diffImages(withMirror, plain, rect);
      fs.writeFileSync(base + '-diff.png', encodePNG(d.image));
      console.log(`开口内像素不一致 ${(d.ratio * 100).toFixed(3)}%（${d.bad}/${d.total}，最大色差 ${d.maxd}）→ ${path.relative(ROOT, base)}-diff.png`);
    } else {
      // 对齐：复制品里每个锁住的块和真网页上同一块的位置差
      const a = await page.eval(`(() => {
        const s = __dm.session; let n = 0, worst = 0, sum = 0, bad = [];
        for (const u of s.units.byNode.values()) {
          if (!u.rendered || u.kind !== 'block') continue;
          const c = s.copy.map.get(u.node); if (!c) continue;
          const r1 = u.node.getBoundingClientRect(), r2 = c.getBoundingClientRect();
          const d = Math.max(Math.abs(r1.left - r2.left), Math.abs(r1.top - r2.top), Math.abs(r1.width - r2.width), Math.abs(r1.height - r2.height));
          n++; sum += d; if (d > worst) worst = d;
          if (d > 1 && bad.length < 8) bad.push({ tag: u.node.localName, cls: u.node.className, d: Math.round(d), src: u.src.slice(0, 50) });
        }
        return { n, worst, avg: n ? sum / n : 0, bad };
      })()`);
      console.log(`已排进复制品的块 ${a.n} 个，位置最大偏差 ${a.worst.toFixed(2)} px，平均 ${a.avg.toFixed(3)} px`);
      if (a.bad.length) console.log('偏差大的：', JSON.stringify(a.bad, null, 1));
      if (cmd === 'real' && log.length) {
        const ms = log.map((x) => x.ms);
        console.log(`Ollama ${log.length} 批，每批 ${Math.min(...ms)}–${Math.max(...ms)} ms`);
      }
    }
    if (page.errors.length) console.log(`页面异常 ${page.errors.length} 个`);
    console.log('截图：', path.relative(ROOT, base) + '-mirror.png');
  } finally {
    if (!has('--keep')) {
      await browser.close();
      server.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
