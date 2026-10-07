// 滚动以后再比：开镜子，把页面（或页面里最大的滚动区域）滚到几个位置，静止时比较开口内和真网页的像素，
// 并列出复制品里位置和真网页不一样的元素。
// node tests/scrolled.mjs <网址或测试页> [x,y,w,h]
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, serve, openPage, mockTranslator } from './lib/harness.mjs';
import { decodePNG, encodePNG, diffImages } from './lib/png.mjs';

const [target, rectArg] = process.argv.slice(2);
const [rx, ry, rw, rh] = (rectArg || '60,300,560,380').split(',').map(Number);
const rect = { x: rx, y: ry, w: rw, h: rh };

async function main() {
  const server = await serve();
  const url = /^https?:/.test(target) ? target : server.url(target);
  const headful = process.argv.includes('--headful');
  const browser = await launch({ width: 1280, height: 860, headless: !headful, args: headful ? ['--window-position=-2400,0',
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] : [] });
  const mode = process.argv.includes('--zh') ? 'zh' : 'identity';
  const page = await openPage(browser, { translate: mockTranslator(mode), verbose: false });
  try {
    await page.goto(url, 3000);
    // 找滚动的是谁：整页，还是页面里的某个区域
    const who = await page.evalMain(`(() => { const se = document.scrollingElement;
      if (se.scrollHeight > se.clientHeight + 50) return { doc: true, max: se.scrollHeight - se.clientHeight };
      let best = null;
      for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el);
        if (!/auto|scroll|hidden/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 50 || el.clientHeight < 200) continue;
        const r = el.getBoundingClientRect(); const area = r.width * r.height;
        if (!best || area > best.area) best = { area, el }; }
      if (!best) return { doc: true, max: 0 };
      best.el.setAttribute('data-test-scroller', '1');
      return { doc: false, max: best.el.scrollHeight - best.el.clientHeight, tag: best.el.localName, cls: String(best.el.className).slice(0, 60) }; })()`);
    console.log('滚动的是：', JSON.stringify(who));
    await page.eval(`(() => { __dm.start({ rect: ${JSON.stringify(rect)} }); return 1; })()`);
    await page.settle(20000);
    for (const frac of [0, 0.25, 0.6]) {
      const y = Math.round(who.max * frac);
      await page.evalMain(who.doc ? `scrollTo(0, ${y}); 0` : `document.querySelector('[data-test-scroller]').scrollTop = ${y}; 0`);
      await sleep(900);
      const a = decodePNG(await page.shot());
      await page.eval(`__dm.session.copy.clip.classList.add('peek')`);
      await sleep(150);
      const b = decodePNG(await page.shot());
      await page.eval(`__dm.session.copy.clip.classList.remove('peek')`);
      const d = diffImages(a, b, rect, mode === 'zh' ? 255 : 60);
      const base = path.join(ROOT, 'tests/out', `scrolled-${Math.round(frac * 100)}`);
      fs.writeFileSync(base + '.png', encodePNG(a));
      fs.writeFileSync(base + '-diff.png', encodePNG(d.image));
      // 复制品里元素的“看到的位置” = 复制品里的位置 + 我们加的平移（base、合成器补偿、固定元素反向补偿）
      const off = await page.eval(`(() => { const s = __dm.session, c = s.copy; const out = [];
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > ${rect.y} && r.top < ${rect.y + rect.h} && r.right > ${rect.x} && r.left < ${rect.x + rect.w}; };
        const shown = (ce) => { const r = ce.getBoundingClientRect(); const m = new DOMMatrix(getComputedStyle(c.ty).transform);
          const bt = new DOMMatrix(getComputedStyle(c.base).transform); let dy = m.m42 + bt.m42;
          for (let p = ce; p; p = p.parentElement) { const a = c.cwin.getComputedStyle(p).translate; if (a && a !== 'none') { const v = a.split(' ')[1]; if (v) dy += parseFloat(v); } }
          return r.top + dy; };
        // 排进译文的块里面的元素（链接、加粗……）本来就会因为译文换位置，不算
        const inUnit = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const u = s.units.byNode.get(p); if (u && u.rendered) return true; } return false; };
        for (const el of document.body.querySelectorAll('*')) { if (!vis(el) || inUnit(el)) continue; const ce = c.map.get(el); if (!ce || !ce.isConnected) continue;
          const d = shown(ce) - el.getBoundingClientRect().top; if (Math.abs(d) > 2) out.push({ d: Math.round(d), tag: el.localName, cls: String(el.className).slice(0, 50),
            pos: getComputedStyle(el).position }); }
        return out.slice(0, 8); })()`).catch((e) => String(e));
      console.log(`滚到 ${y}：像素差 ${(d.ratio * 100).toFixed(2)}%`, Array.isArray(off) && off.length ? '错位：' + JSON.stringify(off) : (typeof off === 'string' ? off : ''));
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
