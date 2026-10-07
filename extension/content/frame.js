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
.lang { color: #c9cdd6; }
.status { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #78dc8c; }
.status.busy { color: #78b4ff; } .status.error { color: #ff6e6e; } .status.paused { color: #b9b9be; }
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
      this.h = handlers;              // { onRect(rect, done), onPause(), onClose() }
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
      const title = document.createElement('b');
      title.textContent = '魔镜';
      this.lang = document.createElement('span');
      this.lang.className = 'lang';
      this.status = document.createElement('span');
      this.status.className = 'status';
      this.pauseBtn = this._button('暂停', () => this.h.onPause());
      const close = this._button('✕', () => this.h.onClose());
      close.title = '关闭魔镜';
      this.tab.append(title, this.lang, this.status, this.pauseBtn, close);
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

    setLang(text) { this.lang.textContent = text; }

    setStatus(text, level) {
      this.status.textContent = text;
      this.status.className = 'status ' + (level || '');
    }

    setPaused(on) { this.pauseBtn.textContent = on ? '继续' : '暂停'; }

    destroy() {
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
    }
  }

  DM.Frame = Frame;
  DM.FRAME_TAB_H = TAB_H;
})();
