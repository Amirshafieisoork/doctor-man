const CACHE='drman-public-v1';
const PUBLIC=['/','/doctors','/pricing','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(PUBLIC)).catch(()=>null));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const u=new URL(req.url);if(u.origin!==location.origin)return;
  if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/health')||u.pathname.startsWith('/profile')||u.pathname.startsWith('/doctor-portal')||u.pathname.startsWith('/admin')||u.pathname.startsWith('/settings')||u.pathname.startsWith('/auth'))return;
  event.respondWith(fetch(req).then(r=>{if(r.ok&&r.type==='basic'){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;}).catch(()=>caches.match(req).then(r=>r||caches.match('/'))));
});
