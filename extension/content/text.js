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

  // ------------------------------------------------------------------ 提示词
  function systemPrompt(target) {
    const lang = (TARGETS[target] || { name: target }).name;
    return [
      `You translate web page text into ${lang}. Each input segment starts with a number like [1].`,
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
    TARGETS, systemPrompt, userMessage, SegmentParser, stripThink,
    parseTagged, stripTags, scriptCounts, hasWords, isAlreadyTarget, mockTranslate, hash,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.__dm = root.__dm || {}).text = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
