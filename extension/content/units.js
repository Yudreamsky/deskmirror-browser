// 桌面魔镜浏览器版：找出网页上要翻的文字块，送去翻译，把译文排进复制品，并把每块的大小锁成原文那么大。
//
// 两种翻译单位：
//  - block：里面只有文字和行内元素的块（段落、标题、列表项、按钮……）。整块带行内标签一起翻，
//    链接、加粗等行内元素在复制品里原样复用，译文里标签换了位置也跟着挪。
//  - leaf：块里混着子块时，散在子块之间的单段文字，单独翻、原地换字。
// 锁大小：复制品里这块的宽高钉成真网页上的大小，译文长短不同也不会把后面的内容推走，两张纸始终对齐。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});
  const T = DM.text;

  const SKIP = 'script,style,noscript,template,textarea,select,option,pre,code,kbd,samp,svg,math,'
    + '[translate="no"],.notranslate,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
  const NOTRANS = '[translate="no"],.notranslate';
  const ATOMIC = new Set(['img', 'svg', 'canvas', 'video', 'audio', 'iframe', 'embed', 'object', 'input', 'select',
    'textarea', 'button', 'br', 'wbr', 'hr', 'picture', 'math', 'meter', 'progress']);
  const CODEY = new Set(['code', 'kbd', 'samp', 'var', 'tt']);
  // 行内 span 和父元素在这些属性上都一样，才当成“没有作用”拆掉（继承下去的换行规则也要一样）
  const NEUTRAL_PROPS = ['color', 'fontWeight', 'fontStyle', 'fontFamily', 'fontSize', 'textDecorationLine',
    'verticalAlign', 'letterSpacing', 'wordSpacing', 'textTransform', 'textShadow', 'whiteSpace', 'wordBreak',
    'overflowWrap', 'lineBreak', 'hyphens', 'lineHeight', 'fontVariant', 'fontFeatureSettings', 'direction'];
  const BATCH_SEGMENTS = 12;
  const BATCH_CHARS = 1800;

  function flatParent(n) {
    if (n.assignedSlot) return n.assignedSlot;
    const p = n.parentNode;
    if (!p) return null;
    if (p.nodeType === 11) return p.host || null;
    return p.nodeType === 1 ? p : null;
  }

  function inlineDisplay(d) {
    return d === 'inline' || d === 'contents' || d.startsWith('ruby');
  }

  function collapses(cs) {
    const c = cs.whiteSpaceCollapse;
    if (c) return c === 'collapse';
    return !/^pre|break-spaces/.test(cs.whiteSpace);
  }

  function shadowOf(el) {
    try {
      if (globalThis.chrome && chrome.dom && chrome.dom.openOrClosedShadowRoot) return chrome.dom.openOrClosedShadowRoot(el);
    } catch (e) { /* 不是扩展环境 */ }
    return el.shadowRoot;
  }

  function dist(r, f) {
    const dx = Math.max(f.x - r.right, r.left - (f.x + f.w), 0);
    const dy = Math.max(f.y - r.bottom, r.top - (f.y + f.h), 0);
    return dx + dy;
  }

  let seq = 0;

  class Units {
    constructor(copy, opts) {
      this.copy = copy;
      this.opts = opts;               // { target, backend, frameRect(), onStatus(s), context(), concurrency }
      this.byNode = new Map();        // 块元素 / 文字节点 → 单位
      this.cache = new Map();         // 键 → 译文
      this.waiting = new Map();       // 键 → Set(单位)
      this.srcOf = new Map();         // 键 → 原文（带标签）
      this.queue = [];
      this.inflight = 0;
      this.locks = new Map();         // 真网页元素 → 引用数
      this.fitted = new Set();        // 缩过字的复制品元素
      this._containers = new Map();   // 放了 leaf 译文的块 → 个数
      this.dirty = new Set();
      this.dirtyAttr = new Set();
      this.toScan = new Set();
      this.paused = false;
      this.error = '';
      this.stats = { units: 0, batches: 0, segments: 0, chars: 0, rendered: 0, tagLoss: 0, scanMs: 0 };
      this.ro = new ResizeObserver((entries) => this._resized(entries));
      this._timer = 0;
      copy.on('change', (ch) => this._onChange(ch));
      copy.on('styleReset', (orig, c) => this._restyle(orig, c));
    }

    start() {
      this.scan(document.body);
      for (const sr of this.copy.shadows.keys()) this.scan(sr);
      this.pump();
    }

    destroy() {
      clearTimeout(this._timer);
      this.ro.disconnect();
      this.paused = true;
    }

    setPaused(on) {
      this.paused = on;
      if (!on) this.pumpSoon(0);
      this._status();
    }

    // ---------------------------------------------------------------- 找翻译单位
    scan(root) {
      if (!root) return;
      const t0 = performance.now();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const pure = new Map();
      for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
        if (!/\S/.test(tn.data) || this.byNode.has(tn)) continue;
        const p = tn.parentElement;
        if (!p || p.closest(SKIP)) continue;
        const block = this._blockOf(tn);
        if (!block) continue;
        if (block !== p && block.closest && block.closest(SKIP)) continue;
        let ok = pure.get(block);
        if (ok === undefined) {
          ok = this._isPure(block);
          pure.set(block, ok);
        }
        if (ok) {
          if (!this.byNode.has(block)) this._add({ kind: 'block', node: block });
        } else {
          this._add({ kind: 'leaf', node: tn, container: block });
        }
      }
      this.stats.scanMs += performance.now() - t0;
    }

    _add(u) {
      u.id = ++seq;
      u.state = 'new';
      u.rendered = false;
      this.byNode.set(u.node, u);
      this.stats.units++;
    }

    _drop(u) {
      if (u.rendered) this._revert(u);
      this.byNode.delete(u.node);
      u.state = 'gone';
    }

    /** 文字所在的块：往上找第一个不是行内的元素（跨过 shadow DOM 和 slot）。藏起来的返回 null。 */
    _blockOf(n) {
      let el = flatParent(n);
      while (el) {
        const d = getComputedStyle(el).display;
        if (d === 'none') return null;
        if (!inlineDisplay(d)) return el;
        el = flatParent(el);
      }
      return null;
    }

    /** 块里是不是只有文字和行内内容（没有子块、slot、shadow DOM）。 */
    _isPure(block) {
      if (shadowOf(block)) return false;
      const walk = (el) => {
        for (let ch = el.firstChild; ch; ch = ch.nextSibling) {
          if (ch.nodeType !== 1) continue;
          const tag = ch.localName;
          if (tag === 'slot') return false;
          const cs = getComputedStyle(ch);
          const d = cs.display;
          if (d === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
          if (ATOMIC.has(tag) || cs.cssFloat !== 'none') continue;
          if (inlineDisplay(d)) {
            if (shadowOf(ch)) return false;
            if (!walk(ch)) return false;
          } else if (!d.startsWith('inline')) {
            return false;
          }
        }
        return true;
      };
      return walk(block);
    }

    _neutral(el, cs, parent) {
      const tag = el.localName;
      if (tag !== 'span' && tag !== 'font') return false;
      if (!el.attributes.length) return true;
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') return false;
      if (parseFloat(cs.paddingLeft) || parseFloat(cs.paddingRight) || parseFloat(cs.marginLeft)
          || parseFloat(cs.marginRight) || parseFloat(cs.borderLeftWidth) || parseFloat(cs.borderRightWidth)) return false;
      const ps = getComputedStyle(parent);
      for (const p of NEUTRAL_PROPS) if (cs[p] !== ps[p]) return false;
      return getComputedStyle(el, '::before').content === 'none' && getComputedStyle(el, '::after').content === 'none';
    }

    /** 生成带标签的原文：<gN>…</gN> 是要保留的行内元素，<xN/> 是原样搬过去的整块（图片、代码、换行、内联块）。 */
    _build(u) {
      const target = this.opts.target;
      if (u.kind === 'leaf') {
        const cs = getComputedStyle(u.container);
        const raw = u.node.data;
        const text = collapses(cs) ? raw.replace(/[ \t\n\r\f]+/g, ' ') : raw;
        u.lead = /^[ \t\n\r\f]/.test(raw) ? ' ' : '';
        u.trail = /[ \t\n\r\f]$/.test(raw) ? ' ' : '';
        u.src = text.trim();
        u.plain = u.src;
        u.tags = [];
        u.key = target + '\u0001' + u.src;
        return;
      }
      const root = u.node;
      const collapse = collapses(getComputedStyle(root));
      const tags = [];
      const carry = [];
      let out = '';
      const walk = (node) => {
        for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
          if (ch.nodeType === 3) {
            out += collapse ? ch.data.replace(/[ \t\n\r\f]+/g, ' ') : ch.data;
            continue;
          }
          if (ch.nodeType !== 1) continue;
          const cs = getComputedStyle(ch);
          const d = cs.display;
          if (d === 'none' || cs.position === 'absolute' || cs.position === 'fixed') {
            carry.push(ch);
            continue;
          }
          const tag = ch.localName;
          if (ATOMIC.has(tag) || CODEY.has(tag) || !inlineDisplay(d) || cs.cssFloat !== 'none'
              || ch.matches(NOTRANS) || !/\S/.test(ch.textContent)) {
            tags.push({ k: 'x', n: ch });
            out += '<x' + tags.length + '/>';
            continue;
          }
          if (d === 'contents' || this._neutral(ch, cs, node)) {
            walk(ch);
            continue;
          }
          tags.push({ k: 'g', n: ch });
          const id = tags.length;
          out += '<g' + id + '>';
          walk(ch);
          out += '</g' + id + '>';
        }
      };
      walk(root);
      if (collapse) out = out.replace(/ {2,}/g, ' ').trim();
      u.src = out;
      u.tags = tags;
      u.carry = carry;
      u.plain = T.stripTags(out);
      u.key = target + '\u0001' + out;
    }

    _rect(u) {
      let r;
      if (u.kind === 'leaf') {
        const range = document.createRange();
        range.selectNodeContents(u.node);
        r = range.getBoundingClientRect();
      } else {
        r = u.node.getBoundingClientRect();
      }
      return r.width * r.height > 0 ? r : null;
    }

    // ---------------------------------------------------------------- 排队翻译
    pumpSoon(ms) {
      if (this._timer) return;
      this._timer = setTimeout(() => {
        this._timer = 0;
        this._process();
      }, ms === undefined ? 100 : ms);
    }

    pump() {
      if (this.paused) return;
      const f = this.opts.frameRect();
      const vw = innerWidth, vh = innerHeight;
      const cand = [];
      for (const u of this.byNode.values()) {
        if (u.state !== 'new') continue;
        const r = this._rect(u);
        if (!r || r.bottom < -vh * 0.5 || r.top > vh * 1.5 || r.right < 0 || r.left > vw) continue;
        cand.push([dist(r, f), u]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, u] of cand) this._request(u);
      // 离开口最近的先翻：队列也按距离排
      if (cand.length) {
        const order = new Map();
        cand.forEach(([d, u], i) => { if (u.key && !order.has(u.key)) order.set(u.key, i); });
        this.queue.sort((a, b) => (order.has(a) ? order.get(a) : 1e9) - (order.has(b) ? order.get(b) : 1e9));
      }
      this._dispatch();
    }

    _request(u) {
      this._build(u);
      if (!u.src || !T.hasWords(u.plain) || T.isAlreadyTarget(u.plain, this.opts.target)) {
        u.state = 'skip';
        return;
      }
      const hit = this.cache.get(u.key);
      if (hit !== undefined) {
        this._render(u, hit);
        return;
      }
      let w = this.waiting.get(u.key);
      if (!w) {
        w = new Set();
        this.waiting.set(u.key, w);
        this.srcOf.set(u.key, u.src);
        this.queue.push(u.key);
      }
      w.add(u);
      u.state = 'queued';
    }

    _dispatch() {
      const max = this.opts.concurrency || 2;
      while (!this.paused && this.inflight < max && this.queue.length) {
        const keys = [];
        let chars = 0;
        while (this.queue.length && keys.length < BATCH_SEGMENTS && chars < BATCH_CHARS) {
          const k = this.queue.shift();
          if (!this.waiting.has(k)) continue;
          keys.push(k);
          chars += this.srcOf.get(k).length;
        }
        if (!keys.length) break;
        this._send(keys, chars);
      }
      this._status();
    }

    _send(keys, chars) {
      this.inflight++;
      this.stats.batches++;
      this.stats.segments += keys.length;
      this.stats.chars += chars;
      const got = new Set();
      const ctx = this.opts.context ? this.opts.context() : '';
      let finished = false;
      this.opts.backend.translate(
        { segments: keys.map((k) => this.srcOf.get(k)), target: this.opts.target, context: ctx },
        (i, text) => {
          if (finished || got.has(i) || i < 0 || i >= keys.length) return;
          got.add(i);
          this._arrived(keys[i], text);
        },
        (err) => {
          if (finished) return;
          finished = true;
          this.inflight--;
          if (err) this.error = String(err);
          else this.error = '';
          keys.forEach((k, i) => { if (!got.has(i)) this._failed(k); });
          this._dispatch();
        },
      );
    }

    _arrived(key, text) {
      this.cache.set(key, text);
      this.srcOf.delete(key);
      const w = this.waiting.get(key);
      this.waiting.delete(key);
      if (!w) return;
      for (const u of w) {
        if (u.key === key && u.state === 'queued' && this.byNode.get(u.node) === u) this._render(u, text);
      }
      this._status();
    }

    _failed(key) {
      const w = this.waiting.get(key);
      this.waiting.delete(key);
      this.srcOf.delete(key);
      if (!w) return;
      for (const u of w) {
        if (u.state !== 'queued') continue;
        u.state = 'failed';
        // 过一会儿再试
        setTimeout(() => { if (u.state === 'failed') { u.state = 'new'; this.pumpSoon(); } }, 8000);
      }
    }

    _status() {
      if (this.opts.onStatus) {
        this.opts.onStatus({ pending: this.waiting.size, inflight: this.inflight, error: this.error, paused: this.paused });
      }
    }

    // ---------------------------------------------------------------- 排进复制品
    _render(u, text) {
      const ok = u.kind === 'leaf' ? this._renderLeaf(u, text) : this._renderBlock(u, text);
      if (!ok) {
        u.state = 'new';
        return;
      }
      u.state = 'done';
      u.text = text;
      this.stats.rendered++;
    }

    _renderBlock(u, text) {
      const copy = this.copy;
      const cRoot = copy.map.get(u.node);
      if (!cRoot || !cRoot.isConnected) return false;
      if (u.rendered) copy.resync(u.node);
      const { nodes, used } = T.parseTagged(text, u.tags.length);
      if (used.size < u.tags.length) this.stats.tagLoss++;
      const cdoc = cRoot.ownerDocument;
      const build = (list) => {
        const out = [];
        for (const n of list) {
          if (n.t === 'text') {
            out.push(cdoc.createTextNode(n.v));
            continue;
          }
          const tag = u.tags[n.id - 1];
          const c = tag && copy.map.get(tag.n);
          if (!c) {
            if (n.c) out.push(...build(n.c));
            continue;
          }
          if (tag.k === 'g') {
            c.replaceChildren(...build(n.c || []));
            out.push(c);
          } else {
            out.push(c);
            if (n.c) out.push(...build(n.c));
          }
        }
        return out;
      };
      const out = build(nodes);
      // 模型漏掉的图片、换行等整块放到末尾，别丢
      u.tags.forEach((tag, i) => {
        if (tag.k === 'x' && !used.has('x' + (i + 1))) {
          const c = copy.map.get(tag.n);
          if (c) out.push(c);
        }
      });
      for (const n of u.carry) {
        const c = copy.map.get(n);
        if (c) out.push(c);
      }
      cRoot.replaceChildren(...out);
      if (!u.rendered) u.locked = this._lockTree(u.node);
      u.rendered = true;
      this._fit(u.node);
      return true;
    }

    _renderLeaf(u, text) {
      const c = this.copy.map.get(u.node);
      if (!c) return false;
      c.data = u.lead + text + u.trail;
      if (!u.rendered) {
        u.locked = this._lockTree(u.container);
        this._containers.set(u.container, (this._containers.get(u.container) || 0) + 1);
      }
      u.rendered = true;
      this._fit(u.container);
      return true;
    }

    _revert(u) {
      if (!u.rendered) return;
      if (u.kind === 'leaf') {
        const c = this.copy.map.get(u.node);
        if (c) c.data = u.node.data;
        for (const el of u.locked || []) this._unlock(el);
        const n = this._containers.get(u.container) || 0;
        if (n > 1) this._containers.set(u.container, n - 1);
        else this._containers.delete(u.container);
      } else {
        this.copy.resync(u.node);
        for (const el of u.locked || []) this._unlock(el);
      }
      u.rendered = false;
    }

    // ---------------------------------------------------------------- 锁大小、缩字
    /**
     * 锁住这一块，还有会被它的内容大小牵动的祖先和兄弟：
     * 弹性盒、网格里的项目，宽度由内容决定的祖先（inline-block、浮动、绝对定位、表格单元格、弹性项目）。
     * 只锁这一块的话，它的“内容宽度”变了，祖先按内容收缩时会算出不同的宽度，兄弟分到的空间也跟着变。
     */
    _lockTree(el) {
      const out = [el];
      this._lock(el);
      let cur = el;
      for (let i = 0; i < 8; i++) {
        const p = flatParent(cur);
        if (!p || p === document.body || p === document.documentElement) break;
        const pd = getComputedStyle(p).display;
        if (/flex|grid/.test(pd)) {
          for (const sib of p.children) {
            if (sib === cur || sib === this.copy.shell.host) continue;
            this._lock(sib);
            out.push(sib);
          }
        }
        if (!this._contentSized(p)) break;
        this._lock(p);
        out.push(p);
        cur = p;
      }
      return out;
    }

    _contentSized(el) {
      const cs = getComputedStyle(el);
      if (cs.display.startsWith('inline') || cs.display === 'table-cell' || cs.display === 'table') return true;
      if (cs.cssFloat !== 'none' || cs.position === 'absolute' || cs.position === 'fixed') return true;
      const p = flatParent(el);
      return !!p && /flex|grid/.test(getComputedStyle(p).display);
    }

    _lock(el) {
      const n = this.locks.get(el);
      if (n) {
        this.locks.set(el, n + 1);
        return;
      }
      this.locks.set(el, 1);
      this._applyLock(el);
      this.ro.observe(el);
    }

    _unlock(el) {
      const n = this.locks.get(el);
      if (!n) return;
      if (n > 1) {
        this.locks.set(el, n - 1);
        return;
      }
      this.locks.delete(el);
      this.ro.unobserve(el);
      const c = this.copy.map.get(el);
      if (c) this.fitted.delete(c);
      this.copy._syncAttr(el, 'style', null);
    }

    _applyLock(el) {
      const c = this.copy.map.get(el);
      if (!c || c.nodeType !== 1) return;
      const cs = getComputedStyle(el);
      if (!cs.width.endsWith('px') || !cs.height.endsWith('px')) return;
      const st = c.style;
      st.setProperty('width', cs.width, 'important');
      // 表格的 height 量出来含标题（caption），设回去只作用于表格本身，会多出一个标题的高度；表格高度由行决定，不锁
      if (!/table$/.test(cs.display)) st.setProperty('height', cs.height, 'important');
      st.setProperty('min-width', '0px', 'important');
      st.setProperty('min-height', '0px', 'important');
      st.setProperty('max-width', 'none', 'important');
      st.setProperty('max-height', 'none', 'important');
      st.setProperty('flex', '0 0 auto', 'important');
    }

    /** 真网页那边重设了 style 属性，复制品跟着重设后要把锁和缩字补回去。 */
    _restyle(orig, c) {
      if (!this.locks.has(orig)) return;
      this._applyLock(orig);
      if (this.fitted.has(c)) {
        this.fitted.delete(c);
        this._fit(orig);
      }
    }

    _resized(entries) {
      for (const e of entries) {
        if (this.locks.has(e.target)) {
          this._applyLock(e.target);
          // 只有放译文的块才缩字；一起锁住的祖先、兄弟不缩
          const u = this.byNode.get(e.target);
          if ((u && u.rendered) || this._containers.has(e.target)) this._fit(e.target);
        }
      }
    }

    /** 译文比原文长、锁住的框放不下时，整块缩小字号（最多到 60%）。 */
    _fit(el) {
      const c = this.copy.map.get(el);
      if (!c || c.nodeType !== 1) return;
      if (this.fitted.has(c)) {
        this.fitted.delete(c);
        this.copy._syncAttr(el, 'style', null);   // 先撤掉上次缩的字号（会触发 _restyle 补回锁）
      }
      const limitH = Math.max(c.clientHeight, el.scrollHeight) + 2;
      const limitW = Math.max(c.clientWidth, el.scrollWidth) + 2;
      const over = () => c.scrollHeight > limitH || c.scrollWidth > limitW;
      if (!over()) return;
      const cs = getComputedStyle(c);
      const fs = parseFloat(cs.fontSize);
      const lh = cs.lineHeight;
      this.fitted.add(c);
      for (const k of [0.9, 0.8, 0.7, 0.6]) {
        c.style.setProperty('font-size', (fs * k).toFixed(2) + 'px', 'important');
        if (lh.endsWith('px')) c.style.setProperty('line-height', (parseFloat(lh) * k).toFixed(2) + 'px', 'important');
        if (!over()) break;
      }
    }

    // ---------------------------------------------------------------- 网页变化
    _onChange(ch) {
      if (ch.scroll) {
        this.pumpSoon(150);
        return;
      }
      if (ch.added) for (const n of ch.added) this.toScan.add(n);
      if (ch.changed) {
        for (const n of ch.changed) {
          const u = this._unitOf(n);
          if (u) this.dirty.add(u);
          else if (n.nodeType === 3) this.toScan.add(n);
        }
      }
      if (ch.attrs) {
        for (const n of ch.attrs) {
          const u = this._unitOf(n);
          if (u) this.dirtyAttr.add(u);
        }
      }
      this.pumpSoon(120);
    }

    _unitOf(n) {
      let k = 0;
      for (let x = n; x && k < 40; x = flatParent(x), k++) {
        const u = this.byNode.get(x);
        if (u) return u;
      }
      return null;
    }

    _process() {
      // 只改了属性的：译文结构不受影响（复制品里用的就是同一个元素），只有原文或块的边界变了才重排
      for (const u of this.dirtyAttr) {
        if (this.dirty.has(u) || u.state === 'gone' || u.key === undefined) continue;
        if (!u.node.isConnected || (u.kind === 'block' && !this._isPure(u.node))) {
          this.dirty.add(u);
          continue;
        }
        const oldKey = u.key;
        this._build(u);
        if (u.key !== oldKey) {
          u.prevKey = oldKey;
          this.dirty.add(u);
        }
      }
      this.dirtyAttr.clear();
      for (const u of this.dirty) {
        if (u.state === 'gone') continue;
        if (!u.node.isConnected) {
          this._drop(u);
          continue;
        }
        if (u.kind === 'block' && !this._isPure(u.node)) {
          this._drop(u);
          this.toScan.add(u.node);
          continue;
        }
        const oldKey = u.prevKey !== undefined ? u.prevKey : u.key;
        u.prevKey = undefined;
        if (oldKey === undefined) continue;
        this._build(u);
        if (u.key === oldKey && !u.rendered) continue;
        const hit = this.cache.get(u.key);
        if (u.rendered) {
          if (hit !== undefined) this._render(u, hit);
          else {
            this._revert(u);
            u.state = 'new';
          }
        } else if (u.key !== oldKey && u.state !== 'queued') {
          u.state = 'new';
        }
      }
      this.dirty.clear();
      for (const n of this.toScan) {
        if (!n.isConnected) continue;
        if (n.nodeType === 3) this.scan(n.parentNode);
        else if (n.nodeType === 1 || n.nodeType === 11) this.scan(n);
      }
      this.toScan.clear();
      this.pump();
    }
  }

  DM.Units = Units;
})();
