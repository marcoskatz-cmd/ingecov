/* Service worker para Panel INGECO (PWA)
   Estrategias:
   - App shell (HTML/JS/CSS/fonts/iconos del repo): network-first con fallback
     a cache. Por qué network-first: si pusheamos una nueva versión, la próxima
     visita online la va a tomar enseguida en lugar de quedarse pegada a la vieja.
   - CDN (Chart.js): cache-first. No cambia seguido y un fetch a cdnjs en
     4G mata el TTI. Las fonts ahora son self-hosted (parte del shell).
   - gviz API (Google Sheets): siempre red, nunca cache. El cache de datos
     vive en localStorage controlado por la app (CACHE module en app.js),
     no acá. Mezclar ambas capas duplicaría lógica de TTL.
   Bump CACHE_VERSION para invalidar todo lo cacheado.
*/
// v3: bump para forzar invalidación del app.js viejo cacheado en HTTP cache del
// browser de clientes ya instalados. El JS vigente calcula horas en taller sumando
// todo PANEL_TRABAJOS (no solo 2026 como hacía una versión anterior).
const CACHE_VERSION = 'v52';
const SHELL_CACHE   = `ingecov-shell-${CACHE_VERSION}`;
const CDN_CACHE     = `ingecov-cdn-${CACHE_VERSION}`;

// Precarga al instalar. Si alguno falla, install igual termina OK
// (los que faltaron se cachearán en runtime).
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/init.js',
  // app.js se partió en 8 scripts clásicos (ago-2026). Si se agrega o renombra
  // alguno, sumarlo acá Y a index.html, y bumpear CACHE_VERSION.
  './js/01-core.js',
  './js/02-datos.js',
  './js/03-ui.js',
  './js/04-carga.js',
  './js/05-render.js',
  './js/06-tabs.js',
  './js/07-auditoria.js',
  './js/08-bootstrap.js',
  './fonts/fonts.css',
  './fonts/ibm-plex-sans-latin.woff2',
  './fonts/jetbrains-mono-latin.woff2',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
  './apple-touch-icon.png',
  './favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll falla atómicamente: si uno falla, ninguno se cachea.
    // Usamos add individuales para tolerar 404s temporales.
    await Promise.all(SHELL_ASSETS.map(url =>
      cache.add(url).catch(err => console.warn('[SW] skip cache:', url, err.message))
    ));
    self.skipWaiting(); // activa enseguida sin esperar reload
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Eliminar caches de versiones anteriores
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('ingecov-') && !n.endsWith(`-${CACHE_VERSION}`))
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

function isGvizRequest(url) {
  return url.hostname === 'docs.google.com' && url.pathname.includes('/gviz/');
}
function isCDNRequest(url) {
  return url.hostname === 'cdnjs.cloudflare.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // gviz: passthrough. La capa de cache vive en localStorage (CACHE module).
  if (isGvizRequest(url)) return;

  // CDN: cache-first.
  if (isCDNRequest(url)) {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // Solo manejamos same-origin de acá para abajo.
  if (url.origin !== self.location.origin) return;

  // App shell: network-first con fallback a cache.
  event.respondWith(networkFirst(req, SHELL_CACHE));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone()).catch(()=>{});
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Para navegaciones offline sin index cacheado, intentamos servir el root
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./');
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) {
    cache.put(req, fresh.clone()).catch(()=>{});
  }
  return fresh;
}
