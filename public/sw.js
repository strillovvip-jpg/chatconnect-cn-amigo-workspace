// 独立中文项目缓存，不与英文生产站共享。
const CACHE_NAME = "chatconnect-cn-full-v2";
const urlsToCache = [
  "/",
  "/site.webmanifest",
  "/icon/shojin-180.png?v=1",
  "/icon/shojin-192.png?v=1",
  "/icon/shojin-512.png?v=1",
];

// Install event - cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting()),
  );
});

// Fetch event - network first, fall back to cache
self.addEventListener("fetch", (event) => {
  // Only handle GET requests - POST/PUT/DELETE cannot be cached
  if (event.request.method !== "GET") {
    return;
  }

  // Never intercept cross-origin requests
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never intercept auth paths
  if (url.pathname.startsWith("/auth")) {
    return;
  }

  // Handle navigation requests differently
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        caches.match("/"),
      ),
    );
    return;
  }

  // Network-first for other same-origin GET requests
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful responses (status 200-299)
        if (!response.ok) {
          return response;
        }
        const responseToCache = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, responseToCache));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

// Handle push notifications - only show if app is not in focus
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const isAppInFocus = clientList.some((client) => client.focused);

        // Only show notification if app is not in focus
        if (!isAppInFocus) {
          return self.registration.showNotification(data.title, data.options);
        }
      }),
  );
});

// Handle notification clicks - opens/focuses the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      // Focus existing window if found
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client)
            return client.navigate(targetUrl).then(() => client.focus());
          return client.focus();
        }
      }
      // Open new window if none exists
      if (clients.openWindow) return clients.openWindow(targetUrl);
    }),
  );
});
