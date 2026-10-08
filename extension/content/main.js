// 桌面魔镜浏览器版：启动、关闭，把复制品、翻译单位、镜框接起来。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});
  const T = DM.text;
  DM.version = '0.1.0';

  function important(el, css) {
    for (const k of Object.keys(css)) el.style.setProperty(k, css[k], 'important');
  }

  function makeShell() {
    const host = document.createElement('div');
    host.setAttribute('data-deskmirror', '');
    important(host, {
      position: 'fixed', left: '0', top: '0', width: '0', height: '0', margin: '0', padding: '0', border: '0',
      display: 'block', 'z-index': '2147483647', 'pointer-events': 'none', overflow: 'visible', transform: 'none',
      filter: 'none', opacity: '1', visibility: 'visible', contain: 'none',
    });
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(DM.FRAME_CSS);
    root.adoptedStyleSheets = [sheet];
    document.documentElement.appendChild(host);
    return { host, root };
  }

  // ------------------------------------------------------------------ 翻译服务
  function jobsBackend(send) {
    const jobs = new Map();
    let seq = 0;
    const api = {
      onEngine: null,                 // 后台换了服务（备用阵列）时调用
      reply(m) {
        if (m.type === 'engine') {
          if (api.onEngine) api.onEngine(m);
          return;
        }
        const j = jobs.get(m.id);
        if (!j) return;
        if (m.type === 'seg') j.onSeg(m.i, m.text);
        else {
          jobs.delete(m.id);
          j.onDone(m.error || null);
        }
      },
      failAll(err) {
        for (const j of jobs.values()) j.onDone(err);
        jobs.clear();
      },
      translate(req, onSeg, onDone) {
        const id = ++seq;
        jobs.set(id, { onSeg, onDone });
        send(Object.assign({ type: 'batch', id }, req));
      },
    };
    return api;
  }

  /** 扩展里：交给后台（后台去请求翻译服务，流式把每段送回来）。 */
  function portBackend() {
    let port = null;
    const b = jobsBackend((msg) => {
      try {
        if (!port) {
          port = chrome.runtime.connect({ name: 'dm-translate' });
          port.onMessage.addListener((m) => b.reply(m));
          port.onDisconnect.addListener(() => {
            port = null;
            b.failAll(T.ui(DM.uiLang, 'disconnected'));
          });
        }
        port.postMessage(msg);
      } catch (e) {
        // 扩展更新或关掉以后，旧脚本连不上后台了：关掉镜子，再点图标会放进新版本
        port = null;
        setTimeout(() => {
          b.failAll(T.ui(DM.uiLang, 'updated'));
          if (DM.session) DM.stop();
        }, 0);
      }
    });
    return b;
  }

  /** 测试工具里：通过 CDP 绑定交给 Node 那边。 */
  function bindingBackend() {
    const b = jobsBackend((msg) => globalThis.dmBackend(JSON.stringify(msg)));
    DM.backendReply = (m) => b.reply(m);
    return b;
  }

  /** 页面内假翻译（没有扩展、也没有测试工具时）。 */
  function mockBackend(mode) {
    return {
      translate(req, onSeg, onDone) {
        setTimeout(() => {
          req.segments.forEach((s, i) => onSeg(i, T.mockTranslate(s, req.target, mode)));
          onDone(null);
        }, 150);
      },
    };
  }

  DM.makeBackend = function (cfg) {
    if (cfg.mock) return mockBackend(cfg.mock);
    if (typeof globalThis.dmBackend === 'function') return bindingBackend();
    if (globalThis.chrome && chrome.runtime && chrome.runtime.id) return portBackend();
    return mockBackend('zh');
  };

  // ------------------------------------------------------------------ 开关
  function defaultRect() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.round(Math.min(Math.max(vw * 0.46, 320), vw - 40));
    const h = Math.round(Math.min(Math.max(vh * 0.55, 200), vh - 80));
    return { x: Math.round(vw - w - 30), y: Math.round(Math.max(60, vh * 0.2)), w, h };
  }

  function fmt(v) {
    return Math.round(v * 100) / 100;
  }

  DM.start = function (opts) {
    if (DM.session) return DM.session;
    const cfg = Object.assign({ concurrency: 2 }, DM.config || {}, opts || {});
    // 母语没设过就按浏览器语言猜；默认译成母语
    if (!cfg.native) cfg.native = T.guessNative(navigator.language);
    if (!cfg.target) cfg.target = cfg.native;
    DM.uiLang = T.uiLang(cfg.native);
    const t0 = performance.now();
    const shell = makeShell();
    shell.compositorSync = cfg.compositorSync !== false;
    const copy = new DM.LiveCopy(shell);
    copy.build();
    const s = { cfg, shell, copy, clip: '', clipDirty: true, frames: 0 };
    DM.session = s;

    const frame = new DM.Frame(shell, cfg.rect || defaultRect(), {
      uiLang: DM.uiLang,
      onRect: (r, done) => {
        s.clipDirty = true;
        s.units.pumpSoon(done ? 0 : 150);
        if (done && cfg.onRect) cfg.onRect(r);
      },
      onPause: () => setPaused(!s.units.paused),
      onClose: () => DM.stop(),
      onLang: (source, target) => {
        s.units.setLanguages(source, target);
        if (cfg.onLang) cfg.onLang(source, target);
        else saveLanguages(source, target);
      },
    });
    s.frame = frame;
    frame.setLang(cfg.source || 'auto', cfg.target);

    const backend = cfg.backend || DM.makeBackend(cfg);
    s.units = new DM.Units(copy, {
      source: cfg.source || 'auto',
      target: cfg.target,
      backend,
      frameRect: () => frame.rect,
      concurrency: cfg.concurrency,
      context: () => ((document.title || '').trim() + ' — ' + location.hostname).slice(0, 160),
      onStatus: (st) => {
        const t = (k, v) => T.ui(DM.uiLang, k, v);
        // 正在用备用阵列里的备用：状态后面加“备用② 模型”，鼠标停上去看主力为什么不能用
        const e = s.engine;
        const extra = e ? t('backup', { n: T.circled(e.idx + 1), m: e.model || e.label }) : '';
        const tip = e ? t('backupTip', { p: e.primary, e: e.reason || '—', n: T.circled(e.idx + 1), l: e.label }) : '';
        if (st.paused) frame.setStatus(t('paused'), 'paused', tip, extra);
        else if (st.error) frame.setStatus(t('error', { e: st.error }), 'error', st.error + (tip ? '\n\n' + tip : ''));
        else if (st.pending || st.inflight) frame.setStatus(t('busy', { n: st.pending }), 'busy', tip, extra);
        else frame.setStatus(t('ready'), 'ok', tip, extra);
      },
    });
    if ('onEngine' in backend) {
      backend.onEngine = (m) => {
        s.engine = m.idx > 0 ? m : null;
        // 本机模型一次一批（显卡排队），云端服务三批并发
        if (typeof m.local === 'boolean') s.units.opts.concurrency = m.local ? 1 : 3;
        s.units._dispatch();
      };
    }
    copy.on('change', () => { s.clipDirty = true; });

    // 非零环绕规则：镜框顺时针 +1；洞逆时针 −1，露出真网页（洞已合并成互不重叠的）；
    // 已经排进译文、又压在画布上的块（Comfy 的节点、图表的图例）再顺时针 +1，从洞里重新露出复制品，但避开输入框这类洞
    const ring = (h, cw) => (cw
      ? `M${fmt(h.x)} ${fmt(h.y)}H${fmt(h.x + h.w)}V${fmt(h.y + h.h)}H${fmt(h.x)}Z`
      : `M${fmt(h.x)} ${fmt(h.y)}V${fmt(h.y + h.h)}H${fmt(h.x + h.w)}V${fmt(h.y)}Z`);
    const updateClip = () => {
      const r = frame.rect;
      const { holes, under, face } = copy.holeInfo(r);
      let d = ring(r, true);
      for (const h of holes) d += ring(h, false);
      if (under.length) {
        for (const c of s.units.coverRects(r, under)) {
          for (const p of DM.subtractRects(c, face)) d += ring(p, true);
        }
      }
      const v = `path(nonzero, "${d}")`;
      if (v !== s.clip) {
        copy.clip.style.clipPath = v;
        s.clip = v;
      }
    };
    const tick = () => {
      s.raf = requestAnimationFrame(tick);
      if (s.clipDirty || ++s.frames % 10 === 0) {
        s.clipDirty = false;
        updateClip();
      }
    };
    tick();

    const setPaused = (on) => {
      s.units.setPaused(on);
      frame.setPaused(on);
      copy.clip.classList.toggle('off', on);
    };
    s.setPaused = setPaused;

    // 按住 Ctrl+Alt+O 看原文（和桌面版一样）
    const peek = (on) => copy.clip && copy.clip.classList.toggle('peek', on);
    s.onKey = (e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.altKey && e.code === 'KeyO') {
        peek(true);
        e.preventDefault();
      } else if (e.type === 'keyup' && (e.code === 'KeyO' || e.key === 'Control' || e.key === 'Alt')) {
        peek(false);
      }
    };
    s.onBlur = () => peek(false);
    window.addEventListener('keydown', s.onKey, true);
    window.addEventListener('keyup', s.onKey, true);
    window.addEventListener('blur', s.onBlur);

    s.units.start();
    s.startMs = performance.now() - t0;
    return s;
  };

  DM.stop = function () {
    const s = DM.session;
    if (!s) return;
    DM.session = null;
    cancelAnimationFrame(s.raf);
    window.removeEventListener('keydown', s.onKey, true);
    window.removeEventListener('keyup', s.onKey, true);
    window.removeEventListener('blur', s.onBlur);
    s.units.destroy();
    s.copy.destroy();
    s.frame.destroy();
    s.shell.host.remove();
  };

  /** 扩展里：标签上换了语言方向，记到设置里（设置页和下次打开都用这个）。 */
  function saveLanguages(source, target) {
    if (!(globalThis.chrome && chrome.storage && chrome.runtime && chrome.runtime.id)) return;
    chrome.storage.local.get('settings').then(({ settings }) => {
      chrome.storage.local.set({ settings: Object.assign({}, settings || {}, { source, target }) });
    }).catch(() => {});
  }

  /** 设置页里改了语言方向，打开着的魔镜马上跟着换。 */
  DM.applySettings = function (st) {
    const s = DM.session;
    if (!s || !st) return;
    if (st.native) {
      const lang = T.uiLang(st.native);
      if (lang !== DM.uiLang) {
        DM.uiLang = lang;
        s.frame.setUiLang(lang);
        s.units._status();
      }
    }
    const source = st.source || 'auto', target = st.target || s.units.opts.target;
    if (source !== s.units.opts.source || target !== s.units.opts.target) {
      s.frame.setLang(source, target);
      s.units.setLanguages(source, target);
    }
  };

  DM.toggle = function () {
    if (DM.session) DM.stop();
    else DM.start();
  };

  // ------------------------------------------------------------------ 扩展入口
  // 后台第一次注入时启动；之后点图标或按快捷键，后台发消息来开关。
  const runtimeAlive = (rt) => {
    try { return !!(rt && rt.id); } catch (e) { return false; }
  };
  if (globalThis.chrome && chrome.runtime && chrome.runtime.id && !(DM.loaded && runtimeAlive(DM.loadedRuntime))) {
    if (DM.session) DM.stop();   // 更新前的旧镜子
    DM.loaded = true;
    DM.loadedRuntime = chrome.runtime;
    const startWithSettings = () => {
      chrome.storage.local.get('settings').then(({ settings }) => {
        const st = settings || {};
        // 本机 Ollama 跑本地模型时一次一批（显卡排队）；云端服务（包括 Ollama 的云端模型）三批并发
        const local = (st.protocol || 'ollama') === 'ollama' && /127\.0\.0\.1|localhost/.test(st.baseUrl || 'http://127.0.0.1')
          && !/cloud$/.test(st.model || '');
        DM.config = Object.assign({ concurrency: local ? 1 : 3 }, st);
        DM.start();
      });
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) DM.applySettings(changes.settings.newValue);
    });
    // 扩展更新（重新加载）以后，这里的旧脚本就和后台断了；镜子自己关掉，再点图标会放进新版本
    setInterval(() => {
      let alive = false;
      try { alive = !!chrome.runtime.id; } catch (e) { /* 已失效 */ }
      if (!alive && DM.session) DM.stop();
    }, 2000);
    chrome.runtime.onMessage.addListener((m, _sender, reply) => {
      if (m && m.type === 'dm-toggle') {
        if (DM.session) DM.stop();
        else startWithSettings();
        reply({ on: !!DM.session });
      }
    });
    startWithSettings();
  }
})();
