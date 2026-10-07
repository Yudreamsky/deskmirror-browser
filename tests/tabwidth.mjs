// 镜框标签：正在用备用时状态字长，标签要加宽到放得下（最宽和镜框一样）；回到主力后恢复原宽度
// node tests/tabwidth.mjs
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
const page = await openPage(browser, { translate: mockTranslator('zh'), verbose: false });
try {
  await page.goto(server.url('article.html'), 800);
  const measure = `(() => { const f = __dm.session.frame; const s = f.status;
    return { tab: Math.round(f.tab.getBoundingClientRect().width), frame: f.rect.w, text: s.textContent,
      clipped: s.scrollWidth - s.clientWidth }; })()`;
  const engine = (m) => page.eval(`(() => { __dm.session.units.opts.backend.onEngine(${JSON.stringify(m)}); return 1; })()`);
  for (const w of [700, 420, 200]) {
    await page.eval(`(() => { if (__dm.session) __dm.stop(); __dm.start({ rect: { x: 300, y: 120, w: ${w}, h: 400 }, target: 'zh-Hans' }); return 1; })()`);
    await page.settle(20000);
    const before = await page.eval(measure);
    await engine({ idx: 1, total: 3, label: '本机 Ollama · gemma4:12b', model: 'gemma4:12b', local: true,
      primary: 'Ollama 云端模型 · gemma4:31b-cloud', reason: '这个云端模型要付费额度' });
    await sleep(100);
    const wide = await page.eval(measure);
    if (w === 700) await page.shot(path.join(ROOT, 'tests/out/tab-backup.png'));
    await engine({ idx: 0, total: 3, label: 'x', model: 'x', local: false, primary: 'x', reason: '' });
    await sleep(100);
    const back = await page.eval(measure);
    const fits = wide.clipped <= 0 || wide.tab >= w + 4;
    check(fits && back.tab === before.tab && /备用②/.test(wide.text),
      `镜框宽 ${w}：标签 ${before.tab} → 用备用 ${wide.tab}（“${wide.text}”，还差 ${Math.max(0, wide.clipped)} px）→ 回主力 ${back.tab}`);
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
