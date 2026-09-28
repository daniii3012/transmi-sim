/** Espacio físico: cada bus ocupa su largo en un carril y los que vienen detrás lo ven.
 *
 * El motor anterior calculaba cada viaje por su cuenta, a partir del horario y de la velocidad
 * medida del lugar, y lo muestreaba después. Era exacto en el reloj y ciego en el espacio: dos buses
 * en el mismo rojo quedaban uno encima del otro y arrancaban a la vez, y en una estación el que
 * llegaba detrás no se enteraba de que el andén estaba ocupado hasta que su propio turno lo decía.
 * Ver docs/COLAS_Y_ESPACIO_20260911.md, que dejó escrito qué hacía falta.
 *
 * Aquí los buses comparten la vía. Los recorridos publicados reutilizan los mismos vértices donde
 * van por la misma calzada —el 84 % de ellos—, así que se unen en una red dirigida de tramos: dos
 * servicios distintos que pasan por el mismo carril son vecinos y se ven. Cada tramo tiene uno o dos
 * carriles por sentido según la etiqueta `lanes` de OpenStreetMap y, en cada estación, un carril de
 * atención junto al andén y uno de paso. Los buses siguen el modelo IDM de seguimiento vehicular: la
 * velocidad que desean sale del trecho medido y del tiempo publicado, como antes; la que llevan la
 * decide además el que va delante, el semáforo, el andén y el empalme.
 *
 * Lo que se conserva: el despacho sale del horario publicado; la velocidad del lugar, de las lecturas
 * de la flota; y el mismo instante da siempre el mismo resultado. Lo último ya no se logra con
 * viajes precalculados sino con un paso fijo determinista y puntos de control: retroceder el reloj
 * restaura el punto anterior y vuelve a simular, que da exactamente lo mismo que la primera vez.
 */
import {DAY,addDays,dayType,demandPeriod} from './calendar.mjs?v=20260928.5';
import {signalOffset,signalClusters} from './signals.mjs?v=20260928.5';
import {generatedPassengers,alightFraction} from './passengers.mjs?v=20260928.5';
import {hash,programmedSpeed} from './operation.mjs?v=20260928.5';
import {vehicleSpec} from './vehicles.mjs?v=20260928.5';

export const DT=1;                     // paso de integración, s simulados: el IDM es estable a 1 s y los topes duros impiden solapes
export const SERVICE_START=3*3600;     // el día de servicio va de las 03:00 a las 03:00 siguientes
export const CHECKPOINT=900;           // un punto de control cada 15 min simulados
const CELL=5;                          // resolución del mapa de carriles, m
const V0CELL=10;                       // resolución de la velocidad deseada, m
export const CRUISE_QUANTILE=.75;       // qué percentil de la velocidad de rodar del tramo se toma como crucero
const LOOK=240;                        // hasta dónde mira un conductor, m
const EMERGENCY=6;                     // frenada máxima, m/s²
export const STATES=['moving','dwell','queue','signal','traffic'];
export const LANE_WIDTH=3.4;           // m entre ejes de carril
const PLATFORM_LAT=2.3;                // plataforma de terminal, en carriles hacia el lado del andén
// Un bus libre en una terminal puede ir en vacío a otra: a esta velocidad media, con este rodeo sobre
// la línea recta y unos minutos para salir. Más allá de la distancia máxima se prefiere uno del patio.
export const DEADHEAD=Object.freeze({speed:7,factor:1.35,setup:180,maxDistance:18000});
const MOVING=0,DWELL=1,QUEUE=2,SIGNAL=3,TRAFFIC=4;
const FREE=0,BUS=1,STOP=2,LIGHT=3,LANE_END=4,MERGE=5;
// Puertas del lado del andén por tipo de bus: con ellas se reparte el embarque.
export const DOORS={biarticulated:5,articulated:4,dual_electric:4,dual:2};
// Cuántos de los servicios que paran en un sentido le sirven, en promedio, a quien espera ahí. Sin
// matriz origen-destino es una estimación: cada bus sube la parte de la espera que le corresponde,
// no a todos, que es lo que hacía llenarse cada bus y alargaba la atención hasta minuto y medio.
export const ROUTE_OPTIONS=3;

// --- Red de tramos compartidos ---------------------------------------------------------------

/** Radio de giro en cada punto y la velocidad que permite, como en `travelProfile`. */
function curveCap(path,pos){
 const p=path.sample(Math.max(0,pos-12)).xy,q=path.sample(pos).xy,r=path.sample(Math.min(path.length,pos+12)).xy;
 const u0=q[0]-p[0],u1=q[1]-p[1],w0=r[0]-q[0],w1=r[1]-q[1],ul=Math.hypot(u0,u1),wl=Math.hypot(w0,w1);
 const angle=ul>1&&wl>1?Math.acos(Math.max(-1,Math.min(1,(u0*w0+u1*w1)/ul/wl))):0;
 return angle>.04?Math.max(3,Math.sqrt(1.15*Math.min(ul,wl)/angle)):Infinity;
}

/** Tramos dirigidos entre bifurcaciones, con su polilínea, sus carriles y los servicios que los usan.
 * Un tramo empieza y acaba donde algún recorrido se separa, se une, empieza o termina; en medio,
 * todos los que entran salen por el mismo sitio. Cruzarse en el plano no une nada: solo se comparte
 * un vértice que los dos recorridos publican.
 */
export class Guideway{
 constructor(routes,{lanes=null,geometry=null}={}){
  this.links=[];this.routeMaps=new Map();
  const nodeOf=new Map(),xy=[],seq=[];
  for(const r of routes){
   const ids=[],idx=[];
   r.points.forEach((p,i)=>{const key=p[0]+','+p[1];let id=nodeOf.get(key);if(id===undefined){id=xy.length;nodeOf.set(key,id);xy.push(p);}if(ids.length&&ids[ids.length-1]===id)return;ids.push(id);idx.push(i);});
   seq.push({r,ids,idx});
  }
  const n=xy.length,indeg=new Uint16Array(n),outdeg=new Uint16Array(n),brk=new Uint8Array(n),edges=new Set();
  for(const {ids} of seq){brk[ids[0]]=1;brk[ids.at(-1)]=1;for(let i=1;i<ids.length;i++){const e=ids[i-1]+'>'+ids[i];if(edges.has(e))continue;edges.add(e);outdeg[ids[i-1]]++;indeg[ids[i]]++;}}
  for(let i=0;i<n;i++)if(indeg[i]!==1||outdeg[i]!==1)brk[i]=1;
  this.nodeCount=n;this.mergeNodes=new Uint8Array(n);for(let i=0;i<n;i++)if(indeg[i]>1)this.mergeNodes[i]=1;
  const byStart=new Map();
  for(const {r,ids,idx} of seq){
   const links=[],starts=[];let i=0;
   while(i<ids.length-1){
    const key=ids[i]+'>'+ids[i+1];let link=byStart.get(key);
    if(!link){let j=i+1;while(j<ids.length-1&&!brk[ids[j]])j++;link=this.makeLink(ids.slice(i,j+1),xy);byStart.set(key,link);}
    const m=link.nodes.length-1;
    for(let q=0;q<=m;q++)if(ids[i+q]!==link.nodes[q])throw new Error('Tramo inconsistente en '+r.id);
    links.push(link.id);starts.push(r.path.cumulative[idx[i]]);link.routes.add(r.id);i+=m;
   }
   starts.push(r.path.length);
   this.routeMaps.set(r.id,{links:Int32Array.from(links),starts:Float64Array.from(starts)});
  }
  for(const map of this.routeMaps.values())for(let k=1;k<map.links.length;k++){this.links[map.links[k-1]].next.add(map.links[k]);this.links[map.links[k]].prev.add(map.links[k-1]);}
  this.assignLanes(routes,lanes,geometry);
 }
 makeLink(nodes,xy){
  const points=nodes.map(i=>xy[i]),cum=new Float64Array(points.length);
  for(let i=1;i<points.length;i++)cum[i]=cum[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
  const link={id:this.links.length,nodes,points,cum,length:cum.at(-1),endNode:nodes.at(-1),routes:new Set(),next:new Set(),prev:new Set(),lanes:null,station:null,street:false};
  this.links.push(link);return link;
 }
 sampleLink(link,s){
  const c=link.cum;let lo=1,hi=c.length-1;const x=Math.max(0,Math.min(s,link.length));
  while(lo<hi){const m=(lo+hi)>>1;if(c[m]<x)lo=m+1;else hi=m;}
  const a=link.points[lo-1],b=link.points[lo],d=c[lo]-c[lo-1],t=d?(x-c[lo-1])/d:0;
  return {xy:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],angle:Math.atan2(b[1]-a[1],b[0]-a[0])};
 }
 /** Qué tramo y a qué distancia de su inicio cae una abscisa del recorrido. */
 locate(routeId,at){
  const m=this.routeMaps.get(routeId),s=m.starts;let lo=0,hi=m.links.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(s[mid]<=at)lo=mid;else hi=mid-1;}
  return {k:lo,link:m.links[lo],offset:at-s[lo]};
 }
 // Carriles por sentido en celdas de 5 m. La etiqueta `lanes` de OSM donde la calzada la publica,
 // uno donde no —no se deduce—, y dos en cada estación: el de atención junto al andén y el de paso,
 // que es la abstracción autorizada del proyecto y lo que se ve en cualquier estación troncal. En
 // calle mixta el bus tiene siempre un carril para adelantar a otro detenido en un paradero.
 assignLanes(routes,lanes,geometry=null){
  for(const link of this.links){link.lanes=new Uint8Array(Math.ceil(link.length/CELL)+1).fill(1);link.station=new Uint8Array(link.lanes.length);link.osm=new Uint8Array(link.lanes.length);}
  // Carriles medidos: el ancho de la calzada del IDU, cada 5 m de cada arista, en la misma clave de
  // vértices que la red (tools/build_busway_geometry.py). Mandan sobre la etiqueta de OSM, que
  // queda para donde la calzada no tiene polígono; y si no hay ninguna de las dos, un carril.
  if(geometry?.edges)for(const link of this.links){
   const m=new Uint8Array(link.lanes.length),b=new Uint8Array(link.lanes.length);let any=false;
   for(let e=1;e<link.points.length;e++){
    const pa=link.points[e-1],pb=link.points[e],g=geometry.edges[pa[0]+','+pa[1]+'>'+pb[0]+','+pb[1]];if(!g)continue;
    const start=link.cum[e-1],len=link.cum[e]-start;
    for(let s=0;s<g.lanes.length;s++){const at=start+Math.min(len,(s+.5)*CELL),c=Math.min(m.length-1,Math.floor(at/CELL)),v=g.lanes.charCodeAt(s)-48;if(v>0){m[c]=Math.min(2,v);any=true;}if(g.bridge.charCodeAt(s)===49)b[c]=1;}
   }
   // Las celdas que caen entre dos muestras toman la de su vecina.
   for(let c=1;c<m.length;c++)if(!m[c]&&m[c-1])m[c]=m[c-1];
   if(any){link.measured=m;link.bridge=b;}
  }
  // Calle o corredor exclusivo se vota con los servicios que usan el tramo.
  const votes=new Map();
  for(const r of routes){
   const map=this.routeMaps.get(r.id);
   for(let k=0;k<map.links.length;k++){
    const mid=(map.starts[k]+map.starts[k+1])/2;let i=0;while(i<r.visits.length-2&&r.visits[i+1].at_m<=mid)i++;
    const street=r.visits[i].kind==='street'||r.visits[i+1]?.kind==='street';
    const v=votes.get(map.links[k])||[0,0];v[street?1:0]++;votes.set(map.links[k],v);
   }
  }
  for(const [id,[trunk,street]] of votes)this.links[id].street=street>trunk;
  // Carriles publicados: la vía de OSM más cercana, paralela y en el mismo sentido.
  const ways=lanes?.ways||[],grid=new Map(),G=40;
  ways.forEach((w,wi)=>{for(let i=1;i<w.points.length;i++){const a=w.points[i-1],b=w.points[i];for(const p of [a,b,[(a[0]+b[0])/2,(a[1]+b[1])/2]]){const key=Math.floor(p[0]/G)+':'+Math.floor(p[1]/G);const list=grid.get(key)||[];if(!list.length||list.at(-1)[0]!==wi||list.at(-1)[1]!==i)list.push([wi,i]);grid.set(key,list);}}});
  for(const link of this.links){
   for(let c=0;c<link.lanes.length;c++){
    const {xy,angle}=this.sampleLink(link,Math.min(link.length,c*CELL+CELL/2));let best=null,bestD=10;
    const gx=Math.floor(xy[0]/G),gy=Math.floor(xy[1]/G);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const [wi,i] of grid.get((gx+dx)+':'+(gy+dy))||[]){
     const w=ways[wi],a=w.points[i-1],b=w.points[i],ex=b[0]-a[0],ey=b[1]-a[1],l2=ex*ex+ey*ey;if(!l2)continue;
     const u=Math.max(0,Math.min(1,((xy[0]-a[0])*ex+(xy[1]-a[1])*ey)/l2)),d=Math.hypot(xy[0]-a[0]-u*ex,xy[1]-a[1]-u*ey);if(d>=bestD)continue;
     const dot=(Math.cos(angle)*ex+Math.sin(angle)*ey)/Math.sqrt(l2);if(Math.abs(dot)<.85)continue;
     const oneway=['yes','1','true'].includes(w.oneway)?1:w.oneway==='-1'?-1:0;if(oneway&&dot*oneway<0)continue;
     best={w,oneway};bestD=d;
    }
    if(best?.w.lanes){const per=best.oneway?best.w.lanes:Math.max(1,Math.floor(best.w.lanes/2));link.osm[c]=Math.min(2,per);link.lanes[c]=Math.min(2,per);}
    if(link.measured&&link.measured[c])link.lanes[c]=link.measured[c];
    if(link.street)link.lanes[c]=2;
   }
  }
  // Zonas de estación: desde 70 m antes del primer punto de atención hasta 60 m después del último,
  // uniendo los de todos los servicios que paran ahí. Si la aproximación empieza en el tramo
  // anterior, se extiende hacia atrás por el propio recorrido.
  for(const r of routes){
   const map=this.routeMaps.get(r.id);
   for(const v of r.visits){
    if(v.kind==='street')continue;
    const from=Math.max(0,v.at_m-70),to=Math.min(r.path.length,v.at_m+60);
    for(let k=0;k<map.links.length;k++){
     const a=Math.max(from,map.starts[k]),b=Math.min(to,map.starts[k+1]);if(b<=a)continue;
     const link=this.links[map.links[k]];
     for(let c=Math.floor((a-map.starts[k])/CELL);c<=Math.min(link.lanes.length-1,Math.ceil((b-map.starts[k])/CELL));c++){link.lanes[c]=2;link.station[c]=1;}
    }
   }
  }
  // El segundo carril solo sigue al tramo siguiente si todos los que salen de ahí empiezan con dos;
  // si no, se cierra antes del final. Así cada cierre cae dentro de un tramo y es un punto concreto
  // que los buses de los dos carriles se turnan, en cremallera, igual que un empalme.
  for(const link of this.links){const n=link.lanes.length;if(link.lanes[n-1]===2&&(!link.next.size||[...link.next].some(L=>this.links[L].lanes[0]!==2)))link.lanes[n-1]=1;}
  this.pointBase=this.nodeCount;let points=0;
  for(const link of this.links){
   const n=link.lanes.length;link.twoEnd=new Float32Array(n);link.endId=new Int32Array(n).fill(-1);link.twoRuns=link.lanes[n-1]===2;
   let end=link.twoRuns?link.length:0,id=-1;
   for(let c=n-1;c>=0;c--){
    if(link.lanes[c]!==2){end=Math.min(link.length,c*CELL);id=-1;}
    else if(c+1<n&&link.lanes[c+1]!==2){end=Math.min(link.length,(c+1)*CELL);id=this.pointBase+points++;}
    link.twoEnd[c]=link.lanes[c]===2?end:0;link.endId[c]=link.lanes[c]===2?id:-1;
   }
  }
  // Inicio de cada zona de estación que cae dentro de un tramo de dos carriles: ahí se incorpora al
  // carril de atención quien venía por el de paso y para en esa estación.
  for(const link of this.links){const n=link.lanes.length;link.zoneId=new Int32Array(n).fill(-1);for(let c=1;c<n;c++)if(link.station[c]&&!link.station[c-1]&&link.lanes[c-1]===2&&link.lanes[c]===2)link.zoneId[c]=this.pointBase+points++;}
  this.pointCount=this.nodeCount+points;
  let km=0,two=0,osm=0,measured=0;for(const l of this.links){km+=l.length;for(let c=0;c<l.lanes.length;c++){if(l.lanes[c]===2)two+=CELL;if(l.osm[c])osm+=CELL;if(l.measured?.[c])measured+=CELL;}}
  this.summary={links:this.links.length,km:km/1000,twoLaneKm:two/1000,osmLaneKm:osm/1000,measuredKm:measured/1000,merges:this.mergeNodes.reduce((a,b)=>a+b,0)};
 }
 lanesAt(link,s){const l=this.links[link];return l.lanes[Math.max(0,Math.min(l.lanes.length-1,Math.floor(s/CELL)))];}
}

// --- Semáforos coordinados --------------------------------------------------------------------

/** Desfase de cada intersección sobre el ciclo. Las fases reales no se publican; lo que sí se sabe es
 * que los cruces consecutivos de una avenida se coordinan. Se recorre cada troncal en orden fijo y
 * cada cruce todavía libre se desfasa respecto del anterior lo que tarda un bus en llegar a la
 * velocidad de progresión: quien sale en verde tiende a encontrar verde en el siguiente. Los que no
 * tienen un vecino ya fijado a menos de 600 m conservan el desfase que sale de su identificador.
 * Es una estimación declarada, como el ciclo mismo. */
export const PROGRESSION=8;            // m/s, unos 29 km/h
export function coordinatedOffsets(routes,clusters,cycle){
 const out=new Map(),rep=id=>clusters.get(id)||id;
 const order=[...routes].sort((x,y)=>y.signals.length-x.signals.length||(x.id<y.id?-1:x.id>y.id?1:0));
 for(const r of order){
  let prev=null;
  for(const sg of r.signals){
   const id=rep(sg.id);
   if(prev&&prev.id===id){prev.at=sg.at_m;continue;}
   if(!out.has(id)){out.set(id,prev&&sg.at_m-prev.at<600?((out.get(prev.id)-(sg.at_m-prev.at)/PROGRESSION)%cycle+cycle)%cycle:signalOffset(id,cycle));}
   prev={id,at:sg.at_m};
  }
 }
 return out;
}

// --- Velocidad deseada ------------------------------------------------------------------------

// Velocidad a la que se rueda en cada trecho: la de travesía medida dividida por la parte del tiempo
// que no se pasa detenido. El campo ya dice que lo detenido es cola —de andén o de semáforo— y esas
// colas ahora ocurren en la simulación; dejarlas dentro de la velocidad las contaría dos veces. Un
// trecho a 3 km/h con 87 % del tiempo quieto es un trecho que se rueda a 23 km/h con una fila delante.
function rollingLimit(field){
 if(!field)return null;
 return at=>{let lo=0,hi=field.at.length;while(lo<hi){const m=(lo+hi)>>1;if(field.at[m]<=at)lo=m+1;else hi=m;}const i=Math.max(0,lo-1);return field.v[i]/(1-Math.min(.8,field.stop[i]));};
}

/** Velocidad deseada cada 10 m de un recorrido, para una columna del horario.
 *
 * Es el mismo reparto que usa el motor anterior, hecho de una vez por servicio en vez de por viaje:
 * el campo medido da la forma, y un factor por tramo la estira o la encoge hasta que rodar el tramo
 * cueste lo que el horario le da después de descontar la atención y los semáforos, que aquí se
 * simulan aparte. Donde no hay campo —calle, duales— la velocidad es constante en el tramo y se
 * despeja igual que antes. Al final, una pasada hacia atrás deja frenar con tiempo antes de cada
 * trecho lento, para que nadie tenga que clavar los frenos por una curva.
 */
export function speedCells(r,column,params,schedule){
 const n=Math.ceil(r.path.length/V0CELL)+1,out=new Float32Array(n),a=params.acceleration,b=params.braking;
 const horario=params.programmedRunning?schedule?.routes?.[r.id]:null;
 const curve=r.curve||(r.curve=Float32Array.from({length:n},(_,c)=>Math.min(40,curveCap(r.path,Math.min(r.path.length,c*V0CELL)))));
 for(let i=0;i<r.visits.length-1;i++){
  const from=r.visits[i].at_m,to=r.visits[i+1].at_m,street=r.visits[i].kind==='street'||r.visits[i+1].kind==='street';
  const cap=(street?params.streetKmh:params.cruiseKmh)/3.6,field=street?null:r.field,limit=rollingLimit(field);
  const medido=params.observedRunning?horario?.observed?.[i]:null,published=medido||horario?.segments?.[i]||null;
  const target=published?(published[column]||published[0]):0;
  const crossings=r.signals.reduce((m,sg)=>m+(sg.at_m>from+.1&&sg.at_m<to-.1?1:0),0);
  const dwell=(street?9:params.dwellBase)+(column===1?4:0)+8,wait=crossings*(params.signalCycle-params.signalGreen)**2/(2*params.signalCycle);
  const c0=Math.max(0,Math.floor(from/V0CELL)),c1=Math.min(n-1,Math.ceil(to/V0CELL));
  let speedAt;
  if(limit){
   const base=c=>Math.min(cap,curve[c],limit(c*V0CELL));
   const time=f=>{let t=0,vs=0;for(let c=c0;c<c1;c++){const v=Math.max(2,Math.min(cap,curve[c],base(c)*f));t+=V0CELL/v;vs+=v;}const vm=vs/Math.max(1,c1-c0);return t+vm/2*(1/a+1/b)*(1+crossings*.4);};
   let f=1;const budget=target-dwell-wait;
   // Crucero del tramo: la velocidad a la que se rueda en su trecho más rápido. Arrancar, frenar,
   // las curvas, los semáforos y las colas los pone la simulación; tomar la media del trecho los
   // contaría dos veces y dejaba a los buses rodando a 21 km/h donde la calle mide 28.
   if(!params.calibrateField){const vs=[];for(let c=c0;c<c1;c++)vs.push(limit(c*V0CELL));vs.sort((x,y)=>x-y);const q=params.cruiseQuantile??CRUISE_QUANTILE,top=vs.length?vs[Math.min(vs.length-1,Math.floor(q*(vs.length-1)))]:cap;speedAt=c=>Math.max(2,Math.min(cap,curve[c],top));}
   else if(target>0&&budget>0){let lo=.35,hi=3;if(time(hi)>=budget)f=hi;else if(time(lo)<=budget)f=lo;else{for(let it=0;it<22;it++){const m=(lo+hi)/2;if(time(m)>budget)lo=m;else hi=m;}f=(lo+hi)/2;}}
   else if(target>0)f=3;
   if(params.calibrateField)speedAt=c=>Math.max(2,Math.min(cap,curve[c],base(c)*f));
  }else{
   const v=target>0?programmedSpeed(target-dwell,to-from,cap,a,b,crossings):cap;
   speedAt=c=>Math.max(2,Math.min(v,curve[c]));
  }
  for(let c=c0;c<=c1;c++)out[c]=speedAt(c);
 }
 for(let c=0;c<n;c++)if(!(out[c]>0))out[c]=Math.min(params.cruiseKmh/3.6,curve[c]);
 for(let c=n-2;c>=0;c--)out[c]=Math.min(out[c],Math.sqrt(out[c+1]*out[c+1]+2*b*V0CELL));
 return out;
}

// --- El motor ---------------------------------------------------------------------------------

class MinHeap{
 constructor(a=[]){this.a=a;}
 push(e){const a=this.a;let i=a.length;a.push(e);while(i){const p=(i-1)>>1;if(a[p][0]<=e[0])break;a[i]=a[p];i=p;}a[i]=e;}
 pop(){const a=this.a,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(last[0]<=a[j][0])break;a[i]=a[j];i=j;}a[i]=last;}return first;}
 peek(){return this.a[0];}
 get length(){return this.a.length;}
}

// Estado por viaje, en arreglos paralelos. `offnet` dice si el bus está en la vía (0), en la
// plataforma de salida de su terminal (1) o en la de llegada (2): en un portal real embarcan y
// desembarcan varios buses a la vez en andenes distintos, así que ahí no ocupan el carril.
const FIELDS={route:Int16Array,k:Int16Array,lane:Uint8Array,state:Uint8Array,stop:Int16Array,sig:Int16Array,binding:Uint8Array,status:Uint8Array,offnet:Uint8Array,
 sR:Float64Array,v:Float64Array,prev:Float64Array,lat:Float32Array,prevLat:Float32Array,dwellEnd:Float64Array,len:Float32Array,vf:Float32Array,col:Uint8Array,
 load:Int16Array,cap:Int16Array,vehicle:Int32Array,stuck:Float32Array,force:Float32Array,queueSince:Float64Array,cool:Float32Array,
 spawned:Float64Array,leader:Int32Array,wait:Float32Array,board:Int16Array,alight:Int16Array,entered:Float64Array,runSeen:Uint8Array,finished:Float64Array,inZone:Uint8Array,zp:Int16Array,dock:Float64Array};
const SAVED=['k','lane','state','stop','sig','binding','status','offnet','sR','v','prev','lat','prevLat','dwellEnd','col','load','vehicle','stuck','force','queueSince','cool','spawned','leader','wait','board','alight','entered','runSeen','finished','inZone','zp','dock'];

export class Traffic{
 /** `op` es una Operation preparada con `plan:true`; `guide`, la red de sus servicios. */
 constructor(op,guide,serviceDate,{dt=DT}={}){
  this.op=op;this.g=guide;this.date=serviceDate;this.dt=dt;this.p=op.params;const p=this.p;
  this.timing={cycle:p.signalCycle,green:p.signalGreen,amber:3};
  this.routes=[...op.routes.values()];this.routeIndex=new Map(this.routes.map((r,i)=>[r.id,i]));
  this.seed=p.dayVariation?hash('dia/'+serviceDate+'/'+p.variant):hash('fijo/'+p.variant);
  // La demanda también cambia de un día a otro, del orden de lo que cambió entre los días
  // laborables medidos.
  const u=(hash(this.seed+'/demanda')%2001)/1000-1;this.demandFactor=p.dayVariation?1+.05*u:1;
  this.passengerParams={...p,demand:p.demand*this.demandFactor};
  this.kind=dayType(serviceDate);
  // Por servicio: largo del bus, dónde se detiene el frente en cada visita, semáforos y velocidades.
  const signalIds=new Map();this.signalIds=[];const clusters=signalClusters(op.data.busway_signals);
  const offsets=op.signalOffsets&&op.signalOffsets.cycle===p.signalCycle?op.signalOffsets.map:(op.signalOffsets={cycle:p.signalCycle,map:coordinatedOffsets(this.routes,clusters,p.signalCycle)}).map;
  this.info=this.routes.map(r=>{
   const spec=vehicleSpec(r),len=spec.length,map=guide.routeMaps.get(r.id);
   const stopFront=Float64Array.from(r.visits,v=>Math.max(len+.5,Math.min(r.path.length-.05,v.at_m+len/2)));
   for(let i=1;i<stopFront.length;i++)if(stopFront[i]<=stopFront[i-1]+.1)stopFront[i]=Math.min(r.path.length-.05,stopFront[i-1]+.1);
   const sigAt=Float64Array.from(r.signals.map(s=>s.at_m)),sigIx=Int32Array.from(r.signals.map(s=>{if(!signalIds.has(s.id)){signalIds.set(s.id,this.signalIds.length);this.signalIds.push(s.id);}return signalIds.get(s.id);}));
   const sigOff=Float64Array.from(r.signals.map(s=>offsets.get(clusters.get(s.id)||s.id)));
   const keys=r.visits.map(v=>v.station_id+'/'+v.direction);
   const origin=guide.locate(r.id,stopFront[0]);
   // Zonas de estación a lo largo del recorrido, en su propia abscisa.
   const zones=[];let cur=null;
   for(let k=0;k<map.links.length;k++){const link=guide.links[map.links[k]];for(let c=0;c<link.lanes.length;c++){const at=map.starts[k]+c*CELL;if(at>=map.starts[k+1])break;if(link.station[c]){if(!cur){cur={start:at,end:at+CELL,id:link.zoneId[c]};zones.push(cur);}else cur.end=at+CELL;}else cur=null;}}
   return {r,spec,len,map,stopFront,sigAt,sigIx,sigOff,keys,cells:[],origin,originStation:r.stops[0].station_id,last:r.visits.length-1,
    zStart:Float64Array.from(zones,z=>z.start),zEnd:Float64Array.from(zones,z=>z.end),zId:Int32Array.from(zones,z=>z.id)};
  });
  // Salidas del día, con el desfase de despacho de este día: el horario dice a qué hora sale cada
  // bus, y en la calle sale con un minuto de más o de menos. Cada fecha tiene su propio desfase.
  const J=Math.round(p.dispatchJitter);
  this.trips=op.departures(serviceDate).map(d=>{
   const jitter=J&&d.programmed?(hash(this.seed+'/'+d.rid+'/'+d.departure)%(2*J+1))-J:0;
   return {...d,time:Math.max(SERVICE_START,d.time+jitter),scheduled:d.time,ri:this.routeIndex.get(d.rid)};
  }).filter(d=>d.ri!==undefined&&d.time<SERVICE_START+DAY).sort((x,y)=>x.time-y.time||x.ri-y.ri||x.departure-y.departure);
  this.trips.forEach((t,i)=>{t.index=i;t.id=`${serviceDate}/${t.rid}/${Math.round(t.departure)}`;});
  const n=this.trips.length;this.a={};for(const [k,T] of Object.entries(FIELDS))this.a[k]=new T(n);
  this.a.leader.fill(-1);
  for(const t of this.trips){const info=this.info[t.ri],spec=vehicleSpec(info.r,p,hash(this.seed+'/'+t.index));this.a.len[t.index]=info.len;this.a.cap[t.index]=spec.capacity;this.a.vf[t.index]=1+spec.speedOffset/60;this.a.route[t.index]=t.ri;}
  this.lists=Array.from({length:guide.links.length*2},()=>[]);
  this.off=new Float64Array(n);this.listPos=new Int32Array(n);this.lg=Infinity;this.reD=new Float64Array(n);this.reId=new Int32Array(n);this.twoHere=new Uint8Array(n);
  this.scratch={s:new Float64Array(4096),v:new Float64Array(4096),bind:new Uint8Array(4096),lead:new Int32Array(4096)};
  this.checkpoints=new Map();this.reset();
 }
 cellsFor(ri,col){const info=this.info[ri];return info.cells[col]||(info.cells[col]=speedCells(info.r,col,this.p,this.op.data.schedule));}
 column(time){const kind=this.kind,period=demandPeriod(time,addDays(this.date,Math.floor(time/DAY)),this.p.mode);return kind==='weekday'?(period==='peak'?1:2):kind==='saturday'?3:4;}
 reset(){
  const a=this.a;a.status.fill(0);for(const l of this.lists)l.length=0;
  this.t=SERVICE_START;this.nextTrip=0;this.active=[];
  const P=this.g.pointCount;this.claims=new Int32Array(P).fill(-1);this.claimLink=new Int32Array(P).fill(-1);this.claimPos=new Float64Array(P);this.lastLane=new Int8Array(P).fill(-1);this.claimed=[];
  this.tails=new Int32Array(this.g.links.length).fill(-1);this.tailEnd=new Float64Array(this.g.links.length);this.tailLane=new Uint8Array(this.g.links.length);
  this.vehicles=[];this.parked=new Map();this.releases=new MinHeap();this.groups=new Map();this.waitingVehicle=[];
  this.acc={boarded:0,alighted:0,stops:0,waitSum:0,denied:0,completed:0,dispatched:0,forced:0,peak:0,entryWait:0,entries:0,deadheads:0,fleetWait:0};
  this.checkpoints.clear();this.saveCheckpoint();
 }

 // --- Puntos de control -------------------------------------------------------------------
 saveCheckpoint(){
  const a=this.a,ids=Int32Array.from(this.active),state={};
  for(const k of SAVED){const src=a[k],dst=new src.constructor(ids.length);for(let j=0;j<ids.length;j++)dst[j]=src[ids[j]];state[k]=dst;}
  this.checkpoints.set(Math.round(this.t),{t:this.t,ids,state,status:a.status.slice(),nextTrip:this.nextTrip,
   claimed:this.claimed.map(node=>[node,this.claims[node],this.claimLink[node],this.claimPos[node]]),lastLane:this.lastLane.slice(),tails:this.tails.slice(),tailEnd:this.tailEnd.slice(),tailLane:this.tailLane.slice(),vehicles:this.vehicles.length,
   parked:[...this.parked].map(([k,v])=>[k,v.map(e=>[...e])]),waitingVehicle:[...this.waitingVehicle],releases:this.releases.a.map(e=>[...e]),groups:[...this.groups].map(([k,g])=>[k,g.time,g.count]),acc:{...this.acc}});
 }
 /** Lo que define este día simulado: dos motores con la misma llave llegan al mismo estado en cada
  * instante. Entra todo lo que el motor usa del día —parámetros, servicios, salidas con su desfase,
  * tipo de día de la fecha y del siguiente (la demanda de la madrugada es la del día siguiente)— y
  * nada de la fecha misma: dos martes normales comparten puntos de control. */
 scenarioKey(){
  if(this.key)return this.key;
  const p=this.p,params=Object.keys(p).sort().map(k=>k+'='+JSON.stringify(p[k])).join('&');
  // Y una huella de los datos que no pasan por las salidas: calzada, andenes y semáforos.
  const data=JSON.stringify(this.g.summary)+'/'+this.info.map(i=>i.stopFront.reduce((x,y)=>x+y,0).toFixed(1)+':'+i.sigOff.reduce((x,y)=>x+y,0).toFixed(1)).join(',');
  const text=[this.kind,dayType(addDays(this.date,1)),this.seed,this.demandFactor,params,data,this.routes.map(r=>r.id).join(','),this.trips.map(t=>t.rid+'@'+t.time+'/'+t.departure+'/'+t.scheduled).join(',')].join('|');
  return this.key=hash(text).toString(16).padStart(8,'0')+hash('#'+text).toString(16).padStart(8,'0');
 }
 /** Un punto de control en binario compacto, para guardarlo en el navegador o publicarlo ya
  * calculado: cabecera JSON con lo pequeño y, detrás, los arreglos tal cual. Restaurarlo en un motor
  * nuevo del mismo escenario da exactamente el mismo estado. */
 exportCheckpoint(t){
  const cp=this.checkpoints.get(Math.round(t));if(!cp)return null;
  const arrays=[['ids',cp.ids],['status',cp.status],['lastLane',cp.lastLane],['tails',cp.tails],['tailEnd',cp.tailEnd],['tailLane',cp.tailLane],...SAVED.map(k=>['state.'+k,cp.state[k]])];
  const {ids,status,lastLane,tails,tailEnd,tailLane,state,...small}=cp;small.vehicleMeta=this.vehicles.slice(0,cp.vehicles);
  let offset=0;const index=arrays.map(([name,arr])=>{offset=Math.ceil(offset/8)*8;const e={name,type:arr.constructor.name,offset,length:arr.length};offset+=arr.byteLength;return e;});
  const header=new TextEncoder().encode(JSON.stringify({version:1,key:this.scenarioKey(),trips:this.trips.length,date:this.date,small,index}));
  const start=Math.ceil((8+header.length)/8)*8,buffer=new ArrayBuffer(start+offset),view=new DataView(buffer);
  view.setUint32(0,0x5452464b);view.setUint32(4,header.length);new Uint8Array(buffer,8,header.length).set(header);
  for(let x=0;x<arrays.length;x++){const arr=arrays[x][1];new Uint8Array(buffer,start+index[x].offset,arr.byteLength).set(new Uint8Array(arr.buffer,arr.byteOffset,arr.byteLength));}
  return buffer;
 }
 importCheckpoint(buffer){
  const view=new DataView(buffer);if(view.getUint32(0)!==0x5452464b)throw new Error('Punto de control no reconocido');
  const length=view.getUint32(4),head=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,length)));
  if(head.key!==this.scenarioKey()||head.trips!==this.trips.length)throw new Error('El punto de control es de otro escenario');
  const start=Math.ceil((8+length)/8)*8,types={Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array};
  const cp={...head.small,state:{}};
  for(const e of head.index){const T=types[e.type],arr=new T(buffer.slice(start+e.offset,start+e.offset+e.length*T.BYTES_PER_ELEMENT));if(e.name.startsWith('state.'))cp.state[e.name.slice(6)]=arr;else cp[e.name]=arr;}
  if(this.vehicles.length<cp.vehicles)this.vehicles=cp.vehicleMeta.map(v=>({...v}));
  delete cp.vehicleMeta;this.checkpoints.set(Math.round(cp.t),cp);this.restore(cp);return cp.t;
 }
 restore(cp){
  const a=this.a;a.status.set(cp.status);
  for(const k of SAVED){const src=cp.state[k],dst=a[k];for(let j=0;j<cp.ids.length;j++)dst[cp.ids[j]]=src[j];}
  this.t=cp.t;this.nextTrip=cp.nextTrip;this.active=[...cp.ids];
  this.lastLane.set(cp.lastLane);this.claims.fill(-1);this.claimed=cp.claimed.map(([node,owner,link,pos])=>{this.claims[node]=owner;this.claimLink[node]=link;this.claimPos[node]=pos;return node;});
  this.tails.set(cp.tails);this.tailEnd.set(cp.tailEnd);this.tailLane.set(cp.tailLane);if(this.vehicles.length>cp.vehicles)this.vehicles.length=cp.vehicles;
  this.parked=new Map(cp.parked.map(([k,v])=>[k,v.map(e=>[...e])]));this.waitingVehicle=[...cp.waitingVehicle];this.releases=new MinHeap(cp.releases.map(e=>[...e]));
  this.groups=new Map(cp.groups.map(([k,time,count])=>[k,{time,count}]));this.acc={...cp.acc};
  for(const l of this.lists)l.length=0;
  for(const i of this.active){this.updateOffset(i);if(!a.offnet[i])this.lists[this.linkOf(i)*2+a.lane[i]].push(i);}
  for(const l of this.lists)this.sortList(l);
 }
 /** Lleva la simulación hasta `time`: hacia atrás restaura el punto de control anterior. Con
  * presupuesto en milisegundos devuelve false si no alcanzó a llegar, para seguir después. */
 seek(time,budget=Infinity){
  const target=Math.max(SERVICE_START,Math.min(SERVICE_START+DAY-this.dt,time));
  // Hacia atrás se restaura el punto de control anterior; hacia adelante también, si ya hay uno
  // guardado más cerca: volver a las 18:00 después de ir a las 7:00 no repite las once horas.
  let best=null;for(const cp of this.checkpoints.values())if(cp.t<=target+1e-9&&(!best||cp.t>best.t))best=cp;
  // Un instante dentro del último paso no es retroceder: `frame` lo dibuja interpolando entre la
  // posición anterior y la actual. Tomarlo como retroceso restauraba el punto de control de hasta
  // 15 min antes y volvía a simular en casi cada petición a 1×.
  if(target<this.t-this.dt-1e-9||best&&best.t>this.t+this.dt*.5)this.restore(best);
  const start=performance.now();let steps=0;
  while(this.t<target-1e-9){this.step();if((++steps&63)===0&&performance.now()-start>budget)return false;}
  return true;
 }

 // --- Utilidades por bus --------------------------------------------------------------------
 linkOf(i){return this.info[this.a.route[i]].map.links[this.a.k[i]];}
 updateOffset(i){const a=this.a;this.off[i]=a.sR[i]-this.info[a.route[i]].map.starts[a.k[i]];}
 sortList(l){const off=this.off;for(let x=1;x<l.length;x++){const e=l[x],o=off[e];let y=x-1;while(y>=0&&(off[l[y]]<o||off[l[y]]===o&&l[y]>e)){l[y+1]=l[y];y--;}l[y+1]=e;}for(let x=0;x<l.length;x++)this.listPos[l[x]]=x;}
 removeFromList(i){const l=this.lists[this.linkOf(i)*2+this.a.lane[i]],x=this.listPos[i];if(l[x]!==i)throw new Error('Lista de carril inconsistente');l.splice(x,1);for(let y=x;y<l.length;y++)this.listPos[l[y]]=y;}
 insertInList(i){const l=this.lists[this.linkOf(i)*2+this.a.lane[i]],o=this.off[i],off=this.off;let x=0;while(x<l.length&&(off[l[x]]>o||off[l[x]]===o&&l[x]<i))x++;l.splice(x,0,i);for(let y=x;y<l.length;y++)this.listPos[l[y]]=y;}

 /** El que va delante en ese carril, aunque ya esté en el tramo siguiente o saliendo de este.
  * Devuelve su número y deja la distancia libre en `this.lg`. */
 leader(i,lane){
  const a=this.a,off=this.off,map=this.info[a.route[i]].map,k=a.k[i],L=map.links[k],own=off[i],list=this.lists[L*2+lane];
  // En el propio carril la lista ya está ordenada; en el otro hay que buscar el primero por
  // delante. Uno que va delante en el mismo tramo siempre está más cerca que los del siguiente.
  if(a.lane[i]===lane){const pos=this.listPos[i];if(pos>0){const j=list[pos-1];this.lg=off[j]-a.len[j]-own;return j;}}
  else for(let x=list.length-1;x>=0;x--){const j=list[x];if(off[j]>own){this.lg=off[j]-a.len[j]-own;return j;}}
  let best=Infinity,who=-1,j=this.tails[L];
  // Quien acaba de salir de este tramo puede tener todavía la cola dentro.
  if(j>=0&&j!==i&&a.status[j]===2&&!a.offnet[j]&&this.tailLane[L]===lane){const rear=a.sR[j]-a.len[j]-this.tailEnd[L];if(rear<0){best=this.g.links[L].length+rear-own;who=j;}}
  let dist=map.starts[k+1]-a.sR[i];
  for(let q=k+1;q<map.links.length&&dist<LOOK&&dist<best;q++){
   const L2=map.links[q],link=this.g.links[L2],lane2=link.lanes[0]<2?0:lane,l2=this.lists[L2*2+lane2];
   if(l2.length){const jj=l2[l2.length-1],g=dist+off[jj]-a.len[jj];if(g<best){best=g;who=jj;}break;}
   j=this.tails[L2];
   if(j>=0&&j!==i&&a.status[j]===2&&!a.offnet[j]&&this.tailLane[L2]===lane2){const rear=a.sR[j]-a.len[j]-this.tailEnd[L2];if(rear<0){const g=dist+link.length+rear;if(g<best){best=g;who=j;}}}
   dist+=link.length;
  }
  this.lg=best;return who;
 }
 /** Cuánto le queda de segundo carril por delante, siguiendo su propio recorrido. Deja en
  * `this.re` el punto de cierre, que es lo que se reserva para incorporarse. */
 runEnd(i,look=LOOK){
  const a=this.a,map=this.info[a.route[i]].map;let k=a.k[i],link=this.g.links[map.links[k]],c=Math.min(link.lanes.length-1,Math.floor(this.off[i]/CELL));
  this.re=-1;if(link.lanes[c]!==2)return 0;
  let d=link.twoEnd[c]-this.off[i],id=link.endId[c];
  while(id<0&&link.twoRuns&&k+1<map.links.length&&d<look){k++;link=this.g.links[map.links[k]];if(link.lanes[0]!==2)break;d+=link.twoEnd[0];id=link.endId[0];}
  this.re=id;return d>0?d:0;
 }

 // --- Un paso ------------------------------------------------------------------------------
 step(){
  const a=this.a,dt=this.dt,t=this.t+dt;this.t=t;
  for(const i of this.active){a.prev[i]=a.sR[i];a.prevLat[i]=a.lat[i];}
  // Buses que terminan su regulación y vuelven a estar disponibles en la terminal.
  while(this.releases.length&&this.releases.peek()[0]<=t){const [ready,station,kind,vehicle]=this.releases.pop();const key=station+'/'+kind,list=this.parked.get(key)||[];list.push([vehicle,ready]);this.parked.set(key,list);}
  let added=false;
  // Las salidas que esperaban vehículo se intentan primero, en su orden; luego las que tocan ahora.
  if(this.waitingVehicle.length){const still=[];for(const i of this.waitingVehicle){if(this.dispatch(i,t))added=true;else still.push(i);}this.waitingVehicle=still;}
  while(this.nextTrip<this.trips.length&&this.trips[this.nextTrip].time<=t){const i=this.trips[this.nextTrip++].index;if(this.dispatch(i,t))added=true;else{this.waitingVehicle.push(i);a.status[i]=1;}}
  if(added)this.active.sort((x,y)=>x-y);
  this.decide(t);
  this.move(t);
  for(const l of this.lists)if(l.length>1)this.sortList(l);
  if(this.active.length>this.acc.peak)this.acc.peak=this.active.length;
  if(Math.floor((t+1e-6)/CHECKPOINT)>Math.floor((t-dt+1e-6)/CHECKPOINT)&&!this.checkpoints.has(Math.round(t)))this.saveCheckpoint();
 }
 /** Un vehículo para una salida: uno que espere en esa terminal; si no, uno libre en otra terminal
  * que haya tenido tiempo de venir en vacío; si no, uno nuevo que sale del patio, mientras la flota
  * alcance. Sin ninguno, la salida espera. Devuelve el vehículo o -1. */
 vehicleFor(info,t){
  const kind=info.spec.kind,here=this.parked.get(info.originStation+'/'+kind);
  if(here?.length)return here.pop()[0];
  const to=this.op.stations.get(info.originStation)?.xy;let best=null;
  if(to)for(const [key,list] of this.parked){
   if(!list.length||!key.endsWith('/'+kind))continue;const from=this.op.stations.get(key.slice(0,key.lastIndexOf('/')))?.xy;if(!from)continue;
   const d=Math.hypot(from[0]-to[0],from[1]-to[1]);if(d>DEADHEAD.maxDistance)continue;
   const [vehicle,ready]=list[0];if(ready+DEADHEAD.setup+d*DEADHEAD.factor/DEADHEAD.speed>t)continue;
   if(!best||d<best.d)best={d,list};
  }
  if(best){this.acc.deadheads++;return best.list.shift()[0];}
  if(this.vehicles.length<this.p.fleet){const vehicle=this.vehicles.length;this.vehicles.push({id:`TM-${String(vehicle+1).padStart(4,'0')}`,home:info.originStation,kind,label:info.spec.label});return vehicle;}
  return -1;
 }
 // El bus aparece en la plataforma de salida de su terminal a la hora de despacho y embarca ahí.
 dispatch(i,t){
  const a=this.a,info=this.info[a.route[i]],vehicle=this.vehicleFor(info,t);
  if(vehicle<0)return false;
  if(t>this.trips[i].time+1)this.acc.fleetWait+=t-this.trips[i].time;
  a.status[i]=2;a.offnet[i]=1;a.k[i]=info.origin.k;a.sR[i]=info.stopFront[0];a.prev[i]=a.sR[i];a.v[i]=0;a.lane[i]=0;a.lat[i]=PLATFORM_LAT;a.prevLat[i]=PLATFORM_LAT;a.stop[i]=0;a.dock[i]=0;a.sig[i]=0;
  a.stuck[i]=0;a.force[i]=0;a.cool[i]=0;a.leader[i]=-1;a.queueSince[i]=-1;a.spawned[i]=t;a.entered[i]=-1;
  while(a.sig[i]<info.sigAt.length&&info.sigAt[a.sig[i]]<a.sR[i]-.5)a.sig[i]++;
  a.vehicle[i]=vehicle;a.load[i]=0;a.zp[i]=0;this.updateOffset(i);this.active.push(i);this.acc.dispatched++;
  this.beginDwell(i,t,0);return true;
 }
 /** Entrar a la vía desde la plataforma: hace falta el hueco del bus y que quien viene por detrás
  * —en este tramo o llegando por uno anterior— tenga distancia para frenar. */
 entryLane(i){const info=this.info[this.a.route[i]],link=this.g.links[info.origin.link];return link.lanes[Math.min(link.lanes.length-1,(info.origin.offset/CELL)|0)]===2?1:0;}
 /** Carril por el que puede entrar a la vía desde la plataforma, o -1 si ninguno tiene hueco. En una
  * estación se prefiere el del andén, que está junto al vagón; si ese está tomado, el que sigue de
  * largo. En un portal la zona del andén es corta y exigir solo ese carril trababa la salida. */
 entryClear(i){
  const two=this.entryLane(i);
  if(two&&this.laneClear(i,1))return 1;
  return this.laneClear(i,0)?0:-1;
 }
 laneClear(i,lane){
  const a=this.a,info=this.info[a.route[i]],L=info.origin.link,o=info.origin.offset,len=a.len[i],S0=this.p.jamGap,off=this.off,list=this.lists[L*2+lane];
  for(let x=0;x<list.length;x++){
   const j=list[x];if(off[j]-a.len[j]>=o+S0)continue;
   if(off[j]>o-len-S0)return false;
   if(o-len-off[j]<S0+a.v[j]*1.6)return false;
   break;
  }
  const need=o-len-S0-30;
  if(need<0&&lane===0)for(const P of this.g.links[L].prev){const lp=this.g.links[P];for(const lane of [0,1]){const l=this.lists[P*2+lane];if(l.length&&off[l[0]]>lp.length+need-a.v[l[0]]*1.6)return false;}}
  return true;
 }
 // Pasajeros y tiempo de atención al abrir puertas. Es el mismo modelo agregado del motor anterior:
 // la espera por estación y sentido se acumula con la demanda medida y se abandona con media de
 // 30 min; baja una fracción según la hora y la centralidad, y sube lo que quepa.
 beginDwell(i,t,wait){
  const a=this.a,info=this.info[a.route[i]],r=info.r,x=a.stop[i],v=r.visits[x],isLast=x===info.last,station=this.op.stations.get(v.station_id);
  let board=0,alight=isLast?a.load[i]:Math.min(a.load[i],Math.floor(a.load[i]*alightFraction(station,t)));
  if(!isLast){
   const key=info.keys[x],share=this.op.demandShares.get(key)||{all:1,selected:1,angle:r.path.sample(v.at_m).angle};
   const g=this.groups.get(key)||{time:Math.max(SERVICE_START,4*3600),count:0};
   const retained=g.count*Math.exp(-Math.max(0,t-g.time)/1800);
   const generated=generatedPassengers(station,share.angle,g.time,t,this.date,this.passengerParams)*share.selected/share.all;
   g.count=retained+generated;g.time=t;
   const mine=Math.floor(g.count*Math.min(1,ROUTE_OPTIONS/Math.max(1,share.selected)));
   board=Math.max(0,Math.min(a.cap[i]-(a.load[i]-alight),mine));g.count-=board;this.groups.set(key,g);this.acc.denied+=mine-board;
  }
  a.load[i]+=board-alight;a.board[i]=board;a.alight[i]=alight;this.acc.boarded+=board;this.acc.alighted+=alight;this.acc.stops++;this.acc.waitSum+=wait;a.wait[i]=wait;
  const peak=demandPeriod(t,addDays(this.date,Math.floor(t/DAY)),this.p.mode)==='peak';
  const spread=this.p.dayVariation?.85+.3*((hash(this.seed+'/'+i+'/'+x)%1000)/1000):1;
  const doors=DOORS[info.spec.kind]||4,rate=this.p.boardingRate*doors;
  const dwell=((v.kind==='street'?9:this.p.dwellBase)+Math.max(board,alight*.8)/rate+(peak?4:0))*spread;
  a.state[i]=DWELL;a.v[i]=0;a.dwellEnd[i]=t+dwell;a.queueSince[i]=-1;a.col[i]=this.column(t);
 }
 // Decisiones que cambian a quién se ve: tomar un empalme y cambiar de carril. Van en orden fijo
 // —por número de viaje— para que dos buses nunca ocupen a la vez el mismo hueco y el resultado no
 // dependa de nada más que del estado.
 decide(t){
  const a=this.a,p=this.p,g=this.g,off=this.off,candidates=new Map(),points=new Map(),owners=[];
  for(const i of this.active){
   if(a.offnet[i]||a.state[i]===DWELL){this.twoHere[i]=0;continue;}
   const info=this.info[a.route[i]],map=info.map,k=a.k[i],L=map.links[k],link=g.links[L],toEnd=link.length-off[i],v=a.v[i],reach=8+v*v/4+v*.8;
   // Si el empalme está libre, se lo queda el que llegaría antes; los que vienen por la misma
   // aproximación que el dueño no compiten con él: lo siguen.
   if(g.mergeNodes[link.endNode]&&k+1<map.links.length){
    const node=link.endNode;
    if(toEnd<reach&&this.claims[node]<0){const eta=toEnd/Math.max(.5,v),best=candidates.get(node);if(!best||eta<best[0]||eta===best[0]&&i<best[1])candidates.set(node,[eta,i,L,map.starts[k+1]]);}
   }
   const c=Math.min(link.lanes.length-1,Math.floor(off[i]/CELL));if(link.lanes[c]<2){this.twoHere[i]=0;continue;}
   const two=this.runEnd(i),end=this.re,lane=a.lane[i];this.twoHere[i]=1;this.reD[i]=two;this.reId[i]=end;
   // Vuelta al carril que sigue de largo antes de la próxima estación: compiten los del otro carril.
   if(lane===1){const zid=this.mergeTarget(i);if(zid>=0){const d=this.mt-a.sR[i];if(d<reach){const owner=this.claims[zid];
    if(owner<0||a.status[owner]!==2){const e=points.get(zid)||[null,null];if(!e[1]||d<e[1][0]||d===e[1][0]&&i<e[1][1])e[1]=[d,i,this.mt,true];points.set(zid,e);}
    else if(owner===i)owners.push([i,d]);
    else if(a.lane[owner]===1&&this.claimPos[zid]-a.sR[owner]>d){this.claims[zid]=i;this.claimPos[zid]=this.mt;owners.push([i,d]);}}}}
   // Cierre del carril de paso: se lo turnan los dos carriles, uno y uno.
   if(end>=0&&two<reach){
    // En cada carril compite el primero, el más cercano al cierre: uno de atrás no puede tener el
    // turno si el de delante no puede avanzar sin él.
    if(this.claims[end]<0){const e=points.get(end)||[null,null],best=e[lane];if(!best||two<best[0]||two===best[0]&&i<best[1])e[lane]=[two,i,a.sR[i]+two,two>v*v/6+2+a.len[i]];points.set(end,e);}
    else if(this.claims[end]===i&&lane===1)owners.push([i,two]);
    // Si el dueño viene detrás por el mismo carril de paso, no puede llegar antes que este: el turno
    // pasa al de delante.
    else if(lane===1&&this.claimLink[end]===1){const owner=this.claims[end];if(a.status[owner]===2&&!a.offnet[owner]&&a.lane[owner]===1&&this.claimPos[end]-a.sR[owner]>two){this.claims[end]=i;this.claimPos[end]=a.sR[i]+two;owners.push([i,two]);}}
   }
   // Fuera de las estaciones, en un tramo de dos carriles, quien llega a una fila toma el carril con
   // menos cola: en un rojo se forman dos filas, como en la calle. Solo si hay hueco y queda trecho
   // antes de la próxima estación o del cierre, donde se vuelve por turnos.
   if(a.cool[i]>0)a.cool[i]-=this.dt;
   else if(!link.station[c]&&two>90&&a.dock[i]===0){
    const zid=this.mergeTarget(i),dz=zid>=0?this.mt-a.sR[i]:Infinity,stopD=info.stopFront[a.stop[i]]-a.sR[i];
    if(dz>90&&stopD>120){
     const j0=this.leader(i,lane),g0=this.lg;
     if(j0>=0&&g0<45&&(a.v[j0]<.6*Math.max(v,4)||a.v[j0]<.5)){const j1=this.leader(i,1-lane),g1=this.lg;if(j1<0||g1>g0+12)this.changeLane(i,1-lane,false);}
    }
   }
  }
  for(const [node,[,i,L,at]] of candidates){this.claims[node]=i;this.claimLink[node]=L;this.claimPos[node]=at;this.claimed.push(node);}
  for(const [id,e] of points){
   // Uno y uno; pero si el de atención ya no alcanza a detenerse dejando el hueco, pasa él.
   // Solo cuenta si sigue en el carril con que se presentó: pudo cambiarse en esta misma ronda.
   if(e[0]&&a.lane[e[0][1]]!==0)e[0]=null;if(e[1]&&a.lane[e[1][1]]!==1)e[1]=null;if(!e[0]&&!e[1])continue;
   const pick=e[0]&&e[1]?(!e[0][3]||this.lastLane[id]===1?e[0]:e[1]):e[0]||e[1],lane=pick===e[0]?0:1;
   this.claims[id]=pick[1];this.claimLink[id]=lane;this.claimPos[id]=pick[2];this.lastLane[id]=lane;this.claimed.push(id);
  }
  // El dueño del cierre que viene por el de paso se pasa al de atención al llegar: los de atención
  // lo esperan en la línea, así que solo necesita que el de delante haya dejado sitio.
  for(const [i,two] of owners)if(two<8)this.changeLane(i,0,true,true);
  // Con hueco en el carril de paso no hace falta esperar turno: se incorpora de una vez. En una
  // estación, el carril del andén es para acomodarse y atender; quien ya atendió o no para ahí lo
  // deja en cuanto puede, para no quedarse delante de un vagón que otro está esperando.
  for(const i of this.active){if(a.lane[i]!==1||a.offnet[i]||a.state[i]===DWELL||a.dock[i]>0||!this.twoHere[i])continue;const two=this.reD[i],zid=this.mergeTarget(i),dz=zid>=0?this.mt-a.sR[i]:Infinity;
   const link=g.links[this.linkOf(i)],inZone=link.station[Math.min(link.station.length-1,(off[i]/CELL)|0)];if(inZone||Math.min(two,dz)<25)this.changeLane(i,0,false);}
  // Acomodarse en el vagón y, al salir, rebasar por fuera al que atiende en el vagón siguiente.
  for(const i of this.active){
   if(a.offnet[i]||a.state[i]===DWELL)continue;
   const info=this.info[a.route[i]],d=info.stopFront[a.stop[i]]-a.sR[i];
   if(a.lane[i]===0){if(a.stop[i]<info.last&&d<a.len[i]+25&&d>-.5)this.dock(i);continue;}
   // Por el carril del andén hacia su propio vagón: si le tapa uno que atiende en un vagón anterior,
   // sale al que sigue de largo para rebasarlo y vuelve a acomodarse más adelante.
   const link=g.links[this.linkOf(i)],inZone=link.station[Math.min(link.station.length-1,(off[i]/CELL)|0)];
   if(a.dock[i]===0&&inZone&&a.stop[i]<info.last&&d<250&&d>-.5){const z=this.zoneAhead(info,a.sR[i]);if(z>=0&&info.stopFront[a.stop[i]]<=info.zEnd[z]+1)a.dock[i]=info.stopFront[a.stop[i]];}
   const j=this.leader(i,1);
   if(j>=0&&this.lg<30&&a.state[j]===DWELL&&d>this.lg+a.len[j]+a.len[i]+2){if(this.changeLane(i,0,false))a.dock[i]=0;}
   else if(a.dock[i]===0&&j>=0&&this.lg<30&&a.state[j]===DWELL)this.changeLane(i,0,false);
  }
 }
 /** Primera zona de estación que termina por delante de `at`, o -1. */
 zoneAhead(info,at){const e=info.zEnd;let lo=0,hi=e.length;while(lo<hi){const m=(lo+hi)>>1;if(e[m]<=at)lo=m+1;else hi=m;}return lo<e.length?lo:-1;}
 /** Dónde se incorpora al de atención un bus que va por el de paso y para en la estación siguiente:
  * al inicio de esa zona. -1 si su parada no está en una zona que empiece dentro del tramo. */
 /** Inicio de la próxima estación dentro del tramo: ahí vuelve al carril que sigue de largo quien
  * venía por el otro, para llegar a su vagón por fuera, como hacen los buses en la calle. */
 mergeTarget(i){
  const a=this.a,info=this.info[a.route[i]],sR=a.sR[i];let z=a.zp[i];while(z<info.zEnd.length&&info.zEnd[z]<=sR)z++;a.zp[i]=z;
  if(z>=info.zEnd.length||info.zId[z]<0||info.zStart[z]<=sR-.5)return -1;
  // Quien para en esa estación entra derecho al carril del andén, que es el mismo por el que viene.
  const S=info.stopFront[a.stop[i]];if(a.lane[i]===1&&a.stop[i]<info.last&&S>=info.zStart[z]-1&&S<=info.zEnd[z]+1)return -1;
  this.mt=info.zStart[z];return info.zId[z];
 }
 /** Fuera de las estaciones, el segundo carril sirve para adelantar: se toma al entrar a un tramo de
  * dos carriles o al salir de una estación si el de delante va lento, y hay trecho de sobra antes de
  * la próxima estación o del cierre, donde se vuelve por turnos. */
 chooseLane(i){
  const a=this.a,info=this.info[a.route[i]],sR=a.sR[i],two=this.runEnd(i,Infinity);if(two<150)return;
  // Dentro de una estación el segundo carril es el del andén: solo se entra ahí para acomodarse.
  {const link=this.g.links[this.linkOf(i)];if(link.station[Math.min(link.station.length-1,(this.off[i]/CELL)|0)])return;}
  const z=this.mergeTarget(i);if(z>=0&&this.mt-sR<150)return;
  if(info.stopFront[a.stop[i]]-sR<150)return;
  const j=this.leader(i,0),gap=this.lg;if(!(j>=0&&gap<60&&a.v[j]<.6*Math.max(a.v[i],6)))return;
  const L=this.linkOf(i),list=this.lists[L*2+1],own=this.off[i],v=a.v[i],S0=this.p.jamGap;
  let lead=-1,follow=-1;for(let x=0;x<list.length;x++){if(this.off[list[x]]>own)lead=list[x];else{follow=list[x];break;}}
  if(lead>=0&&this.off[lead]-a.len[lead]-own<S0+v*.5)return;
  if(follow>=0&&own-a.len[i]-this.off[follow]<S0+a.v[follow]*.8)return;
  this.removeFromList(i);a.lane[i]=1;this.insertInList(i);
 }
 /** Acomodarse en el vagón: desde el carril que sigue de largo, justo antes del punto de atención. Un
  * vagón atiende a un bus a la vez: si está ocupado, el que llega entra igual al carril del andén
  * detrás del que atiende —así deja libre el de paso— y solo abre puertas cuando llega a su puesto.
  * Hace falta que el carril del andén esté libre a su lado y que nadie venga por él. */
 dock(i){
  const a=this.a,info=this.info[a.route[i]],map=info.map,k=a.k[i],L=map.links[k],S=info.stopFront[a.stop[i]],So=S-map.starts[k],own=this.off[i],len=a.len[i],S0=this.p.jamGap;
  const link=this.g.links[L];if(So>link.length||link.lanes[Math.min(link.lanes.length-1,Math.max(0,(So/CELL)|0))]!==2)return false;
  const list=this.lists[L*2+1];let target=So,follow=-1;
  for(let x=0;x<list.length;x++){
   const j=list[x],fj=this.off[j],rj=fj-a.len[j];
   if(fj<=own-len-.5){follow=j;break;}          // del todo por detrás: se revisa abajo
   if(rj>=target+1)continue;                     // del todo por delante del puesto
   // Ocupa el puesto o está entre el bus y su puesto: puede ponerse detrás si queda sitio a su lado.
   if(rj>=own+S0)continue;
   return false;
  }
  if(follow>=0&&own-len-this.off[follow]<S0+a.v[follow]*.8)return false;
  this.removeFromList(i);a.lane[i]=1;this.insertInList(i);a.dock[i]=map.starts[k]+target;return true;
 }
 /** Hasta dónde puede llegar por el carril de paso un bus cuyo vagón está ocupado: la cola del que
  * atiende, menos un metro. Si el puesto está libre, hasta el punto de atención. */
 berthHold(i,d0){
  const a=this.a,info=this.info[a.route[i]],map=info.map,k=a.k[i],L=map.links[k],So=info.stopFront[a.stop[i]]-map.starts[k],link=this.g.links[L];
  if(So>link.length||link.lanes[Math.min(link.lanes.length-1,Math.max(0,(So/CELL)|0))]!==2)return d0;
  const list=this.lists[L*2+1];let hold=d0;
  for(let x=0;x<list.length;x++){const j=list[x],fj=this.off[j],rj=fj-a.len[j];if(rj>=So+1)continue;if(fj<=So-a.len[i]-1)break;hold=Math.min(hold,rj-1-this.off[i]);}
  return Math.max(0,hold);
 }
 changeLane(i,lane,urgent,owner=false){
  const a=this.a,p=this.p,off=this.off,L=this.linkOf(i),list=this.lists[L*2+lane],own=off[i],v=a.v[i];
  let lead=-1,follow=-1;for(let x=0;x<list.length;x++){if(off[list[x]]>own)lead=list[x];else{follow=list[x];break;}}
  if(lead>=0){const gap=off[lead]-a.len[lead]-own;if(gap<(urgent?.6:Math.max(p.jamGap,v*.6)))return false;}
  if(follow>=0){const gap=own-a.len[i]-off[follow],vf=a.v[follow];if(gap<(owner?.3:urgent?Math.max(.8,vf*.4):Math.max(p.jamGap,vf*.9+Math.max(0,vf-v)*1.5)))return false;}
  this.removeFromList(i);a.lane[i]=lane;this.insertInList(i);a.cool[i]=3;
  // Quien deja el de atención para adelantar suelta el turno de cierre que tuviera: ya no llega por ahí.
  if(lane===1&&this.claimed.length)this.claimed=this.claimed.filter(id=>{if(id>=this.g.pointBase&&this.claims[id]===i){this.claims[id]=-1;return false;}return true;});
  return true;
 }
 move(t){
  const a=this.a,p=this.p,g=this.g,dt=this.dt,off=this.off,A=p.acceleration,T=p.headwayTime,S0=p.jamGap,sqrtAB=2*Math.sqrt(A*p.braking);
  const cycle=this.timing.cycle,green=this.timing.green,amber=green+this.timing.amber;
  const n=this.active.length;if(this.scratch.s.length<n){const m=n*2;this.scratch={s:new Float64Array(m),v:new Float64Array(m),bind:new Uint8Array(m),lead:new Int32Array(m)};}
  const newS=this.scratch.s,newV=this.scratch.v,bind=this.scratch.bind,lead=this.scratch.lead,finished=[],entering=[];
  for(let x=0;x<n;x++){
   const i=this.active[x];lead[x]=-1;
   if(a.offnet[i]||a.state[i]===DWELL){newS[x]=a.sR[i];newV[x]=0;bind[x]=STOP;continue;}
   const ri=a.route[i],info=this.info[ri],v=a.v[i],sR=a.sR[i],map=info.map,k=a.k[i],L=map.links[k],link=g.links[L];
   const cells=info.cells[a.col[i]]||this.cellsFor(ri,a.col[i]),v0=Math.max(1,cells[Math.min(cells.length-1,(sR/V0CELL)|0)]*a.vf[i]);
   const ratio=v/v0,r2=ratio*ratio,free=1-r2*r2,vT=v*T;let term=0,limit=1e9,binding=FREE;
   // El que va delante, o el que se está incorporando desde el carril de paso.
   const j=this.leader(i,a.lane[i]),gap=this.lg;
   // Detenido en cola detrás de otro detenido: sigue igual, sin más cuentas.
   if(v===0&&j>=0&&a.v[j]===0&&gap<S0+.3&&a.lane[i]===a.lane[j]){lead[x]=j;newS[x]=sR;newV[x]=0;bind[x]=BUS;continue;}
   if(j>=0&&gap<LOOK){lead[x]=j;const s=S0+Math.max(0,vT+v*(v-a.v[j])/sqrtAB),q=s/Math.max(.1,gap);term=q*q;binding=BUS;limit=gap>.4?gap-.4:0;}
   // La parada propia: el frente se detiene en su punto de atención. Si el vagón está ocupado, espera
   // detrás del que atiende, listo para entrar, y no a su costado tapando el carril de paso.
   let d0=(a.dock[i]>0?a.dock[i]:info.stopFront[a.stop[i]])-sR;
   if(a.lane[i]===0&&a.dock[i]===0&&d0<a.len[i]+30&&d0>0&&a.stop[i]<info.last){const hold=this.berthHold(i,d0);if(hold<d0)d0=hold;}
   if(d0<LOOK){const s=S0+vT+v*v/sqrtAB,q=s/Math.max(.1,d0+S0),tq=q*q;if(tq>term){term=tq;binding=STOP;}if(d0<limit)limit=d0>0?d0:0;}
   // Semáforos: en rojo, o en amarillo si todavía puede frenar con comodidad.
   let q0=a.sig[i];while(q0<info.sigAt.length&&info.sigAt[q0]<sR-.5)q0++;a.sig[i]=q0;
   for(let q=q0;q<info.sigAt.length&&q<q0+2;q++){
    const d=info.sigAt[q]-1.5-sR;if(d>LOOK)break;if(d<-.2)continue;
    const ph=(t+info.sigOff[q])%cycle;
    if(ph>=amber||ph>=green&&d>v*v/6){const dd=d>0?d:0,s=S0+vT+v*v/sqrtAB,qq=s/Math.max(.1,dd+S0),tq=qq*qq;if(tq>term){term=tq;binding=LIGHT;}if(dd<limit)limit=dd;break;}
   }
   // Cierre del carril de paso: el de paso no lo cruza nunca en su carril; el de atención se
   // detiene en la línea si el turno es de uno que se está incorporando.
   if(this.twoHere[i]){
    const two=this.reD[i],end=this.reId[i];
    const owner=end>=0?this.claims[end]:-1;
    // El de atención que cede se queda a un bus y una separación del cierre, para que el otro
    // quepa delante; si ya pasó esa línea, sigue y es el otro el que espera.
    const hold=a.lane[i]===1?two-1:owner>=0&&owner!==i&&this.claimLink[end]===1&&a.status[owner]===2&&a.lane[owner]===1?two-1.5-a.len[owner]-S0:-1;
    if(two<LOOK&&hold>-.5){const dd=hold>0?hold:0,s=S0+vT+v*v/sqrtAB,qq=s/Math.max(.1,dd+S0),tq=qq*qq;if(tq>term){term=tq;binding=LANE_END;}if(dd<limit)limit=dd;}
   }
   // Estación donde para, llegando por el de paso: no cruza el inicio de su zona sin incorporarse.
   // Y el de atención deja el hueco si el turno es de uno que se está incorporando.
   if(a.lane[i]===1){const zid=this.mergeTarget(i);if(zid>=0){const d=this.mt-sR-1;if(d<LOOK){const dd=d>0?d:0,s=S0+vT+v*v/sqrtAB,qq=s/Math.max(.1,dd+S0),tq=qq*qq;if(tq>term){term=tq;binding=LANE_END;}if(dd<limit)limit=dd;}}}
   else if(info.zStart.length){let z=a.zp[i];while(z<info.zEnd.length&&info.zEnd[z]<=sR)z++;a.zp[i]=z;if(z<info.zEnd.length&&info.zId[z]>=0&&info.zStart[z]>sR){const owner=this.claims[info.zId[z]];if(owner>=0&&owner!==i&&a.status[owner]===2&&a.lane[owner]===1){const hold=info.zStart[z]-sR-1.5-a.len[owner]-S0;if(hold>-.5&&hold<LOOK){const dd=hold>0?hold:0,s=S0+vT+v*v/sqrtAB,qq=s/Math.max(.1,dd+S0),tq=qq*qq;if(tq>term){term=tq;binding=LANE_END;}if(dd<limit)limit=dd;}}}}
   // Empalme reservado por otro que llega por otra aproximación.
   if(g.mergeNodes[link.endNode]&&k+1<map.links.length&&a.force[i]<=0){const owner=this.claims[link.endNode];if(owner>=0&&owner!==i&&a.status[owner]===2&&this.claimLink[link.endNode]!==L){const d=link.length-off[i]-1;if(d<LOOK){const dd=d>0?d:0,s=S0+vT+v*v/sqrtAB,qq=s/Math.max(.1,dd+S0),tq=qq*qq;if(tq>term){term=tq;binding=MERGE;}if(dd<limit)limit=dd;}}}
   let acc=A*(free-term);if(acc<-EMERGENCY)acc=-EMERGENCY;else if(acc>A)acc=A;
   let v1=v+acc*dt,ds;
   if(v1<0){ds=acc<0?Math.min(v*dt,v*v/(-2*acc)):0;v1=0;}else ds=(v+v1)*.5*dt;
   if(ds>limit){ds=limit;const cap=ds/dt*1.5;if(v1>cap)v1=cap;}
   newS[x]=sR+(ds>0?ds:0);newV[x]=v1;bind[x]=binding;
  }
  // Aplicar: posición, tramo, parada, semáforo y estado visible.
  for(let x=0;x<n;x++){
   const i=this.active[x],info=this.info[a.route[i]],map=info.map;
   a.binding[i]=bind[x];a.leader[i]=lead[x];
   // Carril: se desliza de uno a otro en unos tres segundos, solo en el dibujo.
   const targetLat=a.offnet[i]?PLATFORM_LAT:a.lane[i];if(a.lat[i]!==targetLat)a.lat[i]=a.lat[i]<targetLat?Math.min(targetLat,a.lat[i]+dt*.4):Math.max(targetLat,a.lat[i]-dt*.4);
   if(a.state[i]===DWELL||a.offnet[i]){
    if(a.state[i]===DWELL&&t<a.dwellEnd[i])continue;
    if(a.offnet[i]===2){finished.push(i);continue;}
    if(a.offnet[i]===1){a.state[i]=QUEUE;entering.push(i);continue;}
    a.stop[i]++;a.state[i]=MOVING;a.col[i]=this.column(t);a.dock[i]=0;continue;
   }
   a.sR[i]=newS[x];a.v[i]=newV[x];
   while(a.k[i]+1<map.links.length&&a.sR[i]>=map.starts[a.k[i]+1]){
    const oldLink=map.links[a.k[i]];this.removeFromList(i);this.tails[oldLink]=i;this.tailEnd[oldLink]=map.starts[a.k[i]+1];this.tailLane[oldLink]=a.lane[i];a.k[i]++;
    if(g.lanesAt(map.links[a.k[i]],0)<2)a.lane[i]=0;
    this.updateOffset(i);this.insertInList(i);
   }
   this.updateOffset(i);
   {const lk=g.links[map.links[a.k[i]]],c=Math.min(lk.lanes.length-1,(off[i]/CELL)|0),two=lk.lanes[c]===2,zone=lk.station[c];
    if(!two){a.runSeen[i]=0;if(a.lane[i]===1){this.removeFromList(i);a.lane[i]=0;this.insertInList(i);}}
    else if(!a.runSeen[i]){a.runSeen[i]=1;if(a.lane[i]===0)this.chooseLane(i);}
    else if(a.inZone[i]&&!zone&&a.lane[i]===0)this.chooseLane(i);
    a.inZone[i]=zone;}
   const stopD=(a.dock[i]>0?a.dock[i]:info.stopFront[a.stop[i]])-a.sR[i],v=a.v[i];
   if(v<.5&&stopD<150&&a.queueSince[i]<0)a.queueSince[i]=t;
   // Atiende desde el carril del andén; donde la estación no tiene ese carril, desde el único que hay.
   // Si en diez minutos no logra acomodarse, atiende donde está: es un seguro contra un bloqueo, no
   // una forma de operar, y se cuenta.
   const berthLane=g.links[map.links[a.k[i]]].lanes[Math.min(g.links[map.links[a.k[i]]].lanes.length-1,(off[i]/CELL)|0)]<2||a.lane[i]===1;
   if(stopD<.3&&v<.8&&!berthLane&&a.stop[i]<info.last)a.stuck[i]+=dt;
   if(stopD<.3&&v<.8&&(berthLane||a.stop[i]===info.last||a.stuck[i]>600)){if(!berthLane&&a.stop[i]!==info.last)this.acc.forced++;a.stuck[i]=0;
    a.sR[i]=a.dock[i]>0?a.dock[i]:info.stopFront[a.stop[i]];a.v[i]=0;this.updateOffset(i);
    // En la última parada deja la vía: desembarca en la plataforma de llegada.
    if(a.stop[i]===info.last){this.removeFromList(i);a.offnet[i]=2;}
    this.beginDwell(i,t,a.queueSince[i]>=0?t-a.queueSince[i]:0);continue;
   }
   const j=a.leader[i];
   // Estado visible y desatasco.
   const b=a.binding[i];
   if(v<.5)a.state[i]=b===LIGHT||(b===BUS&&j>=0&&a.state[j]===SIGNAL)?SIGNAL:stopD<150||(b===BUS&&j>=0&&(a.state[j]===QUEUE||a.state[j]===DWELL))?QUEUE:TRAFFIC;
   else a.state[i]=MOVING;
   // Si una reserva de empalme o un fin de carril lo tienen quieto demasiado tiempo, se le deja
   // pasar forzando el hueco. Nunca atraviesa a otro bus.
   if(v<.1&&b===MERGE){a.stuck[i]+=dt;if(a.stuck[i]>120&&a.force[i]<=0){a.force[i]=20;a.stuck[i]=0;this.acc.forced++;}}else if(v>=.1)a.stuck[i]=0;
   if(a.force[i]>0)a.force[i]-=dt;
  }
  // Entrada desde la plataforma de salida, en orden de despacho.
  for(const i of entering){
   const lane=this.entryClear(i);if(lane<0)continue;
   a.offnet[i]=0;a.state[i]=MOVING;a.stop[i]=1;a.lane[i]=lane;a.lat[i]=a.lane[i];a.runSeen[i]=1;a.inZone[i]=0;a.entered[i]=t;a.col[i]=this.column(t);a.dock[i]=0;this.updateOffset(i);this.insertInList(i);
   this.acc.entryWait+=t-a.dwellEnd[i];this.acc.entries++;
  }
  if(finished.length){
   const done=new Set(finished);
   for(const i of finished){
    const info=this.info[a.route[i]];a.status[i]=3;this.acc.completed++;a.finished[i]=t;
    this.releases.push([t+this.p.turnaround,info.r.stops.at(-1).station_id,info.spec.kind,a.vehicle[i]]);
   }
   this.active=this.active.filter(i=>!done.has(i));
  }
  // Un empalme se libera cuando la cola de su dueño lo ha cruzado, o si su dueño ya no circula.
  // Un empalme se suelta cuando el frente de su dueño lo cruza: desde ahí quien llega por la otra
  // aproximación ya lo ve delante y guarda la distancia solo. Un cierre de carril, cuando su dueño
  // ya está en el carril de atención y lo ha cruzado. En los dos casos, si el dueño ya no circula.
  if(this.claimed.length){const base=this.g.pointBase;this.claimed=this.claimed.filter(node=>{const i=this.claims[node];if(i>=0&&a.status[i]===2&&!a.offnet[i]&&(node<base?a.sR[i]<=this.claimPos[node]+.5:a.lane[i]===1||a.sR[i]-a.len[i]<=this.claimPos[node]+1))return true;this.claims[node]=-1;return false;});}
 }

 // --- Lo que ve la interfaz ---------------------------------------------------------------
 /** Estado en un instante entre dos pasos, interpolado, en arreglos compactos para dibujar. */
 // `lat` sale en metros a la derecha del sentido de marcha. El carril 0 es el que sigue de largo; el
 // 1 aparece en la estación junto al andén —a la izquierda en la troncal, donde el andén está en el
 // separador; a la derecha en calle mixta, donde el paradero está en la acera—. Las plataformas de
 // terminal quedan todavía más allá, del lado del andén.
 frame(time){
  const a=this.a,n=this.active.length,f=Math.max(0,Math.min(1,1-(this.t-time)/this.dt)),g=this.g;
  const out={time,count:n,trip:new Int32Array(n),route:new Uint16Array(n),s:new Float32Array(n),lat:new Float32Array(n),len:new Float32Array(n),state:new Uint8Array(n),speed:new Float32Array(n),load:new Uint16Array(n),cap:new Uint16Array(n),offnet:new Uint8Array(n)};
  for(let x=0;x<n;x++){
   const i=this.active[x],front=a.prev[i]+(a.sR[i]-a.prev[i])*f,link=g.links[this.linkOf(i)];
   out.trip[x]=i;out.route[x]=a.route[i];out.s[x]=front-a.len[i]/2;out.lat[x]=(a.prevLat[i]+(a.lat[i]-a.prevLat[i])*f)*LANE_WIDTH*(link.street?1:-1);
   out.len[x]=a.len[i];out.state[x]=a.state[i];out.speed[x]=a.v[i];out.load[x]=a.load[i];out.cap[x]=a.cap[i];out.offnet[x]=a.offnet[i];
  }
  return out;
 }
 /** Índice de viaje por su identificador de texto, para seguir a un bus entre muestras. */
 tripIndex(id){if(!this.byId)this.byId=new Map(this.trips.map(t=>[t.id,t.index]));return this.byId.get(id)??-1;}
 stats(){
  const a=this.a,counts=[0,0,0,0,0];let onboard=0;for(const i of this.active){counts[a.state[i]]++;onboard+=a.load[i];}
  const s=this.acc;
  return {time_s:this.t,fleet:this.active.length,moving:counts[0],dwell:counts[1],queue:counts[2],signal:counts[3],traffic:counts[4],onboard,boarded:s.boarded,stops:s.stops,
   averageWait:s.stops?s.waitSum/s.stops:0,boardingDenials:s.denied,scheduled:this.trips.length,dispatched:s.dispatched,completed:s.completed,routes:this.routes.length,peakActive:s.peak,
   waitingVehicle:this.waitingVehicle.length,deadheads:s.deadheads,fleetWait:s.fleetWait,fleetCap:this.p.fleet,waitingToEnter:this.active.reduce((m,i)=>m+(a.offnet[i]===1&&a.state[i]===QUEUE?1:0),0),forced:s.forced,entryWait:s.entries?s.entryWait/s.entries:0,vehicles:this.vehicles.length,demandFactor:this.demandFactor};
 }
 /** Ficha de un bus, con los mismos campos que usaba la interfaz. */
 detail(i){
  const a=this.a;if(a.status[i]!==2)return null;
  const trip=this.trips[i],info=this.info[a.route[i]],r=info.r,center=a.sR[i]-a.len[i]/2,pose=r.path.sample(center);
  const x=Math.min(a.stop[i],r.visits.length-1),next=r.visits[x],veh=this.vehicles[a.vehicle[i]];
  const expected=trip.scheduled+this.expectedElapsed(info,center),delay=a.state[i]===DWELL?0:Math.max(0,this.t-expected);
  return {id:trip.id,trip:i,vehicleId:veh?.id||'—',routeId:r.id,code:r.code,pattern:r.name,color:r.color,state:STATES[a.state[i]],s:center,speed:a.v[i],speed_kmh:a.v[i]*3.6,xy:pose.xy,angle:pose.angle,
   load:a.load[i],capacity:a.cap[i],reinforcement:!!trip.reinforcement,busType:info.spec.label,typeSource:r.typeSource,length_m:a.len[i],lane:a.lane[i],
   next_stop:next?.name||'Fin del servicio',next_station:next?.station_id,stopIndex:x,stopsServed:a.stop[i]+(a.state[i]===DWELL?0:0),wagon:next?.wagon||1,wagonLabel:next?.wagonLabel||null,wagonDoors:next?.wagonDoors||null,wagonSource:next?.wagonSource||'estimated',
   street:!!(next&&next.kind==='street'),dwellLeft:a.state[i]===DWELL?Math.max(0,a.dwellEnd[i]-this.t):0,board:a.board[i],alight:a.alight[i],lastWait:a.wait[i],
   scheduled:trip.scheduled,dispatched:a.spawned[i],delay,tripStart:a.spawned[i],progress:center/r.path.length,binding:['libre','bus','parada','semáforo','fin de carril','empalme'][a.binding[i]]};
 }
 // Cuánto lleva un viaje según el horario hasta una abscisa: sirve para decir si va atrasado.
 expectedElapsed(info,at){
  const r=info.r,h=this.p.programmedRunning?this.op.data.schedule?.routes?.[r.id]:null,col=this.column(this.t);let t=0;
  for(let i=0;i<r.visits.length-1;i++){
   const pub=(this.p.observedRunning&&h?.observed?.[i])||h?.segments?.[i],seg=pub?(pub[col]||pub[0]):(r.visits[i+1].at_m-r.visits[i].at_m)/8;
   if(r.visits[i+1].at_m<=at){t+=seg;continue;}
   const span=r.visits[i+1].at_m-r.visits[i].at_m;return t+(span>0?seg*Math.max(0,at-r.visits[i].at_m)/span:0);
  }
  return t;
 }
 waitingAt(stationId){
  let count=0;const station=this.op.stations.get(stationId);if(!station)return 0;
  for(const [key,g] of this.groups){if(!key.startsWith(stationId+'/'))continue;const share=this.op.demandShares.get(key);count+=g.count*Math.exp(-Math.max(0,this.t-g.time)/1800)+(share?generatedPassengers(station,share.angle,g.time,this.t,this.date,this.passengerParams)*share.selected/share.all:0);}
  return Math.round(count);
 }
 pressure(limit=6){
  const totals=new Map();
  for(const [key,g] of this.groups){const id=key.slice(0,key.lastIndexOf('/')),station=this.op.stations.get(id),share=this.op.demandShares.get(key);if(!station||!share)continue;totals.set(id,(totals.get(id)||0)+g.count*Math.exp(-Math.max(0,this.t-g.time)/1800)+generatedPassengers(station,share.angle,g.time,this.t,this.date,this.passengerParams)*share.selected/share.all);}
  return [...totals].map(([id,waiting])=>({id,name:this.op.stations.get(id).name,kind:this.op.stations.get(id).kind,waiting:Math.round(waiting)})).filter(s=>s.waiting>0).sort((x,y)=>y.waiting-x.waiting||x.name.localeCompare(y.name,'es')).slice(0,limit);
 }
 zoneLoad(){
  const a=this.a,zones=new Map();
  for(const i of this.active){const r=this.info[a.route[i]].r,id=r.zone||'?',e=zones.get(id)||{id,buses:0,onboard:0,capacity:0};e.buses++;e.onboard+=a.load[i];e.capacity+=a.cap[i];zones.set(id,e);}
  return [...zones.values()].sort((x,y)=>y.buses-x.buses);
 }
 stationStats(id){
  const a=this.a,buses=[];
  for(const i of this.active){const r=this.info[a.route[i]].r,v=r.visits[a.stop[i]];if(v?.station_id===id&&(a.state[i]===DWELL||a.state[i]===QUEUE))buses.push({id:this.trips[i].id,code:r.code,state:STATES[a.state[i]],wagon:v.wagon});}
  const routes=this.routes.filter(r=>r.stops.some(s=>s.station_id===id));
  // Próximas llegadas: para los viajes en curso, lo que les queda según el horario desde donde van;
  // para los que aún no salen, su salida más lo que el horario da hasta la estación.
  const upcoming=[],horizon=this.t+1800;
  for(const i of this.active){
   const info=this.info[a.route[i]],r=info.r;
   for(let x=a.stop[i];x<r.visits.length;x++){if(r.visits[x].station_id!==id)continue;const eta=this.t+Math.max(0,this.expectedElapsed(info,r.visits[x].at_m)-this.expectedElapsed(info,a.sR[i]-a.len[i]/2));if(eta<horizon)upcoming.push({code:r.code,routeId:r.id,name:r.name,arrival:eta,wagon:r.visits[x].wagon,wagonLabel:r.visits[x].wagonLabel,wagonDoors:r.visits[x].wagonDoors,wagonSource:r.visits[x].wagonSource,live:true});break;}
  }
  for(let q=this.nextTrip;q<this.trips.length&&this.trips[q].time<horizon;q++){
   const trip=this.trips[q],info=this.info[trip.ri],r=info.r;
   r.visits.forEach(v=>{if(v.station_id!==id)return;const eta=trip.time+this.expectedElapsed(info,v.at_m);if(eta<horizon)upcoming.push({code:r.code,routeId:r.id,name:r.name,arrival:eta,wagon:v.wagon,wagonLabel:v.wagonLabel,wagonDoors:v.wagonDoors,wagonSource:v.wagonSource,live:false});});
  }
  return {waiting:this.waitingAt(id),buses,routes:routes.map(r=>({id:r.id,code:r.code,name:r.name,color:r.color})),upcoming:upcoming.sort((x,y)=>x.arrival-y.arrival).slice(0,8)};
 }
 depotStats(){
  const map=new Map(),a=this.a;
  const entry=(id,name)=>{if(!map.has(id))map.set(id,{id,name:this.op.stations.get(id)?.name||name,departures:0,next:Infinity,reserve:0});return map.get(id);};
  for(const trip of this.trips){const r=this.info[trip.ri].r,e=entry(r.stops[0].station_id,r.stops[0].name);if(trip.time<=this.t)e.departures++;else e.next=Math.min(e.next,trip.time);}
  for(const [key,list] of this.parked){const id=key.slice(0,key.lastIndexOf('/'));entry(id,id).reserve+=list.length;}
  return [...map.values()].sort((x,y)=>y.departures-x.departures);
 }
}
