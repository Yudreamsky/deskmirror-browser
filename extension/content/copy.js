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
      cdoc.open();
      cdoc.write(doctypeOf(document));
      cdoc.close();
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
      add(win, 'pointermove', (e) => this._hover(e), { capture: true, passive: true });
      add(win, 'pointerover', (e) => this._hover(e), { capture: true, passive: true });
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
            if (c && orig.sheet) c.textContent = rulesText(orig.sheet.cssRules);
          } catch (e) { /* 跨域 */ }
          info.n = n;
          this._hoverDirty = true;
        }
      }
      if (this._hoverDirty) {
        this._hoverDirty = false;
        this._hoverSheet();
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

    // ---------------------------------------------------------------- 固定元素
    /**
     * 整张复制品随滚动补偿平移时，复制品里的固定元素（顶栏、浮动按钮）也会跟着晃。
     * 给它们加一个反向的平移动画，时间轴用真网页的滚动条（跨文档也能由合成器驱动），正好抵消。
     */
    _scanFixed(root) {
      if (!this.compositorSync || typeof ScrollTimeline !== 'function') return;
      const t0 = performance.now();
      const walk = (start) => {
        const tw = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT, {
          acceptNode: (el) => {
            if (el === this.shell.host) return NodeFilter.FILTER_REJECT;
            const cs = getComputedStyle(el);
            if (cs.display === 'none') return NodeFilter.FILTER_REJECT;
            if (cs.position === 'fixed') {
              this._fix(el);
              return NodeFilter.FILTER_REJECT;   // 里面的跟着它走
            }
            return NodeFilter.FILTER_SKIP;
          },
        });
        while (tw.nextNode()) { /* acceptNode 里处理 */ }
      };
      walk(root);
      for (const sr of this.shadows.keys()) if (sr.host && root.contains(sr.host)) walk(sr);
      this.stats.fixedMs += performance.now() - t0;
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

    /** 开口范围内要露出真网页的矩形（视口坐标）。 */
    holeRects(frame) {
      if (this._holesDirty) this.refreshHoles();
      const out = [];
      const add = (r) => {
        if (r.width < 1 || r.height < 1) return;
        const x0 = Math.max(r.left, frame.x), y0 = Math.max(r.top, frame.y);
        const x1 = Math.min(r.right, frame.x + frame.w), y1 = Math.min(r.bottom, frame.y + frame.h);
        if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      };
      for (const el of this.holeEls) add(el.getBoundingClientRect());
      let a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      if (a && a.isContentEditable) add(a.getBoundingClientRect());
      return mergeRects(out);
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

  DM.LiveCopy = LiveCopy;
  DM.mergeRects = mergeRects;
})();
