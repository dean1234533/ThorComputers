/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { StaleWhileRevalidate, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

// ---- Caching policy -------------------------------------------------------------
// Only the app shell and public static assets are cached. Firestore, Functions and Storage traffic
// (customer details, messages, documents) is deliberately NEVER cached by the service worker.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
const shell = createHandlerBoundToURL('/index.html')
registerRoute(new NavigationRoute(async (opts) => {
  try { return await shell(opts) } catch { return (await caches.match('/offline.html')) ?? Response.error() }
}, { denylist: [/^\/__\//, /^\/api\//] }))
registerRoute(({ url }) => url.origin === 'https://fonts.gstatic.com' || url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'fonts', plugins: [new ExpirationPlugin({ maxEntries: 12, maxAgeSeconds: 365 * 86400 })] }))
registerRoute(({ url }) => url.pathname.startsWith('/brand/'), new CacheFirst({ cacheName: 'brand', plugins: [new ExpirationPlugin({ maxEntries: 10 })] }))

// ---- Updates: the page asks the user before swapping versions ------------------
self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting() })
self.addEventListener('activate', () => { self.clients.claim() })

// ---- Push (FCM) ---------------------------------------------------------------------
const env = import.meta.env
// Push is optional: a missing/invalid Firebase config must never stop the service worker (and offline support) from loading.
try {
  if (env.VITE_FIREBASE_MESSAGING_SENDER_ID && env.VITE_FIREBASE_APP_ID) {
    const fb = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID })
    // Payloads are data-only and deliberately generic (no names, addresses or message text) because they appear on lock screens.
    onBackgroundMessage(getMessaging(fb), (payload) => {
      const d = payload.data ?? {}
      if (!d.title) return
      return self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { link: d.link || '/' }, silent: false, vibrate: [200, 100, 200], renotify: true } as NotificationOptions)
    })
  }
} catch (e) { console.warn('Push disabled in service worker:', e) }
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = new URL((event.notification.data?.link as string) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) if (new URL(w.url).origin === self.location.origin) { await w.focus(); w.postMessage({ type: 'NAVIGATE', link }); return }
    await self.clients.openWindow(link)
  })())
})
