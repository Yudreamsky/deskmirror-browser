// 视频字幕：装上扩展，打开有字幕的视频，打开魔镜盖住视频，真的播放：
//  1. 浏览器自己画的字幕（<track>）：一打开就把往后 5 分钟的字幕一批送去翻（提前翻）；播到哪句，镜框里那句就是译文，
//     原字幕藏起来；镜框挪开、按住看原文时原字幕还原；跳到 30 秒，那里马上是译文；
//     视频本身全屏：字幕轨里的字换成译文，退出全屏换回来；关掉魔镜什么都不留
//  2. 播放器自己画的字幕（字幕轨 hidden，自己画一个框）：译文框盖住原来的字幕框；镜框挪开就不盖
//  3. 像 YouTube 的播放器：魔镜打开前字幕就开着，让播放器重新取一次、抄到整条字幕（地址里的凭证照旧）；
//     译文盖住原字幕框；字幕关掉就不盖；播放器整块全屏时译文层放进全屏的元素里
//  4. 自动生成的字幕（一个词一个词）：按停顿和行尾拼成句子再翻
// node tests/subs.mjs
import path from 'node:path';
import { sleep } from './lib/cdp.mjs';
import { ROOT, serve } from './lib/harness.mjs';
import { launchWithExtension } from './lib/ext.mjs';
import { fakeService } from './lib/fake-llm.mjs';

let failed = 0;
const check = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) failed++;
};

const svc = await fakeService('ok');
svc.tag = 'ZH';
const pages = await serve();
const b = await launchWithExtension({ lang: 'zh-CN', args: ['--autoplay-policy=no-user-gesture-required'] });
const out = (name) => path.join(ROOT, 'tests/out', name);
try {
  const id = await b.load(path.join(ROOT, 'extension'));
  const t = await b.waitTarget((x) => x.type === 'page' && x.url.includes(id) && x.url.includes('options'));
  const op = await b.attach(t.targetId);
  const swT = await b.waitTarget((x) => x.type === 'service_worker' && x.url.includes(id));
  const sw = await b.attach(swT.targetId);
  await sleep(1000);
  await op.eval(`chrome.storage.local.set({ settings: { native: 'zh-Hans', target: 'zh-Hans', source: 'auto', savedAt: Date.now(),
    chain: [{ preset: 'openai-custom', protocol: 'openai', baseUrl: ${JSON.stringify(svc.url + '/v1')}, model: 'm', apiKey: 'test-key' }] } }).then(() => 1)`);

  /** 打开一页（before：打开魔镜前在网页上做的事）、打开魔镜、把镜框挪到 rect。 */
  async function open(file, rect, before) {
    const url = pages.url(file);
    const tab = await b.cdp.send('Target.createTarget', { url });
    const page = await b.attach(tab.targetId);
    const send = (m, p) => b.cdp.send(m, p, page.sessionId);
    await send('Page.bringToFront', {});
    await sleep(1200);
    if (before) await before(page);
    await sw.eval(`chrome.tabs.query({}).then(async (ts) => { const t = ts.find((x) => x.url === ${JSON.stringify(url)}); await toggle(t); return 1; })`);
    await sleep(1200);
    const ctx = page.isolated(id);
    await page.eval(`(() => { __dm.session.frame._set(${JSON.stringify(rect)}, true); return 1; })()`, ctx);
    const gesture = (expr) => send('Runtime.evaluate', { expression: expr, userGesture: true, awaitPromise: true, returnByValue: true });
    /** 第一个视频的字幕现在的样子（扩展那边看）。 */
    const state = () => page.eval(`(() => {
      const s = __dm.session && __dm.session.subs;
      if (!s) return null;
      const vs = [...s.videos.values()][0];
      const b = vs && vs.box;
      const r = b && b.getBoundingClientRect();
      return { text: b ? b.textContent : '', rect: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null,
        inFs: !!(b && s.fs && b.parentNode === s.fs.layer), active: !!(vs && vs.active), mode: vs && vs.track ? vs.track.mode : '',
        cues: vs && vs.track ? vs.track.cues.map((c) => c.text) : [], hide: vs ? vs.video.hasAttribute('data-deskmirror-subs') : false,
        sheet: !!s.cue && document.adoptedStyleSheets.includes(s.cue), batches: s.stats.batches };
    })()`, ctx);
    return { page, ctx, send, gesture, state, tab };
  }
  const seek = (pg, sec) => pg.page.eval(`(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; return 1; })()`);
  const subHits = (texts) => svc.hits.filter((h) => h.segments.some((x) => texts.some((t) => x.includes(t))));

  // ---------------------------------------------------------------- 1. <track>
  {
    const pg = await open('video-native.html', { x: 10, y: 60, w: 700, h: 470 });
    await pg.page.eval(`document.querySelector('video').play().then(() => 1)`);
    await sleep(2500);
    const ahead = subHits(['See you next time.', 'Let it dry overnight.']);
    const first = ahead[0];
    check(ahead.length >= 1 && first.segments.length >= 16,
      `一打开就提前翻：第一批字幕请求带了 ${first ? first.segments.length : 0} 句（整段视频 16 句），还没播到的最后一句也在里面`);
    await pg.page.eval(`document.querySelector('video').pause(), 1`);
    await seek(pg, 4.2);
    await sleep(400);
    let st = await pg.state();
    check(st && st.mode === 'native' && st.text === 'ZH:Today we are building a small bridge.' && st.hide && st.sheet,
      `播到第 2 句：镜框里是“${st && st.text}”，浏览器自己画的原字幕藏起来了（${st && st.hide}）`);
    await pg.page.shot(out('subs-native.png'));
    await seek(pg, 35.0);
    await sleep(350);
    st = await pg.state();
    check(st.text === 'ZH:Let it dry overnight.', `跳到 35 秒：马上是“${st.text}”`);
    // 镜框挪开：字幕区不在镜框里，原字幕还原
    await pg.page.eval(`(() => { __dm.session.frame._set({ x: 760, y: 60, w: 400, h: 300 }, true); return 1; })()`, pg.ctx);
    await sleep(400);
    st = await pg.state();
    check(!st.text && !st.hide && !st.active, '镜框挪开：不显示译文，原字幕还原');
    await pg.page.eval(`(() => { __dm.session.frame._set({ x: 10, y: 60, w: 700, h: 470 }, true); return 1; })()`, pg.ctx);
    await sleep(400);
    // 按住 Ctrl+Alt+O 看原文
    await pg.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79, modifiers: 3 });
    await sleep(300);
    const peek = await pg.state();
    await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79, modifiers: 3 });
    await sleep(300);
    st = await pg.state();
    check(!peek.text && !peek.hide && st.text === 'ZH:Let it dry overnight.' && st.hide, '按住 Ctrl+Alt+O：显示原字幕；松开又是译文');
    // 视频本身全屏
    await pg.gesture(`document.querySelector('video').requestFullscreen().then(() => 1, (e) => String(e))`);
    await sleep(600);
    const fs = await pg.page.eval(`(() => { const v = document.querySelector('video'); const c = v.textTracks[0].cues;
      return { fs: document.fullscreenElement === v, first: c[0].text, last: c[c.length - 1].text }; })()`);
    await pg.gesture('document.exitFullscreen().then(() => 1, () => 0)');
    await sleep(600);
    const back = await pg.page.eval(`(() => { const c = document.querySelector('video').textTracks[0].cues; return c[0].text; })()`);
    check(fs.fs && fs.first === 'ZH:Welcome back to the workshop.' && back === 'Welcome back to the workshop.',
      `视频本身全屏：字幕轨里换成译文（“${fs.first}”），退出全屏换回“${back}”`);
    // 关掉魔镜：什么都不留
    await sw.eval(`chrome.tabs.query({}).then(async (ts) => { const t = ts.find((x) => x.url === ${JSON.stringify(pages.url('video-native.html'))}); await toggle(t); return 1; })`);
    await sleep(800);
    const left = await pg.page.eval(`(() => { const v = document.querySelector('video');
      return { attr: v.hasAttribute('data-deskmirror-subs'), sheets: document.adoptedStyleSheets.length, own: document.querySelectorAll('[data-deskmirror-own],[data-deskmirror]').length,
        cue: v.textTracks[0].cues[0].text }; })()`);
    check(!left.attr && left.sheets === 0 && left.own === 0 && left.cue === 'Welcome back to the workshop.', `关掉魔镜：网页上不留东西（${JSON.stringify(left)}）`);
    await b.cdp.send('Target.closeTarget', { targetId: pg.tab.targetId });
  }

  // ---------------------------------------------------------------- 2. 播放器自己画
  {
    const pg = await open('video-player.html', { x: 10, y: 60, w: 700, h: 470 });
    await seek(pg, 6.5);
    await pg.page.eval(`document.querySelector('video').play().then(() => 1)`);
    await sleep(1800);
    await pg.page.eval(`document.querySelector('video').pause(), 1`);
    await sleep(500);
    const st = await pg.state();
    const orig = await pg.page.eval(`(() => { const s = document.querySelector('#cap span'); if (!s) return null; const r = s.getBoundingClientRect();
      return { text: s.textContent, x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const covers = st.rect && orig && st.rect.x <= orig.x + 0.5 && st.rect.y <= orig.y + 0.5 && st.rect.x + st.rect.w >= orig.x + orig.w - 0.5
      && st.rect.y + st.rect.h >= orig.y + orig.h - 0.5;
    check(st.mode === 'dom' && orig && st.text === 'ZH:' + orig.text && covers,
      `播放器自己画的字幕：“${orig && orig.text}”被盖住，换成“${st.text}”（原框 ${orig && Math.round(orig.w)}×${orig && Math.round(orig.h)}，译文框 ${st.rect && Math.round(st.rect.w)}×${st.rect && Math.round(st.rect.h)}）`);
    await pg.page.shot(out('subs-player.png'));
    // 滚动网页：译文框跟着视频走，马上还盖得住（不等下一次量字幕框）
    await pg.page.eval('scrollBy(0, 70), 1');
    await sleep(60);
    const st2 = await pg.state();
    const orig2 = await pg.page.eval(`(() => { const r = document.querySelector('#cap span').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const covers2 = st2.rect && st2.rect.x <= orig2.x + 0.5 && st2.rect.y <= orig2.y + 0.5
      && st2.rect.x + st2.rect.w >= orig2.x + orig2.w - 0.5 && st2.rect.y + st2.rect.h >= orig2.y + orig2.h - 0.5;
    check(covers2, `滚动网页 70 px 后 0.06 秒：译文框还盖着原字幕（原框顶 ${Math.round(orig2.y)}，译文框顶 ${st2.rect && Math.round(st2.rect.y)}）`);
    await pg.page.eval('scrollTo(0, 0), 1');
    await sleep(200);
    await pg.page.eval(`(() => { __dm.session.frame._set({ x: 760, y: 60, w: 400, h: 300 }, true); return 1; })()`, pg.ctx);
    await sleep(400);
    const away = await pg.state();
    check(!away.text, '镜框挪开：不盖原字幕');
    await b.cdp.send('Target.closeTarget', { targetId: pg.tab.targetId });
  }

  // ---------------------------------------------------------------- 3. 像 YouTube
  {
    const pg = await open('video-yt.html', { x: 10, y: 60, w: 700, h: 470 }, async (page) => {
      await page.eval('captionsOn(), 1');        // 打开魔镜前字幕就开着、已经取过了
      await sleep(600);
    });
    await sleep(1500);
    let st = await pg.state();
    const loads = await pg.page.eval('loads()');
    check(st.cues.length === 16 && loads >= 2, `魔镜打开时字幕已经取过：让播放器重新取了一次（一共取了 ${loads} 次），抄到整条 ${st.cues.length} 句`);
    await seek(pg, 13.2);
    await pg.page.eval(`document.querySelector('video').play().then(() => 1)`);
    await sleep(1200);
    await pg.page.eval(`document.querySelector('video').pause(), 1`);
    await sleep(500);
    st = await pg.state();
    const orig = await pg.page.eval(`(() => { const w = document.querySelector('.caption-window'); if (!w) return null; const r = w.getBoundingClientRect();
      return { text: w.textContent, x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const covers = st.rect && orig && st.rect.x <= orig.x + 0.5 && st.rect.y <= orig.y + 0.5 && st.rect.x + st.rect.w >= orig.x + orig.w - 0.5
      && st.rect.y + st.rect.h >= orig.y + orig.h - 0.5;
    check(orig && st.text === 'ZH:' + orig.text && covers,
      `像 YouTube：原字幕“${orig && orig.text}”被盖住，换成“${st.text}”`);
    // 画面上的字和这时的字幕对不上（放广告这类）：不盖
    await pg.page.eval(`forceCaption('Buy the amazing new phone today'), 1`);
    await sleep(500);
    const ad = await pg.state();
    await pg.page.eval('forceCaption(null), 1');
    await sleep(500);
    const again = await pg.state();
    check(!ad.text && again.text === 'ZH:Sand every edge before you glue it.', '画面上的字和这时的字幕对不上（像放广告）：不盖；对得上又盖');
    const two = await pg.page.eval(`(() => { const v = document.querySelector('video'); v.currentTime = 10.8; return 1; })()`);
    await sleep(500);
    st = await pg.state();
    check(two && st.text === 'ZH:Keep the saw blade straight.', `两行的一句（原文分两行）当一句翻：“${st.text}”`);
    await pg.page.shot(out('subs-yt.png'));
    await pg.page.eval('captionsOff(), 1');
    await sleep(700);
    st = await pg.state();
    check(!st.text, '字幕关掉：不再盖');
    await pg.page.eval('captionsOn(), 1');
    await sleep(900);
    await pg.gesture(`document.getElementById('movie_player').requestFullscreen().then(() => 1, (e) => String(e))`);
    await sleep(800);
    st = await pg.state();
    const fsOk = await pg.page.eval(`document.fullscreenElement === document.getElementById('movie_player')`);
    check(fsOk && st.inFs && st.text === 'ZH:Keep the saw blade straight.', `播放器整块全屏：译文层放进全屏的播放器里（“${st.text}”）`);
    await pg.page.shot(out('subs-yt-fullscreen.png'));
    await pg.gesture('document.exitFullscreen().then(() => 1, () => 0)');
    await sleep(600);
    await b.cdp.send('Target.closeTarget', { targetId: pg.tab.targetId });
  }

  // ---------------------------------------------------------------- 4. 自动生成的字幕
  {
    const pg = await open('video-yt.html#asr', { x: 10, y: 60, w: 700, h: 470 });
    await pg.page.eval('captionsOn(), 1');
    await sleep(1500);
    const st = await pg.state();
    const want = ['so today we are going to build a bridge and the first thing you do is measure the gap',
      'then you cut the beams to length okay', 'now sand every edge before you glue it the glue needs about ten minutes to set'];
    check(JSON.stringify(st.cues) === JSON.stringify(want), `自动生成的字幕拼成 ${st.cues.length} 句：${st.cues.map((c) => '“' + c + '”').join(' ')}`);
    // 播到第二行开头：画面上是第一行加上第二行刚出来的几个词，盖上整句的译文
    await seek(pg, 4.6);
    await pg.page.eval(`document.querySelector('video').play().then(() => 1)`);
    await sleep(500);
    await pg.page.eval(`document.querySelector('video').pause(), 1`);
    await sleep(500);
    const roll = await pg.state();
    const shown = await pg.page.eval(`(document.querySelector('.caption-window') || {}).textContent || ''`);
    check(roll.text === 'ZH:' + want[0], `一个词一个词出来的时候（画面上是“${shown}”）：盖上整句的译文“${roll.text}”`);
    await b.cdp.send('Target.closeTarget', { targetId: pg.tab.targetId });
  }
} finally {
  await b.close();
  svc.close();
  pages.close();
}
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
