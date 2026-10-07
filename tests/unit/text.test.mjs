// node --test tests/unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../extension/content/text.js');

test('标签：正常嵌套、换顺序都能解析', () => {
  const { nodes, used } = T.parseTagged('请看<g2>第二段</g2>和<g1>第一段<x3/></g1>。', 3);
  assert.deepEqual([...used].sort(), ['g1', 'g2', 'x3']);
  assert.equal(nodes[1].t, 'g');
  assert.equal(nodes[1].id, 2);
  assert.deepEqual(nodes[3].c.map((n) => n.t), ['text', 'x']);
});

test('标签：未知编号、重复、多余闭合都忽略，没闭合的自动闭合', () => {
  const { nodes, used } = T.parseTagged('a<g9>b</g9><g1>c<g1>d</g2>e', 2);
  assert.deepEqual([...used], ['g1']);
  assert.equal(T.stripTags('a<g9>b</g9><g1>c<g1>d</g2>e'), 'abcde');
  assert.equal(nodes[0].v, 'ab');
  assert.equal(nodes[1].c.map((n) => n.v).join(''), 'cde');
});

test('流式解析：编号段落完整后才交出，跨行合并，去掉思考段', () => {
  const got = [];
  const p = new T.SegmentParser(3, (i, s) => got.push([i, s]));
  for (const piece of ['<think>嗯', '</think>[1] 第', '一段\n[2] 第二', '段\n续\n[3] 第三段']) p.feedRaw(piece);
  // 第二段要等“[3]”那一行完整收到才算完；最后一段等流结束
  assert.deepEqual(got, [[0, '第一段']]);
  p.close();
  assert.deepEqual(got, [[0, '第一段'], [1, '第二段 续'], [2, '第三段']]);
});

test('语言判断', () => {
  assert.equal(T.isAlreadyTarget('冰川是缓慢流动的冰', 'zh-Hans'), true);
  assert.equal(T.isAlreadyTarget('氷河はゆっくり流れる', 'zh-Hans'), false);
  assert.equal(T.isAlreadyTarget('Glaciers move slowly', 'zh-Hans'), false);
  assert.equal(T.hasWords('12.5 % — 3/4'), false);
  assert.equal(T.hasWords('https://example.com'), false);
  assert.equal(T.hasWords('Read more'), true);
});

test('假翻译保留标签、长度像中文', () => {
  const src = 'A slow <g1>river of ice</g1> can carve <x2/> granite.';
  const out = T.mockTranslate(src, 'zh-Hans');
  assert.match(out, /<g1>[^<]+<\/g1>/);
  assert.match(out, /<x2\/>/);
  assert.ok(T.stripTags(out).length < T.stripTags(src).length);
  assert.equal(T.mockTranslate(src, 'zh-Hans', 'identity'), src);
});

test('提示词带页面信息、编号', () => {
  const m = T.userMessage(['a\nb', 'c'], 'Title — example.com');
  assert.equal(m, 'Page: Title — example.com\n\n[1] a b\n[2] c');
  assert.match(T.systemPrompt('zh-Hans'), /Simplified Chinese/);
});
