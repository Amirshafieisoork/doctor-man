const CACHE='drman-public-v6';
const PUBLIC=['/','/doctors','/pricing','/learn','/medical-methodology','/privacy','/terms','/doctor-onboarding','/manifest.webmanifest','/assets/drman-logo.svg','/assets/theme-v1.css'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(PUBLIC)).catch(()=>null));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const u=new URL(req.url);if(u.origin!==location.origin)return;
  // Tokenized emergency cards and all clinical routes must stay out of caches.
  if(u.pathname.startsWith('/emergency/'))return;
  if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/health')||u.pathname.startsWith('/profile')||u.pathname.startsWith('/doctor-portal')||u.pathname.startsWith('/admin')||u.pathname.startsWith('/settings')||u.pathname.startsWith('/auth')||u.pathname.startsWith('/account')||u.pathname.startsWith('/visit-intake')||u.pathname.startsWith('/payment-result')||u.pathname.startsWith('/support'))return;
  if(!PUBLIC.includes(u.pathname)&&!u.pathname.startsWith('/assets/'))return;
  if(u.search)return;
  event.respondWith(fetch(req).then(r=>{if(r.ok&&r.type==='basic'&&!/no-store|private/i.test(r.headers.get('Cache-Control')||'')){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;}).catch(()=>caches.match(req).then(r=>r||(req.mode==='navigate'?caches.match('/'):Response.error()))));
});
