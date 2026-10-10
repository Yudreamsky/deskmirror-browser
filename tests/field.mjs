// 输入框翻译：装上扩展，在打开过魔镜的页面上，输入框里连按三次空格（真的按键）：
//  1. 多行框：翻译后直接替换，开着魔镜时用量记进顶部栏；能撤回；再连按三次空格原文、译文来回换，不再请求；
//     换回原文后改了字就重新翻译
//  2. 关掉魔镜后照样能用；单行框按得慢一点（每下隔 0.45 秒）也算，也能换回原文；隔太久（0.7 秒）不算
//  3. 可编辑区域、像 React 那样自己管状态的框（状态跟着变），都能来回换；换了“输入框翻译成”的语言，原文重新翻译；
//     像 Slate、Lexical 那样自己记着内容的编辑器：交给它自己换（它记着的也变了，再打字不会被改回去），两段还是两段
//  4. 不该翻的：行首缩进的空格、翻译时又打了字的（不替换）；请求里写明原文是母语
// node tests/field.mjs
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

const svc = await fakeService('ok');
svc.tag = 'EN';
const pages = await serve();
const b = await launchWithExtension({ lang: 'zh-CN' });
try {
  const id = await b.load(path.join(ROOT, 'extension'));
  const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
  const op = await b.attach(t.targetId);
  const swT = await b.waitTarget((x) => x.type === 'service_worker' && x.url.includes(id));
  const sw = await b.attach(swT.targetId);
  await sleep(1000);
  await op.eval(`chrome.storage.local.set({ settings: { native: 'zh-Hans', target: 'zh-Hans', source: 'auto', inputTarget: 'en', savedAt: Date.now(),
    chain: [{ preset: 'openai-custom', protocol: 'openai', baseUrl: ${JSON.stringify(svc.url + '/v1')}, model: 'm', apiKey: 'test-key' }] } }).then(() => 1)`);
  const url = pages.url('fields.html');
  const tab = await b.cdp.send('Target.createTarget', { url });
  const page = await b.attach(tab.targetId);
  await sleep(1000);
  const toggle = () => sw.eval(`chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(async ([t]) => { await toggle(t); return 1; })`);
  await toggle();
  await sleep(1500);
  const ctx = page.isolated(id);
  const send = (m, p) => b.cdp.send(m, p, page.sessionId);
  const focus = (sel) => page.eval(`(() => { const e = document.querySelector('${sel}'); e.focus();
    if ('value' in e && e.localName !== 'div') e.setSelectionRange(e.value.length, e.value.length);
    else { const s = getSelection(); s.selectAllChildren(e); s.collapseToEnd(); } return 1; })()`);
  const type = (text) => send('Input.insertText', { text });
  const space = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  };
  const enter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const triple = async (gap) => {
    for (let i = 0; i < 3; i++) {
      if (i) await sleep(gap);
      await space();
    }
  };
  const val = (sel) => page.eval(`(() => { const e = document.querySelector('${sel}'); return e.localName === 'div' ? e.innerText.replace(/\\n$/, '') : e.value; })()`);
  const lastBadge = () => page.eval(`(() => { const l = __dm.field.last(); return l ? l.text : ''; })()`, ctx);

  // 1. 魔镜开着：多行框
  await focus('#ta');
  await type('你好，世界');
  await triple(120);
  await sleep(1500);
  const v1 = await val('#ta');
  const traffic = await page.eval(`__dm.session ? __dm.session.traffic.n : -1`, ctx);
  check(v1 === 'EN:你好，世界' && /已翻译/.test(await lastBadge()) && traffic >= 1,
    `多行框：连按三次空格 → “${v1}”，提示“${await lastBadge()}”，用量记进顶部栏（${traffic} 次请求）`);
  await page.eval(`document.execCommand('undo'), 1`);
  const undone = await val('#ta');
  check(/^你好，世界\s*$/.test(undone), `撤回（Ctrl+Z）回到原文：“${undone}”`);

  // 再连按三次空格：原文、译文来回换，不再请求
  const h0 = svc.hits.length;
  const states = [];
  await focus('#ta');
  for (let i = 0; i < 3; i++) {
    await triple(120);
    await sleep(600);
    states.push([await val('#ta'), await lastBadge()]);
  }
  check(states[0][0] === 'EN:你好，世界' && states[1][0] === '你好，世界' && /^已换回原文/.test(states[1][1])
    && states[2][0] === 'EN:你好，世界' && /^已翻译/.test(states[2][1]) && svc.hits.length === h0,
  `再连按三次空格来回换：${states.map((s) => '“' + s[0] + '”').join(' → ')}（提示“${states[1][1]}”），没有再请求（${svc.hits.length - h0} 次）`);
  await triple(120);
  await sleep(600);
  await type('！');
  await triple(120);
  await sleep(1500);
  const edited = await val('#ta');
  check(edited === 'EN:你好，世界！' && svc.hits.length === h0 + 1, `换回原文后改了字：重新翻译 → “${edited}”`);

  // 2. 关掉魔镜；单行框按得慢一点也算，隔太久不算
  await toggle();
  await sleep(800);
  const gone = await page.eval(`document.querySelectorAll('[data-deskmirror]').length`);
  await focus('#in');
  await type('早上好');
  await triple(450);
  await sleep(1500);
  const v2 = await val('#in');
  check(gone === 0 && v2 === 'EN:早上好', `关掉魔镜后照样能用；每下隔 0.45 秒也算 → “${v2}”`);
  const h1 = svc.hits.length;
  await triple(450);
  await sleep(800);
  const v2b = await val('#in');
  check(v2b === '早上好' && svc.hits.length === h1, `单行框再连按三次空格换回原文：“${v2b}”，没有请求`);
  const hits = svc.hits.length;
  await focus('#in2');
  await type('再见');
  await triple(700);
  await sleep(1200);
  const v3 = await val('#in2');
  check(v3 === '再见   ' && svc.hits.length === hits, `每下隔 0.7 秒不算连按：框里还是“${v3.replace(/ /g, '·')}”，没有请求`);

  // 3. 可编辑区域、像 React 那样自己管状态的框
  await focus('#ce');
  await type('谢谢你');
  await triple(120);
  await sleep(1500);
  const v4 = await val('#ce');
  check(v4 === 'EN:谢谢你', `可编辑区域 → “${v4}”`);
  const h3 = svc.hits.length;
  await triple(120);
  await sleep(600);
  const v4b = await val('#ce');
  await triple(120);
  await sleep(600);
  const v4c = await val('#ce');
  check(v4b === '谢谢你' && v4c === 'EN:谢谢你' && svc.hits.length === h3, `可编辑区域来回换：“${v4b}” → “${v4c}”，没有请求`);
  await focus('#rx');
  await type('我爱你');
  await triple(120);
  await sleep(1500);
  const v5 = await val('#rx');
  const state = await page.eval(`window.rxState`);
  check(v5 === 'EN:我爱你' && state === 'EN:我爱你', `像 React 的框：显示“${v5}”，它自己的状态也是“${state}”`);
  await triple(120);
  await sleep(600);
  const v5b = await val('#rx');
  const state2 = await page.eval(`window.rxState`);
  check(v5b === '我爱你' && state2 === '我爱你', `像 React 的框换回原文：显示“${v5b}”，它自己的状态也是“${state2}”`);

  // 换了“输入框翻译成”的语言：记着的译文不能用了，原文重新翻译
  await op.eval(`chrome.storage.local.get('settings').then(({ settings }) =>
    chrome.storage.local.set({ settings: { ...settings, inputTarget: 'ja' } })).then(() => 1)`);
  const h4 = svc.hits.length;
  await focus('#rx');
  await triple(120);
  await sleep(1500);
  const v5c = await val('#rx');
  const lastHit = svc.hits[svc.hits.length - 1];
  check(svc.hits.length === h4 + 1 && /^Japanese/.test(lastHit.target) && v5c === 'EN:我爱你',
    `换了“输入框翻译成”的语言：原文重新翻译（请求译成 ${lastHit.target}）`);

  // 像 Slate、Lexical 那样自己记着内容的编辑器：交给它自己换，它记着的也跟着换，两段还是两段
  const h5 = svc.hits.length;
  const model = () => page.eval('JSON.stringify(window.meModel)');
  await focus('#me');
  await type('你好');
  await enter();
  await type('再见');
  await triple(120);
  await sleep(1500);
  const m1 = await model();
  await triple(120);
  await sleep(700);
  const m2 = await model();
  await type('吗');
  await sleep(300);
  const m3 = await model();
  check(m1 === '["EN:你好","EN:再见"]' && m2 === '["你好","再见"]' && m3 === '["你好","再见吗"]' && svc.hits.length === h5 + 1,
    `自己记着内容的编辑器：它记着的是 ${m1} → 换回原文 ${m2} → 再打个字 ${m3}（请求 ${svc.hits.length - h5} 次）`);

  // 4. 不该翻的
  const hits2 = svc.hits.length;
  await focus('#code');
  await type('def f():\n');
  await triple(100);
  await sleep(1000);
  const v6 = await val('#code');
  check(v6 === 'def f():\n   ' && svc.hits.length === hits2, '行首连按空格（缩进）不算：没有请求，空格留着');
  const fieldHits = svc.hits.filter((h) => h.segments.some((x) => /你好|早上好|谢谢你|我爱你/.test(x)));
  check(fieldHits.length >= 4 && fieldHits.every((h) => h.source === 'zh'),
    `输入框发出的 ${fieldHits.length} 个请求都写明原文是母语（中文），不用模型猜`);
  svc.delay = 900;
  await page.eval(`(() => { const e = document.querySelector('#ta'); e.value = ''; return 1; })()`);
  await focus('#ta');
  await type('测试');
  await triple(100);
  await sleep(150);
  await type('又打了几个字');
  await sleep(1600);
  const v7 = await val('#ta');
  check(v7 === '测试   又打了几个字' && /变了/.test(await lastBadge()), `翻译时又打了字：不替换（“${v7}”），提示“${await lastBadge()}”`);
  svc.delay = 0;
  await page.shot(path.join(ROOT, 'tests/out/field.png'));
} finally {
  await b.close();
  svc.close();
  pages.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
