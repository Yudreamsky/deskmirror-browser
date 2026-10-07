// 桌面魔镜浏览器版：设置页。界面语言跟“母语”：中文母语中文界面，其他英文界面（和桌面版一样）。
const T = window.__dm.text;
const LLM = window.__dm.llm;

const PRESETS = {
  ollama: { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b' },
  deepseek: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  openai: { protocol: 'openai', baseUrl: '', model: '' },
  mock: { protocol: 'mock', baseUrl: '', model: '' },
};
const DEFAULTS = { preset: 'ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b', apiKey: '',
  source: 'auto' };

const TEXT = {
  zh: {
    title: '桌面魔镜（浏览器版原型）',
    sub: '在网页上放一块镜子：镜框里是同一位置的译文，镜框外照常是原网页。',
    welcome: '欢迎使用！先选好母语和翻译服务，再到任意网页点工具栏上的“镜”图标。',
    updatedTo: '已更新到 {v}',
    langCard: '语言', native: '母语',
    nativeHint: '界面语言跟着母语（中文母语用中文界面，其他用英文界面），译文默认译成母语。',
    source: '原文', target: '译成',
    dirHint: '指定原文后只翻这种文字（比如日文网页上的英文菜单就不翻）。镜框标签上的语言按钮也能随时切换，选了马上按新方向重翻；这里改了，打开着的魔镜也会跟着换。',
    service: '翻译服务', svcLabel: '服务',
    svc_ollama: '本机 Ollama（免费，文字不出本机）',
    svc_openai: '其他 OpenAI 兼容接口（通义千问、硅基流动、LM Studio……）',
    svc_mock: '测试用假翻译（不联网，只看排版）',
    baseUrl: '服务地址', apiKey: 'API Key',
    keyHint: 'Key 只存在这台电脑的 Chrome 扩展存储里（不像桌面版那样用 Windows 账户加密），只发给上面这个服务地址。',
    model: '模型', fetch: '拉取模型', save: '保存', test: '测试连接',
    m_needUrl: '先填服务地址', m_needKey: '先填 API Key', m_noPerm: '没有拿到访问这个地址的权限',
    m_fetching: '正在拉取……', m_empty: '服务没有返回模型列表，请手动填写模型名', m_pick: '从 {n} 个模型里选一个……',
    m_inList: '当前模型 {m} 在列表里', m_notInList: '当前填的 {m} 不在服务的模型列表里，请从列表里选一个',
    m_pickOne: '从列表里选一个模型', m_failed: '拉取失败：{e}', m_chosen: '已选 {m}，记得点“保存”',
    r_noPermSave: '没有拿到访问这个地址的权限，翻译请求会失败', r_saved: '已保存，打开着的魔镜下一批翻译就用新设置',
    r_mockNoTest: '假翻译不用测试', r_testing: '正在请求……', r_ok: '连接正常：{t}', r_fail: '失败：{e}', r_noReply: '没有回应',
    verCard: '版本与更新', check: '检查更新', upgradeTo: '更新到 {v}', verCurrent: '当前版本 {v}',
    verDev: '（开发者模式，从扩展文件夹加载）', u_cantRead: '读不到扩展文件夹里的版本',
    u_new: '有新版本 {n}（正在运行 {r}），点“更新”马上用上；打开着的魔镜会关掉，再点图标打开就是新版本。',
    u_latest: '已经是最新版本',
    howCard: '怎么用',
    how: [
      '点工具栏上的“镜”图标，或按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>，在当前网页打开魔镜；再按一次关掉。',
      '拖动镜子上方的深色标签移动；拖蓝色边框调整大小。',
      '点标签上的语言按钮（如“自动→中”）换翻译方向；按住 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> 看原文。',
      '镜子里的链接、按钮、输入框照常能点，点到的是下面的真网页。',
      'Chrome 自带的 PDF 阅读器、chrome:// 页面、应用商店页面里放不进魔镜。',
    ],
  },
  en: {
    title: 'DeskMirror (browser preview)',
    sub: 'Put a mirror on any web page: inside the frame the same spot shows the translation; outside, the page stays as it is.',
    welcome: 'Welcome! Pick your language and a translation service, then click the mirror icon in the toolbar on any web page.',
    updatedTo: 'Updated to {v}',
    langCard: 'Languages', native: 'Your language',
    nativeHint: 'The interface follows your language (Chinese or English), and translations go into it by default.',
    source: 'Original', target: 'Translate into',
    dirHint: 'With a specific original language, only text in that language is translated (for example, English menus on a Japanese page stay as they are). The language button on the mirror\'s tab switches directions any time and re-translates right away; changes here apply to open mirrors too.',
    service: 'Translation service', svcLabel: 'Service',
    svc_ollama: 'Ollama on this PC (free; text stays on this PC)',
    svc_openai: 'Other OpenAI-compatible API (Qwen, SiliconFlow, LM Studio, …)',
    svc_mock: 'Fake translation for testing (offline, layout only)',
    baseUrl: 'Address', apiKey: 'API key',
    keyHint: 'The key is kept only in Chrome\'s extension storage on this PC (not encrypted with your Windows account like the desktop app) and is sent only to the address above.',
    model: 'Model', fetch: 'Get models', save: 'Save', test: 'Test connection',
    m_needUrl: 'Fill in the address first', m_needKey: 'Fill in the API key first', m_noPerm: 'No permission to access this address',
    m_fetching: 'Getting the model list…', m_empty: 'The service returned no models; type the model name yourself',
    m_pick: 'Pick one of {n} models…', m_inList: '{m} is available',
    m_notInList: '{m} isn\'t in the service\'s model list; pick one from the list',
    m_pickOne: 'Pick a model from the list', m_failed: 'Couldn\'t get the list: {e}', m_chosen: 'Selected {m}; remember to click Save',
    r_noPermSave: 'No permission for this address; translation requests will fail',
    r_saved: 'Saved. Open mirrors use the new settings from the next batch',
    r_mockNoTest: 'Nothing to test for the fake translation', r_testing: 'Sending a test request…', r_ok: 'Works: {t}',
    r_fail: 'Failed: {e}', r_noReply: 'no reply',
    verCard: 'Version and updates', check: 'Check for updates', upgradeTo: 'Update to {v}', verCurrent: 'Version {v}',
    verDev: ' (developer mode, loaded from the extension folder)', u_cantRead: 'Can\'t read the version in the extension folder',
    u_new: 'Version {n} is ready (running {r}). Click Update to switch; open mirrors close, and the icon then opens the new version.',
    u_latest: 'You have the latest version',
    howCard: 'How to use',
    how: [
      'Click the mirror icon in the toolbar, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>, to open the mirror on the current page; again to close it.',
      'Drag the dark tab above the mirror to move it; drag the blue border to resize it.',
      'Click the language button on the tab (e.g. "Auto→EN") to switch directions; hold <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> to peek at the original.',
      'Links, buttons and input boxes inside the mirror still work; clicks go to the real page underneath.',
      'The mirror can\'t open in Chrome\'s built-in PDF viewer, chrome:// pages or the Web Store.',
    ],
  },
};

const $ = (id) => document.getElementById(id);
let lang = 'zh';
let saved = {};

function t(key, vars) {
  let s = (TEXT[lang] && TEXT[lang][key]) || TEXT.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
  return s;
}

/** 按当前界面语言把页面上的字都写一遍。 */
function render() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('how').innerHTML = TEXT[lang].how.map((h) => '<li>' + h + '</li>').join('');
  const fill = (sel, items, value) => {
    sel.replaceChildren(...items.map(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      return o;
    }));
    sel.value = value;
  };
  const natives = Object.keys(T.NATIVE_NAMES).map((k) => [k, T.NATIVE_NAMES[k]]);
  fill($('native'), natives, $('native').value || saved.native);
  fill($('target'), natives, $('target').value || saved.target);
  fill($('source'), Object.keys(T.SOURCES).map((k) => [k, T.ui(lang, 'src_' + k)]), $('source').value || saved.source || 'auto');
  showVersion();
}

function show(preset) {
  $('fields').hidden = preset === 'mock';
  $('keyRow').hidden = preset === 'ollama';
}

function read() {
  const preset = $('preset').value;
  return {
    preset,
    protocol: PRESETS[preset].protocol,
    baseUrl: $('baseUrl').value.trim(),
    model: $('model').value.trim(),
    apiKey: $('apiKey').value.trim(),
    native: $('native').value,
    source: $('source').value,
    target: $('target').value,
  };
}

function say(id, text, kind) {
  $(id).textContent = text;
  $(id).className = 'msg ' + (kind || '');
}

async function saveSettings(patch) {
  const { settings } = await chrome.storage.local.get('settings');
  saved = Object.assign({}, DEFAULTS, settings || {}, patch);
  await chrome.storage.local.set({ settings: saved });
}

/** 自定义的服务地址要先拿到访问权限（Chrome 会弹窗问一次）。ask=false 时只查不问。 */
async function permit(baseUrl, ask = true) {
  let origin;
  try { origin = new URL(baseUrl).origin; } catch (e) { return true; }
  const want = { origins: [origin + '/*'] };
  if (await chrome.permissions.contains(want)) return true;
  return ask ? chrome.permissions.request(want) : false;
}

// ------------------------------------------------------------------ 语言
$('native').addEventListener('change', async () => {
  const before = saved.native;
  const now = $('native').value;
  // 原来就是译成母语的，跟着换成新的母语
  if ($('target').value === before) $('target').value = now;
  await saveSettings({ native: now, target: $('target').value });
  lang = T.uiLang(now);
  LLM.setUiLang(lang);
  render();
});
for (const id of ['source', 'target']) {
  $(id).addEventListener('change', () => saveSettings({ source: $('source').value, target: $('target').value }));
}

// ------------------------------------------------------------------ 拉取模型
let fetching = 0;

async function fetchModels(ask) {
  const s = read();
  if (s.protocol === 'mock') return;
  if (!s.baseUrl) return say('modelMsg', t('m_needUrl'), 'err');
  if (s.protocol !== 'ollama' && !s.apiKey) return say('modelMsg', t('m_needKey'), 'err');
  if (!(await permit(s.baseUrl, ask))) {
    if (ask) say('modelMsg', t('m_noPerm'), 'err');
    return undefined;
  }
  const my = ++fetching;
  $('fetch').disabled = true;
  say('modelMsg', t('m_fetching'));
  try {
    const list = await LLM.listModels(s);
    if (my !== fetching) return undefined;
    const sel = $('models');
    sel.replaceChildren();
    if (!list.length) {
      sel.hidden = true;
      return say('modelMsg', t('m_empty'), 'err');
    }
    const head = document.createElement('option');
    head.value = '';
    head.textContent = t('m_pick', { n: list.length });
    sel.appendChild(head);
    for (const m of list) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.id + (m.name ? ` (${m.name})` : '') + (m.note ? ' · ' + m.note : '');
      sel.appendChild(o);
    }
    sel.size = Math.min(list.length + 1, 8);
    sel.hidden = false;
    const cur = $('model').value.trim();
    if (list.some((m) => m.id === cur)) {
      sel.value = cur;
      say('modelMsg', t('m_inList', { m: cur }), 'ok');
    } else {
      say('modelMsg', cur ? t('m_notInList', { m: cur }) : t('m_pickOne'), 'err');
    }
  } catch (e) {
    if (my === fetching) {
      $('models').hidden = true;
      say('modelMsg', t('m_failed', { e: e.message || e }), 'err');
    }
  } finally {
    if (my === fetching) $('fetch').disabled = false;
  }
  return undefined;
}

$('models').addEventListener('change', () => {
  const v = $('models').value;
  if (!v) return;
  $('model').value = v;
  say('modelMsg', t('m_chosen', { m: v }), 'ok');
});
$('fetch').addEventListener('click', () => fetchModels(true));
// 填好 Key 就自动拉一次（不弹权限窗口；DeepSeek 和本机地址本来就有权限）
$('apiKey').addEventListener('change', () => fetchModels(false));

// ------------------------------------------------------------------ 服务、保存、测试
$('preset').addEventListener('change', () => {
  const p = PRESETS[$('preset').value];
  if (p.baseUrl || $('preset').value !== 'openai') {
    $('baseUrl').value = p.baseUrl;
    $('model').value = p.model;
  }
  $('models').hidden = true;
  say('modelMsg', '');
  say('result', '');
  show($('preset').value);
  if ($('preset').value === 'ollama' || $('apiKey').value.trim()) fetchModels(false);
});

$('save').addEventListener('click', async () => {
  const s = read();
  if (s.protocol !== 'mock' && !(await permit(s.baseUrl))) return say('result', t('r_noPermSave'), 'err');
  await saveSettings(s);
  return say('result', t('r_saved'), 'ok');
});

$('test').addEventListener('click', async () => {
  const s = read();
  if (s.protocol === 'mock') return say('result', t('r_mockNoTest'), 'ok');
  if (!(await permit(s.baseUrl))) return say('result', t('m_noPerm'), 'err');
  say('result', t('r_testing'));
  const r = await chrome.runtime.sendMessage({ type: 'dm-test', settings: s });
  if (r && r.ok) return say('result', t('r_ok', { t: r.text }), 'ok');
  return say('result', t('r_fail', { e: (r && r.error) || t('r_noReply') }), 'err');
});

// ------------------------------------------------------------------ 版本与更新
// 现在是“开发者模式”从文件夹加载：文件夹里换成新版本后这里能看出来，点“更新”重新加载扩展就用上了。
// 以后发布到网上（扩展商店或 GitHub），再在这里加上检查网上的新版本。
function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/** 从更新记录里取出比 from 新、不比 to 新的条目（中文界面读 CHANGELOG.md，英文读 CHANGELOG.en.md）。 */
async function notesBetween(from, to) {
  let text = '';
  try {
    const file = lang === 'zh' ? 'CHANGELOG.md' : 'CHANGELOG.en.md';
    text = await (await fetch(chrome.runtime.getURL(file), { cache: 'no-store' })).text();
  } catch (e) {
    return [];
  }
  const out = [];
  for (const sec of text.split(/^## /m).slice(1)) {
    const m = /^(\d+\.\d+\.\d+)/.exec(sec);
    if (!m || !newer(m[1], from) || newer(m[1], to)) continue;
    for (const line of sec.split('\n')) if (/^- /.test(line)) out.push(line.slice(2).trim());
  }
  return out;
}

function list(ul, items) {
  ul.replaceChildren(...items.map((x) => {
    const li = document.createElement('li');
    li.textContent = x;
    return li;
  }));
  ul.hidden = !items.length;
}

async function checkUpdate() {
  const running = chrome.runtime.getManifest().version;
  $('upgrade').hidden = true;
  list($('updateNotes'), []);
  let onDisk;
  try {
    onDisk = (await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json()).version;
  } catch (e) {
    return say('updateMsg', t('u_cantRead'), 'err');
  }
  if (!newer(onDisk, running)) return say('updateMsg', t('u_latest'), 'ok');
  say('updateMsg', t('u_new', { n: onDisk, r: running }), 'ok');
  $('upgrade').textContent = t('upgradeTo', { v: onDisk });
  $('upgrade').hidden = false;
  list($('updateNotes'), await notesBetween(running, onDisk));
  return undefined;
}

$('check').addEventListener('click', checkUpdate);
$('upgrade').addEventListener('click', () => chrome.runtime.reload());

let devMode = false;

function showVersion() {
  $('version').textContent = t('verCurrent', { v: chrome.runtime.getManifest().version }) + (devMode ? t('verDev') : '');
}

async function banner() {
  const box = $('banner');
  const v = chrome.runtime.getManifest().version;
  box.replaceChildren();
  if (location.hash === '#welcome') {
    box.textContent = t('welcome');
  } else if (location.hash === '#updated') {
    const b = document.createElement('b');
    b.textContent = t('updatedTo', { v });
    box.appendChild(b);
    const from = new URLSearchParams(location.search).get('from');
    if (from) {
      const ul = document.createElement('ul');
      ul.className = 'notes';
      list(ul, await notesBetween(from, v));
      box.appendChild(ul);
    }
  } else {
    box.hidden = true;
    return;
  }
  box.hidden = false;
}

// ------------------------------------------------------------------ 打开时
async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  saved = Object.assign({}, DEFAULTS, settings || {});
  if (!saved.native) saved.native = T.guessNative(chrome.i18n.getUILanguage());
  if (!saved.target) saved.target = saved.native;
  lang = T.uiLang(saved.native);
  LLM.setUiLang(lang);
  try { devMode = (await chrome.management.getSelf()).installType === 'development'; } catch (e) { /* 没有这个接口 */ }
  $('native').value = '';
  render();
  $('native').value = saved.native;
  $('target').value = saved.target;
  $('source').value = saved.source || 'auto';
  $('preset').value = saved.preset in PRESETS ? saved.preset : 'openai';
  $('baseUrl').value = saved.baseUrl;
  $('model').value = saved.model;
  $('apiKey').value = saved.apiKey;
  show($('preset').value);
  banner();
  checkUpdate();
  // 第一次打开就把母语存下来（以后界面和译文都按它）
  if (!settings || !settings.native) saveSettings({ native: saved.native, target: saved.target });
  if (saved.protocol !== 'mock' && (saved.protocol === 'ollama' || saved.apiKey)) fetchModels(false);
}

// 镜框标签上换了语言方向，这里也跟着显示
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const n = changes.settings.newValue || {};
  saved = Object.assign({}, saved, n);
  if (n.source && n.source !== $('source').value) $('source').value = n.source;
  if (n.target && n.target !== $('target').value) $('target').value = n.target;
});

load();
