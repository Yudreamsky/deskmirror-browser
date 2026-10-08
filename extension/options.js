// 桌面魔镜浏览器版：设置页。界面语言跟“母语”：中文母语中文界面，其他英文界面（和桌面版一样）。
const T = window.__dm.text;
const LLM = window.__dm.llm;
const PS = window.__dm.presets;
const C = window.__dm.chain;
const preset = (id) => PS.byId[id] || PS.byId['openai-custom'];
const DEFAULTS = { preset: 'ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b', apiKey: '',
  source: 'auto' };

const TEXT = {
  zh: {
    title: '桌面魔镜（浏览器版）',
    sub: '在网页上放一块镜子：镜框里是同一位置的译文，镜框外照常是原网页。',
    welcome: '欢迎使用！先选好母语和翻译服务，再到任意网页点工具栏上的“镜”图标。',
    updatedTo: '已更新到 {v}',
    langCard: '语言', native: '母语',
    nativeHint: '界面语言跟着母语（中文母语用中文界面，其他用英文界面），译文默认译成母语。',
    source: '原文', target: '译成',
    inputTarget: '输入框翻译成',
    inputHint: '在网页的输入框里连按三次空格，把框里的字翻译成这种语言并直接替换（按 Ctrl+Z 撤回）。在打开过魔镜的网页上才能用，打开后关掉魔镜也行。',
    dirHint: '指定原文后只翻这种文字（比如日文网页上的英文菜单就不翻）。镜框标签上的语言按钮也能随时切换，选了马上按新方向重翻；这里改了，打开着的魔镜也会跟着换。',
    lookCard: '外观', skinClassic: '经典（和桌面版一样）', skinGlass: '液态玻璃',
    skinHint: '镜框、标签和气泡的样子；液态玻璃跟着系统的浅色 / 深色。打开着的魔镜马上跟着换。标签上的“–”能把魔镜收起成气泡，拖到页面左右边缘会自动吸附，点一下弹回来。',
    service: '翻译服务', svcLabel: '服务',
    chainHint: '可以排好几个服务：按顺序用，前一个出错（额度用完、Key 不对、模型下线、连不上、太慢）就自动换下一个，已经译好的不重翻；出错的过一会儿再回头试。',
    primary: '主力', backup: '备用', add: '＋ 添加备用', testAll: '测试全部', editing: '下面改的是 {n} {r}',
    up: '上移', down: '下移', remove: '删除', unsaved: '有改动，还没保存',
    s_ok: '✓ 能用（{s} 秒）：{t}', s_skip: '⏸ 暂时跳过，{m} 分钟后再试：{e}',
    r_incomplete: '{n} 还没填{what}', r_savedNoKey: '已保存。{n} 还没填 API Key，轮到它时会失败',
    w_url: '服务地址', w_model: '模型名',
    baseUrl: '服务地址', apiKey: 'API Key',
    keyHint: 'Key 只存在这台电脑的 Chrome 扩展存储里（不像桌面版那样用 Windows 账户加密），只发给上面这个服务地址。',
    model: '模型', fetch: '拉取模型', save: '保存', test: '测试连接', site: '开通 / 获取 Key ↗', modelHint: '例如 {m}',
    m_auto: '已自动选了 {m}（轻量、适合翻译），可以从列表里换；记得点“保存”', m_cloudOnly: '只列出 :cloud 云端模型（本机 Ollama 要先登录账号）',
    m_permFirst: '点“拉取模型”列出可用模型（第一次会请求访问这个地址的权限）',
    m_probing: '正在试哪些云端模型你的账号现在能用……', m_probeOk: '你的账号现在能用 {m}，已选上；不能用的：{bad}',
    m_probeNone: '这些云端模型你的账号现在都用不了（订阅到期或免费额度不含），请换本机模型或别的服务', m_paid: '要付费额度', m_gone: '已下线',
    m_needUrl: '先填服务地址', m_needKey: '先填 API Key', m_noPerm: '没有拿到访问这个地址的权限',
    m_fetching: '正在拉取……', m_empty: '服务没有返回模型列表，请手动填写模型名', m_pick: '从 {n} 个模型里选一个……',
    m_inList: '当前模型 {m} 在列表里', m_notInList: '当前填的 {m} 不在服务的模型列表里，请从列表里选一个',
    m_pickOne: '从列表里选一个模型', m_failed: '拉取失败：{e}', m_chosen: '已选 {m}，记得点“保存”',
    r_noPermSave: '没有拿到访问这个地址的权限，翻译请求会失败', r_saved: '已保存，打开着的魔镜下一批翻译就用新设置',
    r_mockNoTest: '假翻译不用测试', r_testing: '正在请求……', r_ok: '连接正常：{t}', r_fail: '失败：{e}', r_noReply: '没有回应',
    verCard: '版本与更新', check: '检查更新', upgradeTo: '更新到 {v}', verCurrent: '当前版本 {v}',
    verDev: '（开发者模式，从扩展文件夹加载）', u_cantRead: '读不到扩展文件夹里的版本', u_store: 'Chrome 会自动更新到新版本',
    u_new: '有新版本 {n}（正在运行 {r}），点“更新”马上用上；打开着的魔镜会关掉，再点图标打开就是新版本。',
    u_latest: '已经是最新版本',
    howCard: '怎么用',
    aboutCard: '关于', email: '意见反馈：', copyMail: '复制邮箱', copied: '已复制', mailSubject: '桌面魔镜浏览器版 {v} 反馈',
    desktop: '桌面版（Windows；软件、游戏、视频字幕都能翻）：', reward: '打赏作者',
    thanks: '桌面魔镜浏览器版免费，所有功能都能用。如果它帮到了你，可以请作者喝杯咖啡。',
    scan: '用微信扫一扫', optional: '完全自愿，不解锁任何功能，不打赏也一样用。', kofi: '海外用户：{link}（可用 PayPal 或银行卡）',
    how: [
      '点工具栏上的“镜”图标，或按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>，在当前网页打开魔镜；再按一次关掉。',
      '拖动镜子上方的深色标签移动；拖蓝色边框调整大小。',
      '点标签上的语言按钮（如“自动→中”）换翻译方向；按住 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> 看原文。',
      '镜子里的链接、按钮、输入框照常能点，点到的是下面的真网页。',
      '在输入框里连按三次空格，把框里的字翻译成“输入框翻译成”的语言（Ctrl+Z 撤回）。',
      'Chrome 自带的 PDF 阅读器、chrome:// 页面、应用商店页面里放不进魔镜。',
    ],
  },
  en: {
    title: 'DeskMirror for browsers',
    sub: 'Put a mirror on any web page: inside the frame the same spot shows the translation; outside, the page stays as it is.',
    welcome: 'Welcome! Pick your language and a translation service, then click the mirror icon in the toolbar on any web page.',
    updatedTo: 'Updated to {v}',
    langCard: 'Languages', native: 'Your language',
    nativeHint: 'The interface follows your language (Chinese or English), and translations go into it by default.',
    source: 'Original', target: 'Translate into',
    inputTarget: 'Translate input boxes into',
    inputHint: 'Press Space three times in a text box on a page to translate what you typed into this language and replace it (Ctrl+Z undoes it). Works on pages where you have opened the mirror, even after you close it.',
    dirHint: 'With a specific original language, only text in that language is translated (for example, English menus on a Japanese page stay as they are). The language button on the mirror\'s tab switches directions any time and re-translates right away; changes here apply to open mirrors too.',
    lookCard: 'Appearance', skinClassic: 'Classic (like the desktop app)', skinGlass: 'Liquid Glass',
    skinHint: 'How the frame, tab and bubble look; Liquid Glass follows the system light or dark mode. Open mirrors switch right away. The "–" on the tab collapses the mirror into a bubble that snaps to the left or right edge; click it to bring the mirror back.',
    service: 'Translation service', svcLabel: 'Service',
    chainHint: 'You can line up several services. They are used in order: when one fails (out of credit, wrong key, model retired, unreachable, too slow), the next one takes over without redoing finished text, and the failed one is retried after a while.',
    primary: 'Main', backup: 'Backup', add: '+ Add a backup', testAll: 'Test all', editing: 'Editing {n} {r}',
    up: 'Move up', down: 'Move down', remove: 'Remove', unsaved: 'Unsaved changes',
    s_ok: '✓ Works ({s} s): {t}', s_skip: '⏸ Skipped for now; retrying in {m} min: {e}',
    r_incomplete: '{n} needs {what}', r_savedNoKey: 'Saved. {n} has no API key yet, so it will fail when its turn comes',
    w_url: 'an address', w_model: 'a model name',
    baseUrl: 'Address', apiKey: 'API key',
    keyHint: 'The key is kept only in Chrome\'s extension storage on this PC (not encrypted with your Windows account like the desktop app) and is sent only to the address above.',
    model: 'Model', fetch: 'Get models', save: 'Save', test: 'Test connection', site: 'Sign up / get a key ↗', modelHint: 'e.g. {m}',
    m_auto: 'Picked {m} (light and good for translation); you can choose another from the list. Remember to click Save',
    m_cloudOnly: 'Only :cloud models are listed (sign in to Ollama on this PC first)',
    m_permFirst: 'Click "Get models" to list the models (the first time Chrome asks for access to this address)',
    m_probing: 'Checking which cloud models your account can use now…', m_probeOk: 'Your account can use {m} now, so it is selected; unavailable: {bad}',
    m_probeNone: 'Your account cannot use any of these cloud models now (subscription expired or not in the free tier); pick a local model or another service',
    m_paid: 'needs paid usage', m_gone: 'retired',
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
    u_store: 'Chrome keeps it up to date automatically',
    u_new: 'Version {n} is ready (running {r}). Click Update to switch; open mirrors close, and the icon then opens the new version.',
    u_latest: 'You have the latest version',
    howCard: 'How to use',
    aboutCard: 'About', email: 'Feedback: ', copyMail: 'Copy', copied: 'Copied', mailSubject: 'DeskMirror for browsers {v} feedback',
    desktop: 'Desktop version (Windows; translates apps, games and video subtitles): ', reward: 'Support the author',
    thanks: 'DeskMirror for browsers is free, with every feature included. If it helps you, you can buy the author a coffee.',
    scan: 'Scan with WeChat', optional: 'Entirely optional: it unlocks nothing, and everything works the same without it.',
    kofi: 'Buy me a coffee on {link} (PayPal or card)',
    how: [
      'Click the mirror icon in the toolbar, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>, to open the mirror on the current page; again to close it.',
      'Drag the dark tab above the mirror to move it; drag the blue border to resize it.',
      'Click the language button on the tab (e.g. "Auto→EN") to switch directions; hold <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> to peek at the original.',
      'Links, buttons and input boxes inside the mirror still work; clicks go to the real page underneath.',
      'Press Space three times in a text box to translate it into the "Translate input boxes into" language (Ctrl+Z undoes it).',
      'The mirror can\'t open in Chrome\'s built-in PDF viewer, chrome:// pages or the Web Store.',
    ],
  },
};

const $ = (id) => document.getElementById(id);
let lang = 'zh';
let saved = {};
let chain = [];                 // 备用阵列（正在编辑的，第一个是主力；点“保存”才存下）
let cur = 0;                    // 下面的表单正在改阵列里第几个
let health = {};                // 后台记的出错记录：跳过到什么时候（storage.session）
const tested = new WeakMap();   // 阵列里的服务 → 测试结果
let dirty = false;

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
  const pv = chain[cur] ? chain[cur].preset : $('preset').value || saved.preset;
  $('preset').replaceChildren(...PS.GROUPS.map(([g, zh, en]) => {
    const og = document.createElement('optgroup');
    og.label = lang === 'zh' ? zh : en;
    for (const p of PS.PRESETS.filter((x) => x.group === g)) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name[lang === 'zh' ? 0 : 1];
      og.appendChild(o);
    }
    return og;
  }));
  if (pv) $('preset').value = pv;
  show($('preset').value);
  const natives = Object.keys(T.NATIVE_NAMES).map((k) => [k, T.NATIVE_NAMES[k]]);
  fill($('native'), natives, $('native').value || saved.native);
  fill($('target'), natives, $('target').value || saved.target);
  fill($('inputTarget'), natives, $('inputTarget').value || saved.inputTarget || (saved.native === 'en' ? 'zh-Hans' : 'en'));
  fill($('source'), Object.keys(T.SOURCES).map((k) => [k, T.ui(lang, 'src_' + k)]), $('source').value || saved.source || 'auto');
  if (dirty) $('unsaved').textContent = t('unsaved');
  drawChain();
  showVersion();
  // 反馈邮件的标题带上版本号
  $('mail').href = 'mailto:' + $('mail').textContent + '?subject='
    + encodeURIComponent(t('mailSubject', { v: chrome.runtime.getManifest().version }));
  // 打赏：英文界面 Ko-fi 放最前面（和桌面版一样）
  $('rewardBody').classList.toggle('en', lang !== 'zh');
  const [before, after] = t('kofi').split('{link}');
  const a = document.createElement('a');
  a.href = KOFI_URL;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Ko-fi';
  $('kofi').replaceChildren(before, a, after || '');
}

const KOFI_URL = 'https://ko-fi.com/dreamskyu';

$('copyMail').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('mail').textContent);
    $('copyMail').textContent = t('copied');
  } catch (e) { /* 剪贴板不让写：邮箱就在旁边，手动复制 */ }
});

function show(id) {
  const p = preset(id);
  $('fields').hidden = p.protocol === 'mock';
  $('keyRow').hidden = !p.key;
  const note = p.note ? p.note[lang === 'zh' ? 0 : 1] : '';
  $('presetNote').textContent = note;
  $('presetNote').hidden = !note;
  $('site').hidden = !p.site;
  if (p.site) {
    $('site').href = p.site;
    $('site').textContent = t('site') + '  ' + p.site.replace(/^https?:\/\//, '');
  }
  $('model').placeholder = p.hint ? t('modelHint', { m: p.hint }) : '';
}

function read() {
  const id = $('preset').value;
  const p = preset(id);
  return {
    preset: id,
    protocol: p.protocol,
    extra: p.extra || null,
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

// ------------------------------------------------------------------ 备用阵列
// 列表里每一行是一个服务；点一行，下面的表单就改它。上移、下移、删除、添加都先记在这里，点“保存”才存下。

function roleOf(i) {
  return t(i === 0 ? 'primary' : 'backup');
}

/** 这一行下面显示什么：测试结果；或者后台记着它出错了、暂时跳过。 */
function stateOf(e, now) {
  const r = tested.get(e);
  if (r) return r;
  const h = C.skipped(health, e, now);
  if (h) return { kind: 'skip', text: t('s_skip', { m: Math.max(1, Math.ceil((h.until - now) / 60000)), e: h.error }) };
  return null;
}

function drawChain() {
  if (!chain.length) return;
  const now = Date.now();
  const span = (cls, text) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };
  const btn = (text, title, hide, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini' + (hide ? ' hide' : '');
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      fn();
    });
    return b;
  };
  $('chain').classList.toggle('many', chain.length > 1);
  $('chain').replaceChildren(...chain.map((e, i) => {
    const row = document.createElement('div');
    row.className = 'eng' + (i === cur ? ' sel' : '');
    const top = document.createElement('div');
    top.className = 'top';
    const name = span('name', PS.engineLabel(e, lang));
    name.title = name.textContent;
    top.append(span('num', T.circled(i + 1)), span('role', roleOf(i)), name,
      btn('↑', t('up'), i === 0, () => move(i, -1)), btn('↓', t('down'), i === chain.length - 1, () => move(i, 1)),
      btn('✕', t('remove'), chain.length < 2, () => remove(i)));
    row.appendChild(top);
    const st = stateOf(e, now);
    if (st) {
      const line = span('state ' + st.kind, st.text);
      line.title = st.text;
      row.appendChild(line);
    }
    row.addEventListener('click', () => select(i));
    return row;
  }));
  $('addEngine').hidden = chain.length >= PS.MAX_CHAIN;
  $('testAll').hidden = chain.length < 2;
  $('editing').hidden = chain.length < 2;
  $('editing').textContent = t('editing', { n: T.circled(cur + 1), r: roleOf(cur) });
}

function markDirty() {
  dirty = true;
  $('unsaved').textContent = t('unsaved');
}

function same(a, b) {
  return !!(a && b) && a.preset === b.preset && a.baseUrl === b.baseUrl && a.model === b.model && a.apiKey === b.apiKey;
}

/** 表单 → 正在改的那一个。 */
function pull() {
  const id = $('preset').value;
  const p = preset(id);
  const e = { preset: id, protocol: p.protocol, baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim(),
    apiKey: p.key ? $('apiKey').value.trim() : '', extra: p.extra || null };
  if (same(e, chain[cur])) return;
  chain[cur] = e;
  markDirty();
  drawChain();
}

/** 正在改的那一个 → 表单。 */
function push() {
  const e = chain[cur];
  $('preset').value = e.preset;
  $('baseUrl').value = e.baseUrl;
  $('model').value = e.model;
  $('apiKey').value = e.apiKey;
  show(e.preset);
  $('models').hidden = true;
  say('modelMsg', '');
}

/** 填了 Key（或不要 Key）就自动拉一次模型列表（不弹权限窗口）。 */
function autoFetch() {
  const e = chain[cur];
  if (e && e.protocol !== 'mock' && (!preset(e.preset).key || e.apiKey)) fetchModels(false);
}

function switchTo(i) {
  cur = i;
  fetching++;                       // 正在拉的模型列表是上一个服务的，作废
  $('fetch').disabled = false;
  push();
  drawChain();
  say('result', '');
}

function select(i) {
  if (i === cur || i < 0 || i >= chain.length) return;
  switchTo(i);
  autoFetch();
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= chain.length) return;
  [chain[i], chain[j]] = [chain[j], chain[i]];
  if (cur === i) cur = j;
  else if (cur === j) cur = i;
  markDirty();
  drawChain();
}

function remove(i) {
  if (chain.length < 2) return;
  const was = cur;
  chain.splice(i, 1);
  markDirty();
  if (i === was) switchTo(Math.max(0, i - 1));
  else {
    if (i < was) cur--;
    drawChain();
  }
}

/** 每家的 Key 分开记：先找阵列里同一家已经填的，再找保存过的。except：不算阵列里的第几个。 */
function keyFor(id, except) {
  const hit = chain.find((e, i) => i !== except && e.preset === id && e.apiKey);
  if (hit) return hit.apiKey;
  if (saved.keys && saved.keys[id]) return saved.keys[id];
  const old = PS.chainOf(saved).find((e) => e.preset === id && e.apiKey);
  return old ? old.apiKey : '';
}

/** 加一个备用：先挑阵列里还没有的常用服务（本机 Ollama、DeepSeek……）。 */
function addEngine() {
  if (chain.length >= PS.MAX_CHAIN) return;
  const has = new Set(chain.map((e) => e.preset));
  const id = ['ollama', 'deepseek', 'ollama-cloud-local', 'openrouter', 'gemini'].find((x) => !has.has(x)) || 'openai-custom';
  const p = preset(id);
  chain.push({ preset: id, protocol: p.protocol, baseUrl: p.baseUrl, model: p.model, apiKey: p.key ? keyFor(id, -1) : '',
    extra: p.extra || null });
  markDirty();
  switchTo(chain.length - 1);
  autoFetch();
}

/** 保存前检查：每个都要有地址和模型名（假翻译除外）。 */
function incomplete() {
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.protocol === 'mock') continue;
    const miss = [];
    if (!e.baseUrl) miss.push(t('w_url'));
    if (!e.model) miss.push(t('w_model'));
    if (miss.length) return { i, what: miss.join(lang === 'zh' ? '、' : ' and ') };
  }
  return null;
}

/** 阵列里各个服务的地址一次要到访问权限（Chrome 弹一次窗）。ask=false 时只查不问。 */
async function permitAll(list, ask = true) {
  const origins = [];
  for (const e of list) {
    if (e.protocol === 'mock') continue;
    try {
      const o = new URL(e.baseUrl).origin + '/*';
      if (!origins.includes(o)) origins.push(o);
    } catch (x) { /* 没填或不是网址 */ }
  }
  if (!origins.length) return true;
  const want = { origins };
  if (await chrome.permissions.contains(want)) return true;
  return ask ? chrome.permissions.request(want) : false;
}

/** 让后台试一个服务（翻一句话），结果显示在它那一行。 */
async function testOne(e) {
  tested.set(e, { kind: '', text: t('r_testing') });
  drawChain();
  const t0 = performance.now();
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'dm-test',
      settings: Object.assign({}, e, { native: $('native').value, target: $('target').value }) });
  } catch (err) {
    r = { ok: false, error: err.message };
  }
  const ok = !!(r && r.ok);
  const error = ok ? '' : (r && r.error) || t('r_noReply');
  tested.set(e, ok ? { kind: 'ok', text: t('s_ok', { s: ((performance.now() - t0) / 1000).toFixed(1), t: r.text }) }
    : { kind: 'err', text: '✗ ' + error });
  drawChain();
  return { ok, text: ok ? r.text : '', error };
}

async function loadHealth() {
  try { health = (await chrome.storage.session.get('health')).health || {}; } catch (e) { health = {}; }
  drawChain();
}

$('addEngine').addEventListener('click', addEngine);
for (const id of ['baseUrl', 'model', 'apiKey']) $(id).addEventListener('input', pull);
// “x 分钟后再试”跟着走
setInterval(() => { if (Object.keys(health).length) drawChain(); }, 30000);

// ------------------------------------------------------------------ 外观（皮肤）
function showSkin(v) {
  for (const b of document.querySelectorAll('.skin')) b.classList.toggle('on', b.dataset.skin === (v || 'classic'));
}

for (const b of document.querySelectorAll('.skin')) {
  b.addEventListener('click', () => {
    showSkin(b.dataset.skin);
    saveSettings({ skin: b.dataset.skin });
  });
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
$('inputTarget').addEventListener('change', () => saveSettings({ inputTarget: $('inputTarget').value }));

// ------------------------------------------------------------------ 拉取模型
let fetching = 0;

async function fetchModels(ask) {
  const s = read();
  if (s.protocol === 'mock') return;
  if (!s.baseUrl) return say('modelMsg', t('m_needUrl'), 'err');
  if (preset(s.preset).key && !s.apiKey) return say('modelMsg', t('m_needKey'), 'err');
  if (!(await permit(s.baseUrl, ask))) {
    say('modelMsg', ask ? t('m_noPerm') : t('m_permFirst'), ask ? 'err' : '');
    return undefined;
  }
  const my = ++fetching;
  $('fetch').disabled = true;
  say('modelMsg', t('m_fetching'));
  try {
    let list = await LLM.listModels(s);
    if (my !== fetching) return undefined;
    const cloudOnly = s.preset === 'ollama-cloud-local';
    if (cloudOnly) list = list.filter((m) => /cloud$/.test(m.id));
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
      say('modelMsg', t('m_inList', { m: cur }) + (cloudOnly ? '；' + t('m_cloudOnly') : ''), 'ok');
    } else if (cloudOnly) {
      await probeCloud(s, list, my);
    } else if (!cur) {
      const pick = PS.pickModel(list);
      $('model').value = pick;
      sel.value = pick;
      pull();
      say('modelMsg', t('m_auto', { m: pick }), 'ok');
    } else {
      say('modelMsg', t('m_notInList', { m: cur }), 'err');
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

/**
 * Ollama 云端模型：列表里的都“装”着，但订阅到期后大多要付费额度才能用（HTTP 402），有的已下线（410）。
 * 轻量的先试，每个只让它说 1 个字；402/410 立刻返回，不花额度。找到第一个能用的就选上。
 */
async function probeCloud(s, list, my) {
  say('modelMsg', t('m_probing'));
  const light = /flash|mini|air|lite|small|gemma/i;
  const order = [...list].sort((a, b) => (light.test(b.id) ? 1 : 0) - (light.test(a.id) ? 1 : 0));
  const bad = [];
  for (const m of order) {
    if (my !== fetching) return;
    try {
      await LLM.probeModel(s, m.id);
      $('model').value = m.id;
      $('models').value = m.id;
      pull();
      say('modelMsg', t('m_probeOk', { m: m.id, bad: bad.join('、') || '—' }), 'ok');
      return;
    } catch (e) {
      bad.push(m.id + (/402|付费|paid/i.test(e.message) ? '（' + t('m_paid') + '）' : /410|下线|retired/i.test(e.message) ? '（' + t('m_gone') + '）' : ''));
    }
  }
  say('modelMsg', t('m_probeNone'), 'err');
}

$('models').addEventListener('change', () => {
  const v = $('models').value;
  if (!v) return;
  $('model').value = v;
  pull();
  say('modelMsg', t('m_chosen', { m: v }), 'ok');
});
$('fetch').addEventListener('click', () => fetchModels(true));
// 填好 Key 就自动拉一次（不弹权限窗口；DeepSeek 和本机地址本来就有权限）
$('apiKey').addEventListener('change', () => fetchModels(false));

// ------------------------------------------------------------------ 服务、保存、测试
$('preset').addEventListener('change', () => {
  const id = $('preset').value;
  const p = preset(id);
  if (id !== 'openai-custom') {
    $('baseUrl').value = p.baseUrl;
    $('model').value = p.model;
  }
  // 每家的 Key 分开记：换过去显示那家记下的 Key，免得把这家的 Key 发给另一家；不要 Key 的服务不带 Key
  $('apiKey').value = p.key ? keyFor(id, cur) : '';
  $('models').hidden = true;
  say('modelMsg', '');
  say('result', '');
  show(id);
  pull();
  if (!p.key || $('apiKey').value.trim()) fetchModels(false);
});

// 保存整个阵列；最外层同时存一份主力（旧版本和内容脚本按它判断并发）。savedAt 变了，后台的出错记录清空，重新从主力试起
$('save').addEventListener('click', async () => {
  pull();
  const bad = incomplete();
  if (bad) {
    select(bad.i);
    return say('result', t('r_incomplete', { n: T.circled(bad.i + 1), what: bad.what }), 'err');
  }
  if (!(await permitAll(chain))) return say('result', t('r_noPermSave'), 'err');
  // 每家记一个 Key（这家的都清空了，就忘掉）
  const keys = Object.assign({}, saved.keys || {});
  for (const id of new Set(chain.filter((e) => preset(e.preset).key).map((e) => e.preset))) {
    const hit = chain.find((e) => e.preset === id && e.apiKey);
    keys[id] = hit ? hit.apiKey : '';
  }
  const main = chain[0];
  await saveSettings({ chain: chain.map((e) => Object.assign({}, e)), preset: main.preset, protocol: main.protocol,
    extra: main.extra, baseUrl: main.baseUrl, model: main.model, apiKey: main.apiKey, keys, savedAt: Date.now(),
    native: $('native').value, source: $('source').value, target: $('target').value });
  dirty = false;
  $('unsaved').textContent = '';
  const noKey = chain.findIndex((e) => preset(e.preset).key && e.preset !== 'openai-custom' && !e.apiKey);
  if (noKey >= 0) return say('result', t('r_savedNoKey', { n: T.circled(noKey + 1) }), 'err');
  return say('result', t('r_saved'), 'ok');
});

$('test').addEventListener('click', async () => {
  pull();
  const e = chain[cur];
  if (e.protocol === 'mock') return say('result', t('r_mockNoTest'), 'ok');
  if (!(await permitAll([e]))) return say('result', t('m_noPerm'), 'err');
  say('result', t('r_testing'));
  const r = await testOne(e);
  if (r.ok) return say('result', t('r_ok', { t: r.text }), 'ok');
  return say('result', t('r_fail', { e: r.error }), 'err');
});

// 一个一个试（按阵列顺序），结果显示在各自那一行
$('testAll').addEventListener('click', async () => {
  pull();
  if (!(await permitAll(chain))) return say('result', t('m_noPerm'), 'err');
  say('result', '');
  $('testAll').disabled = true;
  try {
    for (const e of [...chain]) {
      if (e.protocol === 'mock') {
        tested.set(e, { kind: 'ok', text: t('r_mockNoTest') });
        drawChain();
      } else {
        await testOne(e);
      }
    }
  } finally {
    $('testAll').disabled = false;
  }
  return undefined;
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

// development：从扩展文件夹加载（开发者模式），文件夹里换了新版本，这里点“更新”就用上；
// 其他（从商店装的 normal 等）：Chrome 自动更新，不显示“检查更新”
let installType = 'development';

function showVersion() {
  const dev = installType === 'development';
  $('version').textContent = t('verCurrent', { v: chrome.runtime.getManifest().version }) + (dev ? t('verDev') : '');
  $('check').hidden = !dev;
  if (!dev) {
    $('upgrade').hidden = true;
    list($('updateNotes'), []);
    say('updateMsg', t('u_store'));
  }
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
  try { installType = (await chrome.management.getSelf()).installType || installType; } catch (e) { /* 没有这个接口 */ }
  // 0.4.0 以前只有一个服务：就是只有主力的阵列（旧的服务名在这里换成新的）
  chain = PS.chainOf(saved);
  cur = 0;
  $('native').value = '';
  render();
  $('native').value = saved.native;
  $('target').value = saved.target;
  $('source').value = saved.source || 'auto';
  push();
  showSkin(saved.skin);
  loadHealth();
  banner();
  if (installType === 'development') checkUpdate();
  // 第一次打开就把母语存下来（以后界面和译文都按它）
  if (!settings || !settings.native) saveSettings({ native: saved.native, target: saved.target });
  autoFetch();
}

// 镜框标签上换了语言方向，这里也跟着显示
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.health) {
    health = changes.health.newValue || {};
    drawChain();
    return;
  }
  if (area !== 'local' || !changes.settings) return;
  const n = changes.settings.newValue || {};
  saved = Object.assign({}, saved, n);
  if (n.source && n.source !== $('source').value) $('source').value = n.source;
  if (n.target && n.target !== $('target').value) $('target').value = n.target;
});

load();
