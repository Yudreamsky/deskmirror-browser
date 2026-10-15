// 桌面魔镜浏览器版：放进 YouTube 网页自己的环境里（不是扩展的隔离环境），播放器取到字幕时抄一份转给魔镜。
// YouTube 取字幕要带播放器现场算出的凭证，扩展自己去取只会拿到空的；所以等播放器自己取。
// 放进来时字幕已经取过了：字幕开着就让播放器重新取一次。只抄字幕，不改请求、不改回应；关掉魔镜后不再转。
(function () {
  'use strict';
  const NS = '__deskmirrorYt';
  if (window[NS]) {
    window[NS].on = true;
    window[NS].reload();
    return;
  }
  const api = { on: true, reload: () => {} };
  window[NS] = api;
  const isCaps = (u) => typeof u === 'string' && /(^|\/)api\/timedtext/.test(u);
  const player = () => document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
  const post = (url, body) => {
    if (!api.on || !body) return;
    let videoId = '';
    try {
      const p = player();
      const d = p && p.getVideoData && p.getVideoData();
      videoId = (d && d.video_id) || '';
    } catch (e) { /* 播放器还没好 */ }
    window.postMessage({ deskmirror: 'yt-captions', url: String(url), body: String(body), videoId }, location.origin);
  };

  const X = XMLHttpRequest.prototype;
  const open = X.open, send = X.send;
  X.open = function (method, url) {
    try { this.__dmCaps = isCaps(String(url)) ? String(url) : ''; } catch (e) { this.__dmCaps = ''; }
    return open.apply(this, arguments);
  };
  X.send = function () {
    if (this.__dmCaps) {
      const url = this.__dmCaps;
      this.addEventListener('load', () => {
        try {
          if (this.status !== 200) return;
          const t = this.responseType;
          if (t === '' || t === 'text') post(url, this.responseText);
          else if (t === 'json') post(url, JSON.stringify(this.response));
          else if (t === 'arraybuffer' && this.response) post(url, new TextDecoder().decode(this.response));
        } catch (e) { /* 读不到就算了 */ }
      });
    }
    return send.apply(this, arguments);
  };
  const f = window.fetch;
  if (typeof f === 'function') {
    window.fetch = function (input) {
      const p = f.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        if (isCaps(url)) p.then((r) => (r.ok ? r.clone().text() : '')).then((t) => post(url, t)).catch(() => {});
      } catch (e) { /* 不影响网页自己的请求 */ }
      return p;
    };
  }

  api.reload = () => {
    try {
      const p = player();
      const tr = p && p.getOption && p.getOption('captions', 'track');
      if (tr && tr.languageCode) p.setOption('captions', 'reload', true);
    } catch (e) { /* 播放器还没好 */ }
  };
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source === window && d && d.deskmirror === 'yt-control') api.on = !!d.on;
  });
  api.reload();
})();
