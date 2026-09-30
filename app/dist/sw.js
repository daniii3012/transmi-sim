// Service worker de la aplicación instalable. Solo se registra en el sitio publicado (HTTPS).
//
// Una caché por versión de la página (la cadena ?v con que se registra este archivo); al activarse
// una versión nueva, las demás se borran. Tres maneras de responder:
// - la página: primero la red y, sin conexión, la copia guardada;
// - módulos y estilos, que llevan la versión en la dirección: primero la caché;
// - datos, teselas de edificios y puntos de control: la copia guardada al instante y, por detrás,
//   la de la red para la próxima visita. La segunda visita no descarga los ~14 MB de datos.
const VERSION=new URL(self.location).searchParams.get('v')||'dev';
const CACHE='transmisim-'+VERSION;
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(c=>c.add(new Request('./',{cache:'reload'}))).catch(()=>{}));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('transmisim-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==self.location.origin)return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put(request,copy));return response;}).catch(()=>caches.match(request).then(hit=>hit||caches.match('./'))));
  return;
 }
 if(url.searchParams.has('v')){
  event.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(request);if(hit)return hit;const response=await fetch(request);if(response.ok)c.put(request,response.clone());return response;}));
  return;
 }
 event.respondWith(caches.open(CACHE).then(async c=>{
  const key=url.href,hit=await c.match(key);
  const fresh=fetch(key).then(response=>{if(response.ok)c.put(key,response.clone());return response;}).catch(()=>hit||Response.error());
  if(hit){event.waitUntil(fresh.catch(()=>{}));return hit;}
  return fresh;
 }));
});
