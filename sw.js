const CACHE_VERSION = 'bm2-pwa-20260911-phase3-holding-zones-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_ASSET_MANIFEST = './offline-assets.json';
let offlineCachePromise = null;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './src/main.js',
  './app.webmanifest',
  './data/audio_manifest.json',
  './data/fla_actions_index.json',
  './data/itemtext.json',
  './data/mapnames.json',
  './data/planetData.json',
  './data/planet_manifest.json',
  './data/pod_manifest.json',
  './data/ship_size_config.json',
  './data/starship_manifest.json',
  './data/stationData.json',
  './data/station_manifest.json',
  './assets/app-icons/icon-192.png',
  './assets/app-icons/icon-512.png',
  './assets/app-icons/icon-1024.png',
  './assets/app-icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('bm2-pwa-') && !key.startsWith(CACHE_VERSION))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => warmOfflineCache())
      .catch(() => {})
  );
});

async function fetchOfflineAssetList() {
  try {
    const response = await fetch(OFFLINE_ASSET_MANIFEST, { cache: 'no-store' });
    if (!response || !response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.assets) ? data.assets.filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function cacheOne(cache, asset) {
  try {
    const response = await fetch(asset, { cache: 'reload' });
    if (response && response.ok) await cache.put(asset, response.clone());
    return true;
  } catch {
    return false;
  }
}

async function warmOfflineCache() {
  if (offlineCachePromise) return offlineCachePromise;
  offlineCachePromise = (async () => {
  const assets = await fetchOfflineAssetList();
  if (!assets.length) return;
  const cache = await caches.open(RUNTIME_CACHE);
  for (const asset of assets) {
    await cacheOne(cache, asset);
  }
  await cache.put('./offline-ready.json', new Response(JSON.stringify({
    ready: true,
    cachedAt: new Date().toISOString(),
    assets: assets.length
  }), {
    headers: { 'Content-Type': 'application/json' }
  }));
  await notifyClients({ type: 'BM2_OFFLINE_READY', assets: assets.length });
  })();
  try {
    await offlineCachePromise;
  } finally {
    offlineCachePromise = null;
  }
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

async function networkFirst(request, options = {}) {
  const { fallbackToShell = true } = options;
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackToShell) return caches.match('./index.html');
    return new Response('', { status: 504, statusText: 'Asset unavailable offline' });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const cache = await caches.open(RUNTIME_CACHE);
  const response = await fetch(request);
  if (response && response.status === 200) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes('/assets/') || url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(request, { fallbackToShell: false }));
    return;
  }

  event.respondWith(networkFirst(request));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'BM2_CACHE_OFFLINE') {
    event.waitUntil(warmOfflineCache());
  }
});
