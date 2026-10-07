// 桌面魔镜浏览器版：翻译服务商预设。设置页用来分组列出、一键填好地址和模型；后台用 extra 带上各家关掉“思考”的参数。
// 地址核对日期 2026-10-07（各家官方文档）。模型名留空的，填好 Key 后用“拉取模型”从服务上取，并自动挑一个轻量的。
(function (root) {
  'use strict';

  // group：local 本机 / plan 订阅套餐 / cn 国内按量 / intl 国际按量 / other
  // key：要不要 API Key；site：去哪里开通、拿 Key；note：提醒（中、英）
  const PLAN_NOTE = ['这是编程订阅套餐：按服务条款通常只允许在编程工具里使用，用来翻译可能违反条款，请自行判断。',
    'This is a coding subscription: its terms usually allow use only in coding tools, so using it for translation may break them. Your call.'];
  const P = [
    { id: 'ollama', group: 'local', name: ['本机 Ollama（免费，文字不出本机）', 'Ollama on this PC (free; text stays local)'],
      protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b', key: false, site: 'https://ollama.com' },
    { id: 'lmstudio', group: 'local', name: ['本机 LM Studio', 'LM Studio on this PC'],
      protocol: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', model: '', key: false, site: 'https://lmstudio.ai' },

    { id: 'ollama-cloud-local', group: 'plan', name: ['Ollama 云端模型（订阅，经本机 Ollama）', 'Ollama Cloud models (subscription, via local Ollama)'],
      protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '', key: false, site: 'https://ollama.com/pricing',
      note: ['本机 Ollama 登录账号后，模型列表里带 :cloud 的就是云端模型；文字会发到 Ollama 的服务器。',
        'After signing in to Ollama on this PC, models ending in :cloud run in Ollama\'s cloud; text is sent there.'] },
    { id: 'ollama-cloud', group: 'plan', name: ['Ollama 云端（直连 ollama.com，订阅）', 'Ollama Cloud (direct to ollama.com, subscription)'],
      protocol: 'ollama', baseUrl: 'https://ollama.com', model: '', key: true, site: 'https://ollama.com/settings/keys' },
    // <store-strip> 编程订阅套餐：服务条款通常只允许在编程工具里用，上架版不放（tools/pack.mjs 打包时去掉到 </store-strip>）
    { id: 'glm-coding', group: 'plan', name: ['智谱 GLM Coding Plan', 'Zhipu GLM Coding Plan (China)'],
      protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-4.5-air', key: true,
      site: 'https://bigmodel.cn/glm-coding', note: PLAN_NOTE },
    { id: 'zai-coding', group: 'plan', name: ['Z.ai GLM Coding Plan（国际）', 'Z.ai GLM Coding Plan (global)'],
      protocol: 'openai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', model: 'glm-4.5-air', key: true,
      site: 'https://z.ai/subscribe', note: PLAN_NOTE },
    { id: 'kimi-code', group: 'plan', name: ['Kimi Code 会员', 'Kimi Code membership'],
      protocol: 'openai', baseUrl: 'https://api.kimi.com/coding/v1', model: 'kimi-for-coding', key: true,
      site: 'https://www.kimi.com/code', note: PLAN_NOTE },
    { id: 'bailian-coding', group: 'plan', name: ['阿里云百炼 Coding Plan', 'Alibaba Model Studio Coding Plan'],
      protocol: 'openai', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', model: '', key: true, extra: { enable_thinking: false },
      hint: 'qwen3.5-plus', site: 'https://bailian.console.aliyun.com',
      note: ['这是编程订阅套餐（Key 以 sk-sp- 开头）：官方写明“仅限个人交互式本地编码使用”，用来翻译可能违反条款，请自行判断。',
        'Coding subscription (keys start with sk-sp-): the terms say "personal interactive local coding only", so translation may break them. Your call.'] },
    { id: 'ark-coding', group: 'plan', name: ['火山方舟 Coding Plan', 'Volcano Engine Ark Coding Plan'],
      protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', model: 'ark-code-latest', key: true,
      site: 'https://console.volcengine.com/ark', note: PLAN_NOTE },
    { id: 'minimax-plan', group: 'plan', name: ['MiniMax Coding Plan', 'MiniMax Coding Plan (China)'],
      protocol: 'openai', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.5', key: true,
      site: 'https://platform.minimaxi.com', note: ['套餐 Key 和按量付费的 Key 不通用。' + PLAN_NOTE[0],
        'The plan key differs from pay-as-you-go keys. ' + PLAN_NOTE[1]] },
    // </store-strip>

    { id: 'deepseek', group: 'cn', name: ['DeepSeek', 'DeepSeek'],
      protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', key: true, site: 'https://platform.deepseek.com' },
    { id: 'bailian', group: 'cn', name: ['阿里云百炼（通义千问）', 'Alibaba Model Studio (Qwen, China)'],
      protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '', key: true,
      extra: { enable_thinking: false }, site: 'https://bailian.console.aliyun.com' },
    { id: 'zhipu', group: 'cn', name: ['智谱 BigModel（GLM）', 'Zhipu BigModel (GLM)'],
      protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '', key: true, site: 'https://open.bigmodel.cn' },
    { id: 'moonshot', group: 'cn', name: ['Kimi 开放平台（月之暗面）', 'Moonshot Kimi (China)'],
      protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: '', key: true, site: 'https://platform.moonshot.cn' },
    { id: 'minimax', group: 'cn', name: ['MiniMax 开放平台', 'MiniMax (China)'],
      protocol: 'openai', baseUrl: 'https://api.minimaxi.com/v1', model: '', key: true, site: 'https://platform.minimaxi.com' },
    { id: 'ark', group: 'cn', name: ['火山方舟（豆包）', 'Volcano Engine Ark (Doubao)'],
      protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', key: true, site: 'https://console.volcengine.com/ark' },
    { id: 'siliconflow', group: 'cn', name: ['硅基流动', 'SiliconFlow (China)'],
      protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: '', key: true, site: 'https://cloud.siliconflow.cn' },
    { id: 'hunyuan', group: 'cn', name: ['腾讯混元', 'Tencent Hunyuan'],
      protocol: 'openai', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: '', key: true, site: 'https://console.cloud.tencent.com/hunyuan' },
    { id: 'qianfan', group: 'cn', name: ['百度千帆', 'Baidu Qianfan'],
      protocol: 'openai', baseUrl: 'https://qianfan.baidubce.com/v2', model: '', key: true, site: 'https://console.bce.baidu.com/qianfan' },
    { id: 'stepfun', group: 'cn', name: ['阶跃星辰', 'StepFun'],
      protocol: 'openai', baseUrl: 'https://api.stepfun.com/v1', model: '', key: true, site: 'https://platform.stepfun.com' },
    { id: 'modelscope', group: 'cn', name: ['魔搭 ModelScope（有免费额度）', 'ModelScope (free quota)'],
      protocol: 'openai', baseUrl: 'https://api-inference.modelscope.cn/v1', model: '', key: true, site: 'https://modelscope.cn' },

    { id: 'openai', group: 'intl', name: ['OpenAI', 'OpenAI'],
      protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', key: true, site: 'https://platform.openai.com' },
    { id: 'gemini', group: 'intl', name: ['Google Gemini', 'Google Gemini'],
      protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', key: true,
      extra: { reasoning_effort: 'none' }, site: 'https://aistudio.google.com' },
    { id: 'anthropic', group: 'intl', name: ['Anthropic Claude', 'Anthropic Claude'],
      protocol: 'openai', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5', key: true, site: 'https://console.anthropic.com' },
    { id: 'openrouter', group: 'intl', name: ['OpenRouter（多家模型，部分免费）', 'OpenRouter (many models, some free)'],
      protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', key: true, site: 'https://openrouter.ai' },
    { id: 'groq', group: 'intl', name: ['Groq', 'Groq'],
      protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', key: true, site: 'https://console.groq.com' },
    { id: 'mistral', group: 'intl', name: ['Mistral', 'Mistral'],
      protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', key: true, site: 'https://console.mistral.ai' },
    { id: 'xai', group: 'intl', name: ['xAI Grok', 'xAI Grok'],
      protocol: 'openai', baseUrl: 'https://api.x.ai/v1', model: '', key: true, site: 'https://console.x.ai' },

    { id: 'openai-custom', group: 'other', name: ['其他 OpenAI 兼容接口（自己填地址）', 'Other OpenAI-compatible API (enter the address)'],
      protocol: 'openai', baseUrl: '', model: '', key: true },
    // <store-strip> 测试用假翻译：上架版不放
    { id: 'mock', group: 'other', name: ['测试用假翻译（不联网，只看排版）', 'Fake translation for testing (offline, layout only)'],
      protocol: 'mock', baseUrl: '', model: '', key: false },
    // </store-strip>
  ];

  const GROUPS = [
    ['local', '本机', 'On this PC'], ['plan', '订阅套餐', 'Subscriptions'], ['cn', '国内（按量付费）', 'China (pay as you go)'],
    ['intl', '国际（按量付费）', 'International (pay as you go)'], ['other', '其他', 'Other'],
  ];

  const byId = {};
  for (const p of P) byId[p.id] = p;
  // 0.2.0 及以前的设置里存的旧名字
  const ALIASES = { openai: 'openai-custom' };

  /** 拉到模型列表后，没填模型时挑一个轻量、便宜、适合翻译的。 */
  function pickModel(list) {
    const ids = list.map((m) => m.id || m);
    const bad = /(vision|embed|audio|image|tts|ocr|whisper|realtime|search|guard|moderat|rerank|instruct-vl|-vl\b)/i;
    const good = [/flash/i, /lite/i, /mini/i, /turbo/i, /air/i, /haiku/i, /small/i, /fast/i];
    for (const re of good) {
      const hit = ids.find((id) => re.test(id) && !bad.test(id) && !/:cloud$/.test(id));
      if (hit) return hit;
    }
    return ids.find((id) => !bad.test(id)) || ids[0] || '';
  }

  // ---------------------------------------------------------------- 备用阵列
  const MAX_CHAIN = 6;

  /** 存着的服务名 → 现在的（0.2.0 以前“其他 OpenAI 兼容接口”叫 openai，现在 openai 是 OpenAI 官方）。 */
  function presetOf(e) {
    let id = e.preset;
    if (id === 'openai' && !/api\.openai\.com/.test(e.baseUrl || '')) id = 'openai-custom';
    if (!byId[id]) id = e.protocol === 'ollama' ? 'ollama' : e.protocol === 'mock' && byId.mock ? 'mock' : 'openai-custom';
    return id;
  }

  /**
   * 设置里的备用阵列（第一个是主力）：[{ preset, protocol, baseUrl, model, apiKey, extra }]。
   * 0.4.0 以前的设置只有一个服务（存在最外层），就是只有主力的阵列。协议和附加参数按服务商来；不要 Key 的服务不带 Key。
   */
  function chainOf(s) {
    const raw = s && Array.isArray(s.chain) && s.chain.length ? s.chain : [s || {}];
    return raw.filter((e) => e && typeof e === 'object').slice(0, MAX_CHAIN).map((e) => {
      const id = presetOf(e);
      const p = byId[id];
      return { preset: id, protocol: p.protocol, baseUrl: String(e.baseUrl || '').trim(), model: String(e.model || '').trim(),
        apiKey: p.key ? String(e.apiKey || '').trim() : '', extra: p.extra || null };
    });
  }

  /** 服务商的短名字：去掉括号里的说明（“本机 Ollama（免费，文字不出本机）”→“本机 Ollama”）。 */
  function shortName(id, lang) {
    const p = byId[id] || byId['openai-custom'];
    return p.name[lang === 'zh' ? 0 : 1].replace(/\s*[（(][^）)]*[）)]/g, '').trim();
  }

  /** 列表和镜框上显示的名字：“本机 Ollama · gemma4:12b”；自己填地址的显示地址里的域名。 */
  function engineLabel(e, lang) {
    let name = shortName(e.preset, lang);
    if (e.preset === 'openai-custom') {
      try { name = new URL(e.baseUrl).host || name; } catch (x) { /* 还没填地址 */ }
    }
    return e.protocol === 'mock' ? name : name + ' · ' + (e.model || '?');
  }

  /** 跑在这台电脑上的模型（本机 Ollama 的非云端模型、LM Studio）：一次一批，第一次要加载，等得久些。 */
  function isLocal(e) {
    return e.protocol !== 'mock' && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(e.baseUrl || '')
      && !/cloud$/i.test(e.model || '');
  }

  const api = { PRESETS: P, GROUPS, byId, ALIASES, pickModel, MAX_CHAIN, presetOf, chainOf, shortName, engineLabel, isLocal };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).presets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
