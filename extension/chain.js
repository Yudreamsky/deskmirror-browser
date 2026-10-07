// 桌面魔镜浏览器版：备用阵列。设置里可以排好几个翻译服务（第一个是主力），按顺序用：
//  - 出错（额度用完、Key 不对、模型下线、连不上、太慢）就换下一个；已经译好的段落不重翻，只把剩下的交给下一个；
//  - 出错的先跳过一会儿：一时好不了的（HTTP 4xx，限流除外）30 分钟，其他的 1 分钟、接连出错就翻倍；
//  - 后面还有备用时才限时：第一段译文最多等多久、两段之间最多隔多久。
// 后台（service worker）和设置页用，Node 测试用 require 载入。
(function (root) {
  'use strict';

  const HOLD_HARD = 30 * 60 * 1000;
  const HOLD_SOFT = 60 * 1000;

  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  /** 一个服务的身份：服务商、地址、模型、Key（只存摘要）。设置改了就是另一个，以前的出错记录不算它的。 */
  function keyOf(e) {
    return [e.preset, e.baseUrl, e.model, e.apiKey ? hash(e.apiKey) : ''].join('|');
  }

  /** Key 不对、额度用完、模型没了、没填好这类一时好不了；连不上、限流、服务出错、太慢过一会儿可能就好。 */
  function isHard(err) {
    if (!err) return false;
    if (err.config) return true;
    const st = err.status;
    return st >= 400 && st < 500 && ![408, 409, 425, 429].includes(st);
  }

  function holdFor(err, fails) {
    return isHard(err) ? HOLD_HARD : Math.min(HOLD_SOFT * 2 ** Math.max(0, fails - 1), HOLD_HARD);
  }

  /** 记下出错：跳过到什么时候。 */
  function failed(health, e, err, now) {
    const k = keyOf(e);
    const fails = ((health[k] && health[k].fails) || 0) + 1;
    health[k] = { until: now + holdFor(err, fails), fails, hard: isHard(err),
      error: String((err && err.message) || err).slice(0, 300), at: now };
    return health[k];
  }

  function skipped(health, e, now) {
    const h = health[keyOf(e)];
    return h && h.until > now ? h : null;
  }

  /** 这一批按什么顺序试：没在跳过的按阵列顺序；跳过中的放到最后（前面的都失败了，还是要试一下）。 */
  function order(chain, health, now) {
    const all = chain.map((_, i) => i);
    const up = all.filter((i) => !skipped(health, chain[i], now));
    return up.concat(all.filter((i) => !up.includes(i)));
  }

  /**
   * 给 run(onSeg, signal) 限时：第一段译文最多等 limit.first 毫秒，之后两段之间最多 limit.between 毫秒；
   * 超时就中止它，抛出 timeoutError(毫秒)。limit 为空就不限时。
   */
  async function limited(run, onSeg, signal, limit, timeoutError) {
    if (!limit) return run(onSeg, signal);
    const ac = new AbortController();
    const stop = () => ac.abort();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener('abort', stop);
    }
    let timer = 0;
    let late = 0;
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => { late = ms; ac.abort(); }, ms);
    };
    arm(limit.first);
    try {
      return await run((i, text) => { arm(limit.between); onSeg(i, text); }, ac.signal);
    } catch (err) {
      if (late && !(signal && signal.aborted)) throw timeoutError(late);
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
  }

  /**
   * 按阵列翻译一批 o.req.segments。
   * o: { chain, health, now, req, signal, run(engine, req, onSeg, signal), limitOf(engine), onSeg(i, text), onUse(idx),
   *      timeoutError(ms), emptyError() }
   * 一个服务出错（或一段也没译出来）就换下一个，只把还没译好的段落交给它；译出一部分就算成功（漏的段落内容脚本过一会儿会重试）。
   * health 直接改：出错的记下跳过多久，成功的清掉记录。
   * 返回 { ok（有一个服务正常结束）, got（译好的段落序号）, errors: [{ idx, err }], used（第一个译出东西的服务，没有就是 -1） }
   */
  async function translate(o) {
    const n = o.req.segments.length;
    const got = new Set();
    const errors = [];
    let used = -1;
    const seq = order(o.chain, o.health, o.now);
    for (let k = 0; k < seq.length; k++) {
      const idx = seq[k];
      const e = o.chain[idx];
      const rest = [];
      for (let i = 0; i < n; i++) if (!got.has(i)) rest.push(i);
      const req = Object.assign({}, o.req, { segments: rest.map((i) => o.req.segments[i]) });
      let count = 0;
      try {
        await limited((onSeg, signal) => o.run(e, req, onSeg, signal), (j, text) => {
          const i = rest[j];
          if (i === undefined || got.has(i)) return;
          got.add(i);
          count++;
          if (used < 0) {
            used = idx;
            if (o.onUse) o.onUse(idx);
          }
          o.onSeg(i, text);
        }, o.signal, k < seq.length - 1 ? o.limitOf(e) : null, o.timeoutError);
        if (!count && rest.length) throw o.emptyError();
        delete o.health[keyOf(e)];
        return { ok: true, got, errors, used };
      } catch (err) {
        if (o.signal && o.signal.aborted) throw err;
        failed(o.health, e, err, Date.now());
        errors.push({ idx, err });
      }
    }
    return { ok: false, got, errors, used };
  }

  const api = { keyOf, isHard, holdFor, failed, skipped, order, limited, translate, HOLD_HARD, HOLD_SOFT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).chain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
