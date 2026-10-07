// 桌面魔镜浏览器版：镜框（蓝色边线、四角方块、上方深色标签、拖动和调整大小）。样子照桌面版。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});

  const BLUE = '#3D8BFD';
  const LINE = 2;       // 边线画在开口外面，不压住镜内内容
  const BAND = 7;       // 边框外可抓取的宽度
  const TAB_H = 26;
  const MIN_W = 120;
  const MIN_H = 48;

  DM.FRAME_CSS = `
:host { all: initial; }
.clip { position: fixed; left: 0; top: 0; pointer-events: none; clip-path: inset(50%); }
.clip.peek, .clip.off { visibility: hidden; }
.base { position: absolute; left: 0; top: 0; }
.base.live, .base.live .ty, .base.live .tx { will-change: transform; }
.sheet { border: 0; margin: 0; padding: 0; display: block; pointer-events: none; background: transparent; }
.line { position: fixed; box-sizing: border-box; border: ${LINE}px solid ${BLUE}; pointer-events: none; }
.corner { position: fixed; width: 9px; height: 9px; background: ${BLUE}; pointer-events: none; }
.band { position: fixed; pointer-events: auto; background: rgba(0, 0, 0, 0.004); }
.tab { position: fixed; height: ${TAB_H}px; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  padding: 0 3px 0 10px; background: rgba(28, 30, 36, 0.92); color: #ebeef5; border-radius: 6px 6px 0 0;
  font: 13px/1 "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; pointer-events: auto; cursor: move;
  user-select: none; white-space: nowrap; overflow: hidden; }
.tab.below { border-radius: 0 0 6px 6px; }
.tab b { font-weight: 600; }
.tab > b, .tab > .btn { flex: none; }
.btn.lang { color: #dfe3ea; background: rgba(255, 255, 255, 0.08); }
.menu { position: fixed; display: flex; gap: 6px; padding: 6px; background: rgba(28, 30, 36, 0.97); color: #ebeef5;
  border-radius: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); pointer-events: auto; user-select: none;
  font: 13px/1.2 "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; }
.menu .col { display: flex; flex-direction: column; gap: 1px; min-width: 104px; }
.menu .head { color: #9aa3af; font-size: 12px; padding: 3px 8px 5px; }
.menu .item { padding: 5px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.menu .item:hover { background: rgba(255, 255, 255, 0.12); }
.menu .item.on { background: ${BLUE}; color: #fff; }
.menu .arrow { align-self: center; color: #6b7280; padding: 0 2px; }
.status { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #78dc8c; }
.status.busy { color: #78b4ff; } .status.error { color: #ff6e6e; } .status.paused { color: #b9b9be; }
.status .bk { color: #ffc857; }
.btn { all: unset; cursor: pointer; height: 20px; min-width: 20px; padding: 0 6px; box-sizing: border-box;
  border-radius: 4px; text-align: center; line-height: 20px; color: #ebeef5; background: rgba(255, 255, 255, 0.12);
  font: 12px/20px "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; }
.btn:hover { background: rgba(255, 255, 255, 0.26); }
`;

  const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    nw: 'nwse-resize', se: 'nwse-resize' };

  class Frame {
    constructor(shell, rect, handlers) {
      this.root = shell.root;
      this.h = handlers;              // { onRect(rect, done), onPause(), onClose(), onLang(source, target), uiLang }
      this.ui = handlers.uiLang || 'zh';
      this.source = 'auto';
      this.target = 'zh-Hans';
      this.paused = false;
      this.rect = Object.assign({}, rect);
      const mk = (cls, tag) => {
        const el = document.createElement(tag || 'div');
        el.className = cls;
        this.root.appendChild(el);
        return el;
      };
      this.line = mk('line');
      this.corners = [mk('corner'), mk('corner'), mk('corner'), mk('corner')];
      this.bands = {};
      for (const z of Object.keys(CURSORS)) {
        const b = mk('band');
        b.style.cursor = CURSORS[z];
        b.addEventListener('pointerdown', (e) => this._drag(e, z));
        this.bands[z] = b;
      }
      this.tab = mk('tab');
      this.title = document.createElement('b');
      this.lang = this._button('', () => this._toggleMenu());
      this.lang.classList.add('lang');
      this.status = document.createElement('span');
      this.status.className = 'status';
      this.pauseBtn = this._button('', () => this.h.onPause());
      this.closeBtn = this._button('✕', () => this.h.onClose());
      this.tab.append(this.title, this.lang, this.status, this.pauseBtn, this.closeBtn);
      this._texts();
      this.tab.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('btn')) return;
        this._drag(e, 'move');
      });
      this.layout();
    }

    _button(text, fn) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = text;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    }

    setLang(source, target) {
      this.source = source || 'auto';
      this.target = target;
      this.lang.textContent = DM.text.langLabel(this.ui, this.source, target);
      if (this.menu) this._fillMenu();
    }

    /** 界面语言跟母语：中文母语中文界面，其他英文界面。 */
    setUiLang(lang) {
      this.ui = lang;
      this._texts();
      this.setLang(this.source, this.target);
    }

    _texts() {
      const t = (k) => DM.text.ui(this.ui, k);
      this.title.textContent = t('mirror');
      this.lang.title = t('langTitle');
      this.closeBtn.title = t('close');
      this.pauseBtn.textContent = t(this.paused ? 'resume' : 'pause');
    }

    // 语言按钮：和桌面版一样，点开选“原文 → 译成”，选了马上按新方向重翻
    _toggleMenu() {
      if (this.menu) {
        this._closeMenu();
        return;
      }
      this.menu = document.createElement('div');
      this.menu.className = 'menu';
      this.root.appendChild(this.menu);
      this._fillMenu();
      this._placeMenu();
      this._outside = (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        if (!path.includes(this.root.host)) this._closeMenu();
      };
      window.addEventListener('pointerdown', this._outside, true);
    }

    _closeMenu() {
      if (!this.menu) return;
      this.menu.remove();
      this.menu = null;
      window.removeEventListener('pointerdown', this._outside, true);
    }

    _fillMenu() {
      const T = DM.text;
      this.menu.replaceChildren();
      const col = (head, items, cur, pick) => {
        const c = document.createElement('div');
        c.className = 'col';
        const h = document.createElement('div');
        h.className = 'head';
        h.textContent = head;
        c.appendChild(h);
        for (const [key, label] of items) {
          const it = document.createElement('div');
          it.className = 'item' + (key === cur ? ' on' : '');
          it.textContent = label;
          it.addEventListener('click', (e) => {
            e.stopPropagation();
            pick(key);
          });
          c.appendChild(it);
        }
        return c;
      };
      const arrow = document.createElement('div');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      this.menu.append(
        col(T.ui(this.ui, 'from'), Object.keys(T.SOURCES).map((k) => [k, T.ui(this.ui, 'src_' + k)]), this.source,
          (k) => this._pick(k, this.target)),
        arrow,
        col(T.ui(this.ui, 'to'), Object.keys(T.NATIVE_NAMES).map((k) => [k, T.NATIVE_NAMES[k]]), this.target,
          (k) => this._pick(this.source, k)),
      );
    }

    _pick(source, target) {
      this.setLang(source, target);
      if (this.h.onLang) this.h.onLang(source, target);
    }

    _placeMenu() {
      if (!this.menu) return;
      const t = this.tab.getBoundingClientRect();
      const m = this.menu.getBoundingClientRect();
      const below = !this.tab.classList.contains('below');
      let x = Math.min(this.lang.getBoundingClientRect().left - 6, window.innerWidth - m.width - 8);
      let y = below ? t.bottom + 4 : t.top - m.height - 4;
      if (y + m.height > window.innerHeight - 4) y = Math.max(4, t.top - m.height - 4);
      this.menu.style.left = Math.max(4, x) + 'px';
      this.menu.style.top = Math.max(4, y) + 'px';
    }

    /** extra：跟在后面的琥珀色说明（正在用备用）；tip：鼠标停上去显示的详情。 */
    setStatus(text, level, tip, extra) {
      this.status.textContent = text;
      if (extra) {
        const b = document.createElement('span');
        b.className = 'bk';
        b.textContent = ' · ' + extra;
        this.status.appendChild(b);
      }
      this.status.className = 'status ' + (level || '');
      this.status.title = tip || '';
      if (extra || this._wide) this.layout();
    }

    setPaused(on) {
      this.paused = on;
      this._texts();
    }

    destroy() {
      this._closeMenu();
      for (const el of [this.line, ...this.corners, ...Object.values(this.bands), this.tab]) el.remove();
    }

    _drag(e, zone) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, r: Object.assign({}, this.rect) };
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        const r = Object.assign({}, start.r);
        if (zone === 'move') {
          r.x += dx;
          r.y += dy;
        } else {
          if (zone.includes('w')) { r.x += Math.min(dx, r.w - MIN_W); r.w = Math.max(MIN_W, r.w - dx); }
          if (zone.includes('e')) r.w = Math.max(MIN_W, r.w + dx);
          if (zone.includes('n')) { r.y += Math.min(dy, r.h - MIN_H); r.h = Math.max(MIN_H, r.h - dy); }
          if (zone.includes('s')) r.h = Math.max(MIN_H, r.h + dy);
        }
        this._set(r, false);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        this._set(this.rect, true);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }

    _set(r, done) {
      // 至少留一截在窗口里，别拖丢了
      const vw = window.innerWidth, vh = window.innerHeight;
      r.x = Math.min(Math.max(r.x, 40 - r.w), vw - 40);
      r.y = Math.min(Math.max(r.y, 20 - r.h), vh - 20);
      this.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      this.layout();
      if (this.h.onRect) this.h.onRect(this.rect, done);
    }

    layout() {
      const { x, y, w, h } = this.rect;
      const place = (el, l, t, wd, ht) => {
        const s = el.style;
        s.left = l + 'px';
        s.top = t + 'px';
        s.width = wd + 'px';
        s.height = ht + 'px';
      };
      place(this.line, x - LINE, y - LINE, w + 2 * LINE, h + 2 * LINE);
      const cs = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
      this.corners.forEach((c, i) => place(c, cs[i][0] - 4, cs[i][1] - 4, 9, 9));
      const o = LINE + BAND;
      const b = this.bands;
      place(b.n, x, y - o, w, o);
      place(b.s, x, y + h, w, o);
      place(b.w, x - o, y, o, h);
      place(b.e, x + w, y, o, h);
      place(b.nw, x - o, y - o, o, o);
      place(b.ne, x + w, y - o, o, o);
      place(b.sw, x - o, y + h, o, o);
      place(b.se, x + w, y + h, o, o);
      const tw = Math.max(Math.min(Math.max(300, w / 2), w + 2 * LINE), 230);
      const below = y - LINE - TAB_H < 0;
      this.tab.classList.toggle('below', below);
      place(this.tab, x - LINE, below ? y + h + LINE : y - LINE - TAB_H, tw, TAB_H);
      // 正在用备用时状态字长：标签加宽到放得下（最宽和镜框一样）
      this._wide = false;
      if (this.status.querySelector('.bk')) {
        this.tab.style.width = 'max-content';
        const natural = Math.ceil(this.tab.getBoundingClientRect().width) + 1;
        const want = Math.min(Math.max(tw, w + 2 * LINE), Math.max(tw, natural));
        this.tab.style.width = want + 'px';
        this._wide = want > tw;
      }
      this._placeMenu();
    }
  }

  DM.Frame = Frame;
  DM.FRAME_TAB_H = TAB_H;
})();
