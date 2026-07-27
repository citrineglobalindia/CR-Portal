const CACHE='crportal-v30';
self.addEventListener('install', e=>{ self.skipWaiting(); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e=>{
  const req=e.request; if(req.method!=='GET') return;
  const url=new URL(req.url); if(url.origin!==location.origin) return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(r=>{ const c=r.clone(); caches.open(CACHE).then(ca=>ca.put(req,c)); return r; }).catch(()=>caches.match(req).then(m=>m||caches.match('/'))));
    return;
  }
  e.respondWith(caches.match(req).then(cached=>{
    const net=fetch(req).then(r=>{ if(r&&r.status===200){ const c=r.clone(); caches.open(CACHE).then(ca=>ca.put(req,c)); } return r; }).catch(()=>cached);
    return cached||net;
  }));
});
