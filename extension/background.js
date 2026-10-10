// 桌面魔镜浏览器版：后台。点图标或按快捷键时把魔镜放进当前标签页（第二次就关掉）；
// 设置里打开“所有网页默认显示魔镜气泡”后，登记内容脚本，网页一打开就放一个气泡。
// 替内容脚本请求翻译服务（内容脚本在网页里，跨域请求要由后台发），流式把每段译文送回去。
// 翻译服务可以排成备用阵列（chain.js）：前一个出错就换下一个，镜框标签上显示正在用哪个备用。
importScripts('content/text.js', 'presets.js', 'chain.js', 'llm.js');

const T = self.__dm.text;
const PS = self.__dm.presets;
const C = self.__dm.chain;
const LLM = self.__dm.llm;
const CONTENT = ['content/text.js', 'content/copy.js', 'content/units.js', 'content/frame.js', 'content/field.js', 'content/main.js'];
// 自动放进网页的那一组：前面多一个 auto.js，告诉 main.js 只放气泡
const AUTO_ID = 'dm-auto';
const AUTO_JS = ['content/auto.js', ...CONTENT];
const ALL_SITES = ['https://*/*', 'http://*/*'];

const DEFAULTS = {
  protocol: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma4:12b',
  apiKey: '',
  source: 'auto',
};

// 后面还有备用时才限时：第一段译文最多等多久、两段之间最多隔多久（毫秒）。本机模型第一次要加载，给得长些。
const TIMEOUTS = { first: 30000, between: 30000, firstLocal: 90000, betweenLocal: 60000 };

async function settings() {
  const { settings: s } = await chrome.storage.local.get('settings');
  const out = Object.assign({}, DEFAULTS, s || {});
  if (!out.native) out.native = T.guessNative(chrome.i18n.getUILanguage());
  if (!out.target) out.target = out.native;
  LLM.setUiLang(T.uiLang(out.native));   // 错误提示跟界面语言
  return out;
}

// ------------------------------------------------------------------ 出错记录
// 引擎键 → { until, fails, hard, error, at }。也存进 storage.session（后台休眠再醒来还在，设置页能显示），
// 浏览器关掉就清空；设置页点“保存”也清空，重新从主力试起。
let health = null;

async function healthNow() {
  if (!health) {
    try { health = (await chrome.storage.session.get('health')).health || {}; } catch (e) { health = {}; }
  }
  return health;
}

function keepHealth() {
  chrome.storage.session.set({ health }).catch(() => {});
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const o = changes.settings.oldValue || {}, n = changes.settings.newValue || {};
  if (o.savedAt !== n.savedAt) {
    health = {};
    keepHealth();
  }
  if (!!o.autoBubble !== !!n.autoBubble) syncAuto(!!n.autoBubble);
});

// ------------------------------------------------------------------ 所有网页默认显示魔镜气泡
// 打开了、也拿到了访问所有网站的权限：登记一组内容脚本（只在顶层页面、网页加载完以后），已经开着的网页也补一个气泡。
// 关掉或权限被收回：取消登记；网页上只是气泡的，内容脚本看到设置变了自己拿掉。
let autoQueue = Promise.resolve();

/** 按设置登记或取消；fill：顺便给已经开着的网页补气泡。一个接一个做，免得重复登记。 */
function syncAuto(fill) {
  autoQueue = autoQueue.then(() => applyAuto(fill)).catch((e) => console.warn('默认气泡：', e && e.message));
  return autoQueue;
}

async function applyAuto(fill) {
  const { settings: s } = await chrome.storage.local.get('settings');
  const want = !!(s && s.autoBubble) && await chrome.permissions.contains({ origins: ALL_SITES });
  const have = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_ID] });
  if (!want) {
    if (have.length) await chrome.scripting.unregisterContentScripts({ ids: [AUTO_ID] });
    return false;
  }
  const script = { id: AUTO_ID, matches: ALL_SITES, js: AUTO_JS, runAt: 'document_idle', allFrames: false, persistAcrossSessions: true };
  if (!have.length) await chrome.scripting.registerContentScripts([script]);
  else if (JSON.stringify(have[0].js) !== JSON.stringify(AUTO_JS)) await chrome.scripting.updateContentScripts([script]);
  // 补气泡不排在队里等：冻结的后台标签页可能一直不回话，不能卡住后面的登记、取消
  if (fill) fillTabs().catch(() => {});
  return true;
}

/** 已经开着的网页补气泡：魔镜脚本还活着的发消息让它自己放；没放过的（或扩展更新后旧脚本失效了的）放进去。 */
async function fillTabs() {
  const tabs = await chrome.tabs.query({ url: ALL_SITES, discarded: false });
  await Promise.all(tabs.map(async (t) => {
    try {
      await chrome.tabs.sendMessage(t.id, { type: 'dm-dock' });
      return;
    } catch (e) { /* 还没放进去 */ }
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: AUTO_JS });
    } catch (e) { /* 放不进去的页面 */ }
  }));
}

chrome.permissions.onAdded.addListener(() => syncAuto(false));
chrome.permissions.onRemoved.addListener(() => syncAuto(false));
chrome.runtime.onStartup.addListener(() => syncAuto(false));

// ------------------------------------------------------------------ 开关
async function flash(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d9534f' });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 2500);
  } catch (e) { /* 标签页已关 */ }
}

async function toggle(tab) {
  if (!tab || tab.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'dm-toggle' });
    return;
  } catch (e) { /* 还没放进这个页面 */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT });
  } catch (e) {
    // chrome:// 页面、应用商店、Chrome 自带的 PDF 阅读器等，扩展不能放东西进去
    console.warn('魔镜放不进这个页面：', e && e.message);
    flash(tab.id, '×');
  }
}

chrome.action.onClicked.addListener(toggle);
chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'toggle-mirror') toggle(tab);
});

// 第一次装好：打开设置页选母语和翻译服务；版本变了（更新）：打开设置页说明更新了什么。
// 从商店装的（installType 不是 development）由 Chrome 自动更新：只有前两位变了（如 0.4 → 0.5）才打开，修补版不打扰
function showUpdate(prev, cur, installType) {
  if (!prev || prev === cur) return false;
  if (installType === 'development') return true;
  const minor = (v) => String(v).split('.').slice(0, 2).join('.');
  return minor(prev) !== minor(cur);
}

async function onInstalled({ reason, previousVersion }) {
  const v = chrome.runtime.getManifest().version;
  syncAuto(reason === 'update');     // 更新后开着的网页上旧气泡失效了，补上新的
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
    return;
  }
  if (reason !== 'update') return;
  let type = 'development';
  try { type = (await chrome.management.getSelf()).installType; } catch (e) { /* 没有这个接口 */ }
  if (showUpdate(previousVersion, v, type)) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?from=' + encodeURIComponent(previousVersion) + '#updated') });
  }
}
chrome.runtime.onInstalled.addListener(onInstalled);

// ------------------------------------------------------------------ 翻译
/** 用一个服务翻译 req（假翻译直接在这里出结果，不算用量）；meter 填上这一次发送、接收的 token。 */
function runEngine(e, req, onSeg, signal, meter) {
  if (e.protocol === 'mock') {
    req.segments.forEach((s, i) => onSeg(i, T.mockTranslate(s, req.target, 'zh')));
    return Promise.resolve(req.segments.length);
  }
  return LLM.translateBatch(T, e, req, onSeg, signal, meter);
}

/** 这一批所有尝试（包括出错换下一个之前的）加起来的用量；一次都没真正发出去就是 undefined。 */
function usageOf(meters) {
  const done = meters.filter((m) => m.in !== undefined);
  if (!done.length) return undefined;
  return { in: done.reduce((a, m) => a + m.in, 0), out: done.reduce((a, m) => a + m.out, 0), est: done.some((m) => m.est),
    n: done.length };
}

function limitOf(e) {
  return PS.isLocal(e) ? { first: TIMEOUTS.firstLocal, between: TIMEOUTS.betweenLocal } : { first: TIMEOUTS.first, between: TIMEOUTS.between };
}

function timeoutError(ms) {
  const e = new Error(LLM.msg(Math.round(ms / 1000) + ' 秒没有收到译文', 'No translation for ' + Math.round(ms / 1000) + ' s'));
  e.timeout = true;
  return e;
}

function emptyError() {
  return new Error(LLM.msg('服务有回应，但没有返回译文', 'The service answered but returned no translation'));
}

/** 都失败了：只有一个服务时就是它的错误；几个的话逐个列出（①…；②…）。 */
function summary(errors) {
  if (errors.length === 1) return String(errors[0].err.message || errors[0].err);
  return LLM.msg('都失败了：', 'All failed: ')
    + errors.map(({ idx, err }) => T.circled(idx + 1) + ' ' + (err.message || err)).join(LLM.msg('；', '; '));
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dm-translate') return;
  const running = new Map();
  let shown = 'main';                  // 镜框上显示的是哪个：主力（不显示），或者“序号|服务”
  const post = (msg) => {
    try { port.postMessage(msg); } catch (e) { /* 页面已关 */ }
  };
  port.onMessage.addListener(async (m) => {
    if (!m || m.type !== 'batch') return;
    const ac = new AbortController();
    running.set(m.id, ac);
    try {
      const s = await settings();
      const lang = T.uiLang(s.native);
      const chain = PS.chainOf(s);
      const h = await healthNow();
      // 换了服务（换成备用、或回到主力）就告诉内容脚本：标签上显示，本机模型一次一批
      const announce = (idx) => {
        const e = chain[idx];
        const tag = idx === 0 ? 'main' : idx + '|' + C.keyOf(e);
        if (tag === shown) return;
        shown = tag;
        const why = idx > 0 ? h[C.keyOf(chain[0])] : null;
        post({ type: 'engine', idx, total: chain.length, label: PS.engineLabel(e, lang), model: e.protocol === 'mock' ? '' : e.model,
          local: PS.isLocal(e), primary: PS.engineLabel(chain[0], lang), reason: why ? why.error : '' });
      };
      const meters = [];
      const run = (e, req, onSeg, signal) => {
        const meter = {};
        meters.push(meter);
        return runEngine(e, req, onSeg, signal, meter);
      };
      const r = await C.translate({
        chain, health: h, now: Date.now(), req: m, signal: ac.signal, run, limitOf, timeoutError, emptyError,
        onSeg: (i, text) => post({ type: 'seg', id: m.id, i, text }),
        onUse: announce,
      });
      keepHealth();
      post({ type: 'done', id: m.id, error: r.ok ? undefined : summary(r.errors), usage: usageOf(meters) });
    } catch (e) {
      if (!ac.signal.aborted) post({ type: 'done', id: m.id, error: String((e && e.message) || e) });
    } finally {
      running.delete(m.id);
    }
  });
  port.onDisconnect.addListener(() => {
    for (const ac of running.values()) ac.abort();
    running.clear();
  });
});

// 设置页的“测试连接”：试阵列里的一个服务；能用就清掉它的出错记录
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (!m || m.type !== 'dm-test') return undefined;
  const st = m.settings || {};
  const native = st.native || T.guessNative(chrome.i18n.getUILanguage());
  const e = PS.chainOf({ chain: [Object.assign({}, DEFAULTS, st)] })[0];
  LLM.setUiLang(T.uiLang(native));
  LLM.testConnection(T, e, st.target || native)
    .then(async (text) => {
      const h = await healthNow();
      if (h[C.keyOf(e)]) {
        delete h[C.keyOf(e)];
        keepHealth();
      }
      reply({ ok: true, text });
    })
    .catch((err) => reply({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
