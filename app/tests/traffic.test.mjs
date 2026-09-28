import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Operation} from '../dist/operation.mjs';
import {Guideway,Traffic,STATES,SERVICE_START} from '../dist/traffic.mjs';
import {signalClusters,signalPhase} from '../dist/signals.mjs';

const read=f=>JSON.parse(fs.readFileSync(new URL('../dist/'+f,import.meta.url)));
const data=read('services.json');
const demand=read('demand.json');const profiles=new Map(demand.profiles.map(p=>[p.station_id,p]));for(const s of data.stations)s.demand_profile=profiles.get(s.id);
for(const [k,f] of [['busway_signals','busway_signals.json'],['station_layouts','station_layouts.json'],['station_wagons','station_wagons.json'],['schedule','schedule.json'],['speed_profiles','speed_profiles.json'],['busway_lanes','busway_lanes.json'],['busway_geometry','busway_geometry.json'],['wagon_stops','wagon_stops.json'],['field_corrections','field_corrections.json'],['od_profiles','od_profiles.json'],['busway_structures','busway_structures.json']])data[k]=read(f);

const WEEKDAY='2026-09-24';
function build(config={},date=WEEKDAY){const op=new Operation(data,{date,plan:true,...config});const guide=new Guideway([...op.routes.values()],{lanes:data.busway_lanes,geometry:data.busway_geometry,structures:data.busway_structures,splits:data.field_corrections?.lane_splits});return {op,guide,traffic:new Traffic(op,guide,date)};}
// Troncal Caracas sur y sus alimentaciones: bastante tráfico para que haya colas, pocos servicios
// para que las pruebas no tarden lo que tarda la red entera.
const SMALL={selection:{mode:'zones',zones:['H']}};
const frameKey=f=>JSON.stringify([...f.trip,...f.s,...f.lat,...f.state].map(x=>typeof x==='number'?Math.round(x*1e6):x));

test('La red de tramos cubre cada recorrido entero, en orden y sin huecos',()=>{
 const {op,guide}=build();
 for(const r of op.routes.values()){
  const map=guide.routeMaps.get(r.id);
  assert.ok(Math.abs(map.starts.at(-1)-r.path.length)<1e-6,r.id);
  let total=0;for(let k=0;k<map.links.length;k++){total+=guide.links[map.links[k]].length;if(k)assert.ok(guide.links[map.links[k-1]].next.has(map.links[k]),`${r.id}: tramo ${k} desconectado`);}
  assert.ok(Math.abs(total-r.path.length)<1e-3,`${r.id}: ${total} frente a ${r.path.length}`);
 }
 assert.ok(guide.summary.links>300&&guide.summary.merges>50,'la red compartida tiene empalmes');
});

test('Cada estación tiene carril de andén junto a cada punto de atención, y ningún cierre cae en el borde de un tramo',()=>{
 const {op,guide}=build();
 for(const r of op.routes.values())for(const v of r.visits){
  if(v.kind==='street')continue;
  const loc=guide.locate(r.id,Math.min(r.path.length-.1,v.at_m));
  assert.equal(guide.lanesAt(loc.link,loc.offset),2,`${r.code} en ${v.name}`);
 }
 for(const link of guide.links){const n=link.lanes.length;if(link.lanes[n-1]===2&&!link.split)for(const L of link.next)assert.equal(guide.links[L].lanes[0],2,'un segundo carril solo sigue si todos los siguientes lo tienen');}
 // Salvo en una bifurcación con un carril por rama (field_corrections.json): ahí el segundo carril
 // sigue por la rama de giro y se ve que la corrección se aplicó.
 assert.ok(guide.links.some(l=>l.split),'la bifurcación de la NQS hacia la Calle 26 tiene dos carriles');
});

test('El mismo instante da el mismo estado se llegue avanzando, retrocediendo o desde cero',()=>{
 const a=build(SMALL).traffic;a.seek(7*3600+40*60);const forward=frameKey(a.frame(a.t));
 a.seek(8*3600+10*60);a.seek(7*3600+40*60);const back=frameKey(a.frame(a.t));
 const b=build(SMALL).traffic;b.seek(7*3600+40*60);const fresh=frameKey(b.frame(b.t));
 assert.equal(back,forward,'retroceder restaura y vuelve a simular exactamente');
 assert.equal(fresh,forward,'una simulación nueva llega al mismo estado');
});

test('Ningún bus se monta sobre otro en su carril, ni en una fila de semáforo ni en un andén',()=>{
 const {traffic,guide}=build(SMALL);let checked=0,queued=0;
 for(let t=6*3600;t<=9*3600;t+=600){
  traffic.seek(t);const a=traffic.a;
  for(let L=0;L<guide.links.length;L++)for(const lane of [0,1]){
   const list=traffic.lists[L*2+lane];
   for(let x=1;x<list.length;x++){const lead=list[x-1],follow=list[x];assert.ok(traffic.off[follow]<=traffic.off[lead]-a.len[lead]+.05,`solape en el tramo ${L}, carril ${lane}`);checked++;if(a.v[follow]<.5)queued++;}
  }
 }
 assert.ok(checked>500&&queued>20,'hubo filas de verdad que revisar');
});

test('Se atiende desde el carril del andén y el de paso queda para quien sigue de largo',()=>{
 const {traffic,guide}=build(SMALL);const a=traffic.a;let dwelling=0,berth=0;
 for(let t=7*3600;t<=8*3600;t+=300){
  traffic.seek(t);
  for(const i of traffic.active){if(a.offnet[i]||STATES[a.state[i]]!=='dwell')continue;dwelling++;if(a.lane[i]===1||guide.lanesAt(traffic.linkOf(i),traffic.off[i])<2)berth++;}
 }
 assert.ok(dwelling>30);assert.ok(berth/dwelling>.95,`${berth} de ${dwelling} desde el carril del andén`);
});

test('La flota tiene tope: sin vehículos, la salida espera; con la flota real, alcanza',()=>{
 const scarce=build({...SMALL,params:{fleet:200}}).traffic;scarce.seek(8*3600);const s=scarce.stats();
 assert.ok(s.vehicles<=200);assert.ok(s.fleetWait>0,'hubo salidas que esperaron vehículo');
 const real=build(SMALL).traffic;real.seek(8*3600);const r=real.stats();
 assert.ok(r.vehicles<=r.fleetCap);assert.equal(r.fleetWait,0);assert.ok(r.deadheads>0,'reutiliza buses de otras terminales');
});

test('Sin variación diaria dos martes son iguales; con ella, cada fecha tiene su día y se repite',()=>{
 const key=(date,dayVariation)=>{const t=build({...SMALL,params:{dayVariation}},date).traffic;t.seek(7*3600);return frameKey(t.frame(t.t));};
 assert.equal(key('2026-09-22',false),key('2026-09-29',false));
 assert.notEqual(key('2026-09-22',true),key('2026-09-29',true));
 assert.equal(key('2026-09-22',true),key('2026-09-22',true));
});

test('Los nodos de un mismo cruce comparten la fase semafórica',()=>{
 const clusters=signalClusters(data.busway_signals),byId=new Map(data.busway_signals.signals.map(s=>[s.id,s]));
 assert.ok(new Set(clusters.values()).size<clusters.size,'hay cruces con varios nodos');
 for(const [id,rep] of clusters){const a=byId.get(id),b=byId.get(rep);assert.ok(Math.hypot(a.xy[0]-b.xy[0],a.xy[1]-b.xy[1])<200);}
 for(const t of [0,17,55,89])for(const [id,rep] of clusters)assert.equal(signalPhase(rep,t).color,signalPhase(clusters.get(id),t).color);
});

test('La red entera atraviesa la punta de la mañana sin atascos permanentes',()=>{
 const {traffic}=build();traffic.seek(9*3600);const s=traffic.stats();
 assert.ok(s.dispatched>5000,`${s.dispatched} salidas`);
 assert.ok(s.completed>3000,`${s.completed} viajes terminados`);
 assert.ok(s.forced<20,`${s.forced} desatascos forzados`);
 assert.ok(s.waitingToEnter<40,`${s.waitingToEnter} buses esperando entrar a la vía`);
 // Menos atascos, menos buses a la vez en la calle: sin el falso semáforo de la NQS quedan unos
 // 1.150 a las 9, con un pico de 1.630 hacia las 7.
 assert.ok(s.fleet>1000&&s.fleet<2600,`${s.fleet} buses en servicio a las 9`);
 assert.ok(traffic.t===9*3600&&SERVICE_START===3*3600);
});

test('Los carriles salen del ancho medido de la calzada: Américas tiene dos entre De La Sabana y Distrito Grafiti',()=>{
 const {op,guide}=build();
 assert.ok(guide.summary.measuredKm>250,`${guide.summary.measuredKm} km medidos`);
 const r=[...op.routes.values()].find(r=>r.code==='F19'),at=name=>r.visits.find(v=>v.name.startsWith(name)).at_m;
 const from=at('De La Sabana'),to=at('Distrito Grafiti');let two=0,n=0;
 for(let s=from+100;s<to-100;s+=25){const loc=guide.locate(r.id,s);n++;if(guide.lanesAt(loc.link,loc.offset)===2)two++;}
 assert.ok(two/n>.85,`${two} de ${n} puntos con dos carriles`);
});

test('Un punto de control exportado y restaurado en un motor nuevo sigue exactamente igual',()=>{
 const a=build(SMALL).traffic;a.seek(7*3600);const buffer=a.exportCheckpoint(7*3600);assert.ok(buffer&&buffer.byteLength>1000);
 a.seek(7*3600+20*60);const expected=frameKey(a.frame(a.t));
 const b=build(SMALL).traffic;b.importCheckpoint(buffer);b.seek(7*3600+20*60);
 assert.equal(frameKey(b.frame(b.t)),expected);
});

test('Sin variación diaria dos martes comparten llave de escenario; con ella —por omisión—, cada fecha la suya',()=>{
 const key=(date,params={dayVariation:false})=>build({params},date).traffic.scenarioKey();
 assert.equal(key('2026-09-22'),key('2026-09-29'),'toda la red, incluidas las rutas sin horario publicado');
 assert.notEqual(key('2026-09-22'),key('2026-09-26'),'un sábado es otro día');
 assert.notEqual(key('2026-09-22',{}),key('2026-09-29',{}),'por omisión cada fecha es su propio día');
 assert.notEqual(key('2026-09-22',{dayVariation:true}),key('2026-09-29',{dayVariation:true}));
});

test('Las teselas de edificios se leen enteras y caen donde dice su índice',()=>{
 const index=read('buildings/index.json');let total=0;
 for(const [x,y,count,bytes] of index.tiles.slice(0,40)){
  const buffer=fs.readFileSync(new URL(`../dist/buildings/${x}_${y}.bin`,import.meta.url)),view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength);
  assert.equal(buffer.length,bytes);assert.equal(buffer.toString('latin1',0,4),'TMB1');assert.equal(view.getUint32(4,true),count);
  let at=8;
  for(let b=0;b<count;b++){const floors=view.getUint8(at),n=view.getUint8(at+1);at+=2;assert.ok(floors>=1&&n>=3);
   let cx=0,cy=0;for(let k=0;k<n;k++){cx+=view.getInt16(at,true)/10;cy+=view.getInt16(at+2,true)/10;at+=4;}
   assert.ok(cx/n>-150&&cx/n<index.method.tile_m+150&&cy/n>-150&&cy/n<index.method.tile_m+150,'el edificio cae en su tesela');}
  assert.equal(at,bytes,'sin bytes sobrantes');total+=count;
 }
 assert.ok(total>5000&&index.coverage.buildings>50000);
});

test('Pedir un instante dentro del último paso no restaura un punto de control',()=>{
 const t=build(SMALL).traffic;t.seek(7*3600+40*60+.05);const at=t.t;let restored=0;const restore=t.restore.bind(t);t.restore=cp=>{restored++;return restore(cp);};
 for(const dt of [.1,.2,.3,.6,.9,1.05,1.4])t.seek(7*3600+40*60+dt);
 assert.equal(restored,0,'avanzar a 1× nunca vuelve atrás');assert.ok(t.t>=at);
 t.seek(7*3600+35*60);assert.equal(restored,1,'retroceder de verdad sí restaura');
});

test('Cada servicio para en el vagón que publica el GTFS: en Mandalay el A está al oriente y en Pradera el 5 usa el occidental',()=>{
 const {op}=build();const at=(code,station)=>{const r=[...op.routes.values()].find(r=>r.code===code&&r.visits.some(v=>v.name.startsWith(station)&&v.placement_source==='vagon_gtfs'));const v=r.visits.find(v=>v.name.startsWith(station));return {v,xy:r.path.sample(v.at_m).xy};};
 const m51=at('M51','Mandalay'),b26=at('B26','Mandalay');
 assert.equal(m51.v.wagonLabel,'A');assert.equal(b26.v.wagonLabel,'B');assert.ok(m51.xy[0]>b26.xy[0]+30,'el vagón A de Mandalay queda al oriente del B');
 const five=at('5','Pradera'),m51p=at('M51','Pradera');assert.ok(five.xy[0]<m51p.xy[0]-30,'en Pradera el 5 para en el vagón occidental');
 let placed=0,total=0;for(const r of op.routes.values())r.visits.forEach((v,i)=>{if(v.kind==='street'||i===0||i===r.visits.length-1)return;total++;if(v.placement_source==='vagon_gtfs')placed++;});
 assert.ok(placed/total>.9,`${placed} de ${total} paradas en su vagón del GTFS`);
});

test('En la NQS hacia el norte el semáforo solo detiene a quien gira; el del sentido sur sigue',()=>{
 const {op}=build();const has=(code,id)=>[...op.routes.values()].filter(r=>r.code===code).some(r=>r.signals.some(s=>s.id===id));
 assert.ok(!has('4','osm-node-5631009101'),'el 4 sigue derecho hacia Universidad Nacional');
 assert.ok([...op.routes.values()].some(r=>r.signals.some(s=>s.id==='osm-node-5631009101')),'algún servicio que gira sí lo encuentra');
 assert.ok([...op.routes.values()].some(r=>r.signals.some(s=>s.id==='osm-node-13252352390')));
});
