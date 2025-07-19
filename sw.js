const CACHE_NAME = 'radio-cache-v286.1.20250984';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/styles.css',
        '/script.js',
        '/stations.json',
        '/manifest.json',
        '/ping.txt'
      ]).then(() => {
        caches.keys().then((cacheNames) => {
          return Promise.all(cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          }));
        });
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (event.request.url.endsWith('stations.json')) {
        return fetch(event.request, { cache: 'no-store', signal: new AbortController().signal }).then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
          return networkResponse;
        }).catch(() => caches.match('/index.html'));
      }
      return response || fetch(event.request).then((networkResponse) => {
        return networkResponse;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'CACHE_UPDATED', cacheVersion: CACHE_NAME });
    });
  });
});

// Моніторинг стану мережі
let wasOnline = navigator.onLine;
let checkInterval = null;

function startNetworkCheck() {
  if (!checkInterval) {
    checkInterval = setInterval(() => {
      fetch("/ping.txt", { method: "HEAD", cache: "no-store" })
        .then(() => {
          if (!wasOnline) {
            wasOnline = true;
            self.clients.matchAll().then(clients => {
              clients.forEach(client => {
                client.postMessage({ type: "NETWORK_STATUS", online: true });
              });
            });
            stopNetworkCheck(); // Stop polling once online
          }
        })
        .catch(error => {
          if (wasOnline) {
            wasOnline = false;
            self.clients.matchAll().then(clients => {
              clients.forEach(client => {
                client.postMessage({ type: "NETWORK_STATUS", online: false });
              });
            });
          }
        });
    }, 2000); // Перевірка кожні 2 секунди
  }
}

function stopNetworkCheck() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

self.addEventListener('online', () => {
  if (!wasOnline) {
    wasOnline = true;
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: "NETWORK_STATUS", online: true });
      });
    });
    stopNetworkCheck(); // Stop polling when online
  }
});

self.addEventListener('offline', () => {
  if (wasOnline) {
    wasOnline = false;
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: "NETWORK_STATUS", online: false });
      });
    });
    startNetworkCheck(); // Start polling when offline
  }
});

// Start initial check if already offline
if (!navigator.onLine && wasOnline) {
  wasOnline = false;
  startNetworkCheck();
}