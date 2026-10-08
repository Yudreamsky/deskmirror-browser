// 桌面魔镜浏览器版：输入框里连按三次空格，把框里的字（一定是母语）翻译成设置里“输入框翻译成”的语言，直接换掉（Ctrl+Z 撤回）。
// 只在打开过魔镜的页面上有效：点图标时和魔镜一起放进来，关掉魔镜也还在，换了网页要再点一次图标。
//  - 每两下空格之间不超过 0.5 秒才算连按；按住不放的自动连发、输入法选字时的空格都不算；
//  - 光标要在最后，三个空格前面要有字，而且不是在行首（行首连按空格多半是在缩进）；
//  - 翻译时框旁边出一个小提示；翻完如果框里的字已经变了（又打了字），就不替换。
(function () {
  'use strict';
  const DM = (globalThis.__dm = globalThis.__dm || {});
  const T = DM.text;
  const GAP = 500;
  const BADGE_ATTR = 'data-deskmirror-badge';

  /** 能打字的地方：文字类的单行框、多行框、可编辑区域（返回富文本编辑器的根）。 */
  function editableOf(t) {
    if (!t || t.nodeType !== 1) return null;
    if (t.localName === 'textarea') return t.readOnly || t.disabled ? null : t;
    if (t.localName === 'input') {
      const type = (t.getAttribute('type') || 'text').toLowerCase();
      return /^(text|search|url|email|tel)$/.test(type) && !t.readOnly && !t.disabled ? t : null;
    }
    if (t.isContentEditable) {
      let r = t;
      while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement;
      return r;
    }
    return null;
  }

  const isBox = (el) => el.localName === 'textarea' || el.localName === 'input';
  const textOf = (el) => (isBox(el) ? el.value : el.innerText.replace(/\n$/, ''));

  /** 可编辑区域里，光标后面只剩空白（光标在最后）。 */
  function caretAtEnd(el) {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed || !el.contains(sel.focusNode)) return false;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setStart(sel.focusNode, sel.focusOffset);
    return !/\S/.test(r.toString().replace(/ /g, ' '));
  }

  // ---------------------------------------------------------------- 小提示（框的右下角）
  let badgeHost = null, badgeBox = null, badgeTimer = 0, last = null;

  function badge(el, text, kind, ms) {
    clearTimeout(badgeTimer);
    if (!badgeHost || !badgeHost.isConnected) {
      badgeHost = document.createElement('div');
      badgeHost.setAttribute(BADGE_ATTR, '');
      for (const [k, v] of Object.entries({ position: 'fixed', left: '0', top: '0', width: '0', height: '0', margin: '0', padding: '0',
        border: '0', display: 'block', 'z-index': '2147483647', 'pointer-events': 'none', transform: 'none', opacity: '1' })) {
        badgeHost.style.setProperty(k, v, 'important');
      }
      const root = badgeHost.attachShadow({ mode: 'closed' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
:host { all: initial; }
.b { position: fixed; max-width: 360px; padding: 5px 10px; border-radius: 12px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; font: 12px/1.3 "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  background: rgba(28, 30, 36, 0.92); color: #ebeef5; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  transition: opacity 160ms ease, translate 160ms ease; }
.b.busy::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px;
  background: #78b4ff; animation: p 0.9s ease-in-out infinite; vertical-align: 1px; }
.b.ok { color: #9be3a9; } .b.err { color: #ff8a80; }
.b.hide { opacity: 0; translate: 0 4px; }
:host([data-skin="glass"]) .b { color: #1d1d1f; border: 1px solid rgba(255, 255, 255, 0.75);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 247, 250, 0.82));
  -webkit-backdrop-filter: blur(14px) saturate(160%); backdrop-filter: blur(14px) saturate(160%);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.95), 0 6px 18px rgba(0, 0, 0, 0.16); }
:host([data-skin="glass"]) .b.ok { color: #1a7f37; } :host([data-skin="glass"]) .b.err { color: #c62828; }
@keyframes p { 50% { opacity: 0.25; } }`);
      root.adoptedStyleSheets = [sheet];
      badgeBox = document.createElement('div');
      badgeBox.className = 'b hide';
      root.appendChild(badgeBox);
      document.documentElement.appendChild(badgeHost);
    }
    badgeHost.setAttribute('data-skin', DM.fieldSkin === 'glass' ? 'glass' : 'classic');
    badgeBox.textContent = text;
    badgeBox.className = 'b ' + (kind || '');
    last = { text, kind: kind || '' };
    const r = el.getBoundingClientRect();
    const w = badgeBox.offsetWidth, h = badgeBox.offsetHeight;
    const x = Math.min(Math.max(4, r.right - w - 6), innerWidth - w - 4);
    let y = r.bottom + 6;
    if (y + h > innerHeight - 4) y = Math.max(4, r.bottom - h - 6);
    badgeBox.style.left = x + 'px';
    badgeBox.style.top = y + 'px';
    if (ms) badgeTimer = setTimeout(() => badgeBox && badgeBox.classList.add('hide'), ms);
  }

  // ---------------------------------------------------------------- 翻译、替换
  /** 交给后台按备用阵列翻译；返回每段译文（漏了的段落是 undefined）。 */
  function request(segments, source, target, lang) {
    return new Promise((resolve, reject) => {
      let port;
      try {
        port = chrome.runtime.connect({ name: 'dm-translate' });
      } catch (e) {
        reject(new Error(T.ui(lang, 'updated')));
        return;
      }
      const out = [];
      let done = false;
      port.onMessage.addListener((m) => {
        if (m.type === 'seg') out[m.i] = m.text;
        else if (m.type === 'done') {
          done = true;
          port.disconnect();
          if (m.usage && DM.session && DM.session.addUsage) DM.session.addUsage(m.usage);
          if (m.error && !out.some(Boolean)) reject(new Error(m.error));
          else resolve(out);
        }
      });
      port.onDisconnect.addListener(() => { if (!done) reject(new Error(T.ui(lang, 'disconnected'))); });
      port.postMessage({ type: 'batch', id: 1, segments, source, target,
        context: ((document.title || '').trim() + ' — ' + location.hostname).slice(0, 160) });
    });
  }

  /** 选中框里全部文字，换成 text（走浏览器的“插入文本”，网页框架能收到改动，Ctrl+Z 能撤回）。 */
  function replace(el, text) {
    el.focus();
    if (isBox(el)) {
      const value = el.localName === 'input' ? text.replace(/\s*\n+\s*/g, ' ') : text;
      el.setSelectionRange(0, el.value.length);
      if (!document.execCommand('insertText', false, value) || el.value !== value) {
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    document.getSelection().selectAllChildren(el);
    const lines = text.split('\n');
    let ok = document.execCommand('insertText', false, lines[0]);
    for (let i = 1; ok && i < lines.length; i++) {
      ok = document.execCommand('insertLineBreak') && (!lines[i] || document.execCommand('insertText', false, lines[i]));
    }
    if (!ok) {
      el.innerText = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  const busy = new WeakSet();

  async function translateField(el) {
    if (busy.has(el) || !el.isConnected) return;
    if (isBox(el) ? el.selectionStart !== el.value.length || el.selectionEnd !== el.value.length : !caretAtEnd(el)) return;
    const before = textOf(el);
    if (!/[  ]{3}$/.test(before)) return;
    const body = before.slice(0, -3);
    const lastLine = body.split('\n').pop();
    if (!/\S/.test(body) || !/\S/.test(lastLine)) return;      // 空的，或者在行首缩进
    let st = {};
    try { st = (await chrome.storage.local.get('settings')).settings || {}; } catch (e) { /* 扩展已更新 */ }
    const native = st.native || T.guessNative(navigator.language);
    const lang = T.uiLang(native);
    const target = st.inputTarget || (native === 'en' ? 'zh-Hans' : 'en');
    const source = native.startsWith('zh') ? 'zh' : native;     // 输入框里打的是母语
    DM.fieldSkin = st.skin;
    const lines = body.split('\n');
    const at = [], segs = [];
    lines.forEach((l, i) => {
      if (/\S/.test(l)) {
        at.push(i);
        segs.push(l.trim());
      }
    });
    busy.add(el);
    badge(el, T.ui(lang, 'fieldBusy'), 'busy');
    try {
      const out = await request(segs, source, target, lang);
      if (textOf(el) !== before) {                              // 翻译的时候又打了字：不替换，免得把新打的字冲掉
        badge(el, T.ui(lang, 'fieldChanged'), 'err', 2600);
        return;
      }
      const res = lines.slice();
      at.forEach((i, k) => {
        const lead = (lines[i].match(/^[ \t ]*/) || [''])[0];
        res[i] = lead + (out[k] !== undefined ? T.stripTags(out[k]) : lines[i].trim());
      });
      replace(el, res.join('\n'));
      badge(el, T.ui(lang, 'fieldDone'), 'ok', 2400);
    } catch (e) {
      badge(el, T.ui(lang, 'fieldFail', { e: e.message || e }), 'err', 4500);
    } finally {
      busy.delete(el);
    }
  }

  // ---------------------------------------------------------------- 连按三次空格
  let taps = [], tapEl = null;

  const aliveRt = (rt) => {
    try { return !!(rt && rt.id); } catch (x) { return false; }
  };
  let myRt = null;

  function onKey(e) {
    if (!aliveRt(myRt)) {
      document.removeEventListener('keydown', onKey, true);    // 扩展更新或卸载了，不再管
      return;
    }
    if (e.key !== ' ' || e.repeat || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
      if (!e.repeat) taps = [];
      return;
    }
    const el = editableOf((e.composedPath && e.composedPath()[0]) || e.target);
    if (!el) {
      taps = [];
      return;
    }
    const now = performance.now();
    if (tapEl !== el || (taps.length && now - taps[taps.length - 1] > GAP)) taps = [];
    tapEl = el;
    taps.push(now);
    if (taps.length >= 3) {
      taps = [];
      setTimeout(() => translateField(el), 0);                  // 等第三个空格打进去
    }
  }

  DM.field = { editableOf, translateField, last: () => last };
  const ext = aliveRt(globalThis.chrome && chrome.runtime);
  if (ext && !aliveRt(DM.fieldRuntime)) {
    if (DM.fieldOff) DM.fieldOff();                             // 更新前的旧监听
    myRt = chrome.runtime;
    DM.fieldRuntime = myRt;
    document.addEventListener('keydown', onKey, true);
    DM.fieldOff = () => document.removeEventListener('keydown', onKey, true);
  }
})();
