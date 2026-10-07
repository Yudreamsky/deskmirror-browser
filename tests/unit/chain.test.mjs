// 备用阵列：换下一个、只把剩下的段落交出去、限时、跳过多久、旧设置变成阵列
// node --test tests/unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../extension/chain.js');
const PS = require('../../extension/presets.js');

const E = (name, extra) => Object.assign({ preset: 'openai-custom', protocol: 'openai', baseUrl: 'http://' + name, model: name, apiKey: '' }, extra);
const httpErr = (status) => Object.assign(new Error('HTTP ' + status), { status });
const timeoutError = (ms) => Object.assign(new Error('timeout ' + ms), { timeout: true });
const emptyError = () => new Error('empty');

/** 假服务：按名字给出行为；记下每次收到的段落。 */
function fakes(behaviors) {
  const calls = [];
  const run = async (e, req, onSeg, signal) => {
    calls.push({ name: e.model, segments: req.segments.slice() });
    return behaviors[e.model](req, onSeg, signal);
  };
  return { run, calls };
}

const echo = (tag) => async (req, onSeg) => {
  req.segments.forEach((s, i) => onSeg(i, tag + s));
  return req.segments.length;
};
const hang = (req, onSeg, signal) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

async function run(chain, behaviors, extra) {
  const f = fakes(behaviors);
  const out = {};
  const used = [];
  const health = (extra && extra.health) || {};
  const r = await C.translate(Object.assign({
    chain, health, now: Date.now(), req: { segments: ['a', 'b', 'c', 'd'], target: 'zh-Hans' },
    run: f.run, limitOf: () => ({ first: 60, between: 60 }), timeoutError, emptyError,
    onSeg: (i, t) => { out[i] = t; }, onUse: (i) => used.push(i),
  }, extra || {}));
  return { r, out, used, calls: f.calls, health };
}

test('主力额度用完（402）：换备用，主力记下跳过 30 分钟', async () => {
  const { r, out, used, calls, health } = await run([E('main'), E('b1')], {
    main: async () => { throw httpErr(402); }, b1: echo('B:'),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(out, { 0: 'B:a', 1: 'B:b', 2: 'B:c', 3: 'B:d' });
  assert.deepEqual(used, [1]);
  assert.equal(calls.length, 2);
  const h = health[C.keyOf(E('main'))];
  assert.equal(h.hard, true);
  assert.ok(h.until - Date.now() > 29 * 60000);
  // 下一批直接用备用，不再请求主力
  const again = await run([E('main'), E('b1')], { main: async () => { throw new Error('不该请求'); }, b1: echo('B:') }, { health });
  assert.deepEqual(again.calls.map((c) => c.name), ['b1']);
});

test('主力译到一半断了：译好的留下，只把剩下的交给备用', async () => {
  const { r, out, calls, health } = await run([E('main'), E('b1')], {
    main: async (req, onSeg) => { onSeg(0, 'M:a'); onSeg(1, 'M:b'); throw Object.assign(new Error('断了'), { network: true }); },
    b1: echo('B:'),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(out, { 0: 'M:a', 1: 'M:b', 2: 'B:c', 3: 'B:d' });
  assert.deepEqual(calls[1].segments, ['c', 'd']);
  // 连不上这类：先跳过 1 分钟，不是 30 分钟
  const h = health[C.keyOf(E('main'))];
  assert.equal(h.hard, false);
  assert.ok(h.until - Date.now() <= 60000 && h.until - Date.now() > 50000);
});

test('太慢：第一段等不到就换备用；两段之间停太久也换', async () => {
  const slow = await run([E('main'), E('b1')], { main: hang, b1: echo('B:') });
  assert.equal(slow.r.ok, true);
  assert.equal(slow.r.errors[0].err.timeout, true);
  assert.equal(slow.out[0], 'B:a');
  const stall = await run([E('main'), E('b1')], {
    main: (req, onSeg, signal) => { onSeg(0, 'M:a'); return hang(req, onSeg, signal); },
    b1: echo('B:'),
  });
  assert.deepEqual(stall.out, { 0: 'M:a', 1: 'B:b', 2: 'B:c', 3: 'B:d' });
  assert.deepEqual(stall.calls[1].segments, ['b', 'c', 'd']);
});

test('最后一个不限时：只有一个服务时，慢也等它', async () => {
  const late = (req, onSeg) => new Promise((resolve) => setTimeout(() => { onSeg(0, 'M:a'); resolve(1); }, 150));
  const { r, out } = await run([E('main')], { main: late });
  assert.equal(r.ok, true);
  assert.equal(out[0], 'M:a');
});

test('一段也没译出来算失败，换下一个；译出一部分算成功，不再找备用', async () => {
  const empty = await run([E('main'), E('b1')], { main: async () => 0, b1: echo('B:') });
  assert.equal(empty.out[0], 'B:a');
  const part = await run([E('main'), E('b1')], { main: async (req, onSeg) => { onSeg(2, 'M:c'); return 1; }, b1: echo('B:') });
  assert.equal(part.r.ok, true);
  assert.deepEqual(part.out, { 2: 'M:c' });
  assert.equal(part.calls.length, 1);
});

test('都失败了：每个都试一次，返回各自的错误', async () => {
  const { r, out } = await run([E('main'), E('b1'), E('b2')], {
    main: async () => { throw httpErr(401); }, b1: async () => { throw httpErr(410); }, b2: async () => { throw httpErr(503); },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((x) => [x.idx, x.err.status]), [[0, 401], [1, 410], [2, 503]]);
  assert.deepEqual(out, {});
});

test('跳过中的放到最后：前面的都失败了还会试它；成功了就清掉记录', async () => {
  const health = {};
  C.failed(health, E('main'), httpErr(402), Date.now());
  assert.deepEqual(C.order([E('main'), E('b1'), E('b2')], health, Date.now()), [1, 2, 0]);
  const { r, calls, used } = await run([E('main'), E('b1')], { main: echo('M:'), b1: async () => { throw httpErr(500); } }, { health });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((c) => c.name), ['b1', 'main']);
  assert.deepEqual(used, [0]);
  assert.equal(health[C.keyOf(E('main'))], undefined);
});

test('页面关了（中止）：直接停，不换下一个', async () => {
  const ac = new AbortController();
  const p = run([E('main'), E('b1')], { main: hang, b1: echo('B:') }, { signal: ac.signal, limitOf: () => ({ first: 5000, between: 5000 }) });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(p);
});

test('跳过多久：一时好不了的 30 分钟；其他的 1 分钟起，接连出错翻倍，最长 30 分钟', () => {
  for (const st of [400, 401, 402, 403, 404, 410, 422]) assert.equal(C.isHard(httpErr(st)), true, String(st));
  for (const st of [408, 429, 500, 502, 503]) assert.equal(C.isHard(httpErr(st)), false, String(st));
  assert.equal(C.isHard(Object.assign(new Error('x'), { config: true })), true);
  assert.equal(C.isHard(timeoutError(1)), false);
  const soft = new Error('连不上');
  assert.deepEqual([1, 2, 3, 6, 10].map((n) => C.holdFor(soft, n) / 60000), [1, 2, 4, 30, 30]);
  assert.equal(C.holdFor(httpErr(402), 1), C.HOLD_HARD);
});

test('服务的身份：换了模型或 Key 就是另一个', () => {
  assert.equal(C.keyOf(E('m')), C.keyOf(E('m')));
  assert.notEqual(C.keyOf(E('m')), C.keyOf(E('m', { model: 'x' })));
  assert.notEqual(C.keyOf(E('m', { apiKey: 'k1' })), C.keyOf(E('m', { apiKey: 'k2' })));
  assert.ok(!C.keyOf(E('m', { apiKey: 'sk-secret' })).includes('sk-secret'), 'Key 只存摘要');
});

test('旧设置（只有一个服务）就是只有主力的阵列；旧服务名换成新的；不要 Key 的不带 Key', () => {
  const old = PS.chainOf({ preset: 'deepseek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'k' });
  assert.deepEqual(old, [{ preset: 'deepseek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'k', extra: null }]);
  assert.equal(PS.chainOf({ preset: 'openai', protocol: 'openai', baseUrl: 'http://my/v1', model: 'm' })[0].preset, 'openai-custom');
  assert.equal(PS.chainOf({ protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'g', apiKey: 'leak' })[0].apiKey, '');
  const list = PS.chainOf({ preset: 'deepseek', chain: [{ preset: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'g' },
    { preset: 'bailian', baseUrl: 'https://x', model: 'q', apiKey: 'k2' }] });
  assert.deepEqual(list.map((e) => e.preset), ['ollama', 'bailian']);
  assert.deepEqual(list[1].extra, { enable_thinking: false });
  assert.equal(PS.chainOf({ chain: new Array(9).fill({ preset: 'mock' }) }).length, PS.MAX_CHAIN);
});

test('显示的名字和本机判断', () => {
  assert.equal(PS.engineLabel({ preset: 'ollama', protocol: 'ollama', model: 'gemma4:12b' }, 'zh'), '本机 Ollama · gemma4:12b');
  assert.equal(PS.engineLabel({ preset: 'ollama', protocol: 'ollama', model: 'gemma4:12b' }, 'en'), 'Ollama on this PC · gemma4:12b');
  assert.equal(PS.engineLabel({ preset: 'openai-custom', protocol: 'openai', baseUrl: 'https://llm.example.com/v1', model: 'm' }, 'zh'),
    'llm.example.com · m');
  assert.equal(PS.engineLabel({ preset: 'mock', protocol: 'mock' }, 'zh'), '测试用假翻译');
  assert.equal(PS.isLocal({ protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b' }), true);
  assert.equal(PS.isLocal({ protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:31b-cloud' }), false);
  assert.equal(PS.isLocal({ protocol: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'x' }), true);
  assert.equal(PS.isLocal({ protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'x' }), false);
});
