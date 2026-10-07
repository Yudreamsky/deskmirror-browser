// 设置页的服务商列表：分组、切换后自动填地址、提示、拉模型（本机 Ollama，包括只列云端模型的预设）、按服务商记 Key
// node tests/providers.mjs
import path from 'node:path';
import { sleep } from './lib/cdp.mjs';
import { ROOT } from './lib/harness.mjs';
import { launchWithExtension } from './lib/ext.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};

const b = await launchWithExtension({ lang: 'zh-CN' });
try {
  const id = await b.load(path.join(ROOT, 'extension'));
  const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
  const p = await b.attach(t.targetId);
  await sleep(1500);
  const groups = await p.eval(`[...document.querySelectorAll('#preset optgroup')].map((g) => g.label + ' ' + g.children.length)`);
  check(groups.length === 5, '服务分组：' + groups.join('，'));
  const pick = async (pid) => p.eval(`(async () => { const sel = document.getElementById('preset'); sel.value = ${JSON.stringify(pid)};
    sel.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 2500));
    const $ = (i) => document.getElementById(i);
    return { base: $('baseUrl').value, model: $('model').value, keyShown: !$('keyRow').hidden, note: $('presetNote').hidden ? '' : $('presetNote').textContent,
      site: $('site').hidden ? '' : $('site').href, msg: $('modelMsg').textContent, models: $('models').hidden ? 0 : $('models').options.length - 1,
      placeholder: $('model').placeholder }; })()`);
  const ds = await pick('deepseek');
  check(ds.base === 'https://api.deepseek.com' && ds.model === 'deepseek-flash' && ds.keyShown && !ds.note && /deepseek/.test(ds.site),
    `DeepSeek：${ds.base}，模型 ${ds.model}，要 Key，链接 ${ds.site}`);
  const glm = await pick('glm-coding');
  check(/coding\/paas\/v4/.test(glm.base) && glm.keyShown && /编程/.test(glm.note), `智谱 Coding Plan：${glm.base}，提示“${glm.note.slice(0, 24)}…”`);
  const bl = await pick('bailian-coding');
  check(/coding\.dashscope/.test(bl.base) && /sk-sp-/.test(bl.note) && /qwen3\.5-plus/.test(bl.placeholder), `百炼 Coding Plan：${bl.base}，模型提示“${bl.placeholder}”`);
  const ol = await pick('ollama');
  check(!ol.keyShown && ol.models > 0 && /在列表里/.test(ol.msg), `本机 Ollama：不要 Key，拉到 ${ol.models} 个模型，“${ol.msg}”`);
  const oc = await pick('ollama-cloud-local');
  check(!oc.keyShown && oc.models > 0 && /cloud$/.test(oc.model), `Ollama 云端（经本机）：只列云端 ${oc.models} 个，自动选了 ${oc.model}`);
  await p.shot(path.join(ROOT, 'tests/out/providers.png'));
  // 按服务商记 Key：DeepSeek 填一个假 Key 保存，换到智谱再换回来，Key 还在；智谱那里是空的
  const keys = await p.eval(`(async () => { const $ = (i) => document.getElementById(i); const sel = $('preset');
    const go = async (v) => { sel.value = v; sel.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 300)); };
    await go('deepseek'); $('apiKey').value = 'sk-test-deepseek'; $('save').click(); await new Promise((r) => setTimeout(r, 800));
    await go('zhipu'); const z = $('apiKey').value; await go('deepseek'); const d = $('apiKey').value;
    const st = (await chrome.storage.local.get('settings')).settings;
    return { z, d, saved: st.keys && st.keys.deepseek, extra: st.extra }; })()`);
  check(keys.z === '' && keys.d === 'sk-test-deepseek' && keys.saved === 'sk-test-deepseek', `每家的 Key 分开记（换到智谱是空的，换回 DeepSeek 还在）`);
  // 测试连接走后台：本机 Ollama
  const test = await p.eval(`(async () => { const $ = (i) => document.getElementById(i); const sel = $('preset');
    sel.value = 'ollama'; sel.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 1500));
    $('test').click(); for (let i = 0; i < 120 && /正在/.test($('result').textContent || '正在'); i++) await new Promise((r) => setTimeout(r, 500));
    return $('result').textContent; })()`);
  check(/连接正常/.test(test), '测试连接（本机 Ollama）：' + test);
} finally {
  await b.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
