// 备用阵列：装上扩展，用本机的假服务（402 额度用完、410 下线、不回话、译到一半断开、连不上、正常）走一遍：
//  1. 后台：换下一个、只把剩下的段落交出去、出错的先跳过、“保存”后重新从主力试起、都失败时列出每个的错误
//  2. 网页上的魔镜：标签上显示“备用② …”，鼠标停上去看主力为什么不能用；主力好了就回到主力
//  3. 设置页：旧设置变成只有主力的阵列；添加、改、上移、删除、保存；测试全部；显示后台记的“暂时跳过”
// node tests/chain.mjs
import path from 'node:path';
import { sleep } from './lib/cdp.mjs';
import { ROOT, serve } from './lib/harness.mjs';
import { launchWithExtension } from './lib/ext.mjs';
import { fakeService, deadPort } from './lib/fake-llm.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};

const eng = (url, model) => ({ preset: 'openai-custom', protocol: 'openai', baseUrl: url + '/v1', model: model || 'm', apiKey: 'test-key' });
const SEGS = ['alpha one', 'beta two', 'gamma three', 'delta four'];

const pay = await fakeService('pay');
const gone = await fakeService('gone');
const hang = await fakeService('hang');
const half = await fakeService('half');
const ok = await fakeService('ok');
const dead = await deadPort();
const pages = await serve();
const b = await launchWithExtension({ lang: 'zh-CN' });
try {
  const id = await b.load(path.join(ROOT, 'extension'));
  const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
  const op = await b.attach(t.targetId);
  const swT = await b.waitTarget((x) => x.type === 'service_worker' && x.url.includes(id));
  const sw = await b.attach(swT.targetId);
  await sleep(1200);
  // 测试里把时限改短（本机地址算本机模型）
  await sw.eval('Object.assign(TIMEOUTS, { first: 1500, between: 1500, firstLocal: 1500, betweenLocal: 1500 }); 1');

  // 设置页里开一个和内容脚本一样的连接，发批次（设置页重新载入后要再装一次）
  const helpers = () => op.eval(`window.T_open = () => {
      const port = chrome.runtime.connect({ name: 'dm-translate' });
      const st = { port, engine: [], jobs: {} };
      port.onMessage.addListener((m) => {
        if (m.type === 'engine') { st.engine.push(m); return; }
        const j = st.jobs[m.id]; if (!j) return;
        if (m.type === 'seg') j.segs[m.i] = m.text; else { j.done = m; j.finish(); }
      });
      return st;
    };
    window.T_batch = (st, id, segments) => new Promise((resolve) => {
      const j = st.jobs[id] = { segs: {}, done: null, t0: performance.now() };
      j.finish = () => resolve({ segs: j.segs, error: j.done.error || '', ms: Math.round(performance.now() - j.t0) });
      st.port.postMessage({ type: 'batch', id, segments, source: 'auto', target: 'zh-Hans', context: '' });
    }); 1`);
  await helpers();
  let seq = 0;
  const setChain = async (chain, extra) => {
    await op.eval(`chrome.storage.local.set({ settings: ${JSON.stringify(Object.assign({ native: 'zh-Hans', target: 'zh-Hans',
      source: 'auto', chain, savedAt: Date.now() + ++seq }, extra || {}))} }).then(() => 1)`);
    await sleep(250);
  };
  const run = (port, id) => op.eval(`T_batch(${port}, ${id}, ${JSON.stringify(SEGS)}).then((r) => Object.assign(r, { engine: ${port}.engine.slice() }))`);
  const health = () => op.eval(`chrome.storage.session.get('health').then(({ health }) => health || {})`);

  // ---------------------------------------------------------------- 1. 后台
  await setChain([eng(pay.url, 'm-pay'), eng(ok.url, 'm-ok')]);
  await op.eval('window.P1 = T_open(); 1');
  const r1 = await run('P1', 1);
  check(Object.values(r1.segs).every((s) => s.startsWith('B:')) && Object.keys(r1.segs).length === 4 && !r1.error,
    `主力 402：四段都由备用译出（${Object.values(r1.segs).join(' | ')}）`);
  const e1 = r1.engine[0] || {};
  check(r1.engine.length === 1 && e1.idx === 1 && /127\.0\.0\.1:\d+ · m-ok/.test(e1.label) && /402/.test(e1.reason) && e1.local === true,
    `通知网页换成备用：idx ${e1.idx}，“${e1.label}”，原因“${e1.reason}”`);
  const r2 = await run('P1', 2);
  check(pay.hits.length === 1 && Object.keys(r2.segs).length === 4 && r2.engine.length === 1,
    `第二批直接用备用（主力只被请求过 ${pay.hits.length} 次，没再通知）`);
  const h1 = await health();
  const hp = Object.entries(h1).find(([k]) => k.includes(pay.url));
  check(hp && hp[1].hard && hp[1].until - Date.now() > 29 * 60000, `出错记录：主力跳过 ${hp ? Math.round((hp[1].until - Date.now()) / 60000) : '?'} 分钟（存在 storage.session）`);
  await setChain([eng(pay.url, 'm-pay'), eng(ok.url, 'm-ok')]);
  check(Object.keys(await health()).length === 0, '“保存”（savedAt 变了）：出错记录清空');
  await run('P1', 3);
  check(pay.hits.length === 2, '保存后重新从主力试起（主力又被请求了一次）');

  await setChain([eng(half.url, 'm-half'), eng(ok.url, 'm-ok')]);
  ok.hits.length = 0;
  const r4 = await run('T_open()', 4);
  check(r4.segs[0] === 'H:alpha one' && r4.segs[1] === 'H:beta two' && r4.segs[2] === 'B:gamma three' && r4.segs[3] === 'B:delta four'
    && ok.hits.length === 1 && ok.hits[0].segments.length === 2,
    `译到一半断开：前两段留下，备用只收到剩下的 ${ok.hits[0] ? ok.hits[0].segments.length : '?'} 段（${Object.values(r4.segs).join(' | ')}）`);

  await setChain([eng(hang.url, 'm-hang'), eng(ok.url, 'm-ok')]);
  const r5 = await run('T_open()', 5);
  const h5 = Object.entries(await health()).find(([k]) => k.includes(hang.url));
  check(Object.keys(r5.segs).length === 4 && r5.ms >= 1400 && r5.ms < 4000 && h5 && !h5[1].hard && /1 秒|2 秒/.test(h5[1].error),
    `不回话：${r5.ms} ms 后换备用；记录“${h5 && h5[1].error}”，跳过 ${h5 ? Math.round((h5[1].until - Date.now()) / 1000) : '?'} 秒`);

  await setChain([{ preset: 'openai-custom', protocol: 'openai', baseUrl: dead + '/v1', model: 'm', apiKey: 'k' }, eng(ok.url, 'm-ok')]);
  const r6 = await run('T_open()', 6);
  check(Object.keys(r6.segs).length === 4 && !r6.error, `连不上（${dead}）：换备用`);

  await setChain([eng(pay.url, 'm-pay'), eng(gone.url, 'm-gone')]);
  const r7 = await run('T_open()', 7);
  check(Object.keys(r7.segs).length === 0 && /都失败了：① .*402.*；② .*410/.test(r7.error), `都失败了：“${r7.error}”`);

  // ---------------------------------------------------------------- 2. 网页上的魔镜
  pay.mode = 'pay';
  await setChain([eng(pay.url, 'm-pay'), { preset: 'mock', protocol: 'mock' }],
    { preset: 'openai-custom', protocol: 'openai', baseUrl: pay.url + '/v1', model: 'm-pay' });
  const url = pages.url('article.html');
  const tab = await b.cdp.send('Target.createTarget', { url });
  const page = await b.attach(tab.targetId);
  await sleep(1200);
  await sw.eval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); return 1; })`);
  await sleep(2500);
  const ctx = page.isolated(id);
  const st1 = await page.eval(`(() => { const s = __dm.session; return { text: s.frame.status.textContent, tip: s.frame.status.title,
    bk: (s.frame.status.querySelector('.bk') || {}).textContent || '', conc: s.units.opts.concurrency,
    rendered: [...s.units.byNode.values()].filter((u) => u.rendered).length }; })()`, ctx);
  check(/备用② 测试用假翻译/.test(st1.bk) && /主力（127\.0\.0\.1:\d+ · m-pay）出错：.*402/.test(st1.tip) && st1.conc === 3 && st1.rendered > 0,
    `魔镜标签：“${st1.text}”，鼠标停上去：“${st1.tip.replace(/\n/g, ' / ')}”，并发 ${st1.conc}，已排进 ${st1.rendered} 块`);
  await page.shot(path.join(ROOT, 'tests/out/chain-mirror.png'));
  // 主力好了：保存一下（清空出错记录），换个方向让它重翻
  pay.mode = 'ok';
  pay.tag = 'M';
  await setChain([eng(pay.url, 'm-pay'), { preset: 'mock', protocol: 'mock' }],
    { preset: 'openai-custom', protocol: 'openai', baseUrl: pay.url + '/v1', model: 'm-pay', target: 'ja' });
  await sleep(2500);
  const st2 = await page.eval(`(() => { const s = __dm.session; return { text: s.frame.status.textContent, bk: !!s.frame.status.querySelector('.bk'),
    conc: s.units.opts.concurrency, target: s.units.opts.target }; })()`, ctx);
  check(!st2.bk && st2.target === 'ja' && st2.conc === 1, `主力恢复后回到主力：标签“${st2.text}”，并发 ${st2.conc}（本机地址）`);

  // ---------------------------------------------------------------- 3. 设置页
  pay.mode = 'pay';
  await op.eval(`chrome.storage.local.set({ settings: { native: 'zh-Hans', target: 'zh-Hans', source: 'auto', preset: 'openai-custom',
    protocol: 'openai', baseUrl: ${JSON.stringify(pay.url + '/v1')}, model: 'm-pay', apiKey: 'test-key' } }).then(() => 1)`);
  await op.eval('location.reload(); 1').catch(() => {});
  await sleep(1800);
  await helpers();
  const rows = () => op.eval(`[...document.querySelectorAll('#chain .eng')].map((r) => ({ name: r.querySelector('.name').textContent,
    role: r.querySelector('.role').textContent, sel: r.classList.contains('sel'), state: (r.querySelector('.state') || {}).textContent || '' }))`);
  const v0 = await rows();
  const ui0 = await op.eval(`({ testAll: document.getElementById('testAll').hidden, editing: document.getElementById('editing').hidden })`);
  check(v0.length === 1 && /127\.0\.0\.1:\d+ · m-pay/.test(v0[0].name) && v0[0].role === '主力' && ui0.testAll && ui0.editing,
    `旧设置变成只有主力的阵列：“${v0.map((r) => r.role + ' ' + r.name).join('，')}”`);
  // 添加备用 → 改成正常的假服务
  const v1 = await op.eval(`(async () => { const $ = (i) => document.getElementById(i);
    $('addEngine').click(); await new Promise((r) => setTimeout(r, 300));
    const first = $('preset').value;
    $('preset').value = 'openai-custom'; $('preset').dispatchEvent(new Event('change'));
    $('baseUrl').value = ${JSON.stringify(ok.url + '/v1')}; $('baseUrl').dispatchEvent(new Event('input'));
    $('model').value = 'm-ok'; $('model').dispatchEvent(new Event('input'));
    $('apiKey').value = 'test-key'; $('apiKey').dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    return { first, editing: $('editing').textContent, unsaved: $('unsaved').textContent }; })()`);
  const v1r = await rows();
  check(v1.first === 'ollama' && v1r.length === 2 && v1r[1].sel && /127\.0\.0\.1:\d+ · m-ok/.test(v1r[1].name) && v1.editing === '下面改的是 ② 备用'
    && /还没保存/.test(v1.unsaved), `添加备用：默认先给本机 Ollama，改成假服务后列表显示“${v1r[1].name}”，“${v1.editing}”，“${v1.unsaved}”`);
  const saved1 = await op.eval(`(async () => { document.getElementById('save').click(); await new Promise((r) => setTimeout(r, 600));
    const s = (await chrome.storage.local.get('settings')).settings;
    return { n: s.chain.length, second: s.chain[1].baseUrl, top: s.baseUrl, savedAt: !!s.savedAt, msg: document.getElementById('result').textContent,
      unsaved: document.getElementById('unsaved').textContent }; })()`);
  check(saved1.n === 2 && saved1.second === ok.url + '/v1' && saved1.top === pay.url + '/v1' && saved1.savedAt && !saved1.unsaved,
    `保存：阵列 ${saved1.n} 个，最外层存着主力，“${saved1.msg}”`);
  // 跑一批：主力 402 → 列表上显示“暂时跳过”
  await run('T_open()', 8);
  await sleep(400);
  const v2 = await rows();
  check(/暂时跳过，30 分钟后再试：.*402/.test(v2[0].state), `后台记下主力出错，列表显示：“${v2[0].state}”`);
  // 测试全部
  const v3 = await op.eval(`(async () => { document.getElementById('testAll').click();
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250));
      if (![...document.querySelectorAll('#chain .state')].some((x) => /正在/.test(x.textContent))) break; }
    return [...document.querySelectorAll('#chain .eng')].map((r) => (r.querySelector('.state') || {}).textContent || ''); })()`);
  check(/^✗ .*402/.test(v3[0]) && /^✓ 能用（[\d.]+ 秒）：B:Hello/.test(v3[1]), `测试全部：① “${v3[0]}”；② “${v3[1]}”`);
  await op.shot(path.join(ROOT, 'tests/out/chain-options-test.png'));
  // 上移：备用变主力
  const v4 = await op.eval(`(async () => { const r = document.querySelectorAll('#chain .eng')[1];
    r.querySelector('button[title="上移"]').click(); await new Promise((x) => setTimeout(x, 200));
    const before = document.getElementById('editing').textContent;
    document.getElementById('save').click(); await new Promise((x) => setTimeout(x, 600));
    const s = (await chrome.storage.local.get('settings')).settings;
    return { before, first: s.chain[0].baseUrl, top: s.baseUrl }; })()`);
  check(v4.first === ok.url + '/v1' && v4.top === ok.url + '/v1' && v4.before === '下面改的是 ① 主力',
    `上移后保存：主力换成了原来的备用（最外层也跟着换），“${v4.before}”`);
  // 删除
  const v5 = await op.eval(`(async () => { const r = document.querySelectorAll('#chain .eng')[1];
    r.querySelector('button[title="删除"]').click(); await new Promise((x) => setTimeout(x, 200));
    document.getElementById('save').click(); await new Promise((x) => setTimeout(x, 600));
    const s = (await chrome.storage.local.get('settings')).settings;
    return { rows: document.querySelectorAll('#chain .eng').length, n: s.chain.length }; })()`);
  check(v5.rows === 1 && v5.n === 1, `删除后保存：剩 ${v5.n} 个`);
  // 没填模型名不让保存，并跳到那一个
  const v6 = await op.eval(`(async () => { const $ = (i) => document.getElementById(i);
    $('addEngine').click(); await new Promise((r) => setTimeout(r, 200));
    $('preset').value = 'openai-custom'; $('preset').dispatchEvent(new Event('change'));
    $('baseUrl').value = 'http://127.0.0.1:1/v1'; $('baseUrl').dispatchEvent(new Event('input'));
    $('model').value = ''; $('model').dispatchEvent(new Event('input'));
    $('save').click(); await new Promise((r) => setTimeout(r, 300));
    return { msg: $('result').textContent, n: (await chrome.storage.local.get('settings')).settings.chain.length }; })()`);
  check(/② 还没填模型名/.test(v6.msg) && v6.n === 1, `没填模型名：“${v6.msg}”，没有保存`);

  // 给你看的截图：常见的排法（Ollama 云端 → 本机 Ollama → DeepSeek），云端那个后台记着要付费额度
  const demo = [{ preset: 'ollama-cloud-local', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:31b-cloud' },
    { preset: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b' },
    { preset: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }];
  const demoKey = '{"preset":"ollama-cloud-local","baseUrl":"http://127.0.0.1:11434","model":"gemma4:31b-cloud","apiKey":""}';
  await op.eval(`(async () => {
    await chrome.storage.local.set({ settings: { native: 'zh-Hans', target: 'zh-Hans', source: 'auto', chain: ${JSON.stringify(demo)} } });
    await new Promise((r) => setTimeout(r, 500));   // 设置变了，后台会先清空出错记录
    const e = JSON.parse(${JSON.stringify(demoKey)});
    await chrome.storage.session.set({ health: { [window.__dm.chain.keyOf(e)]: { until: Date.now() + 25 * 60000, fails: 1, hard: true,
      error: '这个云端模型要付费额度：Ollama 订阅已到期，或免费额度不含它。', at: Date.now() } } });
    location.reload(); })()`).catch(() => {});
  await sleep(2500);
  await op.eval(`(() => { const r = document.querySelectorAll('#chain .eng')[1]; r.click(); document.getElementById('chain').scrollIntoView(); })()`);
  await sleep(1500);
  const demoRows = await rows();
  check(demoRows.length === 3 && /暂时跳过/.test(demoRows[0].state), `示例阵列：${demoRows.map((r) => r.role + ' ' + r.name).join('，')}`);
  await op.shot(path.join(ROOT, 'tests/out/chain-options.png'));
  await op.eval(`(() => { document.getElementById('reward').open = true; document.getElementById('reward').scrollIntoView(); })()`);
  await sleep(500);
  const about = await op.eval(`({ mail: document.getElementById('mail').href, kofi: document.getElementById('kofi').textContent,
    img: document.querySelector('#reward img').naturalWidth })`);
  check(/^mailto:a885187@gmail\.com\?subject=/.test(about.mail) && /Ko-fi/.test(about.kofi) && about.img > 0,
    `关于：反馈邮件“${decodeURIComponent(about.mail)}”，打赏码 ${about.img}px，“${about.kofi}”`);
  await op.shot(path.join(ROOT, 'tests/out/chain-about.png'));
} finally {
  await b.close();
  for (const s of [pay, gone, hang, half, ok]) s.close();
  pages.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
