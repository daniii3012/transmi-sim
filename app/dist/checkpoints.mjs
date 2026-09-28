// Puntos de control guardados, para no simular desde las 03:00 cada vez que alguien abre la página.
//
// Dos orígenes, en este orden:
// 1. Los que se calcularon al publicar en Pages con el escenario inicial (carpeta checkpoints/ junto a
//    la página; la genera tools/build_day_checkpoints.mjs y no se versiona).
// 2. Los que este navegador ya simuló, guardados en IndexedDB: cualquier escenario —otros parámetros,
//    otra selección, otro día— vuelve a abrirse al instante la segunda vez.
//
// La llave de cada uno es la versión de la aplicación, la llave del escenario (Traffic.scenarioKey) y
// el segundo del día de servicio. Un punto de control de otra versión o de otro escenario no se usa:
// el motor restaurado tiene que llegar exactamente al mismo estado que simulando desde cero.
const VERSION=new URL(import.meta.url).searchParams.get('v')||'dev';
const DB='transmi-sim',KEEP=8,MAGIC=[0x1f,0x8b];
let db=null,published=null;
const known=new Map();// llave del escenario → Map(segundo → 'pub'|'idb')

function request(r){return new Promise((ok,fail)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});}
function openDb(){
 if(db)return db;
 db=new Promise((ok,fail)=>{
  if(typeof indexedDB==='undefined')return fail(new Error('Sin IndexedDB'));
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('meta');d.createObjectStore('data');};
  r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);r.onblocked=()=>fail(new Error('IndexedDB bloqueada'));
 }).then(async d=>{
  // Limpieza al abrir: fuera lo de otras versiones y, de lo demás, los escenarios menos usados.
  const tx=d.transaction(['meta','data'],'readwrite'),meta=tx.objectStore('meta'),store=tx.objectStore('data');
  const [keys,values]=await Promise.all([request(meta.getAllKeys()),request(meta.getAll())]);
  const used=new Map();
  keys.forEach((k,x)=>{const v=values[x];if(v.version!==VERSION){meta.delete(k);store.delete(k);return;}used.set(v.scenario,Math.max(used.get(v.scenario)||0,v.used));});
  const drop=new Set([...used].sort((a,b)=>b[1]-a[1]).slice(KEEP).map(e=>e[0]));
  keys.forEach((k,x)=>{const v=values[x];if(v.version===VERSION&&drop.has(v.scenario)){meta.delete(k);store.delete(k);}});
  await new Promise(ok=>{tx.oncomplete=ok;tx.onerror=ok;tx.onabort=ok;});
  return d;
 });
 db.catch(()=>{});
 return db;
}
function loadPublished(){
 published ||= fetch(new URL('./checkpoints/index.json',import.meta.url)).then(r=>r.ok?r.json():null).then(index=>index&&index.version===VERSION?index:null).catch(()=>null);
 return published;
}
const id=(scenario,t)=>`${VERSION}|${scenario}|${t}`;

/** Qué instantes hay guardados para este escenario, de cualquiera de los dos orígenes. */
export async function available(scenario){
 const times=known.get(scenario)||new Map();known.set(scenario,times);
 const index=await loadPublished();
 for(const t of index?.scenarios?.[scenario]?.times||[])times.set(t,'pub');
 try{
  const d=await openDb(),meta=d.transaction('meta').objectStore('meta');
  const range=IDBKeyRange.bound(id(scenario,''),id(scenario,'￿'));
  for(const k of await request(meta.getAllKeys(range))){const t=Number(k.slice(k.lastIndexOf('|')+1));if(!times.has(t))times.set(t,'idb');}
 }catch{}
 return times;
}
/** El instante guardado más tardío que no pase de `upTo` y que adelante algo frente a `from`. */
export function best(scenario,upTo,from){
 let hit=-1;for(const t of known.get(scenario)?.keys()||[])if(t<=upTo&&t>from&&t>hit)hit=t;return hit;
}
export const has=(scenario,t)=>!!known.get(scenario)?.has(t);

async function inflate(buffer){
 const bytes=new Uint8Array(buffer);if(bytes[0]!==MAGIC[0]||bytes[1]!==MAGIC[1])return buffer;
 return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function deflate(buffer){
 if(typeof CompressionStream==='undefined')return buffer;
 return new Response(new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}
export async function load(scenario,t){
 const source=known.get(scenario)?.get(t);
 try{
  if(source==='pub'){
   const r=await fetch(new URL(`./checkpoints/${scenario}/${t}.ckpt`,import.meta.url));if(!r.ok)throw new Error(r.status);
   return await inflate(await r.arrayBuffer());
  }
  const d=await openDb(),tx=d.transaction(['meta','data'],'readwrite'),key=id(scenario,t);
  const [buffer,meta]=await Promise.all([request(tx.objectStore('data').get(key)),request(tx.objectStore('meta').get(key))]);
  if(!buffer)throw new Error('No está');
  if(meta)tx.objectStore('meta').put({...meta,used:Date.now()},key);
  return await inflate(buffer);
 }catch(error){known.get(scenario)?.delete(t);throw error;}
}
let broken=false;
export async function save(scenario,t,buffer){
 const times=known.get(scenario)||new Map();known.set(scenario,times);
 if(broken||times.has(t))return;times.set(t,'idb');
 try{
  const packed=await deflate(buffer),d=await openDb(),tx=d.transaction(['meta','data'],'readwrite'),key=id(scenario,t);
  tx.objectStore('data').put(packed,key);tx.objectStore('meta').put({version:VERSION,scenario,t,used:Date.now(),bytes:packed.byteLength},key);
  await new Promise((ok,fail)=>{tx.oncomplete=ok;tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error);});
 }catch{times.delete(t);broken=true;}// sin espacio o sin IndexedDB (ventana privada): se sigue sin caché
}
