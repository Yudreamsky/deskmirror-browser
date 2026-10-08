// 用量（镜框顶部栏的 ↑ ↓）：
//  1. OpenAI 兼容接口：请求带 stream_options，服务报告了就用报告的；不认这个参数的服务降一档重发（关掉思考的参数还在），
//     按字数估，并记住以后直接用那一档
//  2. 本机 Ollama 原生接口：用它报告的 prompt_eval_count / eval_count（--no-ollama 跳过）
//  3. 装上扩展打开魔镜：顶部栏显示这次打开以来的 ↑ ↓，等于每批之和；鼠标停上去看详情；关闭按钮没有被挤出去
// node tests/usage.mjs [--no-ollama]
import path from 'node:path';
import { createRequire } from 'node:module';
import { sleep } from './lib/cdp.mjs';
import { ROOT, serve, T } from './lib/harness.mjs';
import { launchWithExtension } from './lib/ext.mjs';
import { fakeService } from './lib/fake-llm.mjs';

const require = createRequire(import.meta.url);
const LLM = require(path.join(ROOT, 'extension/llm.js'));

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};

const req = { segments: ['one two', 'three four', 'five six'], target: 'zh-Hans', context: '' };
const ok = await fakeService('ok');
const picky = await fakeService('ok');
picky.rejectUsage = true;
const pages = await serve();
try {
  // 1. OpenAI 兼容接口
  const m1 = {};
  await LLM.translateBatch(T, { protocol: 'openai', baseUrl: ok.url + '/v1', model: 'm', apiKey: 'k' }, req, () => {}, undefined, m1);
  check(m1.in === 103 && m1.out === 30 && m1.est === false && ok.hits[0].streamOptions && ok.hits[0].thinking,
    `服务报告的用量：发送 ${m1.in}，接收 ${m1.out}（请求带了 stream_options 和关掉思考的参数）`);
  const cfg2 = { protocol: 'openai', baseUrl: picky.url + '/v1', model: 'm', apiKey: 'k' };
  const m2 = {};
  await LLM.translateBatch(T, cfg2, req, () => {}, undefined, m2);
  check(picky.hits.length === 2 && !picky.hits[1].streamOptions && picky.hits[1].thinking && m2.est === true && m2.in > 0 && m2.out > 0,
    `不认 stream_options 的服务：降一档重发（关掉思考的参数还在），按字数估：发送约 ${m2.in}，接收约 ${m2.out}`);
  await LLM.translateBatch(T, cfg2, req, () => {}, undefined, {});
  check(picky.hits.length === 3 && !picky.hits[2].streamOptions, '记住了：同一个地址以后直接用那一档（只请求一次）');

  // 2. 本机 Ollama
  if (!process.argv.includes('--no-ollama')) {
    const m4 = {};
    const t0 = Date.now();
    try {
      await LLM.translateBatch(T, { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b' },
        { segments: ['Hello, <g1>world</g1>!'], target: 'zh-Hans', context: '' }, () => {}, undefined, m4);
      check(m4.est === false && m4.in > 0 && m4.out > 0, `本机 Ollama 报告的用量：发送 ${m4.in}，接收 ${m4.out}（${Date.now() - t0} ms）`);
    } catch (e) {
      check(false, '本机 Ollama：' + e.message);
    }
  }

  // 3. 打开魔镜：顶部栏的 ↑ ↓
  const b = await launchWithExtension({ lang: 'zh-CN' });
  try {
    const id = await b.load(path.join(ROOT, 'extension'));
    const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
    const op = await b.attach(t.targetId);
    const swT = await b.waitTarget((x) => x.type === 'service_worker' && x.url.includes(id));
    const sw = await b.attach(swT.targetId);
    await sleep(1000);
    ok.hits.length = 0;
    await op.eval(`chrome.storage.local.set({ settings: { native: 'zh-Hans', target: 'zh-Hans', source: 'auto', savedAt: Date.now(),
      chain: [{ preset: 'openai-custom', protocol: 'openai', baseUrl: ${JSON.stringify(ok.url + '/v1')}, model: 'm', apiKey: 'test-key' }] } }).then(() => 1)`);
    const url = pages.url('article.html');
    const tab = await b.cdp.send('Target.createTarget', { url });
    const page = await b.attach(tab.targetId);
    await sleep(1200);
    await sw.eval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); return 1; })`);
    await sleep(3000);
    const ctx = page.isolated(id);
    const st = await page.eval(`(() => { const s = __dm.session, f = s.frame;
      const tr = f.tab.getBoundingClientRect(), cr = f.closeBtn.getBoundingClientRect();
      return { text: f.traffic.textContent, hidden: f.traffic.hidden, tip: f.traffic.title, sum: s.traffic, tab: Math.round(tr.width),
        closeOk: cr.width > 0 && cr.right <= tr.right + 0.5 }; })()`, ctx);
    const expIn = ok.hits.reduce((a, h) => a + 100 + h.segments.length, 0);
    const expOut = ok.hits.reduce((a, h) => a + 10 * h.segments.length, 0);
    check(!st.hidden && st.sum.in === expIn && st.sum.out === expOut && st.sum.n === ok.hits.length
      && st.text === '↑' + T.shortCount(expIn) + ' ↓' + T.shortCount(expOut),
      `顶部栏“${st.text}”：${ok.hits.length} 批之和（发送 ${expIn}，接收 ${expOut}）`);
    check(/发送 [\d,]+ 个 token，接收 [\d,]+ 个 token（\d+ 次请求）/.test(st.tip) && !/估算/.test(st.tip),
      `鼠标停上去：“${st.tip.replace(/\n/g, ' ')}”`);
    check(st.closeOk, `标签宽 ${st.tab} px，关闭按钮没有被挤出去`);
    await page.shot(path.join(ROOT, 'tests/out/usage-tab.png'));
    // 收起成气泡：标签看不见了，鼠标停在气泡上也能看到用量
    const bub = await page.eval(`(() => { const f = __dm.session.frame; f.fold();
      return new Promise((ok) => setTimeout(() => ok(f.bubble.title), 900)); })()`, ctx);
    check(bub.includes('↑' + T.shortCount(expIn) + ' ↓' + T.shortCount(expOut)) && /发送 [\d,]+ 个 token/.test(bub),
      `收起成气泡后，鼠标停在气泡上：“${bub.replace(/\n/g, ' / ')}”`);
    // 再点一次图标关掉、再打开：从 0 重新算
    await sw.eval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); await new Promise((r) => setTimeout(r, 300)); await toggle(t); return 1; })`);
    await sleep(800);
    const again = await page.eval(`(() => { const s = __dm.session; return { sum: s.traffic, hidden: s.frame.traffic.hidden }; })()`, page.isolated(id));
    check(again.sum.n <= ok.hits.length && again.sum.in < st.sum.in + 1, `重新打开魔镜从头算（现在 ${again.sum.n} 批）`);
  } finally {
    await b.close();
  }
} finally {
  ok.close();
  picky.close();
  pages.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
