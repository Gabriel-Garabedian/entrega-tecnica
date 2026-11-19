// Caches only public application assets, never API requests, login responses or user data.
const CACHE = 'entrega-shell-v6';
const ASSETS = ['index.html','style.css','app.js','model.js','storage.js','workspace.js','motion-ui.js','theme.js','cloud.js','cloud-config.js','pwa.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','vendor/motion.mjs','vendor/workspace.mjs','vendor/charts.mjs','vendor/supabase.mjs'].map(path => new URL(path, self.registration.scope).href);
const known = new Set(ASSETS);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => Promise.all(ASSETS.map(async url => {
  const response = await fetch(url, { cache: 'no-store' });
  const type = response.headers.get('content-type') || '';
  // A hosting sign-in page or redirect is never an application asset.
  if (!response.ok || response.redirected || (!url.endsWith('index.html') && type.includes('text/html'))) throw new Error('App asset unavailable.');
  if (url.endsWith('index.html') && !(await response.clone().text()).includes('<title>Entrega Técnica</title>')) throw new Error('Unexpected app shell.');
  await cache.put(url, response);
})))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('entrega-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate' && (new URL(request.url).pathname === new URL(self.registration.scope).pathname || request.url === ASSETS[0]);
  if (!navigation && !known.has(request.url)) return;
  event.respondWith(fetch(request).catch(async () => {
    const cached = await caches.match(navigation ? ASSETS[0] : request.url, { cacheName: CACHE });
    return cached || Response.error();
  }));
});
