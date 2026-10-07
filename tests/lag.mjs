// 滚动跟随测试：开口左边是真网页（黑线），开口里是复制品（把线染成红色），
// 一边用滚轮滚动一边录下每一帧，量红线相对黑线偏了多少像素。
// node tests/lag.mjs [wheel|gesture] [--headful]
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib/cdp.mjs';
import { ROOT, serve, openPage, mockTranslator } from './lib/harness.mjs';
import { decodePNG } from './lib/png.mjs';

const mode = process.argv[2] || 'wheel';
const pageName = process.argv.find((a) => a.endsWith('.html')) || 'ruler.html';
// 测哪一段：page=整页滚动区（默认），fixed=顶部固定栏，pane=页面里单独滚动的区域
const region = (process.argv.find((a) => a.startsWith('--region=')) || '--region=page').slice(9);
const headful = process.argv.includes('--headful');
const W = 1280, H = 860;

function rowsOf(img, x, pred) {
  const rows = [];
  for (let y = 0; y < img.height; y++) {
    const o = (y * img.width + x) * 4;
    if (pred(img.data[o], img.data[o + 1], img.data[o + 2])) rows.push(y);
  }
  // 连续的几行算一条线，取起点
  return rows.filter((y, i) => i === 0 || rows[i - 1] !== y - 1);
}

function bestShift(black, red, range = 120) {
  if (!black.length || !red.length) return null;
  const set = new Set(black);
  let best = null, bestScore = -1;
  for (let s = -range; s <= range; s++) {
    let hit = 0;
    for (const y of red) hit += set.has(y - s) ? 2 : set.has(y - s - 1) || set.has(y - s + 1) ? 1 : 0;
    if (hit > bestScore) { bestScore = hit; best = s; }
  }
  return bestScore >= Math.min(red.length, 5) * 1.6 ? best : null;
}

async function main() {
  const server = await serve();
  const browser = await launch({ width: W, height: H, headless: !headful,
    args: ['--enable-smooth-scrolling', ...(process.argv.includes('--offscreen') ? ['--window-position=-2400,0',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'] : [])] });
  const page = await openPage(browser, { translate: mockTranslator('identity') });
  await page.goto(server.url(pageName), 300);
  const rect = region === 'page' && pageName === 'ruler.html' ? { x: 640, y: 100, w: 560, h: 600 } : { x: 640, y: 0, w: 560, h: 760 };
  const band = region === 'fixed' ? [0, 90] : region === 'pane' ? [522, 740] : region === 'page' && pageName !== 'ruler.html' ? [92, 518] : [rect.y, rect.y + rect.h];
  const wheelAt = region === 'pane' ? { x: 300, y: 630 } : { x: 300, y: 300 };
  await page.eval(`(() => { const s = __dm.start({ rect: ${JSON.stringify(rect)} });
    const sh = new s.copy.cwin.CSSStyleSheet(); sh.replaceSync('.rl{background:#f00!important}');
    s.copy.cdoc.adoptedStyleSheets = [...s.copy.cdoc.adoptedStyleSheets, sh]; return 1; })()`);
  await sleep(400);

  const frames = [];
  const { sessionId } = page;
  page.cdp.on('Page.screencastFrame', (p) => {
    frames.push({ data: p.data, meta: p.metadata, t: Date.now() });
    page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  }, sessionId);
  await page.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(300);

  if (mode === 'gesture') {
    await page.send('Input.synthesizeScrollGesture', { x: wheelAt.x, y: wheelAt.y, yDistance: -3000, speed: 2500, gestureSourceType: 'mouse' });
  } else {
    for (let i = 0; i < 30; i++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheelAt.x, y: wheelAt.y, deltaX: 0, deltaY: 120 });
      await sleep(35);
    }
  }
  await sleep(800);
  await page.send('Page.stopScreencast');

  const offs = [];
  let lastScroll = null;
  for (const f of frames) {
    const img = decodePNG(Buffer.from(f.data, 'base64'));
    const black = rowsOf(img, 300, (r, g, b) => r < 80 && g < 80 && b < 80).filter((y) => y > band[0] && y < band[1]);
    const red = rowsOf(img, 900, (r, g, b) => r > 180 && g < 90 && b < 90).filter((y) => y > band[0] && y < band[1]);
    const s = bestShift(black, red);
    const pos = region === 'pane' ? (black[0] || 0) * 1000 + (black[1] || 0) : f.meta.scrollOffsetY;
    const moving = lastScroll !== null && Math.abs(pos - lastScroll) > 0.5;
    lastScroll = pos;
    offs.push({ scroll: Math.round(f.meta.scrollOffsetY), shift: s, moving, t: f.t });
  }
  const during = offs.filter((o) => o.moving && o.shift !== null);
  const still = offs.filter((o) => !o.moving && o.shift !== null);
  const abs = (a) => a.map((o) => Math.abs(o.shift));
  const stat = (a) => (a.length ? `${a.length} 帧，偏移 0 的 ${a.filter((v) => v === 0).length} 帧，最大 ${Math.max(...a)} px，平均 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} px` : '无');
  console.log(`录到 ${frames.length} 帧（${pageName} ${region} ${mode}${headful ? '，有界面' : '，无头'}）`);
  console.log('滚动中：', stat(abs(during)));
  console.log('静止时：', stat(abs(still)));
  console.log('逐帧（滚动位置 → 红线相对黑线的偏移）：', offs.map((o) => `${o.scroll}${o.moving ? '*' : ''}→${o.shift}`).join(' '));
  fs.writeFileSync(path.join(ROOT, 'tests/out/lag-last.json'), JSON.stringify(offs));
  if (frames.length) fs.writeFileSync(path.join(ROOT, 'tests/out/lag-frame.png'), Buffer.from(frames[Math.floor(frames.length / 2)].data, 'base64'));
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
