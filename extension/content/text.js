// 桌面魔镜浏览器版：文字处理（提示词、流式解析、行内标签、语言判断、测试用假翻译）。
// 内容脚本、后台和 Node 测试共用这一份，所以不碰 DOM。
(function (root) {
  'use strict';

  const TARGETS = {
    'zh-Hans': { name: 'Simplified Chinese (简体中文)', short: '中' },
    'zh-Hant': { name: 'Traditional Chinese (繁體中文)', short: '繁' },
    en: { name: 'English', short: '英' },
    ja: { name: 'Japanese (日本語)', short: '日' },
    ko: { name: 'Korean (한국어)', short: '韩' },
    id: { name: 'Indonesian (Bahasa Indonesia)', short: '印尼' },
  };
  // 原文语言：auto 交给模型自己认；指定了就在提示词里说明，并且只翻这种文字（和桌面版的语言按钮一样）
  const SOURCES = {
    auto: { name: '', short: '自动', label: '自动识别' },
    en: { name: 'English', short: '英', label: '英文' },
    zh: { name: 'Chinese', short: '中', label: '中文' },
    ja: { name: 'Japanese', short: '日', label: '日文' },
    ko: { name: 'Korean', short: '韩', label: '韩文' },
    id: { name: 'Indonesian', short: '印尼', label: '印尼文' },
  };

  // ------------------------------------------------------------------ 界面文字
  // 和桌面版一样：母语是中文（简体或繁体）用中文界面，其他母语用英文界面。
  // 语言名用各自的文字写（简体中文、English、日本語……），任何界面下都这样显示。
  const NATIVE_NAMES = {
    'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', id: 'Bahasa Indonesia',
  };
  const UI = {
    zh: {
      mirror: '魔镜', pause: '暂停', resume: '继续', close: '关闭魔镜', langTitle: '原文和译成的语言',
      from: '原文', to: '译成', ready: '就绪', paused: '已暂停', busy: '翻译中 {n}', error: '出错：{e}',
      updated: '扩展已更新，请重新打开魔镜', disconnected: '后台断开了',
      backup: '备用{n} {m}', backupTip: '主力（{p}）出错：{e}\n现在用备用{n}：{l}',
      traffic: '这次打开魔镜以来：\n发送 {in} 个 token，接收 {out} 个 token（{n} 次请求）', trafficEst: '有的服务不报告用量，这部分按字数估算',
      src_auto: '自动识别', src_en: '英文', src_zh: '中文', src_ja: '日文', src_ko: '韩文', src_id: '印尼文',
      s_auto: '自动', s_en: '英', s_zh: '中', s_ja: '日', s_ko: '韩', s_id: '印尼',
      t_zh_Hans: '中', t_zh_Hant: '繁', t_en: '英', t_ja: '日', t_ko: '韩', t_id: '印尼',
    },
    en: {
      mirror: 'Mirror', pause: 'Pause', resume: 'Resume', close: 'Close the mirror', langTitle: 'Source and target languages',
      from: 'Original', to: 'Translate into', ready: 'Ready', paused: 'Paused', busy: 'Translating {n}', error: 'Error: {e}',
      updated: 'The extension was updated; open the mirror again', disconnected: 'Lost the connection to the extension',
      backup: 'backup {n} {m}', backupTip: 'The main service ({p}) failed: {e}\nNow using backup {n}: {l}',
      traffic: 'Since the mirror opened:\nsent {in} tokens, received {out} tokens ({n} requests)',
      trafficEst: 'Some services do not report usage; those are estimated from the text length',
      src_auto: 'Auto-detect', src_en: 'English', src_zh: 'Chinese', src_ja: 'Japanese', src_ko: 'Korean', src_id: 'Indonesian',
      s_auto: 'Auto', s_en: 'EN', s_zh: 'ZH', s_ja: 'JA', s_ko: 'KO', s_id: 'ID',
      t_zh_Hans: 'ZH', t_zh_Hant: 'ZH-T', t_en: 'EN', t_ja: 'JA', t_ko: 'KO', t_id: 'ID',
    },
  };

  /** 粗估 token 数（服务不报告用量时用）：汉字、假名、韩文每个字算 1 个，其他文字大约 4 个字符 1 个。 */
  function estimateTokens(text) {
    const s = String(text || '');
    const cjk = (s.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
    return cjk + Math.ceil((s.length - cjk) / 4);
  }

  /** 网速那样的写法：999、1.2k、12k、1.3M。 */
  function shortCount(n) {
    if (n < 1000) return String(Math.round(n));
    if (n < 10000) return (Math.round(n / 100) / 10) + 'k';
    if (n < 1e6) return Math.round(n / 1000) + 'k';
    return (Math.round(n / 1e5) / 10) + 'M';
  }

  /** 带圈的序号 ①②③……（备用阵列里第几个）。 */
  function circled(n) {
    return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : '(' + n + ')';
  }

  function uiLang(native) {
    return /^zh/.test(native || '') ? 'zh' : 'en';
  }

  function ui(lang, key, vars) {
    let s = (UI[lang] && UI[lang][key]) || UI.en[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
    return s;
  }

  /** 语言按钮上的字，如“自动→中”“Auto→EN”。 */
  function langLabel(lang, source, target) {
    return ui(lang, 's_' + (source || 'auto')) + '→' + ui(lang, 't_' + String(target).replace('-', '_'));
  }

  /** 第一次用时按浏览器语言猜母语。 */
  function guessNative(browserLang) {
    const l = String(browserLang || '').toLowerCase();
    if (/^zh[-_](tw|hk|mo|hant)/.test(l)) return 'zh-Hant';
    if (l.startsWith('zh')) return 'zh-Hans';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('id') || l.startsWith('in')) return 'id';
    return 'en';
  }

  // ------------------------------------------------------------------ 提示词
  function systemPrompt(target, source) {
    const lang = (TARGETS[target] || { name: target }).name;
    const src = SOURCES[source] && SOURCES[source].name;
    return [
      `You translate web page text into ${lang}. Each input segment starts with a number like [1].`
        + (src ? ` The user says the text is mostly ${src}; read it as ${src}.` : ''),
      'Segments can contain inline tags: <gN>...</gN> wraps formatted words such as a link or bold text, and <xN/> '
        + 'stands for an image, a line break or a piece of code that stays as it is.',
      'Rules:',
      `- Output every segment in the same order, each on one line starting with its own number, e.g. [1] <${lang} text>.`,
      '- Never merge, split, skip or reorder segments; one output segment per input segment.',
      '- Keep every tag of a segment exactly once, with the same number, around the words it belongs to in your '
        + 'translation. Do not add tags.',
      '- Translate naturally and concisely. Keep names, code, URLs, file paths, numbers and units as they are.',
      `- If a segment is already ${lang}, or is only symbols/numbers, repeat it unchanged.`,
      "- A first line 'Page: ...' gives the page title and site. Use it only as context; never translate or output it.",
      '- Output only the numbered translations, nothing else.',
    ].join('\n');
  }

  function userMessage(texts, context) {
    const body = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s*\n\s*/g, ' ')}`).join('\n');
    return context ? `Page: ${context}\n\n${body}` : body;
  }

  // ------------------------------------------------------------------ 流式解析 “[n] 译文”
  const SEG = /^\s*\[(\d{1,3})\]\s?(.*)$/;

  function stripThink(raw) {
    let s = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    const open = s.indexOf('<think>');
    return open >= 0 ? s.slice(0, open) : s;
  }

  /** 第 n 段在看到下一个编号或流结束时才算完整，界面因此总是整段替换。 */
  class SegmentParser {
    constructor(count, onSegment) {
      this.count = count;
      this.onSegment = onSegment;
      this.raw = '';
      this.fed = 0;
      this.buf = '';
      this.current = null;
      this.parts = [];
      this.done = new Set();
    }

    feedRaw(piece) {
      this.raw += piece;
      const cleaned = stripThink(this.raw);
      if (cleaned.length > this.fed) {
        this.feed(cleaned.slice(this.fed));
        this.fed = cleaned.length;
      }
    }

    feed(chunk) {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        this._line(line);
      }
    }

    _line(line) {
      const m = SEG.exec(line);
      if (m && +m[1] >= 1 && +m[1] <= this.count) {
        this._finish();
        this.current = +m[1] - 1;
        this.parts = [m[2]];
      } else if (this.current !== null && line.trim()) {
        this.parts.push(line.trim());
      }
    }

    _finish() {
      if (this.current !== null && !this.done.has(this.current)) {
        const text = this.parts.map((p) => p.trim()).filter(Boolean).join(' ').trim();
        if (text) {
          this.done.add(this.current);
          this.onSegment(this.current, text);
        }
      }
      this.current = null;
      this.parts = [];
    }

    close() {
      if (this.buf) {
        this._line(this.buf);
        this.buf = '';
      }
      this._finish();
    }
  }

  // ------------------------------------------------------------------ 行内标签 <gN>…</gN> / <xN/>
  const TAG = /<(\/?)g(\d+)>|<x(\d+)\s*\/?>/g;

  /** 解析译文里的标签。宽松处理：未知编号、重复、多余的闭合标签都忽略，没闭合的在末尾自动闭合。 */
  function parseTagged(s, tagCount) {
    const top = [];
    const stack = [{ id: 0, c: top }];
    const used = new Set();
    let last = 0;
    const pushText = (v) => {
      if (!v) return;
      const c = stack[stack.length - 1].c;
      const prev = c[c.length - 1];
      if (prev && prev.t === 'text') prev.v += v;
      else c.push({ t: 'text', v });
    };
    TAG.lastIndex = 0;
    let m;
    while ((m = TAG.exec(s))) {
      pushText(s.slice(last, m.index));
      last = TAG.lastIndex;
      const cur = stack[stack.length - 1].c;
      if (m[3] !== undefined) {
        const id = +m[3];
        if (id >= 1 && id <= tagCount && !used.has('x' + id)) {
          used.add('x' + id);
          cur.push({ t: 'x', id });
        }
        continue;
      }
      const id = +m[2];
      if (m[1] === '') {
        if (id >= 1 && id <= tagCount && !used.has('g' + id)) {
          used.add('g' + id);
          const node = { t: 'g', id, c: [] };
          cur.push(node);
          stack.push({ id, c: node.c });
        }
      } else {
        let k = stack.length - 1;
        while (k > 0 && stack[k].id !== id) k--;
        if (k > 0) stack.length = k;
      }
    }
    pushText(s.slice(last));
    return { nodes: top, used };
  }

  function stripTags(s) {
    return s.replace(TAG, '').replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------ 语言判断
  function scriptCounts(s) {
    let han = 0, kana = 0, hangul = 0, latin = 0, other = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)) han++;
      else if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff)) kana++;
      else if ((c >= 0xac00 && c <= 0xd7af) || (c >= 0x1100 && c <= 0x11ff)) hangul++;
      else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) latin++;
      else if (/\p{L}/u.test(ch)) other++;
    }
    return { han, kana, hangul, latin, other, letters: han + kana + hangul + latin + other };
  }

  /** 有没有要翻的字：全是数字、符号、网址的不送去翻。 */
  function hasWords(text) {
    const t = text.replace(/https?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '');
    return /\p{L}/u.test(t);
  }

  /** 指定了原文语言时，这段里有没有这种文字（没有就不翻，比如日文网页上的英文菜单）。 */
  function matchesSource(text, source) {
    if (!source || source === 'auto') return true;
    const n = scriptCounts(text);
    if (source === 'ja') return n.kana > 0 || n.han > 0;
    if (source === 'zh') return n.han > 0;
    if (source === 'ko') return n.hangul > 0;
    return n.latin > 0;
  }

  /** 已经是目标语言的明显情况（只按文字种类判断，拿不准就交给模型）。 */
  function isAlreadyTarget(text, target) {
    const n = scriptCounts(text);
    if (!n.letters) return true;
    if (target === 'zh-Hans' || target === 'zh-Hant') return n.han >= 0.6 * n.letters && n.kana === 0;
    if (target === 'ja') return n.kana > 0 && n.kana + n.han >= 0.6 * n.letters;
    if (target === 'ko') return n.hangul >= 0.6 * n.letters;
    return false;
  }

  // ------------------------------------------------------------------ 测试用假翻译
  const POOL = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面'
    + '而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还'
    + '因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意';

  function hash(s) {
    let h = 2166136261;
    for (const ch of s) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function fakeCjkWord(word, ratio) {
    const n = Math.max(1, Math.round(word.length * ratio));
    let h = hash(word.toLowerCase());
    let out = '';
    for (let i = 0; i < n; i++) {
      out += POOL[h % POOL.length];
      h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    }
    return out;
  }

  const LATIN = 'abcdefghiklmnoprstuvy';

  function fakeLatin(run) {
    let h = hash(run);
    const words = [];
    const n = Math.max(1, Math.round([...run].length * 0.8));
    for (let i = 0; i < n; i++) {
      let w = '';
      const len = 2 + (h % 7);
      for (let k = 0; k < len; k++) {
        w += LATIN[h % LATIN.length];
        h = Math.imul(h ^ (h >>> 13), 1597334677) >>> 0;
      }
      words.push(w);
    }
    return words.join(' ');
  }

  const PUNCT = { ',': '，', '.': '。', ';': '；', ':': '：', '!': '！', '?': '？', '(': '（', ')': '）' };

  /** 只换字不换结构：标签原样保留，长度大致像真的译文（英译中约 0.45 字/字母）。mode=identity 时原样返回。 */
  function mockTranslate(tagged, target, mode) {
    if (mode === 'identity') return tagged;
    const cjk = /^(zh|ja|ko)/.test(target);
    const ratio = mode === 'long' ? 0.9 : 0.45;
    return tagged.split(/(<\/?g\d+>|<x\d+\s*\/?>)/).map((part, i) => {
      if (i % 2) return part;
      if (cjk) {
        return part.replace(/[A-Za-z][A-Za-z'’-]*|\s+|[,.;:!?()]/g, (w) => {
          if (/^\s+$/.test(w)) return '';
          if (PUNCT[w]) return PUNCT[w];
          return fakeCjkWord(w, ratio);
        });
      }
      return part.replace(/[㐀-鿿぀-ヿ가-힯]+/g, (run) => ' ' + fakeLatin(run) + ' ')
        .replace(/ {2,}/g, ' ');
    }).join('');
  }

  const api = {
    TARGETS, SOURCES, NATIVE_NAMES, UI, circled, estimateTokens, shortCount, uiLang, ui, langLabel, guessNative, systemPrompt, userMessage, SegmentParser, stripThink,
    parseTagged, stripTags, scriptCounts, hasWords, isAlreadyTarget, matchesSource, mockTranslate, hash,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).text = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
