// 上架包自测：先 node tools/pack.mjs，再装上解开的上架包（不是源码文件夹）走一遍：
//  - 设置页：名字、服务商列表里没有编程订阅套餐和测试用假翻译；假装是从商店装的：不显示“检查更新”
//  - 后台：从商店装的只有前两位版本变了才打开“更新了什么”
//  - 网页上打开魔镜，用本机的假翻译服务真的译出来
// node tests/store.mjs
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './lib/cdp.mjs';
import { ROOT, serve } from './lib/harness.mjs';
import { launchWithExtension } from './lib/ext.mjs';
import { fakeService } from './lib/fake-llm.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;
const STAGE = path.join(ROOT, 'dist', 'deskmirror-browser-' + version);
if (!fs.existsSync(path.join(STAGE, 'manifest.json'))) {
  console.error('先运行 node tools/pack.mjs');
  process.exit(1);
}

const ok = await fakeService('ok');
const pages = await serve();
const b = await launchWithExtension({ lang: 'zh-CN' });
try {
  const id = await b.load(STAGE);
  const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
  const op = await b.attach(t.targetId);
  const swT = await b.waitTarget((x) => x.type === 'service_worker' && x.url.includes(id));
  const sw = await b.attach(swT.targetId);
  await sleep(1500);
  const ui = await op.eval(`({ title: document.title, ids: [...document.querySelectorAll('#preset option')].map((o) => o.value),
    groups: [...document.querySelectorAll('#preset optgroup')].map((g) => g.label), about: !!document.getElementById('reward') })`);
  const gone = ['glm-coding', 'zai-coding', 'kimi-code', 'bailian-coding', 'ark-coding', 'minimax-plan', 'mock'].filter((x) => ui.ids.includes(x));
  check(ui.title === '桌面魔镜（浏览器版）' && !gone.length && ui.ids.includes('ollama-cloud-local') && ui.ids.includes('deepseek') && ui.about,
    `设置页“${ui.title}”：服务商 ${ui.ids.length} 个，分组 ${ui.groups.join('、')}，没有编程套餐和假翻译`);
  const store = await op.eval(`(() => { installType = 'normal'; render(); const $ = (i) => document.getElementById(i);
    return { version: $('version').textContent, check: $('check').hidden, upgrade: $('upgrade').hidden, msg: $('updateMsg').textContent }; })()`);
  check(store.check && store.upgrade && /自动更新/.test(store.msg) && !/开发者模式/.test(store.version),
    `假装从商店装的：“${store.version}”，“${store.msg}”，没有“检查更新”`);
  const upd = await sw.eval(`[showUpdate('0.3.1', '0.4.0', 'normal'), showUpdate('0.4.0', '0.4.1', 'normal'), showUpdate('0.4.0', '0.4.1', 'development')]`);
  check(upd[0] && !upd[1] && upd[2], `更新后打开设置页：商店版 0.3→0.4 打开、0.4.0→0.4.1 不打扰；开发者模式都打开（${upd.join(', ')}）`);

  // 网页上打开魔镜，用假翻译服务（OpenAI 兼容接口）译出来
  ok.tag = '译';
  await op.eval(`chrome.storage.local.set({ settings: { native: 'zh-Hans', target: 'zh-Hans', source: 'auto', savedAt: Date.now(),
    chain: [{ preset: 'openai-custom', protocol: 'openai', baseUrl: ${JSON.stringify(ok.url + '/v1')}, model: 'm', apiKey: 'test-key' }] } }).then(() => 1)`);
  const url = pages.url('article.html');
  const tab = await b.cdp.send('Target.createTarget', { url });
  const page = await b.attach(tab.targetId);
  await sleep(1200);
  await sw.eval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); return 1; })`);
  await sleep(3000);
  const ctx = page.isolated(id);
  const st = await page.eval(`(() => { const s = __dm.session; const done = [...s.units.byNode.values()].filter((u) => u.rendered);
    return { status: s.frame.status.textContent, rendered: done.length, hits: 0 }; })()`, ctx);
  check(st.rendered > 0 && ok.hits.length > 0 && /就绪|翻译中/.test(st.status),
    `魔镜：请求了 ${ok.hits.length} 批，排进 ${st.rendered} 块，标签“${st.status}”`);
  await page.shot(path.join(ROOT, 'tests/out/store-mirror.png'));
} finally {
  await b.close();
  ok.close();
  pages.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
