/**
 * sw.js — 오프라인 지원 서비스 워커.
 *
 * 캐시 전략
 *  - 앱 껍데기(HTML/CSS/JS)와 번들 데이터는 설치 시 미리 받아둔다.
 *  - 실행 중에는 network-first: 온라인이면 최신을 쓰고, 실패하면 캐시로 되돌아간다.
 *    데이터가 갱신되는 앱이라 cache-first면 오래된 회차에 갇힌다.
 *  - 외부 도메인(데이터 갱신 엔드포인트) 요청은 캐시하지 않고 그대로 통과시킨다.
 */
const CACHE = 'lotto-v2';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/engine.js',
  './js/store.js',
  './js/source.js',
  './data/draws.json',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;  // 외부 API는 건드리지 않는다

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
