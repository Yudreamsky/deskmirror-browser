// 桌面魔镜浏览器版：后台。点图标或按快捷键时把魔镜放进当前标签页（第二次就关掉），
// 替内容脚本请求翻译服务（内容脚本在网页里，跨域请求要由后台发），流式把每段译文送回去。
importScripts('content/text.js', 'llm.js');

const T = self.__dm.text;
const LLM = self.__dm.llm;
const CONTENT = ['content/text.js', 'content/copy.js', 'content/units.js', 'content/frame.js', 'content/main.js'];

const DEFAULTS = {
  protocol: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma4:12b',
  apiKey: '',
  source: 'auto',
};

async function settings() {
  const { settings: s } = await chrome.storage.local.get('settings');
  const out = Object.assign({}, DEFAULTS, s || {});
  if (!out.native) out.native = T.guessNative(chrome.i18n.getUILanguage());
  if (!out.target) out.target = out.native;
  LLM.setUiLang(T.uiLang(out.native));   // 错误提示跟界面语言
  return out;
}

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

// 第一次装好：打开设置页选母语和翻译服务；版本变了（更新）：打开设置页说明更新了什么
function onInstalled({ reason, previousVersion }) {
  const v = chrome.runtime.getManifest().version;
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
  else if (reason === 'update' && previousVersion && previousVersion !== v) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?from=' + encodeURIComponent(previousVersion) + '#updated') });
  }
}
chrome.runtime.onInstalled.addListener(onInstalled);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dm-translate') return;
  const running = new Map();
  const post = (msg) => {
    try { port.postMessage(msg); } catch (e) { /* 页面已关 */ }
  };
  port.onMessage.addListener(async (m) => {
    if (!m || m.type !== 'batch') return;
    const cfg = await settings();
    const ac = new AbortController();
    running.set(m.id, ac);
    try {
      if (cfg.protocol === 'mock') {
        m.segments.forEach((s, i) => post({ type: 'seg', id: m.id, i, text: T.mockTranslate(s, m.target, 'zh') }));
      } else {
        await LLM.translateBatch(T, cfg, m, (i, text) => post({ type: 'seg', id: m.id, i, text }), ac.signal);
      }
      post({ type: 'done', id: m.id });
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

// 设置页的“测试连接”
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (!m || m.type !== 'dm-test') return undefined;
  const cfg = Object.assign({}, DEFAULTS, m.settings || {});
  if (!cfg.native) cfg.native = T.guessNative(chrome.i18n.getUILanguage());
  LLM.setUiLang(T.uiLang(cfg.native));
  LLM.testConnection(T, cfg, cfg.target || cfg.native)
    .then((text) => reply({ ok: true, text }))
    .catch((e) => reply({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
