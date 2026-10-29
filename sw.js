/* Service Worker。ビルド時に scripts/build-sw.mjs がバージョンとキャッシュ対象の一覧を埋める。
   - アプリ本体（HTML/JS/CSS/アイコン）はインストール時に全てキャッシュし、オフラインでも起動する
   - index.html はキャッシュを先に返し、裏で更新を取りに行く（次回起動で新しい版になる）
   - Supabase への通信はキャッシュしない */
const VERSION = '0903050478b8';
const CACHE = `cashflow-${VERSION}`;
const ASSETS = [
  "./assets/index-DkgChCA8.js",
  "./assets/index-Pv9GrfJK.js",
  "./assets/index-m59cODZg.css",
  "./assets/ocr-b0l0iqCI.js",
  "./fonts/Anton-Regular.woff2",
  "./fonts/JetBrainsMono-Medium.woff2",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512-maskable.png",
  "./icons/icon-512.png",
  "./index.html",
  "./manifest.webmanifest"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase などはそのまま
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(new Request(indexUrl()), req));
    return;
  }
  // 文字認識の部品（ocr/）は大きいので、最初に使ったときに別のキャッシュに残す（版が変わっても消さない）
  if (url.pathname.includes('/ocr/')) {
    event.respondWith(ocrCache(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});

const OCR_CACHE = 'cashflow-ocr-v1';
async function ocrCache(req) {
  const c = await caches.open(OCR_CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

function indexUrl() {
  return new URL('./index.html', self.registration.scope).toString();
}

async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok && ASSETS.some((a) => new URL(a, self.registration.scope).pathname === new URL(req.url).pathname)) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function staleWhileRevalidate(cacheReq, netReq) {
  const c = await caches.open(CACHE);
  const cached = await c.match(cacheReq);
  const network = fetch(netReq).then((res) => {
    if (res.ok) c.put(cacheReq, res.clone());
    return res;
  }).catch(() => null);
  if (cached) {
    event_noop(network);
    return cached;
  }
  const res = await network;
  return res ?? new Response('<h1>オフラインです</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function event_noop(p) { p.then(() => {}, () => {}); }

// ---- 通知（F09 の C・E）。Supabase の Edge Function `notify` から届く ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: '家計', body: event.data ? event.data.text() : '' }; }
  const title = data.title || '家計';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || 'cashflow',
    icon: new URL('./icon-192.png', self.registration.scope).toString(),
    badge: new URL('./icon-192.png', self.registration.scope).toString(),
    data: { url: data.url || '#/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(self.registration.scope);
  target.hash = (event.notification.data && event.notification.data.url) || '#/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === target.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target.toString()); } catch (e) { /* 別のページのときは開き直す */ } }
        return;
      }
    }
    await self.clients.openWindow(target.toString());
  })());
});
