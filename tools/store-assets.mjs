// 商店素材，放在 store/images：
//   1-mirror-zh.png、2-mirror-en.png   截图 1280×800：演示页上打开魔镜（本机 Ollama gemma4:12b 真翻译）
//   3-settings-zh.png、4-settings-en.png 截图 1280×800：上架版的设置页（备用阵列；先 node tools/pack.mjs）
//   promo-440x280-zh.png、promo-440x280-en.png  小宣传图
// node tools/store-assets.mjs [mirror|settings|promo]（不写就全部）
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from '../tests/lib/cdp.mjs';
import { ROOT, serve, openPage, ollamaTranslator } from '../tests/lib/harness.mjs';
import { launchWithExtension } from '../tests/lib/ext.mjs';

const OUT = path.join(ROOT, 'store/images');
fs.mkdirSync(OUT, { recursive: true });
const what = process.argv[2] || 'all';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;

async function exact(send, width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {});
}

async function mirrorShots(server) {
  const browser = await launch({ width: 1280, height: 800 });
  try {
    for (const [file, page, native] of [['1-mirror-zh.png', 'demo-en.html', 'zh-Hans'], ['2-mirror-en.png', 'demo-zh.html', 'en']]) {
      const p = await openPage(browser, { translate: ollamaTranslator('gemma4:12b'), verbose: false });
      await exact(p.send, 1280, 800);
      await p.goto(server.url(page), 800);
      await p.eval(`(() => { __dm.start({ rect: { x: 334, y: 86, w: 880, h: 620 }, native: '${native}', target: '${native}',
        concurrency: 1 }); return 1; })()`);
      const done = await p.settle(300000);
      await sleep(1000);
      await p.shot(path.join(OUT, file));
      const st = await p.eval('__dm.session.units.stats');
      console.log(`${file}：${done ? '译完' : '没等到全部译完'}，${st.rendered} 块`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

// 示例阵列：Ollama 云端（后台记着要付费额度，暂时跳过）→ 本机 Ollama → DeepSeek（没填 Key）
const DEMO = [{ preset: 'ollama-cloud-local', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:31b-cloud' },
  { preset: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b' },
  { preset: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }];
const SKIP = { zh: '这个云端模型要付费额度：Ollama 订阅已到期，或免费额度不含它。',
  en: 'This cloud model needs paid usage: the Ollama subscription has expired or the free tier does not include it.' };

async function settingsShots() {
  const stage = path.join(ROOT, 'dist', 'deskmirror-browser-' + version);
  if (!fs.existsSync(path.join(stage, 'manifest.json'))) throw new Error('先运行 node tools/pack.mjs');
  for (const [file, lang, native] of [['3-settings-zh.png', 'zh-CN', 'zh-Hans'], ['4-settings-en.png', 'en-US', 'en']]) {
    const b = await launchWithExtension({ lang });
    try {
      const id = await b.load(stage);
      const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
      const op = await b.attach(t.targetId);
      await exact((m, p) => b.cdp.send(m, p, op.sessionId), 1280, 800);
      await sleep(1000);
      const ui = native === 'en' ? 'en' : 'zh';
      await op.eval(`(async () => {
        await chrome.storage.local.set({ settings: { native: '${native}', target: '${native}', source: 'auto', chain: ${JSON.stringify(DEMO)} } });
        await new Promise((r) => setTimeout(r, 600));
        const e = window.__dm.presets.chainOf({ chain: [${JSON.stringify(DEMO[0])}] })[0];
        await chrome.storage.session.set({ health: { [window.__dm.chain.keyOf(e)]: { until: Date.now() + 25 * 60000, fails: 1, hard: true,
          error: ${JSON.stringify(SKIP.zh)}.length && ${JSON.stringify(ui)} === 'en' ? ${JSON.stringify(SKIP.en)} : ${JSON.stringify(SKIP.zh)}, at: Date.now() } } });
        location.replace('options.html'); })()`).catch(() => {});
      await sleep(3000);
      // 选中 DeepSeek（没填 Key，不会去拉模型列表），滚到“翻译服务”
      await op.eval(`(() => { document.querySelectorAll('#chain .eng')[2].click();
        const card = document.querySelectorAll('.card')[1]; window.scrollTo(0, card.getBoundingClientRect().top + scrollY - 14); return 1; })()`);
      await sleep(800);
      await op.shot(path.join(OUT, file));
      console.log(file);
    } finally {
      await b.close();
    }
  }
}

async function promo(server) {
  const browser = await launch({ width: 440, height: 280 });
  try {
    for (const lang of ['zh', 'en']) {
      const p = await openPage(browser, { verbose: false });
      await exact(p.send, 440, 280);
      await p.goto(server.url('promo.html?lang=' + lang), 600);
      await p.shot(path.join(OUT, `promo-440x280-${lang}.png`));
      console.log(`promo-440x280-${lang}.png`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

const server = await serve(path.join(ROOT, 'store/pages'));
try {
  if (what === 'all' || what === 'promo') await promo(server);
  if (what === 'all' || what === 'settings') await settingsShots();
  if (what === 'all' || what === 'mirror') await mirrorShots(server);
} finally {
  server.close();
}
