// ─────────────────────────────────────────────────────────────────────────────
// CutPro Web — Service Worker
// Strategy: Cache-first for app shell, network-first for dynamic content
// ─────────────────────────────────────────────────────────────────────────────

const SW_VERSION = 'v1.0.0';
const CACHE_APP   = `cutpro-app-${SW_VERSION}`;
const CACHE_MEDIA = `cutpro-media-${SW_VERSION}`;
const CACHE_FONTS = `cutpro-fonts-${SW_VERSION}`;

// App shell — everything needed to run offline
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
];

// External font origins to cache
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL — pre-cache the app shell
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log(`[SW ${SW_VERSION}] Installing...`);

  event.waitUntil(
    caches.open(CACHE_APP)
      .then((cache) => {
        console.log(`[SW] Pre-caching app shell`);
        // Use individual adds so one 404 doesn't break everything
        return Promise.allSettled(
          APP_SHELL.map(url =>
            cache.add(url).catch(err => console.warn(`[SW] Failed to cache ${url}:`, err))
          )
        );
      })
      .then(() => {
        console.log(`[SW] App shell cached. Skipping waiting.`);
        return self.skipWaiting();
      })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE — clean up old caches
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log(`[SW ${SW_VERSION}] Activating...`);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        const current = [CACHE_APP, CACHE_MEDIA, CACHE_FONTS];
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('cutpro-') && !current.includes(name))
            .map(name => {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log(`[SW] Activated. Claiming clients.`);
        return self.clients.claim();
      })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — routing logic
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'blob:') return;

  // ── Fonts → cache-first, long TTL ──
  if (FONT_ORIGINS.some(origin => request.url.startsWith(origin))) {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // ── App shell (HTML, manifest, sw itself) → cache-first with network fallback ──
  if (
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  ) {
    event.respondWith(staleWhileRevalidate(request, CACHE_APP));
    return;
  }

  // ── Images / icons → cache-first ──
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/screenshots/') ||
    request.destination === 'image'
  ) {
    event.respondWith(cacheFirst(request, CACHE_APP));
    return;
  }

  // ── Everything else → network-first ──
  event.respondWith(networkFirst(request, CACHE_APP));
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHING STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache-first: serve from cache, fall back to network and cache the result.
 * Best for: fonts, icons, versioned assets.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Stale-while-revalidate: serve from cache immediately, update cache in background.
 * Best for: app shell HTML/JS/CSS — fast load + stays fresh.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Kick off network request in background
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || await networkPromise || offlineFallback(request);
}

/**
 * Network-first: try network, fall back to cache.
 * Best for: API requests, dynamic content.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || offlineFallback(request);
  }
}

/**
 * Offline fallback — return the cached index.html for navigation requests,
 * or a simple offline response for everything else.
 */
async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    const cache = await caches.open(CACHE_APP);
    const fallback = await cache.match('/index.html') || await cache.match('/');
    if (fallback) return fallback;
  }

  // Generic offline response
  return new Response(
    JSON.stringify({ error: 'offline', message: 'CutPro Web is offline' }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND SYNC — queue project saves when offline
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-project') {
    console.log('[SW] Background sync: syncing project data...');
    event.waitUntil(syncProjectData());
  }
});

async function syncProjectData() {
  // In a full implementation this would flush any queued
  // IndexedDB project saves to a remote server.
  console.log('[SW] Project data synced.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH NOTIFICATIONS (placeholder for render-complete notifications)
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || 'CutPro Web';
  const options = {
    body: data.body || 'Your export is ready.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    tag: data.tag || 'cutpro-notification',
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Open Editor' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const targetUrl = event.notification.data?.url || '/';
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE CHANNEL — communicate with the app
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.ports[0]?.postMessage({ type: 'VERSION', version: SW_VERSION });
      break;

    case 'CACHE_URLS':
      // Dynamically cache additional URLs sent from the app
      if (Array.isArray(payload?.urls)) {
        caches.open(CACHE_APP).then(cache => cache.addAll(payload.urls));
      }
      break;

    case 'CLEAR_MEDIA_CACHE':
      caches.delete(CACHE_MEDIA).then(() => {
        event.ports[0]?.postMessage({ type: 'MEDIA_CACHE_CLEARED' });
      });
      break;

    default:
      console.log('[SW] Unknown message type:', type);
  }
});

console.log(`[SW] CutPro Web Service Worker ${SW_VERSION} loaded.`);
