// 桌面魔镜浏览器版：镜框（蓝色边线、四角方块、上方深色标签、拖动和调整大小）。样子照桌面版。
// 还能收起成气泡：镜框缩成圆形贴到页面边缘，拖到另一边自动吸附，点一下再弹回原处（都是平滑动画）。
// 两套皮肤：经典（和桌面版一样）、液态玻璃（半透明磨砂、圆角、高光；跟着系统的浅色 / 深色）。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});

  const BLUE = '#3D8BFD';
  const LINE = 2;       // 边线画在开口外面，不压住镜内内容
  const BAND = 7;       // 边框外可抓取的宽度
  const TAB_H = 26;
  const MIN_W = 120;
  const MIN_H = 48;
  const BUB = 46;       // 气泡直径
  const EDGE = 10;      // 气泡吸附时离页面边缘的距离
  const TUCK = 0.42;    // 停一会儿后藏进边缘的比例，鼠标移上去再滑出来
  const GLASS_R = 14;   // 液态玻璃：镜框圆角（边线外沿）
  const GAP = 6;        // 液态玻璃：标签浮在镜框上方的间距

  // 收起、弹出的曲线：起步快、收尾很柔（像 iOS 的弹性动画）；气泡吸附带一点回弹
  const EASE_FOLD = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const EASE_OPEN = 'cubic-bezier(0.2, 0.9, 0.1, 1)';

  DM.FRAME_CSS = `
:host { all: initial; }
.clip { position: fixed; left: 0; top: 0; pointer-events: none; clip-path: inset(50%); }
.clip.peek, .clip.off, .clip.fold { visibility: hidden; }
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
.btn.fold { font-weight: 700; }
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
.traffic { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; color: #b7c0cc;
  font: 12px/1 Consolas, "Cascadia Mono", ui-monospace, monospace; }
.traffic .up { color: #f0b072; } .traffic .down { color: #8cc8ff; }
.btn { all: unset; cursor: pointer; height: 20px; min-width: 20px; padding: 0 6px; box-sizing: border-box;
  border-radius: 4px; text-align: center; line-height: 20px; color: #ebeef5; background: rgba(255, 255, 255, 0.12);
  font: 12px/20px "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; }
.btn:hover { background: rgba(255, 255, 255, 0.26); }
.hide { display: none !important; }

/* 收起成气泡：镜框边线变形成圆形的那一层，和气泡本身 */
.morph { position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: none; display: none;
  transform-origin: 0 0; border: ${LINE}px solid ${BLUE}; will-change: transform; }
.morph.on { display: block; }
.bubble { position: fixed; left: 0; top: 0; width: ${BUB}px; height: ${BUB}px; box-sizing: border-box; border-radius: 50%;
  display: none; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer; touch-action: none;
  user-select: none; outline: none; background: ${BLUE}; color: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  font: 600 20px/1 "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  transition: translate 480ms cubic-bezier(0.34, 1.36, 0.64, 1), scale 180ms ease, box-shadow 180ms ease; }
.bubble.on { display: flex; }
.bubble:hover, .bubble:focus-visible { scale: 1.08; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.4); }
.bubble.slide { transition: translate 280ms cubic-bezier(0.25, 0.8, 0.25, 1), scale 180ms ease, box-shadow 180ms ease; }
.bubble.drag { transition: scale 140ms ease; scale: 1.12; cursor: grabbing; }
.bubble.still { transition: none; }

/* ---------------- 液态玻璃：半透明磨砂、圆角、边缘高光（浅色） ---------------- */
:host([data-skin="glass"]) .line { border: 1.5px solid rgba(255, 255, 255, 0.9); border-radius: ${GLASS_R}px;
  box-shadow: 0 0 0 1px rgba(61, 139, 253, 0.55), 0 14px 36px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.3); }
:host([data-skin="glass"]) .corner { display: none; }
:host([data-skin="glass"]) .tab, :host([data-skin="glass"]) .menu {
  color: #1d1d1f; border: 1px solid rgba(255, 255, 255, 0.7);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.28) 0%, rgba(250, 250, 252, 0.66) 34%, rgba(250, 250, 252, 0.66) 66%, rgba(255, 255, 255, 0.28) 100%);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.95), inset 0 -1px 1px rgba(0, 0, 0, 0.05), 0 8px 26px rgba(0, 0, 0, 0.16);
  text-shadow: 0 0 6px rgba(255, 255, 255, 0.85), 0 0 1px rgba(255, 255, 255, 0.9);
  font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; }
/* 边缘折射：位移滤镜（见 glassFilter），再轻轻模糊、提一点饱和度 */
:host([data-skin="glass"]) .tab { border-radius: ${TAB_H / 2}px; padding: 0 4px 0 12px; gap: 7px;
  -webkit-backdrop-filter: url(#dm-lg-tab) blur(1px) saturate(150%); backdrop-filter: url(#dm-lg-tab) blur(1px) saturate(150%); }
:host([data-skin="glass"]) .menu { border-radius: 16px; padding: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 249, 251, 0.9));
  -webkit-backdrop-filter: url(#dm-lg-menu) blur(16px) saturate(150%); backdrop-filter: url(#dm-lg-menu) blur(16px) saturate(150%); }
:host([data-skin="glass"]) .btn { color: #1d1d1f; background: rgba(255, 255, 255, 0.6); border-radius: 10px;
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9); }
:host([data-skin="glass"]) .btn:hover { background: rgba(255, 255, 255, 0.92); }
:host([data-skin="glass"]) .btn.lang { background: rgba(61, 139, 253, 0.14); color: #0b57d0; }
:host([data-skin="glass"]) .status { color: #1a7f37; }
:host([data-skin="glass"]) .status.busy { color: #0b57d0; }
:host([data-skin="glass"]) .status.error { color: #c62828; }
:host([data-skin="glass"]) .status.paused { color: #6e6e73; }
:host([data-skin="glass"]) .status .bk { color: #a15c00; }
:host([data-skin="glass"]) .traffic { color: #48484a; }
:host([data-skin="glass"]) .traffic .up { color: #c25e00; }
:host([data-skin="glass"]) .traffic .down { color: #0a63c9; }
:host([data-skin="glass"]) .menu .head { color: #6e6e73; }
:host([data-skin="glass"]) .menu .item { border-radius: 9px; }
:host([data-skin="glass"]) .menu .item:hover { background: rgba(0, 0, 0, 0.06); }
:host([data-skin="glass"]) .menu .item.on { background: ${BLUE}; color: #fff; }
:host([data-skin="glass"]) .menu .arrow { color: #8e8e93; }
:host([data-skin="glass"]) .morph { border: 1.5px solid rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 1px rgba(61, 139, 253, 0.6); }
:host([data-skin="glass"]) .bubble { color: ${BLUE}; border: 1px solid rgba(255, 255, 255, 0.8);
  background: radial-gradient(120% 120% at 30% 18%, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.12) 55%, rgba(236, 240, 248, 0.08));
  -webkit-backdrop-filter: url(#dm-lg-bubble) blur(0.5px) saturate(140%); backdrop-filter: url(#dm-lg-bubble) blur(0.5px) saturate(140%);
  text-shadow: 0 0 6px rgba(255, 255, 255, 0.95);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.95), inset 0 -3px 8px rgba(0, 0, 0, 0.07), 0 8px 24px rgba(0, 0, 0, 0.22); }

/* 液态玻璃（深色）：系统是深色模式时换成烟灰玻璃 */
@media (prefers-color-scheme: dark) {
  :host([data-skin="glass"]) .tab, :host([data-skin="glass"]) .menu { color: #f5f5f7; border-color: rgba(255, 255, 255, 0.2);
    background: linear-gradient(180deg, rgba(72, 72, 78, 0.3) 0%, rgba(30, 30, 34, 0.64) 34%, rgba(30, 30, 34, 0.64) 66%, rgba(72, 72, 78, 0.3) 100%);
    text-shadow: 0 0 6px rgba(0, 0, 0, 0.75), 0 0 1px rgba(0, 0, 0, 0.8);
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.28), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 8px 26px rgba(0, 0, 0, 0.4); }
  :host([data-skin="glass"]) .btn { color: #f5f5f7; background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18); }
  :host([data-skin="glass"]) .btn:hover { background: rgba(255, 255, 255, 0.26); }
  :host([data-skin="glass"]) .btn.lang { background: rgba(61, 139, 253, 0.28); color: #cfe0ff; }
  :host([data-skin="glass"]) .status { color: #63d68a; }
  :host([data-skin="glass"]) .status.busy { color: #8ab8ff; }
  :host([data-skin="glass"]) .status.error { color: #ff7b72; }
  :host([data-skin="glass"]) .status.paused { color: #aeaeb2; }
  :host([data-skin="glass"]) .status .bk { color: #ffcc66; }
  :host([data-skin="glass"]) .traffic { color: #c7c7cc; }
  :host([data-skin="glass"]) .traffic .up { color: #ffb36b; }
  :host([data-skin="glass"]) .traffic .down { color: #8cc8ff; }
  :host([data-skin="glass"]) .menu .head, :host([data-skin="glass"]) .menu .arrow { color: #98989d; }
  :host([data-skin="glass"]) .menu .item:hover { background: rgba(255, 255, 255, 0.1); }
  :host([data-skin="glass"]) .menu { background: linear-gradient(180deg, rgba(56, 56, 62, 0.94), rgba(30, 30, 34, 0.92)); }
  :host([data-skin="glass"]) .bubble { color: #fff; border-color: rgba(255, 255, 255, 0.25); text-shadow: 0 0 6px rgba(0, 0, 0, 0.8);
    background: radial-gradient(120% 120% at 30% 18%, rgba(120, 160, 230, 0.55), rgba(40, 60, 100, 0.3) 60%, rgba(20, 24, 34, 0.26));
    box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.35), inset 0 -3px 8px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.45); }
}
`;

  const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    nw: 'nwse-resize', se: 'nwse-resize' };

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // ---------------------------------------------------------------- 液态玻璃的边缘折射
  // 位移图：圆角矩形边缘一圈（bezel 宽）往里取样，越靠边取得越远——背后的内容在边上被拉伸、弯折，像弧形的厚玻璃边。
  // R、G 通道是横向、纵向的位移（128 = 不动），给 feDisplacementMap 用。
  function glassMap(w, h, r, bezel, shift) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const d = img.data;
    const hw = w / 2, hh = h / 2, rr = Math.min(r, hw, hh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hw, py = y + 0.5 - hh;
        const qx = Math.abs(px) - (hw - rr), qy = Math.abs(py) - (hh - rr);
        const inside = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr);
        let nx = 0, ny = 0;
        if (qx > 0 && qy > 0) {
          const L = Math.hypot(qx, qy) || 1;
          nx = (qx / L) * Math.sign(px);
          ny = (qy / L) * Math.sign(py);
        } else if (qx > qy) nx = Math.sign(px);
        else ny = Math.sign(py);
        const t = inside < bezel ? 1 - Math.max(inside, 0) / bezel : 0;
        const m = -t * t;                       // 往里取样，靠边最多 shift 像素
        const i = (y * w + x) * 4;
        d[i] = 128 + Math.round(nx * m * 127);
        d[i + 1] = 128 + Math.round(ny * m * 127);
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * 建（或按新尺寸更新）一个折射滤镜：三个颜色通道各自位移、位移量差一点点（边上有一丝色散），再合回来。
   * 滤镜放在影子 DOM 里，backdrop-filter: url(#id) 就能引用到（Chrome）。
   */
  function glassFilter(root, id, w, h, r, bezel, shift) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    let svg = root.querySelector('svg.dm-defs');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'dm-defs');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position: fixed; width: 0; height: 0; overflow: hidden; pointer-events: none;';
      root.appendChild(svg);
    }
    let f = svg.querySelector('#' + id);
    const key = [w, h, r, bezel, shift].join(',');
    if (f && f.getAttribute('data-key') === key) return;
    if (!f) {
      f = document.createElementNS(SVG_NS, 'filter');
      f.id = id;
      f.setAttribute('filterUnits', 'userSpaceOnUse');
      f.setAttribute('primitiveUnits', 'userSpaceOnUse');
      f.setAttribute('color-interpolation-filters', 'sRGB');
      const el = (tag, attrs) => {
        const e = document.createElementNS(SVG_NS, tag);
        for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
        f.appendChild(e);
        return e;
      };
      el('feImage', { result: 'map', preserveAspectRatio: 'none' });
      const only = { r: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', g: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0',
        b: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0' };
      for (const c of ['r', 'g', 'b']) {
        el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + c, 'data-ch': c });
        el('feColorMatrix', { in: 'd' + c, type: 'matrix', values: only[c], result: c });
      }
      el('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' });
      el('feBlend', { in: 'rg', in2: 'b', mode: 'screen' });
      svg.appendChild(f);
    }
    f.setAttribute('data-key', key);
    for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) f.setAttribute(k, v);
    const img = f.querySelector('feImage');
    for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) img.setAttribute(k, v);
    img.setAttribute('href', glassMap(w, h, r, bezel, shift));
    const k = { r: 1, g: 1.025, b: 1.05 };    // 红绿蓝位移差一点：边上一丝色散
    for (const dm of f.querySelectorAll('feDisplacementMap')) dm.setAttribute('scale', (2 * shift * k[dm.getAttribute('data-ch')]).toFixed(2));
  }
  /** 页面可用宽度（不含竖滚动条），气泡贴右边时不压住滚动条。 */
  const viewW = () => document.documentElement.clientWidth || window.innerWidth;
  const viewH = () => document.documentElement.clientHeight || window.innerHeight;

  class Frame {
    constructor(shell, rect, handlers) {
      this.root = shell.root;
      this.h = handlers;              // { onRect(rect, done), onPause(), onClose(), onLang(source, target), onFold(folded), onBubble(pos), uiLang }
      this.ui = handlers.uiLang || 'zh';
      this.source = 'auto';
      this.target = 'zh-Hans';
      this.paused = false;
      this.skin = 'classic';
      this.folded = false;
      this.bub = null;                // 气泡：{ side: 'left' | 'right', x, y, tucked }
      this.home = null;               // 上次气泡停在哪：{ side, y（占页面高度的比例） }
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
      this.traffic = document.createElement('span');
      this.traffic.className = 'traffic';
      this.traffic.hidden = true;
      this.pauseBtn = this._button('', () => this.h.onPause());
      this.foldBtn = this._button('–', () => this.fold());
      this.foldBtn.classList.add('fold');
      this.closeBtn = this._button('✕', () => this.h.onClose());
      this.tab.append(this.title, this.lang, this.status, this.traffic, this.pauseBtn, this.foldBtn, this.closeBtn);
      this.morph = mk('morph');
      this.bubble = mk('bubble');
      this.bubble.textContent = '镜';
      this.bubble.tabIndex = 0;
      this.bubble.setAttribute('role', 'button');
      this.bubble.addEventListener('pointerdown', (e) => this._bubbleDown(e));
      this.bubble.addEventListener('pointerenter', () => this._untuck());
      this.bubble.addEventListener('pointerleave', () => this._tuckLater());
      this.bubble.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.unfold();
        }
      });
      this._onResize = () => {
        if (this.folded && this.bub && !this._busy) this._placeBubble(this.bub.side, this.bub.y, this.bub.tucked, 'still');
      };
      window.addEventListener('resize', this._onResize);
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
      this.foldBtn.title = t('fold');
      this._bubbleTitle();
      this.pauseBtn.textContent = t(this.paused ? 'resume' : 'pause');
    }

    /** 皮肤：classic（经典）或 glass（液态玻璃）。 */
    setSkin(skin) {
      this.skin = skin === 'glass' ? 'glass' : 'classic';
      this.root.host.setAttribute('data-skin', this.skin);
      if (this.skin === 'glass') glassFilter(this.root, 'dm-lg-bubble', BUB, BUB, BUB / 2, 15, 9);
      this.layout();
    }

    /** 液态玻璃：标签、菜单按现在的尺寸更新折射滤镜。 */
    _refract() {
      if (this.skin !== 'glass') return;
      if (!this.folded) {
        const t = this.tab.getBoundingClientRect();
        if (t.width > 2) glassFilter(this.root, 'dm-lg-tab', t.width, t.height, TAB_H / 2, 9, 6);
      }
      if (this.menu) {
        const m = this.menu.getBoundingClientRect();
        if (m.width > 2) glassFilter(this.root, 'dm-lg-menu', m.width, m.height, 16, 12, 8);
      }
    }

    /** 开口的圆角（液态玻璃是圆角镜框；复制品的开口跟着切成圆角）。 */
    get radius() {
      return this.skin === 'glass' ? GLASS_R - LINE : 0;
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
      this._refract();
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

    /** 气泡的提示：怎么展开，再加上用量（收起时标签看不见，鼠标停在气泡上也能看到发送、接收了多少）。 */
    _bubbleTitle() {
      const t = this.traffic.hidden ? '' : this.traffic.textContent;
      this.bubble.title = DM.text.ui(this.ui, 'unfold') + (t ? '\n' + t + '\n' + (this.traffic.title || '') : '');
    }

    /**
     * 像网速那样显示发送（↑，橙色）、接收（↓，蓝色）的 token：t = { up: '1.2k', down: '3.4k', approx }，null 就不显示；
     * approx：有一部分是按字数估的，前面加“≈”。tip 是鼠标停上去看的详情。
     */
    setTraffic(t, tip) {
      this.traffic.title = tip || '';
      const text = t ? (t.approx ? '≈' : '') + '↑' + t.up + ' ↓' + t.down : '';
      if (text === this.traffic.textContent && this.traffic.hidden === !text) return;
      const span = (cls, s) => {
        const e = document.createElement('span');
        e.className = cls;
        e.textContent = s;
        return e;
      };
      this.traffic.replaceChildren(...(t ? [(t.approx ? '≈' : ''), span('up', '↑' + t.up), ' ', span('down', '↓' + t.down)] : []));
      this.traffic.hidden = !text;
      this._bubbleTitle();
      this.layout();
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
      clearTimeout(this._tuckTimer);
      window.removeEventListener('resize', this._onResize);
      for (const el of [this.line, ...this.corners, ...Object.values(this.bands), this.tab, this.morph, this.bubble]) el.remove();
    }

    // ---------------------------------------------------------------- 收起成气泡、弹出来
    /** 镜框边线的外框（视口坐标）。 */
    _outline() {
      const { x, y, w, h } = this.rect;
      return { x: x - LINE, y: y - LINE, w: w + 2 * LINE, h: h + 2 * LINE };
    }

    _parts() {
      return [this.line, ...this.corners, ...Object.values(this.bands), this.tab];
    }

    /** 气泡贴边时的位置；tucked 时藏进边缘一部分。 */
    _bubbleXY(side, y, tucked) {
      const vw = viewW(), vh = viewH();
      const inX = side === 'left' ? EDGE : vw - BUB - EDGE;
      const outX = side === 'left' ? -BUB * TUCK : vw - BUB * (1 - TUCK);
      return { x: tucked ? outX : inX, y: clamp(y, EDGE, vh - BUB - EDGE) };
    }

    /** how：still 直接到位，snap 带回弹地吸过去，slide 平滑地滑过去。 */
    _placeBubble(side, y, tucked, how) {
      const p = this._bubbleXY(side, y, tucked);
      const b = this.bubble;
      b.classList.toggle('still', how === 'still');
      b.classList.toggle('slide', how === 'slide');
      b.style.translate = p.x + 'px ' + p.y + 'px';
      this.bub = { side, x: p.x, y: p.y, tucked: !!tucked };
      return p;
    }

    /** 第一次收起：贴到离镜框近的那一边，和标签一样高；以后回到上次停的地方。 */
    _homeOf() {
      if (this.home && (this.home.side === 'left' || this.home.side === 'right')) {
        return { side: this.home.side, y: (this.home.y || 0) * viewH() };
      }
      const o = this._outline();
      return { side: o.x + o.w / 2 < viewW() / 2 ? 'left' : 'right', y: o.y - TAB_H };
    }

    /** 边线变形的两段动画：位置大小（合成器上跑，不受页面卡顿影响），圆角和颜色。 */
    _morphTo(toBubble, dot, duration, easing) {
      const m = this.morph;
      const o = this._outline();
      m.style.width = o.w + 'px';
      m.style.height = o.h + 'px';
      m.classList.add('on');
      const at = (b, sx, sy) => `translate(${b.x}px, ${b.y}px) scale(${sx}, ${sy})`;
      const frame = { transform: at(o, 1, 1) };
      const ball = { transform: at(dot, dot.w / o.w, dot.h / o.h) };
      const glass = this.skin === 'glass';
      const r0 = glass ? GLASS_R + 'px' : '0px';
      const fill = glass ? 'rgba(236, 243, 255, 0.92)' : BLUE;
      const look0 = { borderRadius: r0, backgroundColor: 'rgba(61, 139, 253, 0)' };
      const look1 = { borderRadius: '50%', backgroundColor: fill };
      const opts = { duration, easing, fill: 'both' };
      return [
        m.animate(toBubble ? [frame, ball] : [ball, frame], opts),
        m.animate(toBubble ? [look0, look1] : [look1, look0], opts),
      ];
    }

    /** 收起：标签淡出，边线缩成圆形飞到页面边缘，变成气泡。 */
    fold() {
      if (this.folded || this._busy) return;
      this._busy = true;
      this._closeMenu();
      this.folded = true;
      if (this.h.onFold) this.h.onFold(true);
      const home = this._homeOf();
      const p = this._bubbleXY(home.side, home.y, false);
      this.tab.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 -4px' }], { duration: 140, easing: 'ease-out' });
      for (const el of this._parts()) if (el !== this.tab) el.classList.add('hide');
      setTimeout(() => this.tab.classList.add('hide'), 130);
      const anims = this._morphTo(true, { x: p.x, y: p.y, w: BUB, h: BUB }, 440, EASE_FOLD);
      anims[0].finished.then(() => {
        this.morph.classList.remove('on');
        anims.forEach((a) => a.cancel());
        this._placeBubble(home.side, p.y, false, 'still');
        this.bubble.classList.add('on');
        // 落定时轻轻弹一下
        this.bubble.animate([{ scale: 0.88 }, { scale: 1.06, offset: 0.55 }, { scale: 1 }], { duration: 300, easing: 'ease-out' });
        this._busy = false;
        this._tuckLater();
        if (this.h.onFolded) this.h.onFolded(true);
      }).catch(() => { this._busy = false; });
    }

    /** 弹出：气泡变回镜框，回到原来的位置，标签和译文淡入。 */
    unfold() {
      if (!this.folded || this._busy) return;
      this._busy = true;
      clearTimeout(this._tuckTimer);
      const r = this.bubble.getBoundingClientRect();
      const dot = { x: r.left, y: r.top, w: r.width, h: r.height };
      this.bubble.classList.remove('on');
      const anims = this._morphTo(false, dot, 460, EASE_OPEN);
      anims[0].finished.then(() => {
        this.morph.classList.remove('on');
        anims.forEach((a) => a.cancel());
        this.folded = false;
        for (const el of this._parts()) el.classList.remove('hide');
        this.layout();
        this.tab.animate([{ opacity: 0, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], { duration: 200, easing: 'ease-out' });
        for (const c of this.corners) c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
        if (this.h.onFold) this.h.onFold(false);
        this._busy = false;
        if (this.h.onFolded) this.h.onFolded(false);
      }).catch(() => { this._busy = false; });
    }

    /** 停一会儿就藏进边缘一部分（鼠标在上面、正在拖就不藏）。 */
    _tuckLater() {
      clearTimeout(this._tuckTimer);
      this._tuckTimer = setTimeout(() => {
        if (!this.folded || this._busy || this._dragging || !this.bub || this.bubble.matches(':hover')) return;
        this._placeBubble(this.bub.side, this.bub.y, true, 'slide');
      }, 1600);
    }

    _untuck() {
      clearTimeout(this._tuckTimer);
      if (this.folded && this.bub && this.bub.tucked && !this._dragging) this._placeBubble(this.bub.side, this.bub.y, false, 'slide');
    }

    /** 气泡：按下不动就是点一下（弹出）；拖动就跟着手走，松开吸到近的那一边。 */
    _bubbleDown(e) {
      if (e.button !== 0 || this._busy) return;
      e.preventDefault();
      e.stopPropagation();
      const b = this.bubble;
      b.setPointerCapture(e.pointerId);
      const r = b.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, bx: r.left, by: r.top };
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) {
          moved = true;
          this._dragging = true;
          clearTimeout(this._tuckTimer);
          b.classList.add('drag');
        }
        b.style.translate = (start.bx + dx) + 'px ' + (start.by + dy) + 'px';
      };
      const up = (ev) => {
        b.removeEventListener('pointermove', move);
        b.removeEventListener('pointerup', up);
        b.removeEventListener('pointercancel', up);
        b.classList.remove('drag');
        if (!moved) {
          this.unfold();
          return;
        }
        this._dragging = false;
        const cx = start.bx + (ev.clientX - start.x) + BUB / 2;
        const y = start.by + (ev.clientY - start.y);
        const side = cx < viewW() / 2 ? 'left' : 'right';
        const p = this._placeBubble(side, y, false, 'snap');
        this.home = { side, y: p.y / viewH() };
        if (this.h.onBubble) this.h.onBubble(this.home);
        this._tuckLater();
      };
      b.addEventListener('pointermove', move);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }

    // ---------------------------------------------------------------- 拖动、调整大小
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
      const gap = this.skin === 'glass' ? GAP : 0;
      const below = y - LINE - TAB_H - gap < 0;
      this.tab.classList.toggle('below', below);
      place(this.tab, x - LINE, below ? y + h + LINE + gap : y - LINE - TAB_H - gap, tw, TAB_H);
      // 正在用备用、显示着用量时字长：标签加宽到放得下（最宽和镜框一样）
      this._wide = false;
      if (!this.folded && (this.status.querySelector('.bk') || !this.traffic.hidden)) {
        this.tab.style.width = 'max-content';
        const natural = Math.ceil(this.tab.getBoundingClientRect().width) + 1;
        const want = Math.min(Math.max(tw, w + 2 * LINE), Math.max(tw, natural));
        this.tab.style.width = want + 'px';
        this._wide = want > tw;
      }
      this._placeMenu();
      this._refract();
    }
  }

  DM.Frame = Frame;
  DM.FRAME_TAB_H = TAB_H;
})();
