// 桌面魔镜浏览器版：设置页。
const PRESETS = {
  ollama: { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b' },
  deepseek: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  openai: { protocol: 'openai', baseUrl: '', model: '' },
  mock: { protocol: 'mock', baseUrl: '', model: '' },
};
const DEFAULTS = { preset: 'ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b', apiKey: '', target: 'zh-Hans' };

const $ = (id) => document.getElementById(id);

function show(preset) {
  $('fields').style.display = preset === 'mock' ? 'none' : '';
  $('keyRow').style.display = preset === 'ollama' ? 'none' : '';
}

function read() {
  const preset = $('preset').value;
  return {
    preset,
    protocol: PRESETS[preset].protocol,
    baseUrl: $('baseUrl').value.trim(),
    model: $('model').value.trim(),
    apiKey: $('apiKey').value.trim(),
    target: $('target').value,
  };
}

function say(text, kind) {
  $('result').textContent = text;
  $('result').className = kind || '';
}

/** 自定义的服务地址要先拿到访问权限（Chrome 会弹窗问一次）。 */
async function permit(baseUrl) {
  let origin;
  try { origin = new URL(baseUrl).origin; } catch (e) { return true; }
  const want = { origins: [origin + '/*'] };
  if (await chrome.permissions.contains(want)) return true;
  return chrome.permissions.request(want);
}

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = Object.assign({}, DEFAULTS, settings || {});
  $('preset').value = s.preset in PRESETS ? s.preset : 'openai';
  $('baseUrl').value = s.baseUrl;
  $('model').value = s.model;
  $('apiKey').value = s.apiKey;
  $('target').value = s.target;
  show($('preset').value);
}

$('preset').addEventListener('change', () => {
  const p = PRESETS[$('preset').value];
  if (p.baseUrl || $('preset').value !== 'openai') {
    $('baseUrl').value = p.baseUrl;
    $('model').value = p.model;
  }
  show($('preset').value);
  say('');
});

$('save').addEventListener('click', async () => {
  const s = read();
  if (s.protocol !== 'mock' && !(await permit(s.baseUrl))) {
    say('没有拿到访问这个地址的权限，翻译请求会失败', 'err');
    return;
  }
  await chrome.storage.local.set({ settings: s });
  say('已保存。已经打开的魔镜关掉再开一次就会用新设置。', 'ok');
});

$('test').addEventListener('click', async () => {
  const s = read();
  if (s.protocol === 'mock') {
    say('假翻译不用测试', 'ok');
    return;
  }
  if (!(await permit(s.baseUrl))) {
    say('没有拿到访问这个地址的权限', 'err');
    return;
  }
  say('正在请求……');
  const r = await chrome.runtime.sendMessage({ type: 'dm-test', settings: s });
  if (r && r.ok) say('连接正常：' + r.text, 'ok');
  else say('失败：' + ((r && r.error) || '没有回应'), 'err');
});

load();
