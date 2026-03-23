// ─────────────────────────────────────────────────────────────────────────────
// CutPro Web — Service Worker v3.0.0
// ─────────────────────────────────────────────────────────────────────────────

const SW_VERSION   = 'v4.0.0';
const CACHE_APP    = `cutpro-app-${SW_VERSION}`;
const CACHE_AUDIO  = `cutpro-audio-${SW_VERSION}`;   // dedicated audio cache
const CACHE_FONTS  = `cutpro-fonts-${SW_VERSION}`;

const AUDIO_CACHE_LIMIT_MB = 300;  // evict LRU when audio cache exceeds this
const AUDIO_CACHE_LIMIT    = AUDIO_CACHE_LIMIT_MB * 1024 * 1024;

const APP_SHELL = [
  './',
  './manifest.json',
];

const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// Audio origins we actively cache
const AUDIO_ORIGINS = [
  'ia800201.us.archive.org',
  'ia800504.us.archive.org',
  'ia800303.us.archive.org',
  'ia600301.us.archive.org',
  'ia801605.us.archive.org',
  'ia800501.us.archive.org',
  'ia600607.us.archive.org',
  'ia600401.us.archive.org',
  'ia600304.us.archive.org',
  'ia600202.us.archive.org',
  'ia600305.us.archive.org',
  'ia800304.us.archive.org',
  'ia600509.us.archive.org',
  'ia800607.us.archive.org',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log(`[SW ${SW_VERSION}] Installing…`);
  event.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(e => console.warn('[SW] cache miss:', url, e)))
      ))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log(`[SW ${SW_VERSION}] Activating…`);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('cutpro-') && ![CACHE_APP, CACHE_AUDIO, CACHE_FONTS].includes(k))
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'blob:') return;

  // Fonts → cache-first
  if (FONT_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // Audio from known archive.org CDN hosts → audio-specific cache
  if (AUDIO_ORIGINS.includes(url.hostname) && url.pathname.endsWith('.mp3')) {
    event.respondWith(audioCacheFirst(request));
    return;
  }

  // App shell → network first (always fresh)
  if (
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    request.mode === 'navigate'
  ) {
    event.respondWith(networkFirst(request, CACHE_APP));
    return;
  }

  // Icons/images → cache-first
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/screenshots/') ||
    request.destination === 'image'
  ) {
    event.respondWith(cacheFirst(request, CACHE_APP));
    return;
  }

  // Everything else → network-first
  event.respondWith(networkFirst(request, CACHE_APP));
});

// ── AUDIO CACHE STRATEGY ──────────────────────────────────────────────────────
// Cache-first for audio: serve instantly if cached, otherwise fetch+cache+serve
async function audioCacheFirst(request) {
  const cache  = await caches.open(CACHE_AUDIO);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      // Store in audio cache
      await cache.put(request, response.clone());
      // Enforce size limit asynchronously
      enforceAudioCacheLimit().catch(() => {});
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

// Evict oldest entries when cache exceeds limit
async function enforceAudioCacheLimit() {
  const cache   = await caches.open(CACHE_AUDIO);
  const keys    = await cache.keys();
  if (keys.length === 0) return;

  // Estimate total size
  let totalSize = 0;
  const entries = [];
  for (const req of keys) {
    const resp = await cache.match(req);
    if (!resp) continue;
    const clone = resp.clone();
    const buf   = await clone.arrayBuffer();
    entries.push({ req, size: buf.byteLength });
    totalSize += buf.byteLength;
  }

  // Sort by insertion order (keys() returns in insertion order)
  // Evict oldest (front of array) until under limit
  let i = 0;
  while (totalSize > AUDIO_CACHE_LIMIT && i < entries.length) {
    await cache.delete(entries[i].req);
    totalSize -= entries[i].size;
    console.log('[SW] Evicted from audio cache:', entries[i].req.url.split('/').pop());
    i++;
  }
}

// ── STANDARD STRATEGIES ───────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return offlineFallback(request);
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || offlineFallback(request);
  }
}

async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    const cache    = await caches.open(CACHE_APP);
    const fallback = await cache.match('./') || await cache.match('./index.html') || await cache.match('index.html');
    if (fallback) return fallback;
  }
  return new Response(
    JSON.stringify({ error: 'offline', message: 'CutPro Web is offline' }),
    { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'application/json' } }
  );
}

// ── MESSAGES ──────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.ports[0]?.postMessage({ type: 'VERSION', version: SW_VERSION });
      break;

    // Explicitly pre-cache a list of audio URLs (called when user pins tracks offline)
    case 'CACHE_AUDIO_URLS':
      if (Array.isArray(payload?.urls)) {
        caches.open(CACHE_AUDIO).then(async cache => {
          let cached = 0;
          for (const url of payload.urls) {
            try {
              const existing = await cache.match(url);
              if (!existing) {
                const resp = await fetch(url);
                if (resp.ok) { await cache.put(url, resp); cached++; }
              } else { cached++; }
            } catch(e) { console.warn('[SW] Failed to cache audio:', url, e); }
          }
          event.ports[0]?.postMessage({ type: 'AUDIO_CACHED', count: cached, total: payload.urls.length });
        });
      }
      break;

    // Query which URLs are currently in the audio cache
    case 'GET_CACHED_AUDIO_URLS':
      caches.open(CACHE_AUDIO).then(async cache => {
        const keys = await cache.keys();
        event.ports[0]?.postMessage({
          type: 'CACHED_AUDIO_URLS',
          urls: keys.map(r => r.url),
        });
      });
      break;

    // Remove specific URLs from audio cache
    case 'UNCACHE_AUDIO_URLS':
      if (Array.isArray(payload?.urls)) {
        caches.open(CACHE_AUDIO).then(async cache => {
          for (const url of payload.urls) await cache.delete(url);
          event.ports[0]?.postMessage({ type: 'AUDIO_UNCACHED' });
        });
      }
      break;

    // Get audio cache size
    case 'GET_AUDIO_CACHE_SIZE':
      caches.open(CACHE_AUDIO).then(async cache => {
        const keys = await cache.keys();
        let total = 0;
        for (const req of keys) {
          const resp = await cache.match(req);
          if (resp) { const buf = await resp.clone().arrayBuffer(); total += buf.byteLength; }
        }
        event.ports[0]?.postMessage({
          type: 'AUDIO_CACHE_SIZE',
          bytes: total,
          count: keys.length,
          limitMb: AUDIO_CACHE_LIMIT_MB,
        });
      });
      break;

    // Clear entire audio cache
    case 'CLEAR_AUDIO_CACHE':
      caches.delete(CACHE_AUDIO).then(() => {
        event.ports[0]?.postMessage({ type: 'AUDIO_CACHE_CLEARED' });
      });
      break;

    case 'CLEAR_MEDIA_CACHE':
      caches.delete(CACHE_AUDIO).then(() => {
        event.ports[0]?.postMessage({ type: 'MEDIA_CACHE_CLEARED' });
      });
      break;

    // Show a local notification directly from app JS (no server needed)
    case 'SHOW_NOTIFICATION':
      if (payload?.title) {
        self.registration.showNotification(payload.title, {
          body:    payload.body || '',
          icon:    './icons/icon-192.png',
          badge:   './icons/icon-192.png',
          tag:     payload.tag || 'cutpro-local',
          data:    { url: './' },
          silent:  payload.silent || false,
        });
      }
      break;

    // App queued a save while offline — store in IndexedDB
    case 'QUEUE_PROJECT_SAVE':
      if (payload?.data) {
        queueProjectSave(payload.data).then(() => {
          event.ports[0]?.postMessage({ type: 'SAVE_QUEUED' });
        }).catch(() => {
          event.ports[0]?.postMessage({ type: 'QUEUE_FAILED' });
        });
      }
      break;

    default:
      console.log('[SW] Unknown message type:', type);
  }
});

// ── Background Sync — offline project save queue ─────────────────────────────
// When a save is queued while offline, Background Sync fires this when reconnected.
// Reads pending saves from IndexedDB and flushes them to the client via postMessage.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-project-queue') {
    event.waitUntil(flushProjectSaveQueue());
  }
  if (event.tag === 'sync-audio-cache') {
    event.waitUntil(retryFailedAudioDownloads());
  }
});

const IDB_NAME    = 'cutpro-offline-queue';
const IDB_VERSION = 1;
const IDB_STORE   = 'pending-saves';

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// Called by app JS to queue a save when offline
async function queueProjectSave(projectData) {
  const db    = await openQueueDB();
  const tx    = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  store.add({ savedAt: Date.now(), data: projectData });
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

// Flush all queued saves back to app clients when back online
async function flushProjectSaveQueue() {
  let db;
  try { db = await openQueueDB(); } catch(e) { return; }

  const tx      = db.transaction(IDB_STORE, 'readwrite');
  const store   = tx.objectStore(IDB_STORE);
  const records = await new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });

  if (!records.length) return;

  // Send each queued save to active clients to merge into localStorage
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const record of records) {
    for (const client of clients) {
      client.postMessage({
        type: 'SYNC_QUEUED_SAVE',
        payload: { id: record.id, data: record.data, savedAt: record.savedAt },
      });
    }
    // Remove after sending
    store.delete(record.id);
  }

  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });

  // Notify clients that sync is complete
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_COMPLETE', count: records.length });
  }
}

// Retry any audio downloads that failed while offline
async function retryFailedAudioDownloads() {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'RETRY_AUDIO_DOWNLOADS' });
    }
  } catch(e) {}
}

// ── Push notifications (fully wired — needs VAPID server to send payloads) ────
// The push handler is complete. To activate remote push:
//   1. Generate VAPID keys (see app JS — Settings > Notifications)
//   2. Send the subscription object to your server
//   3. Server sends Web Push payloads to this handler
//   Without a server, local notifications still work for in-app events.

self.addEventListener('push', (event) => {
  // Gracefully handle both JSON and plain-text payloads
  let data = {};
  if (event.data) {
    try       { data = event.data.json(); }
    catch(e)  { data = { body: event.data.text() }; }
  }

  const title   = data.title   || 'CutPro Web';
  const body    = data.body    || 'Something happened in your project.';
  const tag     = data.tag     || 'cutpro-notification';
  const url     = data.url     || './';
  const actions = data.actions || [];

  const options = {
    body,
    icon:   './icons/icon-192.png',
    badge:  './icons/icon-192.png',
    tag,
    renotify: !!data.renotify,
    requireInteraction: !!data.requireInteraction,
    data:   { url },
    actions: [
      ...actions,
      { action: 'open',    title: 'Open Editor' },
      { action: 'dismiss', title: 'Dismiss' },
    ].slice(0, 2), // max 2 actions on most platforms
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus existing tab if already open
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open new tab
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── SW message: show a local notification (called by app JS for in-app events) ─
// This is separate from remote push — fires immediately from the app itself.
// Usage: postMessage({ type: 'SHOW_NOTIFICATION', payload: { title, body, tag } })

console.log(`[SW] CutPro Web Service Worker ${SW_VERSION} loaded.`);
