// 桌面魔镜浏览器版：视频字幕。读出视频挂着的整条字幕，按播放位置提前翻好，播放时在镜框里、原字幕的位置换成译文。
//  - 字幕从哪来：<track> 和走字幕轨接口（TextTrack）的播放器（video.js、Plyr、hls.js……）直接读整条；
//    YouTube 的字幕不在字幕轨里，而且取字幕要带播放器现场算出的凭证，扩展自己去取只会拿到空的：
//    往网页里放一小段脚本（yt-main.js），播放器取到字幕时抄一份过来。
//  - 只翻用户打开了的字幕：浏览器自己在画的字幕轨，或者画面上真有原字幕（播放器自己画的）。
//  - 提前翻：当前位置往后 5 分钟，边播边补；跳到别处先翻那里；同样的句子只翻一次。
//  - 显示：镜框里、原字幕的位置画译文，盖住原字幕；镜框外照旧是原字幕。浏览器自己画的字幕没法只遮住镜框里那一半：
//    字幕区进了镜框就整个藏起来（::cue），移出去还原；还没译好的句子先照原文显示。
//  - 全屏：播放器整块全屏时，译文层放进全屏的那个元素里；视频本身全屏时，临时把字幕轨里的字换成译文，退出全屏换回来。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});
  const T = DM.text;

  const AHEAD = 300;            // 往后提前翻多少秒
  const BEHIND = 10;            // 往回也留几秒（倒回去一点不用等）
  const BATCH_CUES = 40;
  const BATCH_CHARS = 2400;
  const HIDE_ATTR = 'data-deskmirror-subs';
  const YT_PLAYER = '#movie_player.html5-video-player, .html5-video-player#movie_player';
  const SUBS_CSS = `
.layer { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: hidden;
  contain: strict; }
.sub { position: absolute; box-sizing: border-box; transform: translate(-50%, -100%); display: flex; align-items: center;
  justify-content: center; padding: 0.1em 0.45em; background: rgb(8, 8, 8); color: #fff; text-align: center;
  white-space: pre-line; overflow-wrap: anywhere; line-height: 1.32; font-weight: 500;
  font-family: "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif; }
.sub.native { background: rgba(8, 8, 8, 0.78); }
`;
  // 浏览器自己画的字幕（<track>）藏起来：只改颜色和底色，字幕轨照常工作
  const CUE_CSS = `video[${HIDE_ATTR}]::cue { color: transparent !important; background: transparent !important;
  text-shadow: none !important; outline: none !important; }`;

  const ENT = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '', rlm: '', quot: '"', apos: "'" };

  /** 字幕轨里一句的纯文字：去掉 <i>、<v 说话人>、<00:01.000> 这类标记，换回转义的字符。 */
  function cueText(raw) {
    return String(raw || '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g, (m, k) => ENT[k])
      .replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  const escVtt = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const rectOf = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  };
  const cut = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  };
  const union = (rs) => {
    if (!rs.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rs) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const squash = (s) => s.replace(/\s+/g, '');
  const half = (v) => Math.round(v * 2) / 2;

  // ---------------------------------------------------------------- 一条字幕
  /** 按开始时间排好的句子 { start, end, text, cue? }；mode：'native' 浏览器自己画，'dom' 播放器自己画在网页上。 */
  class Track {
    constructor(key, cues, mode, tt) {
      this.key = key;
      this.cues = cues;
      this.mode = mode;
      this.tt = tt || null;
      this.yt = key.startsWith('yt:');
      this.born = performance.now();
    }

    /** t 时刻正在显示的句子（可能不止一句）。 */
    at(t) {
      const c = this.cues;
      let lo = 0, hi = c.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (c[m].start <= t) lo = m + 1;
        else hi = m;
      }
      const out = [];
      for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) if (c[i].end > t) out.unshift(c[i]);
      return out;
    }
  }

  /** 字幕轨（TextTrack）里的句子。 */
  function cuesOf(tt) {
    const out = [];
    const list = tt.cues;
    for (let i = 0; list && i < list.length; i++) {
      const c = list[i];
      const text = cueText(c.text);
      if (text) out.push({ start: c.startTime, end: c.endTime, text, cue: c });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /**
   * YouTube 的字幕（json3）。人工字幕一段一句；自动生成的一个词一个词出来（每个词带时间），按停顿、行尾和标点拼成句子再翻，
   * 不然一行行的碎片译出来不成话。
   */
  function parseJson3(body, url) {
    let j;
    try { j = JSON.parse(body); } catch (e) { return null; }
    const evs = (j && j.events) || [];
    const asr = /[?&]kind=asr\b/.test(url) || evs.some((e) => e.segs && e.segs.length > 1 && e.segs.some((s) => s.tOffsetMs));
    if (!asr) {
      const out = [];
      for (const e of evs) {
        if (!e.segs) continue;
        const text = cueText(e.segs.map((s) => s.utf8 || '').join(''));
        if (!text) continue;
        const start = (e.tStartMs || 0) / 1000;
        out.push({ start, end: start + (e.dDurationMs || 2000) / 1000, text });
      }
      return out.sort((a, b) => a.start - b.start);
    }
    const words = [];
    for (const e of evs) {
      if (!e.segs || e.aAppend) continue;
      const line = [];
      for (const s of e.segs) {
        const w = String(s.utf8 || '').replace(/\n/g, ' ');
        if (w.trim()) line.push({ t: ((e.tStartMs || 0) + (s.tOffsetMs || 0)) / 1000, w });
      }
      if (line.length) line[line.length - 1].eol = true;
      words.push(...line);
    }
    words.sort((a, b) => a.t - b.t);
    const out = [];
    let cur = null;
    const cjk = /[぀-ヿ㐀-鿿가-힯＀-￯]/;
    words.forEach((x, i) => {
      if (!cur) cur = { start: x.t, text: '', n: 0 };
      // 每行第一个词前面没有空格：接到上一行后面要补一个（中文、日文这类不用空格的不补）
      const prev = words[i - 1];
      if (cur.text && prev && prev.eol && !/^\s/.test(x.w) && !cjk.test(cur.text.slice(-1)) && !cjk.test(x.w[0])) cur.text += ' ';
      cur.text += x.w;
      cur.n++;
      const next = words[i + 1];
      const gap = next ? next.t - x.t : Infinity;
      const w = x.w.trim();
      if (!next || /[.?!。？！]$/.test(w) || gap > 1.2 || (x.eol && cur.n >= 12) || cur.n >= 30) {
        const end = next ? Math.min(next.t, x.t + 3) : x.t + 3;
        out.push({ start: cur.start, end: Math.max(end, cur.start + 1), text: cur.text.replace(/\s+/g, ' ').trim() });
        cur = null;
      }
    });
    return out;
  }

  /** YouTube 地址里的视频 id（观看页、短视频、嵌入、直播）。 */
  function ytIdOf(href) {
    try {
      const u = new URL(href, location.href);
      return u.searchParams.get('v') || ((/\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname) || [])[1]) || '';
    } catch (e) {
      return '';
    }
  }

  /** 视频外面、和视频差不多大的播放器（找它自己画的字幕时只在这里面找）。 */
  function playerRoot(video) {
    const vr = rectOf(video);
    let root = video.parentElement || video;
    for (let el = root.parentElement, i = 0; el && i < 4; el = el.parentElement, i++) {
      const r = rectOf(el);
      if (r.w > vr.w * 1.6 || r.h > vr.h * 1.8) break;
      root = el;
    }
    return root;
  }

  // ---------------------------------------------------------------- 一个视频
  class VideoSubs {
    constructor(subs, video) {
      this.subs = subs;
      this.video = video;
      this.track = null;
      this.checked = 0;
      this.active = false;      // 字幕区在镜框里（或者全屏）：要显示
      this.wanted = false;      // 而且字幕开着：要提前翻
      this.box = null;
      this.drawn = '';
      this.cover = null;        // 播放器自己画的字幕在画面上的范围（每帧按视频现在的位置算）
      this.coverRel = null;     // 量到的范围，相对视频左上角（隔一会儿才量一次，滚动时跟着视频走）
      this.coverAt = 0;
      this.coverEl = null;
      this.font = 0;
      this.looked = 0;
      this.hiding = false;
      this.swapped = new Map(); // 视频全屏时换成译文的句子 → 原来的字
    }

    destroy() {
      this._hideNative(false);
      this._swap(false);
      if (this.box) this.box.remove();
      this.box = null;
    }

    update(now, off, fse, open) {
      const s = this.subs;
      const v = this.video;
      if (!this.track || now - this.checked > 1000) {
        this.checked = now;
        this.track = s.trackOf(this);
      }
      const tr = this.track;
      this.active = false;
      this.wanted = false;
      if (!tr) {
        // 没有字幕的视频（信息流里一大堆）：不量位置，每秒看一次有没有字幕
        if (this.box || this.hiding || this.swapped.size) this.destroy();
        this.drawn = '';
        return;
      }
      const vr = rectOf(v);
      let spec = null;
      let fsVideo = false;
      if (tr && vr.w > 40 && vr.h > 30 && !off) {
        const t = v.currentTime;
        const act = tr.at(t);
        const fs = !!fse && (fse === v || fse.contains(v));
        fsVideo = fs && fse === v;
        if (tr.mode === 'dom') this._findCover(act, now, vr);
        const rel = this.coverRel;
        this.cover = rel ? { x: vr.x + rel.dx, y: vr.y + rel.dy, w: rel.w, h: rel.h } : null;
        // 字幕区：浏览器画的在视频下部；播放器画的看它画在哪（YouTube 刚取到字幕、还没出字时也按视频下部算）
        const low = { x: vr.x, y: vr.y + vr.h * 0.7, w: vr.w, h: vr.h * 0.3 };
        const zone = tr.mode === 'native' ? low : this.cover || (tr.yt ? low : null);
        const seen = zone && open ? cut(zone, open) : null;
        this.active = fs || (!fse && !!seen && seen.w * seen.h >= zone.w * zone.h * 0.4);
        // 要不要提前翻：浏览器画的开着就翻；播放器画的，最近一分钟里画面上出过原字幕（YouTube 刚取到字幕也算）
        this.wanted = this.active && (tr.mode === 'native' || now - this.coverAt < 60000 || (tr.yt && now - tr.born < 60000));
        if (this.active && act.length && !fsVideo) spec = this._spec(act, vr);
      }
      this._hideNative(!!(this.active && tr && tr.mode === 'native' && !fsVideo));
      this._swap(!!(this.active && fsVideo && tr && tr.mode === 'native'));
      const host = spec && fse && (fse === v || fse.contains(v)) ? s.fsLayer(fse, v) : s.layer;
      this._draw(host, spec);
    }

    /** 这一刻要画什么：浏览器自己画的，译文没好就先显示原文；播放器自己画的，都译好了、画面上也有原字幕才盖上去。 */
    _spec(act, vr) {
      const s = this.subs;
      const tr = this.track;
      if (tr.mode === 'native') {
        const text = act.map((c) => {
          const x = s.translated(c.text);
          return typeof x === 'string' ? x : c.text;
        }).join('\n');
        const font = Math.max(12, vr.h * 0.05);
        return { text, x: vr.x + vr.w / 2, y: vr.y + vr.h - vr.h * 0.045, minW: 0, minH: 0, maxW: vr.w * 0.92, font, native: true };
      }
      if (!this.cover) return null;
      const xs = act.map((c) => s.translated(c.text));
      if (!xs.every((x) => typeof x === 'string')) return null;
      const c = this.cover;
      // 四周多盖 1 像素，取整时不露出原字幕的边
      return { text: xs.join('\n'), x: c.x + c.w / 2, y: c.y + c.h + 1, minW: c.w + 2, minH: c.h + 2,
        maxW: Math.max(c.w + 2, vr.w * 0.92), font: this.font || Math.max(12, vr.h * 0.05), native: false };
    }

    /**
     * 播放器自己画的字幕在哪：YouTube 直接找它的字幕框；别的播放器在视频那一块里找和当前这句一样的字。
     * 找不到就不盖（字幕关着，或者不是画在这儿的），刚找到过的留 0.4 秒，免得两句之间一闪一闪。
     */
    _findCover(act, now, vr) {
      const keep = () => {
        if (now - this.coverAt > 400) this.coverRel = null;
      };
      const put = (r) => {
        this.coverRel = { dx: r.x - vr.x, dy: r.y - vr.y, w: r.w, h: r.h };
        this.coverAt = now;
      };
      if (now - this.looked < (this.coverRel ? 120 : 250)) return;
      this.looked = now;
      const p = this.video.closest(YT_PLAYER);
      if (p) {
        const rs = [];
        let shown = '';
        for (const w of p.querySelectorAll('.caption-window')) {
          if (!/\S/.test(w.textContent)) continue;
          const r = rectOf(w);
          if (r.w > 2 && r.h > 2 && getComputedStyle(w).visibility !== 'hidden') {
            rs.push(r);
            shown += ' ' + w.textContent;
          }
        }
        // 画面上的字要和这时候的字幕对得上才盖（放广告、刚换了视频字幕还没到时，别拿别的译文盖上去）
        if (rs.length && this._agrees(shown)) {
          put(union(rs));
          const seg = p.querySelector('.ytp-caption-segment');
          if (seg) this.font = parseFloat(getComputedStyle(seg).fontSize) || 0;
        } else keep();
        return;
      }
      if (!act.length) return keep();
      const want = squash(act.map((c) => c.text).join(''));
      const root = playerRoot(this.video);
      const found = (this.coverEl && root.contains(this.coverEl) ? this._match(this.coverEl, want, vr, root) : null)
        || this._match(root, want, vr, root);
      if (found) {
        put(found.rect);
        this.coverEl = found.el;
        this.font = found.font;
      } else keep();
    }

    /** 画面上的字和这时前后几秒的字幕大半一样（按三个字一组比；自动生成的字幕一个词一个词出来，也比得上）。 */
    _agrees(shown) {
      const grams = (s) => {
        const x = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        const g = new Set();
        for (let i = 0; i + 3 <= x.length; i++) g.add(x.slice(i, i + 3));
        if (!g.size && x) g.add(x);
        return g;
      };
      const d = grams(shown);
      if (!d.size) return false;
      const t = this.video.currentTime;
      const near = this.track.cues.filter((c) => c.end > t - 8 && c.start < t + 1).map((c) => c.text).join(' ');
      const c = grams(near);
      let hit = 0;
      for (const g of d) if (c.has(g)) hit++;
      return hit >= d.size * 0.5;
    }

    /** root 里和这句字幕一样的文字（视口坐标的范围、所在元素、字号）；字幕框最多往上找到播放器 bound。 */
    _match(root, want, vr, bound) {
      if (!root || !root.isConnected || !want) return null;
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const rs = [];
      const least = Math.min(6, want.length);      // 太短的字多半是播放器按钮上的
      let el = null, font = 0, got = '', budget = 800;
      for (let n = tw.nextNode(); n && budget-- > 0; n = tw.nextNode()) {
        const t = squash(n.data);
        if (t.length < least || !want.includes(t)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const b = range.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        const r = { x: b.left, y: b.top, w: b.width, h: b.height };
        if (!cut(r, vr)) continue;
        const p = n.parentElement;
        if (!p || getComputedStyle(p).visibility === 'hidden') continue;
        rs.push(r);
        got += t;
        if (!el) {
          el = p;
          font = parseFloat(getComputedStyle(p).fontSize) || 0;
        } else {
          while (el && !el.contains(p)) el = el.parentElement;
        }
      }
      if (!rs.length || got.length < want.length * 0.6) return null;
      // 字幕框：文字所在元素一路往上，到还在视频范围里的那层（带着播放器给字幕加的底色和边距）
      let box = el;
      for (let up = el && el.parentElement; up && up !== bound && bound.contains(up); up = up.parentElement) {
        const r = rectOf(up);
        if (r.w > vr.w * 0.98 || r.h > vr.h * 0.6) break;
        box = up;
      }
      const text = union(rs);
      const br = box ? rectOf(box) : null;
      return { rect: br && br.w <= text.w * 3 && br.h <= text.h * 4 ? union([text, br]) : text, el, font };
    }

    _draw(host, spec) {
      if (spec) {
        spec.x = half(spec.x);
        spec.y = half(spec.y);
        spec.minW = Math.ceil(spec.minW);
        spec.minH = Math.ceil(spec.minH);
        spec.maxW = Math.floor(spec.maxW);
        spec.font = half(spec.font);
      }
      const key = spec ? JSON.stringify(spec) : '';
      if (key === this.drawn && (!spec || (this.box && this.box.parentNode === host))) return;
      this.drawn = key;
      if (!spec) {
        if (this.box) this.box.remove();
        this.box = null;
        return;
      }
      if (!this.box || this.box.parentNode !== host) {
        if (this.box) this.box.remove();
        this.box = document.createElement('div');
        host.appendChild(this.box);
      }
      const b = this.box;
      b.className = 'sub' + (spec.native ? ' native' : '');
      b.textContent = spec.text;
      const st = b.style;
      st.left = spec.x + 'px';
      st.top = spec.y + 'px';
      st.minWidth = spec.minW + 'px';
      st.minHeight = spec.minH + 'px';
      st.maxWidth = spec.maxW + 'px';
      st.fontSize = spec.font + 'px';
    }

    _hideNative(on) {
      if (on === this.hiding) return;
      this.hiding = on;
      if (on) {
        this.subs.cueSheet();
        this.video.setAttribute(HIDE_ATTR, '');
      } else this.video.removeAttribute(HIDE_ATTR);
    }

    /** 视频本身全屏：字幕轨里的字临时换成译文（浏览器自己画）；退出全屏、关掉魔镜时换回来。 */
    _swap(on) {
      const tr = this.track;
      if (!on) {
        for (const [cue, text] of this.swapped) {
          try { cue.text = text; } catch (e) { /* 字幕轨已经没了 */ }
        }
        this.swapped.clear();
        return;
      }
      for (const c of tr.cues) {
        if (!c.cue || this.swapped.has(c.cue)) continue;
        const x = this.subs.translated(c.text);
        if (typeof x !== 'string') continue;
        this.swapped.set(c.cue, c.cue.text);
        c.cue.text = escVtt(x);
      }
    }
  }

  // ---------------------------------------------------------------- 整页
  class Subs {
    /** opts：{ backend, frame, copy, source, target, context() } */
    constructor(shell, opts) {
      this.shell = shell;
      this.opts = opts;
      this.videos = new Map();
      this.cache = new Map();       // 方向 + 原文 → 译文（null = 不用翻）
      this.srcOf = new Map();
      this.flying = new Set();
      this.retryAt = new Map();
      this.pending = [];
      this.inflight = 0;
      this.yt = new Map();          // YouTube：视频 id → 字幕
      this.ytLatest = '';
      this.ytAsked = false;
      this.state = { hidden: false, paused: false, peek: false };
      this.scanned = 0;
      this.planned = 0;
      this.clipKey = '';
      this.stats = { batches: 0, segments: 0 };

      this.sheet = new CSSStyleSheet();
      this.sheet.replaceSync(SUBS_CSS);
      shell.root.adoptedStyleSheets = [...shell.root.adoptedStyleSheets, this.sheet];
      this.layer = document.createElement('div');
      this.layer.className = 'layer';
      const after = opts.copy && opts.copy.clip;
      if (after && after.parentNode === shell.root) shell.root.insertBefore(this.layer, after.nextSibling);
      else shell.root.prepend(this.layer);
      this.fs = null;

      this._onMessage = (e) => this._message(e);
      window.addEventListener('message', this._onMessage);
      this._onSeek = () => { this.planned = 0; };
      document.addEventListener('seeking', this._onSeek, true);
    }

    destroy() {
      for (const vs of this.videos.values()) vs.destroy();
      this.videos.clear();
      this.layer.remove();
      this._dropFs();
      this._dropCueSheet();
      window.removeEventListener('message', this._onMessage);
      document.removeEventListener('seeking', this._onSeek, true);
      if (this.ytAsked) window.postMessage({ deskmirror: 'yt-control', on: false }, location.origin);
      this.pending = [];
    }

    setHidden(on) { this.state.hidden = on; }

    setPaused(on) { this.state.paused = on; }

    setPeek(on) { this.state.peek = on; }

    setLanguages(source, target) {
      if (source === this.opts.source && target === this.opts.target) return;
      this.opts.source = source;
      this.opts.target = target;
      this.pending = [];
      this.planned = 0;
    }

    _prefix() {
      return (this.opts.source || 'auto') + '\u0001' + this.opts.target + '\u0001';
    }

    /** 这句的译文：字符串；null = 不用翻（已经是目标语言、没有字）；undefined = 还没译好。 */
    translated(text) {
      return this.cache.get(this._prefix() + text);
    }

    /** 每一帧：跟着播放位置换字幕、跟着镜框裁剪；每秒找一次新视频，每半秒排一次要提前翻的句子。 */
    tick() {
      const now = performance.now();
      if (now - this.scanned > 1000) {
        this.scanned = now;
        this._scan();
      }
      const st = this.state;
      const off = st.hidden || st.paused || st.peek;
      const fse = document.fullscreenElement;
      const open = this.opts.frame.open;
      this._clip(open, this.opts.frame.radius || 0);
      for (const vs of this.videos.values()) vs.update(now, off, fse, open);
      if (!fse && this.fs) this._dropFs();
      if (now - this.planned > 500) {
        this.planned = now;
        this._plan();
      }
    }

    /** 镜框（拖动变形时跟着形状）以外的译文裁掉。 */
    _clip(r, k) {
      const key = [r.x, r.y, r.w, r.h, k].map((v) => Math.round(v)).join(',');
      if (key === this.clipKey) return;
      this.clipKey = key;
      const { x, y, w, h } = r;
      const rad = Math.min(k, w / 2, h / 2);
      this.layer.style.clipPath = rad
        ? `path("M${x + rad} ${y}H${x + w - rad}A${rad} ${rad} 0 0 1 ${x + w} ${y + rad}V${y + h - rad}A${rad} ${rad} 0 0 1 ${x + w - rad} ${y + h}`
          + `H${x + rad}A${rad} ${rad} 0 0 1 ${x} ${y + h - rad}V${y + rad}A${rad} ${rad} 0 0 1 ${x + rad} ${y}Z")`
        : `path("M${x} ${y}H${x + w}V${y + h}H${x}Z")`;
    }

    _scan() {
      const list = [...document.getElementsByTagName('video')];
      const copy = this.opts.copy;
      if (copy && copy.shadows) {
        for (const sr of copy.shadows.keys()) if (sr.host && sr.host.isConnected) list.push(...sr.querySelectorAll('video'));
      }
      for (const v of list) if (!this.videos.has(v)) this.videos.set(v, new VideoSubs(this, v));
      for (const [v, vs] of this.videos) {
        if (!v.isConnected) {
          vs.destroy();
          this.videos.delete(v);
        }
      }
      if (!this.ytAsked && document.querySelector(YT_PLAYER)) this._askYouTube();
      if (this.cue && !document.adoptedStyleSheets.includes(this.cue)) this.cueSheet();
    }

    /** 这个视频现在显示的那条字幕。 */
    trackOf(vs) {
      const v = vs.video;
      if (v.closest(YT_PLAYER)) {
        const id = ytIdOf(location.href) || this.ytLatest;
        return this.yt.get(id) || null;
      }
      let pick = null, idx = -1;
      const list = v.textTracks;
      for (let i = 0; list && i < list.length; i++) {
        const tt = list[i];
        if (tt.kind !== 'subtitles' && tt.kind !== 'captions') continue;
        if (!tt.cues || !tt.cues.length) continue;
        if (tt.mode === 'showing') {
          pick = tt;
          idx = i;
          break;
        }
        if (tt.mode === 'hidden' && !pick) {
          pick = tt;
          idx = i;
        }
      }
      if (!pick) return null;
      const mode = pick.mode === 'showing' ? 'native' : 'dom';
      const key = `tt:${idx}:${pick.cues.length}:${pick.language}:${pick.label}:${mode}`;
      if (vs.track && vs.track.key === key) return vs.track;
      return new Track(key, cuesOf(pick), mode, pick);
    }

    // ---------------------------------------------------------------- YouTube
    _askYouTube() {
      this.ytAsked = true;
      try {
        if (globalThis.chrome && chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ type: 'dm-yt-hook' }).catch(() => {});
      } catch (e) { /* 扩展已更新 */ }
    }

    _message(e) {
      const d = e.data;
      if (e.source !== window || !d || d.deskmirror !== 'yt-captions') return;
      const url = String(d.url || '');
      const cues = parseJson3(String(d.body || ''), url);
      if (!cues || !cues.length) return;
      const id = String(d.videoId || '') || ytIdOf(url);
      if (!id) return;
      const key = 'yt:' + url.replace(/[?&](pot|potc|signature|sparams|expire|ei|key|c|cver|cplayer|cos|cosver|cbr|cbrver|cplatform|xorb|xobt|xovt)=[^&]*/g, '');
      const old = this.yt.get(id);
      if (!old || old.key !== key || old.cues.length !== cues.length) this.yt.set(id, new Track(key, cues, 'dom'));
      this.ytLatest = id;
      this.planned = 0;
      for (const vs of this.videos.values()) vs.checked = 0;
    }

    // ---------------------------------------------------------------- 提前翻
    /** 镜框里（或全屏）在放的视频：当前位置往后 5 分钟里的句子，近的先翻；跳到别处就先翻那里。 */
    _plan() {
      const st = this.state;
      if (st.hidden || st.paused) return;
      const want = [];
      for (const vs of this.videos.values()) {
        if (!vs.wanted || !vs.track) continue;
        const t = vs.video.currentTime;
        for (const c of vs.track.cues) {
          if (c.end < t - BEHIND || c.start > t + AHEAD) continue;
          want.push([c.end >= t ? Math.max(0, c.start - t) : 1e6 + t - c.end, c.text]);
        }
      }
      want.sort((a, b) => a[0] - b[0]);
      const pre = this._prefix();
      const seen = new Set();
      this.pending = [];
      for (const [, text] of want) {
        const key = pre + text;
        if (seen.has(key) || this.cache.has(key)) continue;
        seen.add(key);
        if (!T.hasWords(text) || T.isAlreadyTarget(text, this.opts.target) || !T.matchesSource(text, this.opts.source)) {
          this.cache.set(key, null);
          continue;
        }
        this.srcOf.set(key, text);
        this.pending.push(key);
      }
      this._dispatch();
    }

    _dispatch() {
      if (this.inflight >= 1 || this.state.hidden || this.state.paused) return;
      const now = performance.now();
      const keys = [];
      let chars = 0;
      for (const k of this.pending) {
        if (this.cache.has(k) || this.flying.has(k) || (this.retryAt.get(k) || 0) > now) continue;
        keys.push(k);
        chars += this.srcOf.get(k).length;
        if (keys.length >= BATCH_CUES || chars >= BATCH_CHARS) break;
      }
      if (keys.length) this._send(keys);
    }

    _send(keys) {
      this.inflight++;
      this.stats.batches++;
      this.stats.segments += keys.length;
      keys.forEach((k) => this.flying.add(k));
      const got = new Set();
      let finished = false;
      const ctx = 'Video subtitles, consecutive lines (a sentence may continue on the next line) — '
        + (this.opts.context ? this.opts.context() : '');
      this.opts.backend.translate(
        { segments: keys.map((k) => this.srcOf.get(k)), source: this.opts.source || 'auto', target: this.opts.target,
          context: ctx.slice(0, 220) },
        (i, text) => {
          if (finished || got.has(i) || i < 0 || i >= keys.length) return;
          got.add(i);
          this.flying.delete(keys[i]);
          this.cache.set(keys[i], T.stripTags(String(text)).replace(/\s+/g, ' ').trim());
        },
        () => {
          if (finished) return;
          finished = true;
          this.inflight--;
          keys.forEach((k, i) => {
            this.flying.delete(k);
            if (!got.has(i)) this.retryAt.set(k, performance.now() + 8000);
          });
          this._dispatch();
        },
      );
    }

    // ---------------------------------------------------------------- 显示用的零件
    /** 播放器整块全屏时，译文层放进全屏的元素里（镜框不在全屏画面上）。 */
    fsLayer(fse, video) {
      if (this.fs && this.fs.el === fse && this.fs.host.isConnected) return this.fs.layer;
      this._dropFs();
      // 放进全屏元素里；它有影子 DOM 时直接放进去的子元素不显示，就放进视频外面最外层没有影子 DOM 的那层
      const shadowed = (el) => {
        try {
          return !!(chrome.dom && chrome.dom.openOrClosedShadowRoot ? chrome.dom.openOrClosedShadowRoot(el) : el.shadowRoot);
        } catch (e) {
          return !!el.shadowRoot;
        }
      };
      let parent = null;
      for (let el = video.parentElement; el; el = el.parentElement) {
        if (!shadowed(el)) parent = el;
        if (el === fse) break;
      }
      if (!parent) parent = fse;
      const host = document.createElement('div');
      host.setAttribute('data-deskmirror-own', '');
      for (const [k, v] of Object.entries({ position: 'fixed', left: '0', top: '0', width: '0', height: '0', margin: '0',
        padding: '0', border: '0', display: 'block', 'z-index': '2147483647', 'pointer-events': 'none', transform: 'none',
        opacity: '1', visibility: 'visible' })) host.style.setProperty(k, v, 'important');
      const root = host.attachShadow({ mode: 'closed' });
      root.adoptedStyleSheets = [this.sheet];
      const layer = document.createElement('div');
      layer.className = 'layer';
      root.appendChild(layer);
      parent.appendChild(host);
      this.fs = { el: fse, host, layer };
      return layer;
    }

    _dropFs() {
      if (this.fs) this.fs.host.remove();
      this.fs = null;
    }

    /** 藏浏览器自己画的字幕用的样式表（挂在网页上；用样式表对象，不受网页的内联样式限制）。 */
    cueSheet() {
      if (!this.cue) {
        this.cue = new CSSStyleSheet();
        this.cue.replaceSync(CUE_CSS);
      }
      try {
        if (!document.adoptedStyleSheets.includes(this.cue)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.cue];
      } catch (e) { /* 老浏览器 */ }
    }

    _dropCueSheet() {
      if (!this.cue) return;
      try {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== this.cue);
      } catch (e) { /* 老浏览器 */ }
    }
  }

  DM.Subs = Subs;
  DM.subsParse = { parseJson3, cueText, ytIdOf };
})();
