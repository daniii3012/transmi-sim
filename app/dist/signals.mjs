import {travelProfile,travelTimeAtDistance,travelAt} from './travel.mjs?v=20261003.1';

// Existence is sourced from OSM. These phases are explicitly scenario estimates.
export const SIGNAL_CYCLE=Object.freeze({cycle:90,green:52,amber:3});
// Lo que un semáforo cuesta en promedio, deducido del mismo ciclo que usa signalPhase: se detiene
// quien llega fuera del verde, y la espera media es la integral de (ciclo−fase) sobre el ciclo.
// Sirve para descontar del tiempo publicado lo que ya lleva dentro de semáforos, sin simularlos dos veces.
export const SIGNAL_EXPECTED=Object.freeze({
 stopChance:(SIGNAL_CYCLE.cycle-SIGNAL_CYCLE.green)/SIGNAL_CYCLE.cycle,
 wait:(SIGNAL_CYCLE.cycle-SIGNAL_CYCLE.green)**2/(2*SIGNAL_CYCLE.cycle),
});
function phaseOffset(id){let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
// Desfase fijo de un cruce sobre su ciclo, para quien consulta millones de veces la misma luz.
export function signalOffset(id,cycle=SIGNAL_CYCLE.cycle){return phaseOffset(id)%cycle;}
// Un cruce se publica en OSM como varios nodos —uno por calzada, a veces uno por carril— y cada uno
// tenía su propio desfase: un bus debía encontrar en verde dos, tres o cuatro luces independientes a
// pocos metros, y el verde efectivo se reducía a una fracción del ciclo. Los nodos a menos de 60 m se
// agrupan y comparten la fase del primero: son el mismo cruce o cruces tan próximos que en la calle
// los maneja un mismo controlador; con fases independientes, entre uno y otro cabe un solo bus.
const clusterCache=new WeakMap();
export function signalClusters(catalogue,radius=60){
 if(!catalogue)return new Map();if(clusterCache.has(catalogue))return clusterCache.get(catalogue);
 const list=[...(catalogue.signals||[])].sort((a,b)=>String(a.id).localeCompare(String(b.id))),grid=new Map(),parent=new Map(),out=new Map();
 const find=id=>{let r=id;while(parent.get(r)!==r)r=parent.get(r);parent.set(id,r);return r;};
 for(const s of list){parent.set(s.id,s.id);const gx=Math.floor(s.xy[0]/radius),gy=Math.floor(s.xy[1]/radius);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const o of grid.get((gx+dx)+':'+(gy+dy))||[])if(Math.hypot(o.xy[0]-s.xy[0],o.xy[1]-s.xy[1])<=radius){const a=find(o.id),b=find(s.id);if(a!==b)parent.set(a<b?b:a,a<b?a:b);}
  const key=gx+':'+gy;(grid.get(key)||grid.set(key,[]).get(key)).push(s);}
 for(const s of list)out.set(s.id,find(s.id));
 clusterCache.set(catalogue,out);return out;
}
// El ciclo se puede ajustar por escenario; sin argumento rige el estimado de 90 s. El desfase de
// cada cruce sale de su identificador y se reparte sobre el ciclo vigente.
/** Verde propio de una intersección (`signal_timings` en field_corrections.json), como fracción del
 * ciclo: un cruce de obra con cuatro accesos le da a TransMilenio menos verde que el plan general. El
 * verde recortado queda centrado en el del plan (`shift`, segundos que se corre su inicio), así el
 * rojo crece por los dos lados. Por intersección (el primer nodo del grupo). */
export function signalGreens(data,clusters,cycle,green=SIGNAL_CYCLE.green){
 const out=new Map();
 for(const c of data?.field_corrections?.signal_timings||[]){const own=Math.round(c.green_share*cycle);for(const id of c.signals||[])out.set(clusters.get(id)||id,{green:own,shift:Math.max(0,(green-own)/2)});}
 return out;
}
export function signalPhase(id,time,timing=SIGNAL_CYCLE){
 const {cycle,green,amber}=timing,p=((time+phaseOffset(id)%cycle)%cycle+cycle)%cycle;
 return {color:p<green?'green':p<green+amber?'amber':'red',wait:p<green?0:cycle-p};
}
function compatible(signal,angle){
 if(!signal.evidence?.direct_membership)return false;
 return (signal.evidence.qualifying_ways||[]).some(way=>{
  if(!Number.isFinite(way.directed_angle_deg))return false;
  const dot=Math.cos(angle-way.directed_angle_deg*Math.PI/180);if(Math.abs(dot)<.87)return false;
  const direction=signal.direction?.['traffic_signals:direction'];
  if(direction==='forward'&&dot<0||direction==='backward'&&dot>0)return false;
  if(['yes','1','true'].includes(way.oneway)&&dot<0||way.oneway==='-1'&&dot>0)return false;
  return true;
 });
}
export function matchSignals(path,catalogue){
 const result=[];
 for(const signal of catalogue?.signals||[]){
  const matches=[];
  for(let i=1;i<path.points.length;i++){
   const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=path.cumulative[i]-path.cumulative[i-1];if(!length)continue;
   const u=Math.max(0,Math.min(1,((signal.xy[0]-a[0])*dx+(signal.xy[1]-a[1])*dy)/(length*length)));
   const distance=Math.hypot(signal.xy[0]-a[0]-u*dx,signal.xy[1]-a[1]-u*dy);
   if(distance<=12&&compatible(signal,Math.atan2(dy,dx)))matches.push({id:signal.id,at_m:path.cumulative[i-1]+u*length,distance});
  }
  // Adjacent polyline vertices can project to the same approach; retain separate laps.
  matches.sort((a,b)=>a.distance-b.distance);const chosen=[];
  for(const p of matches)if(!chosen.some(q=>Math.abs(p.at_m-q.at_m)<25))chosen.push(p);
  result.push(...chosen);
 }
 return result.sort((a,b)=>a.at_m-b.at_m);
}
// `limitAt` deja que el techo de velocidad cambie a lo largo del tramo: por ahí entra la velocidad
// medida de cada trecho de corredor. Las esperas que el respaldo añade van después del último
// semáforo, así que no mueven ninguna fase y no hace falta intercalarlas aquí.
export function signalTravel(path,from,to,limit,a,b,departure,signals,cache=new Map(),key='',limitAt=null){
 const checkpoints=signals.filter(s=>s.at_m>from+.1&&s.at_m<to-.1),forced=new Set();
 for(let pass=0;pass<=checkpoints.length;pass++){
  const mask=[...forced].sort((a,b)=>a-b).join(','),profileKey=key+'/'+mask;
  let profile=cache.get(profileKey);if(!profile){profile=travelProfile(path,from,to,limit,a,b,{checkpoints:checkpoints.map(s=>s.at_m-from),stops:[...forced].map(i=>checkpoints[i].at_m-from),limitAt});cache.set(profileKey,profile);}
  const holds=[];let delay=0,retry=false;
  for(const [i,signal] of checkpoints.entries()){
   const arrival=departure+travelTimeAtDistance(profile,signal.at_m-from)+delay,phase=signalPhase(signal.id,arrival);
   if(phase.wait>1e-7&&!forced.has(i)){forced.add(i);retry=true;break;}
   if(phase.wait>1e-7){holds.push({signalId:signal.id,at_m:signal.at_m,start:arrival,end:arrival+phase.wait});delay+=phase.wait;}
  }
  if(!retry)return {profile,holds,duration:profile.duration+delay};
 }
 throw Error('No se pudo resolver el recorrido semafórico');
}
export function signalTravelAt(move,time){
 let delay=0;
 for(const hold of move.holds||[]){
  if(time<hold.start)break;
  if(time<hold.end)return {s:hold.at_m-move.from,speed:0,signalId:hold.signalId||null,signalWait:hold.end-time,congestion:!!hold.congestion};
  delay+=hold.end-hold.start;
 }
 return travelAt(move.profile,time-move.start-delay);
}
/** Aplica las correcciones observadas en la calle (`field_corrections.json`) al catálogo de semáforos:
 * los que se retiran dejan de existir para el motor y para el mapa. Se puede llamar más de una vez. */
/** Semáforos que solo detienen a quien gira en el cruce (`applies_to: 'turning'`): el recorrido que
 * sigue derecho —menos de 30° de giro en los 150 m siguientes— no lo encuentra. */
export function turningOnly(data,path,signals){
 const only=new Set((data.field_corrections?.signals_removed||[]).filter(s=>s.applies_to==='turning').map(s=>s.id));if(!only.size)return signals;
 return signals.filter(s=>{if(!only.has(s.id))return true;const a=path.sample(Math.max(0,s.at_m-20)).angle,b=path.sample(Math.min(path.length,s.at_m+150)).angle;let d=Math.abs(b-a)%(2*Math.PI);if(d>Math.PI)d=2*Math.PI-d;return d>30*Math.PI/180;});
}
// Proyección de un punto sobre una polilínea: abscisa y distancia.
function projectOn(points,p){let best=null,acc=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy,l=Math.sqrt(l2);if(!l2)continue;const u=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)),d=Math.hypot(a[0]+dx*u-p[0],a[1]+dy*u-p[1]);if(!best||d<best.d)best={at:acc+u*l,d};acc+=l;}return best;}
/** Paradas nuevas que el GTFS todavía no trae (`stops_added`): se insertan en el recorrido de cada
 * servicio, en su orden, y el tiempo publicado del tramo se reparte según la distancia. Una vez por
 * juego de datos. */
function addStops(data){
 if(data._stopsAdded||!data.field_corrections?.stops_added)return;data._stopsAdded=true;
 for(const c of data.field_corrections.stops_added){
  const st=data.stations?.find(s=>s.id===c.station_id);if(!st)continue;
  for(const r of data.routes||[]){
   const wagon=c.wagons?.[r.code];if(!wagon||!r.ready||r.stops.some(s=>s.station_id===c.station_id))continue;
   const hit=projectOn(r.points,st.xy);if(!hit||hit.d>40)continue;
   const k=r.stops.findIndex(s=>s.at_m>hit.at);if(k<=0)continue;
   const prev=r.stops[k-1],next=r.stops[k],f=(hit.at-prev.at_m)/Math.max(1,next.at_m-prev.at_m);
   r.stops.splice(k,0,{station_id:st.id,code:null,name:st.name,kind:'station',at_m:hit.at,published_position_m:hit.at,coordinate_source:'field_correction',snap_distance_m:Math.round(hit.d),wagons:2,wagons_source:'field_correction'});
   const h=data.schedule?.routes?.[r.id];
   for(const key of ['segments','observed'])if(h?.[key]?.[k-1]){const seg=h[key][k-1];h[key].splice(k-1,1,seg.map(v=>v==null?v:v*f),seg.map(v=>v==null?v:v*(1-f)));}
   (data.station_wagons ||= {assignments:[]}).assignments.push({station_id:st.id,route_id:r.id,code:r.code,destination:r.name,kind:'station',label:String(wagon),wagon,doors:[]});
  }
 }
}
/** Tramos de calzada que cambiaron en la calle y la fuente todavía no trae (`path_overrides`), como el
 * desvío por obras en Puente Aranda: entre dos vértices que el recorrido publica, el trazado observado
 * reemplaza al de la fuente. Las paradas siguientes se corren lo que cambió el largo y el tramo queda
 * marcado (`single_lane`) para que el motor le deje un carril. No se aplica a un recorrido con una
 * parada en medio del tramo. Una vez por juego de datos. */
function reroute(data){
 if(data._rerouted||!data.field_corrections?.path_overrides)return;data._rerouted=true;
 const key=p=>p[0]+','+p[1],len=pts=>{let s=0;for(let i=1;i<pts.length;i++)s+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);return s;};
 for(const c of data.field_corrections.path_overrides){
  // El semáforo del cruce va con la calzada: queda sobre el trazado nuevo.
  for(const m of c.signals_moved||[]){const s=data.busway_signals?.signals?.find(s=>s.id===m.id);if(s)s.xy=[...m.xy];}
  for(const r of data.routes||[]){
   const i=r.points.findIndex(p=>key(p)===key(c.from)),j=i<0?-1:r.points.findIndex((p,k)=>k>i&&key(p)===key(c.to));if(j<0)continue;
   const before=len(r.points.slice(0,i+1)),old=len(r.points.slice(i,j+1));
   if(r.stops.some(s=>s.at_m>before&&s.at_m<before+old))continue;
   const fresh=[c.from,...c.points,c.to].map(p=>[...p]),delta=len(fresh)-old;
   r.points.splice(i,j-i+1,...fresh);
   for(const s of r.stops)if(s.at_m>=before+old)s.at_m+=delta;
   if(r.length_m!=null)r.length_m+=delta;
   if(c.lanes===1)(r.single_lane ||= []).push([before,before+old+delta]);
  }
 }
}
export function applyFieldCorrections(data){
 reroute(data);addStops(data);
 const removed=new Set((data.field_corrections?.signals_removed||[]).filter(s=>!s.applies_to).map(s=>s.id));
 for(const c of data.field_corrections?.stations_status||[]){const st=data.stations?.find(s=>s.id===c.id);if(st){st.status=c.status;st.status_note=c.reason;}}
 // Paradas de calle que ningún servicio utilizable usa: restos de la C15 zonal en la Carrera 13 y 11.
 if(data.routes&&data.stations){const used=new Set(data.routes.filter(r=>r.ready).flatMap(r=>r.stops.map(s=>s.station_id)));data.stations=data.stations.filter(s=>s.kind!=='street'||used.has(s.id));}
 if(removed.size&&data.busway_signals?.signals)data.busway_signals={...data.busway_signals,signals:data.busway_signals.signals.filter(s=>!removed.has(s.id))};
 return data;
}
