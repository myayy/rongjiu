/* 融酒 PWA Service Worker
   策略：
   - App 外壳（index.html / css / js / 图标 / manifest）预缓存，采用「先用缓存、后台更新」
   - 素材/ 下的配方图片体积大（约 74MB），不预缓存，改成「看过一张就存一张」（cache-first）
   - 升级：改 VERSION 即可让旧缓存在 activate 时被清掉
   注意：Service Worker 只在 https 或 localhost 下生效，双击 index.html（file://）不会注册。 */
'use strict';

var VERSION = 'rongjiu-v3';
var SHELL_CACHE = VERSION + '-shell';
var IMG_CACHE = VERSION + '-img';
var IMG_LIMIT = 240;   // 最多留 240 张配方图，超了就丢最早的，避免无限膨胀

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/data.js',
  './js/tags.js',
  './js/store.js',
  './js/core.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // 单个文件失败不要拖垮整个安装（例如某张图标还没生成）
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== IMG_CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 图片缓存超量后丢掉最早的一批 */
function trimImageCache() {
  return caches.open(IMG_CACHE).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= IMG_LIMIT) return null;
      return Promise.all(keys.slice(0, keys.length - IMG_LIMIT).map(function (req) {
        return cache.delete(req);
      }));
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 只管同源

  // 注意：URL.pathname 仍是 percent-encoded 的，中文目录名要先解码再匹配
  var pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch (err) { /* 解码失败就用原串 */ }
  var isImage = /\/素材\//.test(pathname);

  if (isImage) {
    // 配方图：缓存优先，命中就直接用，没命中再联网并存下来
    e.respondWith(
      caches.open(IMG_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) {
              cache.put(req, res.clone());
              trimImageCache();
            }
            return res;
          });
        });
      })
    );
    return;
  }

  // App 外壳：先用缓存（离线也能开），同时在后台拉新版本写回缓存，下次打开就是新的
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        caches.open(SHELL_CACHE).then(function (c) { c.put('./index.html', res.clone()); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});
