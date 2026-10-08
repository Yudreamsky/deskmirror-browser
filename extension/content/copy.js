// 桌面魔镜浏览器版：把当前网页实时复制一份（“下面那张纸”）。
//
// 复制品放在一个只读的 iframe 里，和真网页一样大、滚到同一个位置；网站自己的脚本不在里面运行。
// 真网页一有变化（增删节点、改属性、改文字、滚动、悬停、焦点），就按节点对应关系改到复制品上。
// 视频、画布、嵌入网页、输入框这些复制不过来或者要保持可用的，在复制品里只占位，开口处挖洞露出真网页。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});

  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const HOLE_SEL = 'video,canvas,iframe,frame,embed,object,audio[controls],input:not([type="hidden"]),textarea,select';
  // 画布在复制品里是空的，要挖洞露出真网页；但画布常常是“底”，上面还压着网页文字（Comfy 的节点、图表的图例），
  // 这些文字的译文要从洞里重新露出来（见 main.js 的 updateClip）。其他的洞（输入框、iframe、视频）照旧整块露出真网页。
  const UNDER = new Set(['canvas']);
  // 这些属性一复制就会去加载东西或运行东西，复制品里不要
  const DROP_ATTR = {
    iframe: ['src', 'srcdoc'], frame: ['src'], embed: ['src'], object: ['data'],
    video: ['src', 'autoplay'], audio: ['src', 'autoplay'], track: ['src'], script: ['src'],
  };
  const HOVER_PSEUDO = /:(hover|focus-visible|focus-within|focus|active)\b/;
  // 图片、视频这类元素的大小取决于加载状态（没加载完、加载失败、懒加载），两边常常不一样，按真网页钉住
  const REPLACED = new Set(['img', 'video', 'canvas', 'iframe', 'embed', 'object']);

  function shadowOf(el) {
    try {
      if (globalThis.chrome && chrome.dom && chrome.dom.openOrClosedShadowRoot) {
        return chrome.dom.openOrClosedShadowRoot(el) || null;
      }
    } catch (e) { /* 不是扩展环境 */ }
    return el.shadowRoot || null;
  }

  function doctypeOf(doc) {
    const d = doc.doctype;
    if (!d) return '';
    let s = '<!DOCTYPE ' + d.name;
    if (d.publicId) s += ' PUBLIC "' + d.publicId + '"';
    if (d.systemId) s += (d.publicId ? '' : ' SYSTEM') + ' "' + d.systemId + '"';
    return s + '>';
  }

  /**
   * 空 iframe 一开始是怪异模式；写一个和原网页一样的 doctype 进去。
   * 有的网站（YouTube 等）开了 Trusted Types，直接 write 字符串会被拒，要先建一个策略；
   * 策略名也被限制时，只 open 不 close：open 之后就是标准模式，一直开着也不影响显示。
   */
  function writeDoctype(cdoc) {
    const html = doctypeOf(document);
    try {
      cdoc.open();
      cdoc.write(html);
      cdoc.close();
      return;
    } catch (e) { /* Trusted Types */ }
    try {
      if (!DM.ttPolicy) DM.ttPolicy = trustedTypes.createPolicy('deskmirror', { createHTML: (x) => x });
      cdoc.open();
      cdoc.write(DM.ttPolicy.createHTML(html));
      cdoc.close();
      return;
    } catch (e) { /* 策略名受限 */ }
    try { cdoc.open(); } catch (e) { /* 没办法了，按怪异模式 */ }
  }

  /**
   * Chrome 的 CSSOM 有个缺陷：简写属性里用了 var()、后面又单独改了其中一项（如 padding: var(--a); padding-right: 0），
   * 读出来的文字里其余几项就成了空值（padding-top: ;），原值再也读不回来。CSS-in-JS（Emotion 等）插入的规则只能这样读，
   * 复制品里就少了这些声明。这里把这类规则记下来（选择器 + 丢了的属性），之后按真网页算好的值补到复制品元素上。
   */
  function findBroken(rules, sink, root) {
    if (!sink) return;
    const walk = (rs, depth) => {
      for (const r of rs) {
        if (r.style && r.selectorText !== undefined) {
          let props = null;
          for (let i = 0; i < r.style.length; i++) {
            const n = r.style[i];
            if (!n.startsWith('--') && r.style.getPropertyValue(n) === '') (props = props || []).push(n);
          }
          if (props && !r.selectorText.includes('&')) sink.push({ sel: r.selectorText, props, root });
        }
        if (r.cssRules && depth < 4) walk(r.cssRules, depth + 1);
      }
    };
    try { walk(rules, 0); } catch (e) { /* 读不到 */ }
  }

  function rulesText(rules) {
    let out = '';
    for (const r of rules) out += r.cssText + '\n';
    return out;
  }

  class LiveCopy {
    constructor(shell) {
      this.shell = shell;               // { host, root }：我们自己的界面，复制时跳过
      this.map = new WeakMap();         // 真网页节点 → 复制品节点
      this.styles = new Map();          // 真网页 <style> → 上次的规则数
      this.shadows = new Map();         // 真网页 shadow root → 复制品 shadow root
      this.pendingShadow = new Set();   // 还没长出 shadow root 的自定义元素
      this.scrolled = new Set();        // 滚动过的元素
      this.holeEls = [];
      this.hovered = new Set();
      this.focused = new Set();
      this.listeners = { change: [], styleReset: [] };
      this.fixed = new Map();           // 真网页上 position:fixed 的元素 → 复制品里给它的反向补偿动画
      this.inner = new Map();           // 页面里单独滚动的元素 → 补偿动画
      this.fixedAll = new Set();        // 真网页上所有 position:fixed 的元素（包括不用补偿的）
      this.stats = { buildMs: 0, nodes: 0, mutBatches: 0, mutMs: 0, maxMutMs: 0, fixedMs: 0 };
      this.compositorSync = shell.compositorSync !== false;
      this._raf = 0;
      this._frames = 0;
      this._holesDirty = true;
      this._keyboard = false;
    }

    on(name, fn) { this.listeners[name].push(fn); }
    _emit(name, ...args) { for (const fn of this.listeners[name]) fn(...args); }

    // ---------------------------------------------------------------- 建立复制品
    build() {
      const t0 = performance.now();
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.className = 'sheet';
      // 层次：clip（按开口裁剪，视口坐标）→ base（主线程同步的滚动量）→ ty / tx（合成器按真网页滚动量反向平移）→ iframe
      const mk = (cls) => {
        const d = document.createElement('div');
        d.className = cls;
        return d;
      };
      this.clip = mk('clip');
      this.base = mk('base');
      this.ty = mk('ty');
      this.tx = mk('tx');
      this.clip.appendChild(this.base);
      this.base.appendChild(this.ty);
      this.ty.appendChild(this.tx);
      this.tx.appendChild(frame);
      this.frame = frame;
      if (this.compositorSync) this.base.classList.add('live');
      this.shell.root.appendChild(this.clip);
      this._sizeFrame();
      const cdoc = frame.contentDocument;
      // 保持和原网页同样的排版模式（标准 / 有限怪异 / 怪异模式），否则排版会不一样
      writeDoctype(cdoc);
      this.cdoc = cdoc;
      this.cwin = frame.contentWindow;

      const html = this._cloneDeep(document.documentElement);
      cdoc.replaceChild(html, cdoc.documentElement);
      if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) {
        this.adoptedCopies = this._adopted(document.adoptedStyleSheets);
      }
      this._helperSheet();
      this._hoverSheet();

      this.replacedRO = new ResizeObserver((entries) => {
        for (const e of entries) {
          const c = this.map.get(e.target);
          if (c && c.nodeType === 1) this._sizeReplaced(e.target, c);
        }
      });
      for (const el of this._earlyReplaced || []) this.replacedRO.observe(el);
      this._earlyReplaced = null;
      this.observer = new MutationObserver((recs) => this._onMutations(recs));
      this._observe(document);
      this._listen(window, document);
      cdoc.addEventListener('load', () => this._afterLoad(), true);

      this.fixBroken();
      this._syncAllScroll();
      this._scanFixed(document.documentElement);
      this.refreshHoles();
      this._tick = this._tick.bind(this);
      this._raf = requestAnimationFrame(this._tick);
      this.stats.buildMs = performance.now() - t0;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      if (this.observer) this.observer.disconnect();
      if (this.replacedRO) this.replacedRO.disconnect();
      for (const off of this._offs || []) off();
      clearInterval(this._shadowTimer);
      for (const a of [this._animY, this._animX, ...this.fixed.values()]) if (a) a.cancel();
      this.fixed.clear();
      for (const st of this.inner.values()) for (const k of st.kids || []) k.anim.cancel();
      this.inner.clear();
      if (this.clip) this.clip.remove();
      this.frame = null;
    }

    _sizeFrame() {
      for (const el of [this.frame, this.clip]) {
        el.style.width = window.innerWidth + 'px';
        el.style.height = window.innerHeight + 'px';
      }
    }

    _observe(target) {
      this.observer.observe(target, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
    }

    _listen(win, doc) {
      const offs = (this._offs = []);
      const add = (t, ev, fn, opt) => {
        t.addEventListener(ev, fn, opt);
        offs.push(() => t.removeEventListener(ev, fn, opt));
      };
      this._onScroll = (e) => this._scrollFrom(e.target);
      add(doc, 'scroll', this._onScroll, { capture: true, passive: true });
      add(win, 'resize', () => { this._sizeFrame(); this._holesDirty = true; this._syncAllScroll(); }, { passive: true });
      // 滚轮一按下就把要滚的区域的补偿准备好，不用等第一个 scroll 事件（那时合成器已经滚了一帧）
      add(win, 'wheel', (e) => this._preScroll(e), { capture: true, passive: true });
      add(win, 'pointermove', (e) => this._hover(e), { capture: true, passive: true });
      add(win, 'pointerover', (e) => { this._hover(e); this._preScroll(e); }, { capture: true, passive: true });
      add(doc, 'pointerleave', () => this._setHover([]), { passive: true });
      add(win, 'focusin', () => this._focus(), true);
      add(win, 'focusout', () => setTimeout(() => this._focus(), 0), true);
      add(win, 'keydown', () => { this._keyboard = true; }, true);
      add(win, 'pointerdown', () => { this._keyboard = false; }, true);
      add(doc, 'input', (e) => this._formState(e.target), true);
      add(doc, 'change', (e) => this._formState(e.target), true);
      add(doc, 'load', () => { this._holesDirty = true; }, true);
      add(doc, 'toggle', (e) => this._topLayer(e.target), true);
      this._shadowTimer = setInterval(() => this._checkPending(), 300);
    }

    // ---------------------------------------------------------------- 复制节点
    _cloneShallow(orig) {
      const cdoc = this.cdoc;
      switch (orig.nodeType) {
        case 1: {
          if (orig === this.shell.host) return null;
          const tag = orig.localName;
          let el;
          try {
            el = orig.namespaceURI === HTML_NS ? cdoc.createElement(tag) : cdoc.createElementNS(orig.namespaceURI, orig.tagName);
          } catch (e) {
            return null;
          }
          this._copyAttrs(orig, el);
          return el;
        }
        case 3:
          return cdoc.createTextNode(orig.data);
        default:
          return null;
      }
    }

    _copyAttrs(orig, el) {
      const tag = orig.localName;
      const drop = DROP_ATTR[tag];
      for (const a of orig.attributes) {
        const name = a.name;
        if (name.length > 2 && name[0] === 'o' && name[1] === 'n') continue;
        if (drop && drop.includes(name)) continue;
        if (name === 'style') continue;
        if (tag === 'source' && (name === 'src' || name === 'srcset') && orig.parentElement
            && orig.parentElement.localName !== 'picture') continue;
        if (tag === 'link' && name === 'rel' && !/\bstylesheet\b/i.test(a.value)) {
          el.setAttribute('data-dm-rel', a.value);
          continue;
        }
        try {
          if (a.namespaceURI) el.setAttributeNS(a.namespaceURI, name, a.value);
          else el.setAttribute(name, a.value);
        } catch (e) { /* 非法属性名 */ }
      }
      if (orig.style && orig.style.cssText) el.style.cssText = orig.style.cssText;
      if (tag === 'script') el.setAttribute('type', 'dm/inert');
      if (tag === 'video' || tag === 'audio') el.setAttribute('preload', 'none');
      if ((tag === 'style' || tag === 'link' || tag === 'script') && orig.nonce) el.nonce = orig.nonce;
    }

    _cloneDeep(orig) {
      const c = this._cloneShallow(orig);
      if (!c) return null;
      this.map.set(orig, c);
      this.stats.nodes++;
      if (orig.nodeType !== 1) return c;
      const tag = orig.localName;
      if (tag === 'style') {
        c.textContent = this._styleText(orig);
        return c;
      }
      if (tag === 'script' || tag === 'noscript') return c;  // 内容不要
      for (let ch = orig.firstChild; ch; ch = ch.nextSibling) {
        const cc = this._cloneDeep(ch);
        if (cc) c.appendChild(cc);
      }
      const sr = shadowOf(orig);
      if (sr) this._cloneShadow(orig, sr, c);
      else if (tag.includes('-')) this.pendingShadow.add(orig);
      this._post(orig, c);
      return c;
    }

    _post(orig, c) {
      const tag = orig.localName;
      try {
        if (tag === 'input' && orig.type !== 'file') {
          c.value = orig.value;
          c.checked = orig.checked;
        } else if (tag === 'textarea') {
          c.value = orig.value;
        } else if (tag === 'select') {
          c.selectedIndex = orig.selectedIndex;
        }
      } catch (e) { /* 只读属性 */ }
      if (tag.includes('-')) this._pin(orig, c);
      if (tag === 'dialog' || orig.hasAttribute('popover')) this._topLayer(orig);
      if (orig.scrollTop || orig.scrollLeft) this.scrolled.add(orig);
      if (REPLACED.has(tag)) {
        this._sizeReplaced(orig, c);
        if (this.replacedRO) this.replacedRO.observe(orig);
        else (this._earlyReplaced = this._earlyReplaced || []).push(orig);
      }
    }

    _sizeReplaced(orig, c) {
      const cs = getComputedStyle(orig);
      if (cs.display === 'none' || !cs.width.endsWith('px')) return;
      c.style.setProperty('width', cs.width, 'important');
      c.style.setProperty('height', cs.height, 'important');
      c.style.setProperty('min-width', '0px', 'important');
      c.style.setProperty('min-height', '0px', 'important');
      c.style.setProperty('max-width', 'none', 'important');
      c.style.setProperty('max-height', 'none', 'important');
      c.style.setProperty('aspect-ratio', 'auto', 'important');
    }

    /** 自定义元素在复制品里永远是“未定义”，网站常用 :not(:defined) 把它藏起来；把真网页上的显示状态钉上去。 */
    _pin(orig, c) {
      const cs = getComputedStyle(orig);
      c.style.setProperty('display', cs.display, 'important');
      c.style.setProperty('visibility', cs.visibility, 'important');
      c.style.setProperty('opacity', cs.opacity, 'important');
    }

    /** 模态对话框、弹出层在真网页的最上层，盖在镜子上面；复制品里它们会跑到正文里，藏起来。 */
    _topLayer(orig) {
      const c = this.map.get(orig);
      if (!c || c.nodeType !== 1) return;
      let top = false;
      try { top = orig.matches(':modal') || orig.matches(':popover-open'); } catch (e) { /* 老浏览器 */ }
      if (top) c.setAttribute('data-dm-hide', '');
      else c.removeAttribute('data-dm-hide');
    }

    _cloneShadow(orig, sr, c) {
      let csr;
      try {
        csr = c.attachShadow({ mode: 'open', delegatesFocus: sr.delegatesFocus });
      } catch (e) {
        return;
      }
      this.shadows.set(sr, csr);
      this.map.set(sr, csr);
      for (let ch = sr.firstChild; ch; ch = ch.nextSibling) {
        const cc = this._cloneDeep(ch);
        if (cc) csr.appendChild(cc);
      }
      if (sr.adoptedStyleSheets && sr.adoptedStyleSheets.length) {
        csr.adoptedStyleSheets = this._adopted(sr.adoptedStyleSheets);
      }
      if (this.observer) this._watchShadow(sr);
      else (this._earlyShadows = this._earlyShadows || []).push(sr);
    }

    _watchShadow(sr) {
      this._observe(sr);
      sr.addEventListener('scroll', this._onScroll, { capture: true, passive: true });
    }

    _checkPending() {
      if (this._earlyShadows) {
        for (const sr of this._earlyShadows) this._watchShadow(sr);
        this._earlyShadows = null;
      }
      for (const orig of this.pendingShadow) {
        if (!orig.isConnected) { this.pendingShadow.delete(orig); continue; }
        const sr = shadowOf(orig);
        if (!sr) continue;
        this.pendingShadow.delete(orig);
        const c = this.map.get(orig);
        if (c && !c.shadowRoot) {
          this._cloneShadow(orig, sr, c);
          this._pin(orig, c);
          this._emit('change', { added: [sr], changed: [orig] });
        }
      }
      this._checkStyles();
    }

    _adopted(sheets) {
      const out = [];
      for (const s of sheets) {
        try {
          const n = new this.cwin.CSSStyleSheet({ media: s.media.mediaText });
          n.replaceSync(rulesText(s.cssRules));
          findBroken(s.cssRules, this._brokenSink(), null);
          out.push(n);
        } catch (e) { /* 读不到 */ }
      }
      return out;
    }

    // ---------------------------------------------------------------- 样式表
    _styleText(orig) {
      const text = orig.textContent;
      let n = -1;
      try {
        const rules = orig.sheet && orig.sheet.cssRules;
        if (rules) {
          n = rules.length;
          // CSS-in-JS 常用 insertRule 往空的 <style> 里塞规则，文字内容里看不到
          if (!text.trim() && n) {
            this.styles.set(orig, { n, cssom: true });
            findBroken(rules, this._brokenSink(), orig.getRootNode());
            return rulesText(rules);
          }
        }
      } catch (e) { /* 跨域 */ }
      this.styles.set(orig, { n, cssom: false });
      return text;
    }

    _resyncStyle(orig) {
      const c = this.map.get(orig);
      if (c) c.textContent = this._styleText(orig);
      this._hoverDirty = true;
    }

    _checkStyles() {
      for (const [orig, info] of this.styles) {
        if (!orig.isConnected) { this.styles.delete(orig); continue; }
        let n = -1;
        try { n = orig.sheet ? orig.sheet.cssRules.length : -1; } catch (e) { /* 跨域 */ }
        if (n !== info.n) {
          info.cssom = true;
          const c = this.map.get(orig);
          try {
            if (c && orig.sheet) {
              c.textContent = rulesText(orig.sheet.cssRules);
              findBroken(orig.sheet.cssRules, this._brokenSink(), orig.getRootNode());
            }
          } catch (e) { /* 跨域 */ }
          info.n = n;
          this._hoverDirty = true;
        }
      }
      if (this._hoverDirty) {
        this._hoverDirty = false;
        this._hoverSheet();
      }
      if (this._brokenDirty) this.fixBroken();
    }

    // ---------------------------------------------------------------- 补回 CSSOM 读丢的声明
    _brokenSink() {
      this._brokenDirty = true;
      if (!this.broken) this.broken = new Map();   // 选择器 → { props:Set, root }
      const self = this;
      return { push(b) {
        const key = b.sel + '\u0001' + (b.root && b.root !== document ? 'shadow' : 'doc');
        let e = self.broken.get(key);
        if (!e) self.broken.set(key, (e = { sel: b.sel, props: new Set(), roots: new Set() }));
        for (const p of b.props) e.props.add(p);
        e.roots.add(b.root && b.root.nodeType === 11 ? b.root : document);
      } };
    }

    /** 命中这些规则的元素：按真网页上算好的值写到复制品元素的行内样式上（锁大小等加了 !important 的不受影响）。 */
    fixBroken() {
      this._brokenDirty = false;
      if (!this.broken || !this.broken.size) return;
      const t0 = performance.now();
      const LOCKED = /^(width|height|min-width|min-height|max-width|max-height|flex|flex-grow|flex-shrink|flex-basis|display|visibility|opacity)$/;
      let budget = 4000;
      this.fixedUp = this.fixedUp || new WeakMap();
      for (const e of this.broken.values()) {
        // 伪元素（::before）没法用行内样式补
        if (/::|:(before|after|first-line|first-letter|marker|placeholder|selection)\b/.test(e.sel)) continue;
        for (const root of e.roots) {
          let els;
          try { els = root.querySelectorAll(e.sel); } catch (err) { continue; }
          for (const el of els) {
            if (--budget < 0) break;
            const ce = this.map.get(el);
            if (!ce || ce.nodeType !== 1) continue;
            const cs = getComputedStyle(el);
            let done = this.fixedUp.get(ce);
            if (!done) this.fixedUp.set(ce, (done = new Set()));
            for (const p of e.props) {
              if (LOCKED.test(p)) continue;
              const v = cs.getPropertyValue(p);
              if (v && ce.style.getPropertyValue(p) !== v) ce.style.setProperty(p, v);
              done.add(p);
            }
          }
        }
      }
      this.stats.brokenMs = (this.stats.brokenMs || 0) + performance.now() - t0;
    }

    /** 真网页那边重设了 style 属性，复制品跟着重设后，补上去的值要重新写。 */
    _refix(orig, c) {
      const done = this.fixedUp && this.fixedUp.get(c);
      if (!done) return;
      const cs = getComputedStyle(orig);
      for (const p of done) {
        const v = cs.getPropertyValue(p);
        if (v) c.style.setProperty(p, v);
      }
    }

    /** 复制品自己的几条规则：不平滑滚动、不做滚动锚定、noscript 和顶层元素不显示、透明画布补上底色。 */
    _helperSheet() {
      const s = new this.cwin.CSSStyleSheet();
      let css = '*,*::before,*::after{scroll-behavior:auto!important;overflow-anchor:none!important}'
        + 'noscript{display:none!important}[data-dm-hide]{display:none!important}';
      const rootBg = getComputedStyle(document.documentElement);
      const bodyBg = document.body ? getComputedStyle(document.body) : null;
      const clear = (cs) => !cs || ((cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent')
        && cs.backgroundImage === 'none');
      if (clear(rootBg) && clear(bodyBg)) css += 'html{background-color:Canvas!important}';
      s.replaceSync(css);
      this.helper = s;
      this._applySheets();
    }

    /**
     * 复制品里没有真的鼠标悬停和焦点：把读得到的样式表里带 :hover/:focus/:active 的规则改写成属性选择器
     * （[data-dm-hover] 等，优先级不变），再按真网页的悬停、焦点状态给复制品节点打上属性。
     */
    _hoverSheet() {
      const parts = [];
      const walk = (rules, depth) => {
        for (const r of rules) {
          const kind = r.constructor && r.constructor.name;
          if (kind === 'CSSStyleRule') {
            if (HOVER_PSEUDO.test(r.selectorText)) {
              const sel = r.selectorText
                .replace(/:hover\b/g, '[data-dm-hover]')
                .replace(/:focus-visible\b/g, '[data-dm-focus-visible]')
                .replace(/:focus-within\b/g, '[data-dm-focus-within]')
                .replace(/:focus\b/g, '[data-dm-focus]')
                .replace(/:active\b/g, '[data-dm-active]');
              parts.push(sel + '{' + r.style.cssText + '}');
            }
            continue;
          }
          let head = null;
          if (kind === 'CSSMediaRule') head = '@media ' + r.media.mediaText;
          else if (kind === 'CSSSupportsRule') head = '@supports ' + r.conditionText;
          else if (kind === 'CSSContainerRule') head = '@container ' + r.conditionText;
          else if (kind === 'CSSLayerBlockRule' && r.name) head = '@layer ' + r.name;
          if (!head || depth > 3) continue;
          const start = parts.length;
          walk(r.cssRules, depth + 1);
          if (parts.length > start) parts.push(head + '{' + parts.splice(start).join('') + '}');
        }
      };
      for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
        try { walk(sheet.cssRules, 0); } catch (e) { /* 跨域样式表读不到 */ }
      }
      try {
        const s = this.hoverSheet || new this.cwin.CSSStyleSheet();
        s.replaceSync(parts.join('\n'));
        this.hoverSheet = s;
        this._applySheets();
      } catch (e) { /* 改写后有不认识的语法 */ }
    }

    _applySheets() {
      const own = this.adoptedCopies || [];
      this.cdoc.adoptedStyleSheets = [...own, ...(this.hoverSheet ? [this.hoverSheet] : []), ...(this.helper ? [this.helper] : [])];
    }

    // ---------------------------------------------------------------- 同步变化
    _onMutations(recs) {
      const t0 = performance.now();
      const parents = new Set();
      const added = [];
      const changed = [];
      const attrs = [];
      const host = this.shell.host;
      for (const r of recs) {
        const t = r.target;
        if (t === host) continue;
        if (r.type === 'childList') {
          if (t.nodeName === 'STYLE') { this._resyncStyle(t); continue; }
          parents.add(t);
          for (const n of r.addedNodes) if (n !== host) added.push(n);
          changed.push(t);
        } else if (r.type === 'characterData') {
          const p = t.parentNode;
          if (p && p.nodeName === 'STYLE') { this._resyncStyle(p); continue; }
          const c = this.map.get(t);
          if (c && c.data !== t.data) c.data = t.data;
          changed.push(t);
        } else {
          this._syncAttr(t, r.attributeName, r.attributeNamespace);
          attrs.push(t);
        }
      }
      for (const p of parents) this.syncChildren(p);
      if (parents.size) this._holesDirty = true;
      // 结构或 class 变了，命中“读丢了值”的规则的元素可能变了，稍后重补一次
      if (this.broken && this.broken.size && (parents.size || attrs.length)) this._brokenDirty = true;
      if (this.compositorSync && this.cwin) {
        for (const n of added) if (n.nodeType === 1 && n.isConnected) this._scanFixed(n);
        this._recheckFixed(attrs);
        // 被重新复制的元素换了对应节点，动画要跟着换
        for (const [el, anim] of this.fixed) {
          if (this.map.get(el) !== anim.effect.target) {
            anim.cancel();
            this.fixed.delete(el);
            if (el.isConnected) this._fix(el);
          }
        }
      }
      this.stats.mutBatches++;
      const ms = performance.now() - t0;
      this.stats.mutMs += ms;
      if (ms > this.stats.maxMutMs) this.stats.maxMutMs = ms;
      if (added.length || changed.length || attrs.length) this._emit('change', { added, changed, attrs });
    }

    /** 让复制品里这个节点的子节点和真网页一致（顺序、增删）；已有对应的节点直接挪，没有的新复制。 */
    syncChildren(orig) {
      const cp = this.map.get(orig);
      if (!cp || orig.nodeName === 'STYLE' || orig.nodeName === 'SCRIPT' || orig.nodeName === 'NOSCRIPT') return;
      const want = [];
      for (let ch = orig.firstChild; ch; ch = ch.nextSibling) {
        let cc = this.map.get(ch);
        if (cc && !cc.parentNode) cc = null;     // 离开过文档的节点可能已经变了，重新复制
        if (!cc) cc = this._cloneDeep(ch);
        if (cc) want.push(cc);
      }
      let cur = cp.firstChild;
      for (const cc of want) {
        if (cur === cc) { cur = cur.nextSibling; continue; }
        cp.insertBefore(cc, cur);
      }
      while (cur) {
        const nx = cur.nextSibling;
        cp.removeChild(cur);
        cur = nx;
      }
    }

    /** 整棵子树按真网页恢复（撤掉译文时用）。 */
    resync(orig) {
      const stack = [orig];
      while (stack.length) {
        const n = stack.pop();
        if (n.nodeType !== 1) continue;
        this.syncChildren(n);
        for (let ch = n.firstChild; ch; ch = ch.nextSibling) {
          if (ch.nodeType === 1) stack.push(ch);
          else if (ch.nodeType === 3) {
            const c = this.map.get(ch);
            if (c && c.data !== ch.data) c.data = ch.data;
          }
        }
      }
    }

    _syncAttr(orig, name, ns) {
      const c = this.map.get(orig);
      if (!c || c.nodeType !== 1) return;
      const tag = orig.localName;
      if (name === 'style' && !ns) {
        c.style.cssText = orig.style ? orig.style.cssText : '';
        this._refix(orig, c);
        if (tag.includes('-')) this._pin(orig, c);
        if (REPLACED.has(tag)) this._sizeReplaced(orig, c);
        this._emit('styleReset', orig, c);
        return;
      }
      if (name.length > 2 && name[0] === 'o' && name[1] === 'n') return;
      const drop = DROP_ATTR[tag];
      if (drop && drop.includes(name)) return;
      if (tag === 'link' && name === 'rel') {
        if (/\bstylesheet\b/i.test(orig.getAttribute('rel') || '')) c.setAttribute('rel', orig.getAttribute('rel'));
        else c.removeAttribute('rel');
        return;
      }
      const attr = ns ? orig.getAttributeNodeNS(ns, name) : orig.getAttributeNode(name);
      try {
        if (!attr) {
          if (ns) c.removeAttributeNS(ns, name);
          else c.removeAttribute(name);
        } else if (ns) {
          c.setAttributeNS(ns, attr.name, attr.value);
        } else {
          c.setAttribute(name, attr.value);
        }
      } catch (e) { /* 非法属性名 */ }
      if (tag.includes('-')) this._pin(orig, c);
      if (name === 'open' || name === 'popover') this._topLayer(orig);
      if (name === 'class' || name === 'hidden') this._holesDirty = true;
    }

    _formState(t) {
      const c = t && this.map.get(t);
      if (!c) return;
      this._post(t, c);
    }

    // ---------------------------------------------------------------- 滚动
    _scrollFrom(t) {
      if (t === document || t === document.documentElement || t === document.scrollingElement) {
        this.syncDocScroll();
      } else if (t && t.nodeType === 1) {
        const c = this.map.get(t);
        if (c) {
          if (c.scrollTop !== t.scrollTop) c.scrollTop = t.scrollTop;
          if (c.scrollLeft !== t.scrollLeft) c.scrollLeft = t.scrollLeft;
          this.scrolled.add(t);
          if (this.compositorSync) this._innerSync(t, c);
        }
      }
      this._holesDirty = true;
      this._emit('change', { scroll: true });
    }

    /**
     * 整页滚动的跟随。真网页是合成器线程直接滚的，主线程（我们的脚本）要晚一帧才知道，
     * 光靠脚本把复制品滚过去，快速滚动时开口里会慢一帧、错开十几二十像素。
     * 所以复制品的位置由两部分相加：base 平移 +S（脚本设的、复制品实际滚到的位置），
     * ty/tx 平移 −S'（滚动驱动动画，合成器每帧按真网页当时的滚动量算）。两者之差正好补上那一帧。
     */
    syncDocScroll() {
      const w = this.cwin;
      if (!w) return;
      const x = window.scrollX, y = window.scrollY;
      if (w.scrollX !== x || w.scrollY !== y) w.scrollTo(x, y);
      if (!this.compositorSync) return;
      const bx = w.scrollX, by = w.scrollY;
      const moved = bx !== this._bx || by !== this._by;
      if (moved) {
        this._bx = bx;
        this._by = by;
        this.base.style.transform = `translate(${bx}px, ${by}px)`;
      }
      if (this._timelines() || moved) this._fixedKeyframes();
    }

    _timelines() {
      if (typeof ScrollTimeline !== 'function') return false;
      const se = document.scrollingElement || document.documentElement;
      const maxY = Math.max(0, se.scrollHeight - se.clientHeight);
      const maxX = Math.max(0, se.scrollWidth - se.clientWidth);
      const changed = maxY !== this._maxY;
      if (maxY !== this._maxY) {
        this._maxY = maxY;
        const kf = [{ transform: 'translateY(0px)' }, { transform: `translateY(${-maxY}px)` }];
        if (this._animY) this._animY.effect.setKeyframes(kf);
        else {
          this._animY = this.ty.animate(kf, {
            timeline: new ScrollTimeline({ source: se, axis: 'block' }), fill: 'both', easing: 'linear',
          });
        }
      }
      if (maxX !== this._maxX) {
        this._maxX = maxX;
        const kf = [{ transform: 'translateX(0px)' }, { transform: `translateX(${-maxX}px)` }];
        if (this._animX) this._animX.effect.setKeyframes(kf);
        else {
          this._animX = this.tx.animate(kf, {
            timeline: new ScrollTimeline({ source: se, axis: 'inline' }), fill: 'both', easing: 'linear',
          });
        }
      }
      return changed;
    }

    // ---------------------------------------------------------------- 页面里单独滚动的区域
    _preScroll(e) {
      if (!this.compositorSync || !e.composedPath) return;
      for (const n of e.composedPath()) {
        if (!n || n.nodeType !== 1 || n === document.documentElement || n === document.body) continue;
        if (n.scrollHeight <= n.clientHeight && n.scrollWidth <= n.clientWidth) continue;
        const ov = getComputedStyle(n);
        if (!/auto|scroll|overlay/.test(ov.overflowY + ov.overflowX)) continue;
        const c = this.map.get(n);
        if (c) this._innerSync(n, c);
      }
    }

    /**
     * 和整页一样的问题：区域里的内容由合成器直接滚，脚本晚一帧。复制品里这个区域的子元素各加一个平移动画，
     * 时间轴用真网页这个区域的滚动条：平移 = 复制品实际滚到的位置 − 合成器当下的位置。
     * 子元素太多（长列表直接挂在滚动区域下）就不补偿，免得几百个图层。
     */
    /**
     * 滚动区域里要加补偿的元素。注意：祖先一旦有平移，里面 position:fixed 的元素就改成相对这个祖先定位、
     * 跟着内容滚了（侧边栏会跟着正文跑）。所以含有固定元素的那一支不整个平移，往下拆开，只平移不含固定元素的部分；
     * 固定元素自己本来就不随滚动走，不用管。
     */
    _innerTargets(t) {
      const out = [];
      const fixedInside = (el) => {
        for (const f of this.fixedAll) if (f !== el && el.contains(f)) return true;
        return false;
      };
      const visit = (el, depth) => {
        for (const ch of el.children) {
          if (this.fixedAll.has(ch)) continue;
          if (fixedInside(ch)) {
            if (depth > 8 || !visit(ch, depth + 1)) return false;
            continue;
          }
          const cc = this.map.get(ch);
          if (cc && cc.nodeType === 1 && cc.isConnected) out.push(cc);
          if (out.length > 40) return false;
        }
        return true;
      };
      return visit(t, 0) ? out : null;
    }

    _innerSync(t, c) {
      const vert = t.scrollHeight - t.clientHeight >= t.scrollWidth - t.clientWidth;
      let st = this.inner.get(t);
      const kids = this._innerTargets(t) || [];
      const n = kids.length;
      if (st && (st.skip ? st.n === n : st.kids.length === n && st.kids.every((k, i) => k.el === kids[i])
          && st.vert === vert)) {
        if (st.skip) return;
      } else {
        if (st && st.kids) for (const k of st.kids) k.anim.cancel();
        if (!n || typeof ScrollTimeline !== 'function') {
          this.inner.set(t, { skip: true, n });
          return;
        }
        st = { vert, kids: [], s: null, max: null };
        let tl;
        try { tl = new this.cwin.ScrollTimeline({ source: t, axis: vert ? 'block' : 'inline' }); } catch (e) { return; }
        for (const el of kids) {
          const t0 = this.cwin.getComputedStyle(el).translate;
          const base = !t0 || t0 === 'none' ? ['0px', '0px', ''] : [t0.split(' ')[0], t0.split(' ')[1] || '0px', t0.split(' ')[2] || ''];
          let anim;
          try { anim = el.animate([{}, {}], { timeline: tl, fill: 'both', easing: 'linear' }); } catch (e) { continue; }
          st.kids.push({ el, base, anim });
        }
        this.inner.set(t, st);
      }
      const s = vert ? c.scrollTop : c.scrollLeft;
      const max = vert ? t.scrollHeight - t.clientHeight : t.scrollWidth - t.clientWidth;
      if (s === st.s && max === st.max) return;
      st.s = s;
      st.max = max;
      for (const k of st.kids) {
        const [bx, by, bz] = k.base;
        const z = bz ? ' ' + bz : '';
        const at = (d) => (vert ? `${bx} calc(${by} + ${d}px)${z}` : `calc(${bx} + ${d}px) ${by}${z}`);
        k.anim.effect.setKeyframes([{ translate: at(s) }, { translate: at(s - max) }]);
      }
    }

    // ---------------------------------------------------------------- 固定元素
    /**
     * 整张复制品随滚动补偿平移时，复制品里的固定元素（顶栏、浮动按钮）也会跟着晃。
     * 给它们加一个反向的平移动画，时间轴用真网页的滚动条（跨文档也能由合成器驱动），正好抵消。
     */
    _scanFixed(root) {
      if (!this.compositorSync || typeof ScrollTimeline !== 'function') return;
      const t0 = performance.now();
      const scrollers = [];
      const before = this.fixedAll.size;
      const walk = (start) => {
        const tw = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT, {
          acceptNode: (el) => {
            if (el === this.shell.host) return NodeFilter.FILTER_REJECT;
            const cs = getComputedStyle(el);
            if (cs.display === 'none') return NodeFilter.FILTER_REJECT;
            if (cs.position === 'fixed') {
              this.fixedAll.add(el);
              this._fix(el);
              return NodeFilter.FILTER_REJECT;   // 里面的跟着它走
            }
            // 页面里能单独滚动的区域（也包括 overflow:hidden、靠脚本滚的），扫完再准备补偿
            if (/auto|scroll|overlay|hidden/.test(cs.overflowY + cs.overflowX)
                && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) scrollers.push(el);
            return NodeFilter.FILTER_SKIP;
          },
        });
        while (tw.nextNode()) { /* acceptNode 里处理 */ }
      };
      walk(root);
      for (const sr of this.shadows.keys()) if (sr.host && root.contains(sr.host)) walk(sr);
      if (this.fixedAll.size !== before) this._resetInner();
      for (const el of scrollers) {
        const c = this.map.get(el);
        if (c && /auto|scroll|overlay/.test(getComputedStyle(el).overflowY + getComputedStyle(el).overflowX)) this._innerSync(el, c);
      }
      this.stats.fixedMs += performance.now() - t0;
    }

    /** 固定元素有增减：滚动区域的补偿全部撤掉，下次滚动时按新的结构重建。 */
    _resetInner() {
      for (const st of this.inner.values()) for (const k of st.kids || []) k.anim.cancel();
      this.inner.clear();
    }

    _fix(el) {
      if (this.fixed.has(el)) return;
      // 祖先有 transform、filter 之类时，fixed 其实相对那个祖先定位、跟着内容滚，不用补偿
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || cs.backdropFilter !== 'none'
            || /paint|layout|strict|content/.test(cs.contain) || /transform|filter|perspective/.test(cs.willChange)) return;
      }
      const c = this.map.get(el);
      if (!c || c.nodeType !== 1) return;
      const se = document.scrollingElement || document.documentElement;
      // 不用 composite:'add'（那样合成器跑不了，又会慢一帧）；元素自己的 translate 直接算进关键帧
      const base = this._baseTranslate(el);
      try {
        const anim = c.animate(this._fixedFrames(base), {
          timeline: new this.cwin.ScrollTimeline({ source: se, axis: 'block' }), fill: 'both', easing: 'linear',
        });
        anim.dmBase = base;
        this.fixed.set(el, anim);
      } catch (e) { /* 老浏览器没有跨文档时间轴 */ }
    }

    _baseTranslate(el) {
      const t = getComputedStyle(el).translate;
      if (!t || t === 'none') return ['0px', '0px', ''];
      const parts = t.split(' ');
      return [parts[0], parts[1] || '0px', parts[2] || ''];
    }

    _fixedFrames(base) {
      const sy = this._by || 0, max = this._maxY || 0;
      const at = (dy) => `${base[0]} calc(${base[1]} + ${dy}px)${base[2] ? ' ' + base[2] : ''}`;
      return [{ translate: at(-sy) }, { translate: at(max - sy) }];
    }

    _fixedKeyframes() {
      if (!this.fixed.size) return;
      for (const [el, anim] of this.fixed) {
        if (!el.isConnected || this.map.get(el) !== anim.effect.target) {
          anim.cancel();
          this.fixed.delete(el);
          continue;
        }
        anim.effect.setKeyframes(this._fixedFrames(anim.dmBase));
      }
    }

    /** 元素的 position 可能因为改了 class/style 变成 fixed 或不再 fixed，变化过的元素重新查一下。 */
    _recheckFixed(els) {
      if (!this.compositorSync) return;
      for (const el of els) {
        if (el.nodeType !== 1 || !el.isConnected) continue;
        const anim = this.fixed.get(el);
        const isFixed = getComputedStyle(el).position === 'fixed';
        if (isFixed !== this.fixedAll.has(el)) {
          if (isFixed) this.fixedAll.add(el);
          else this.fixedAll.delete(el);
          this._resetInner();
        }
        if (anim && !isFixed) {
          anim.cancel();
          this.fixed.delete(el);
        } else if (!anim && isFixed) {
          this._fix(el);
        } else if (anim) {
          const base = this._baseTranslate(el);
          if (base.join() !== anim.dmBase.join()) {
            anim.dmBase = base;
            anim.effect.setKeyframes(this._fixedFrames(base));
          }
        }
      }
    }

    _syncAllScroll() {
      this.syncDocScroll();
      for (const el of this.scrolled) {
        if (!el.isConnected) { this.scrolled.delete(el); continue; }
        const c = this.map.get(el);
        if (!c) continue;
        if (c.scrollTop !== el.scrollTop) c.scrollTop = el.scrollTop;
        if (c.scrollLeft !== el.scrollLeft) c.scrollLeft = el.scrollLeft;
      }
    }

    _afterLoad() {
      // 复制品里图片、样式表加载完排版会变高，滚动位置要重新对一次
      this._syncAllScroll();
    }

    _tick() {
      this._raf = requestAnimationFrame(this._tick);
      this.syncDocScroll();
      if (++this._frames % 15 === 0) this._syncAllScroll();
    }

    // ---------------------------------------------------------------- 悬停、焦点
    _hover(e) {
      const path = e.composedPath ? e.composedPath() : [e.target];
      if (path.includes(this.shell.host)) return;
      this._setHover(path);
    }

    _setHover(path) {
      const next = new Set();
      for (const n of path) {
        if (!n || n.nodeType !== 1) continue;
        const c = this.map.get(n);
        if (c && c.nodeType === 1) next.add(c);
      }
      for (const c of this.hovered) if (!next.has(c)) c.removeAttribute('data-dm-hover');
      for (const c of next) if (!this.hovered.has(c)) c.setAttribute('data-dm-hover', '');
      this.hovered = next;
    }

    _focus() {
      for (const c of this.focused) {
        c.removeAttribute('data-dm-focus');
        c.removeAttribute('data-dm-focus-visible');
        c.removeAttribute('data-dm-focus-within');
      }
      this.focused = new Set();
      let a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      if (!a || a === document.body || a === this.shell.host) return;
      const c = this.map.get(a);
      if (c && c.nodeType === 1) {
        c.setAttribute('data-dm-focus', '');
        if (this._keyboard) c.setAttribute('data-dm-focus-visible', '');
        this.focused.add(c);
      }
      for (let n = a; n; n = n.parentNode || n.host) {
        const cn = this.map.get(n);
        if (cn && cn.nodeType === 1) {
          cn.setAttribute('data-dm-focus-within', '');
          this.focused.add(cn);
        }
      }
      this._holesDirty = true;
    }

    // ---------------------------------------------------------------- 挖洞
    refreshHoles() {
      const els = [...document.querySelectorAll(HOLE_SEL)];
      for (const sr of this.shadows.keys()) {
        if (sr.host && sr.host.isConnected) els.push(...sr.querySelectorAll(HOLE_SEL));
      }
      this.holeEls = els;
      this._holesDirty = false;
    }

    /**
     * 开口范围内要露出真网页的矩形（视口坐标）：holes 是合并好、互不重叠的洞；
     * under 是其中画布的范围（上面压着的译文要重新露出来），face 是输入框这类必须一直露出真网页的洞。
     */
    holeInfo(frame) {
      if (this._holesDirty) this.refreshHoles();
      const all = [], under = [], face = [];
      const add = (r, list) => {
        if (r.width < 1 || r.height < 1) return;
        const x0 = Math.max(r.left, frame.x), y0 = Math.max(r.top, frame.y);
        const x1 = Math.min(r.right, frame.x + frame.w), y1 = Math.min(r.bottom, frame.y + frame.h);
        if (x1 > x0 && y1 > y0) {
          const h = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          all.push(h);
          list.push(h);
        }
      };
      for (const el of this.holeEls) add(el.getBoundingClientRect(), UNDER.has(el.localName) ? under : face);
      let a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      if (a && a.isContentEditable) add(a.getBoundingClientRect(), face);
      return { holes: mergeRects(all), under, face };
    }

    holeRects(frame) {
      return this.holeInfo(frame).holes;
    }
  }

  /** 重叠的洞合并成外接矩形（evenodd 规则下两个洞重叠的地方会被重新填上）。 */
  function mergeRects(rects) {
    const out = rects.slice();
    for (let changed = true; changed;) {
      changed = false;
      outer: for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i], b = out[j];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
            out.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    return out;
  }

  /** 矩形 a 减去一组矩形，剩下的切成互不重叠的小矩形。 */
  function subtractRects(a, cuts) {
    let parts = [a];
    for (const b of cuts) {
      const next = [];
      for (const p of parts) {
        if (!(p.x < b.x + b.w && b.x < p.x + p.w && p.y < b.y + b.h && b.y < p.y + p.h)) {
          next.push(p);
          continue;
        }
        const px1 = p.x + p.w, py1 = p.y + p.h, bx1 = b.x + b.w, by1 = b.y + b.h;
        if (b.y > p.y) next.push({ x: p.x, y: p.y, w: p.w, h: b.y - p.y });
        if (by1 < py1) next.push({ x: p.x, y: by1, w: p.w, h: py1 - by1 });
        const y0 = Math.max(p.y, b.y), y1 = Math.min(py1, by1);
        if (b.x > p.x) next.push({ x: p.x, y: y0, w: b.x - p.x, h: y1 - y0 });
        if (bx1 < px1) next.push({ x: bx1, y: y0, w: px1 - bx1, h: y1 - y0 });
      }
      parts = next;
    }
    return parts;
  }

  DM.LiveCopy = LiveCopy;
  DM.mergeRects = mergeRects;
  DM.subtractRects = subtractRects;
})();
