const CACHE_NAME = 'dashboard-pro-v1';
const urlsToCache = [
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.png'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Interceptar peticiones para que la app cargue rapidísimo
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Devuelve lo que hay en caché, o hace la petición a internet
        return response || fetch(event.request);
      })
  );
});
