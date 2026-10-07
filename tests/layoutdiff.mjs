// 调试用：列出真网页和复制品里位置、大小不一样的元素（不翻译，译文=原文）
// node tests/layoutdiff.mjs <网址> [选择器（要看结构的元素）]
import { launch, sleep } from './lib/cdp.mjs';
import { openPage, mockTranslator } from './lib/harness.mjs';
const [url, probe] = process.argv.slice(2);
const browser = await launch({ width: 1280, height: 860 });
const page = await openPage(browser, { translate: mockTranslator('identity'), verbose: false });
await page.goto(url, 2500);
const r = await page.eval(`(async () => { const s = __dm.start({ rect: {x:260,y:140,w:760,h:560}, compositorSync: false, noTranslate: ${process.argv.includes('--raw')} });
  await new Promise(r => setTimeout(r, 1500));
  const cw = s.copy.cwin; const out = []; let n = 0, detached = 0;
  for (const el of document.body.querySelectorAll('*')) { const c = s.copy.map.get(el); if (!c) continue; const a = el.getBoundingClientRect(); if (a.bottom < 0 || a.top > innerHeight || !a.width) continue; n++;
    if (!c.isConnected) { detached++; continue; }
    const b = c.getBoundingClientRect(); const d = Math.max(Math.abs(a.left-b.left), Math.abs(a.top-b.top), Math.abs(a.width-b.width), Math.abs(a.height-b.height));
    if (d > 0.5) { const ca = getComputedStyle(el), cb = cw.getComputedStyle(c); const diffs = [];
      for (const p of ['display','width','height','fontFamily','fontSize','fontWeight','lineHeight','padding','margin','boxSizing','position','flex','whiteSpace','letterSpacing','contentVisibility']) if (ca[p] !== cb[p]) diffs.push(p + ': ' + ca[p] + ' | ' + cb[p]);
      out.push({ d: +d.toFixed(1), tag: el.localName, cls: String(el.className).slice(0,50), a: [a.left,a.top,a.width,a.height].map(v=>+v.toFixed(1)), b: [b.left,b.top,b.width,b.height].map(v=>+v.toFixed(1)), diffs, attrs: [...el.attributes].map(x => x.name + '=' + x.value.slice(0, 40)).slice(0, 6) }); } }
  out.sort((x, y) => (x.a[1] - y.a[1]) || (x.a[0] - y.a[0]));
  let html = ''; const pe = ${JSON.stringify(probe || '')} && document.querySelector(${JSON.stringify(probe || 'x')}); if (pe) html = pe.outerHTML.slice(0, 1200);
  return { n, detached, bad: out.length, list: out.slice(0, 10), html }; })()`);
console.log(JSON.stringify(r, null, 1));
await browser.close();
