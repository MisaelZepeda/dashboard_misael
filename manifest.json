const CACHE_NAME = 'dashpro-v1';

// Instalación básica
self.addEventListener('install', (e) => {
  console.log('Service Worker instalado');
});

// Activación
self.addEventListener('activate', (e) => {
  console.log('Service Worker activo');
});

// Este evento es OBLIGATORIO para que sea PWA
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
