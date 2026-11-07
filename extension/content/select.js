// 桌面魔镜浏览器版：在镜框里选字，选中、复制的是看到的译文。
// 译文那一页（复制品）盖在真网页上面，鼠标的点、拖都落在下面的真网页上：真网页里选中的是原文，高亮被译文盖住看不见，
// 复制出来也是原文。整页翻译时尤其明显（这时其实是在和译文那一页打交道）。
// 这里照着鼠标拖过的屏幕位置，在复制品里选中同样位置的译文（复制品自己画高亮），复制时换成这段译文；
// 双击选一个词、三击选一段、Shift+点击延长、Ctrl+A 全选也照着来；按在选中的字上拖走，拖走的也是译文。
// 按住 Ctrl+Alt+O 看原文、收起、暂停时译文那层看不见：选的、复制的就是原文；复制品里照着选好的先留着，回来接着用。
// 真网页的选区不是照着选的那个了（键盘选的、网页自己改的），复制品里的就不要了，复制照旧是原文。
// 选区有一部分在镜框外（镜框外看到的是原文）时，复制照旧是原文；整页翻译时整页都是译文，复制的总是译文。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});

  // 复制品窗口没有焦点时，浏览器把选区画成灰色；统一画成魔镜的蓝色
  const SEL_CSS = '::selection { background-color: rgba(61, 139, 253, 0.34); }';

  const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const isField = (el) => !!el && el.nodeType === 1 && (el.localName === 'input' || el.localName === 'textarea' || el.isContentEditable);

  class SelectMirror {
    /** opts：{ open()：开口（视口坐标）；full()：整页翻译；live()：译文那层看得见（没收起、没暂停、没按住看原文）；own(e)：点在魔镜自己的界面上 } */
    constructor(copy, opts) {
      this.copy = copy;
      this.opts = opts;
      this.drag = null;             // 鼠标按着在选：{ x0, y0, x, y, clicks, extend }
      this.allAt = 0;               // 刚按过 Ctrl+A
      this.on = false;              // 复制品里有照着选好的译文
      this.snap = null;             // 照着选的时候，真网页的选区在哪（变了就不算数）
      this.raf = 0;
      try {
        const sheet = new copy.cwin.CSSStyleSheet();
        sheet.replaceSync(SEL_CSS);
        copy.cdoc.adoptedStyleSheets = [...copy.cdoc.adoptedStyleSheets, sheet];
      } catch (e) { /* 老浏览器：用浏览器的颜色 */ }
      const offs = (this.offs = []);
      const add = (t, ev, fn, opt) => {
        t.addEventListener(ev, fn, opt);
        offs.push(() => t.removeEventListener(ev, fn, opt));
      };
      add(window, 'mousedown', (e) => {
        if (e.button !== 0 || this.opts.own(e)) return;
        this.drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, clicks: e.detail || 1, extend: e.shiftKey && this.on };
      }, true);
      add(window, 'mousemove', (e) => {
        if (!this.drag || !(e.buttons & 1)) return;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.soon();
      }, true);
      add(window, 'mouseup', (e) => {
        if (!this.drag || e.button !== 0) return;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.soon();
        const d = this.drag;
        // 放开以后选区还会再变一次（双击、三击选词选段），照着这次再对一遍，然后才结束
        setTimeout(() => {
          if (this.drag === d) {
            this.sync();
            this.drag = null;
          }
        }, 0);
      }, true);
      // 按在选中的字上拖：浏览器拖的是选中的字，选区不变，也不会再有鼠标移动、松开
      add(window, 'dragstart', (e) => this._dragOut(e), true);
      add(window, 'keydown', (e) => {
        const t = e.composedPath ? e.composedPath()[0] : e.target;
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'A') && !isField(t)) this.allAt = performance.now();
      }, true);
      add(document, 'selectionchange', () => this.soon());
      add(document, 'copy', (e) => this._copy(e), true);
    }

    destroy() {
      for (const off of this.offs) off();
      cancelAnimationFrame(this.raf);
      this._clear();
    }

    soon() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.sync();
      });
    }

    _clear() {
      try {
        const cs = this.copy.cdoc.getSelection();
        if (cs && cs.rangeCount) cs.removeAllRanges();
      } catch (e) { /* 复制品已经拿掉了 */ }
      this.on = false;
      this.snap = null;
    }

    /** 记下真网页现在的选区；之后看它变没变。 */
    _mark(sel) {
      const r = sel.getRangeAt(0);
      this.snap = [r.startContainer, r.startOffset, r.endContainer, r.endOffset];
    }

    _same(sel) {
      const s = this.snap;
      if (!s || !sel.rangeCount) return false;
      const r = sel.getRangeAt(0);
      return r.startContainer === s[0] && r.startOffset === s[1] && r.endContainer === s[2] && r.endOffset === s[3];
    }

    /** 屏幕上 (x, y) 那一点，在复制品里对应的文字位置。 */
    _caret(x, y) {
      const f = this.copy.cwin && this.copy.cwin.frameElement;
      if (!f) return null;
      const r = f.getBoundingClientRect();
      const cd = this.copy.cdoc;
      const c = cd.caretRangeFromPoint ? cd.caretRangeFromPoint(x - r.left, y - r.top) : null;
      return c ? { node: c.startContainer, off: c.startOffset } : null;
    }

    /** 真网页的选区一变（或者鼠标拖着在走）：复制品里照着鼠标拖过的位置选同样的地方。 */
    sync() {
      if (!this.opts.live()) return;   // 译文那层看不见：复制品里的先留着，回来接着用
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) {
        if (this.on) this._clear();
        return;
      }
      const cs = this.copy.cdoc.getSelection();
      const d = this.drag;
      try {
        if (!d && performance.now() - this.allAt < 800) {
          cs.selectAllChildren(this.copy.cdoc.body);   // Ctrl+A：全选
        } else if (d && d.extend) {
          // Shift+点击（拖）：延长到鼠标那里
          const b = this._caret(d.x, d.y);
          if (b) cs.extend(b.node, b.off);
        } else if (!d || (d.clicks === 1 && Math.abs(d.x - d.x0) < 3 && Math.abs(d.y - d.y0) < 3)) {
          // 不是鼠标选的（键盘选的、网页自己改的），或者只点了一下（点按钮、链接，选区没动）：
          // 真网页的选区还是照着选的那个就留着，变了就不要了
          if (this.on && !this._same(sel)) this._clear();
          else if (this.on && cs.isCollapsed) this._clear();
          return;
        } else {
          const a = this._caret(d.x0, d.y0);
          if (!a) return;
          if (d.clicks >= 3) {
            // 三击：选这一段
            let el = a.node.nodeType === 1 ? a.node : a.node.parentElement;
            const w = this.copy.cwin;
            while (el && el.parentElement && /^(inline|contents)/.test(w.getComputedStyle(el).display)) el = el.parentElement;
            if (el) cs.selectAllChildren(el);
          } else if (d.clicks === 2) {
            // 双击：选这个词（中文按词典分词）
            cs.collapse(a.node, a.off);
            cs.modify('move', 'backward', 'word');
            cs.modify('extend', 'forward', 'word');
          } else {
            const b = this._caret(d.x, d.y);
            if (!b) return;
            cs.setBaseAndExtent(a.node, a.off, b.node, b.off);
          }
        }
        this.on = !cs.isCollapsed;
        if (this.on) this._mark(sel);
        else this.snap = null;
      } catch (e) {
        this._clear();
      }
    }

    /** 现在该复制（拖走）的译文：照着选好了、看得见、真网页的选区没变、整个在镜框里（整页时不管）。不该换就是空。 */
    _text() {
      if (!this.on || !this.opts.live() || isField(document.activeElement)) return '';
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !this._same(sel)) return '';
      const b = sel.getRangeAt(0).getBoundingClientRect();
      if (!this.opts.full() && !inside({ x: b.left, y: b.top, w: b.width, h: b.height }, this.opts.open())) return '';
      return this.copy.cdoc.getSelection().toString();
    }

    /** 复制：换成复制品里选中的译文。 */
    _copy(e) {
      const text = this._text();
      if (!text || !e.clipboardData) return;
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    }

    /** 按在选中的字上拖走：拖的是选中的字（不是链接、图片、网页自己的拖动），换成译文。 */
    _dragOut(e) {
      this.drag = null;
      const dt = e.dataTransfer;
      if (!dt) return;
      const types = Array.from(dt.types || []);
      if (!types.includes('text/plain') || types.includes('text/uri-list') || types.includes('Files')) return;
      const text = this._text();
      if (!text) return;
      dt.clearData();
      dt.setData('text/plain', text);
    }
  }

  DM.SelectMirror = SelectMirror;
})();
