import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Operation,DEFAULTS,parameters,motion,motionAt,programmedSpeed,TRAFFIC,FIELD,routeField,fieldLimit} from '../dist/operation.mjs';
import {vehicleSpec} from '../dist/vehicles.mjs';
import {MetricPath} from '../dist/simulation.mjs';
import {travelProfile,travelAt} from '../dist/travel.mjs';
import {dayType,holidays,serviceWindows,dateNumber,validityState,gtfsServices,programmedDepartures,DAY} from '../dist/calendar.mjs';
import {directionalFactor,generatedPassengers,EMPLOYMENT_CENTER} from '../dist/passengers.mjs';
const source=JSON.parse(fs.readFileSync(new URL('../dist/services.json',import.meta.url)));
const base={schema_version:2,scenario_date:'2026-09-10',vehicle:{length_m:18.5,width_m:2.5},stations:[{id:'a',xy:[0,0],name:'Portal Prueba',kind:'station',wagons:2},{id:'b',xy:[1000,0],name:'Centro',kind:'station',wagons:2},{id:'c',xy:[2000,0],name:'Terminal',kind:'station',wagons:2}]};
const route=(id='r',stops=['a','b','c'])=>({id,code:id,color:'#ff0000',name:'Test',family:id,ready:true,valid_from:'2026-01-01',valid_until:'2026-12-31',variant:'regular',calendar:[{days:'L-D',start:14400,end:82800}],points:[[0,0],[1000,0],[2000,0]],stops:stops.map(k=>({station_id:k,name:k,kind:'station',wagons:2,at_m:{a:0,b:1000,c:2000}[k]})),served_zones:['F'],zone:'F'});
const fixture=(routes=[route()])=>({...base,routes});
test('Bogotá civil dates and Colombian moved/floating holidays',()=>{assert.equal(dayType('2026-09-10'),'weekday');assert.equal(dayType('2026-09-12'),'saturday');assert.equal(dayType('2026-09-13'),'holiday');for(const d of ['2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-18','2026-06-08','2026-06-15','2026-08-17'])assert.ok(holidays(2026).has(d),d);assert.throws(()=>dateNumber('2026-02-30'));});
test('Calendar splits, weekend exceptions, expiry and overlapping windows',()=>{const r=route();r.calendar=[{days:'L-V',start:18000,end:20000},{days:'L-V',start:19000,end:21000}];assert.deepEqual(serviceWindows(r,'2026-09-10',[r]),[[18000,21000]]);assert.deepEqual(serviceWindows(r,'2026-09-12',[r]),[]);assert.deepEqual(serviceWindows(r,'2027-01-01',[r]),[]);});
test('Published validity is classified and may be operated past its end without rewriting it',()=>{
 const r=route();r.valid_from='2026-06-28';r.valid_until='2026-09-11';
 assert.equal(validityState(r,'2026-09-10'),'current');
 assert.equal(validityState(r,'2026-09-12'),'expired');
 assert.equal(validityState(r,'2026-06-01'),'future');
 // Sin la opción, la vigencia excluye el servicio; con ella conserva exactamente su ventana publicada.
 assert.deepEqual(serviceWindows(r,'2026-09-12',[r]),[]);
 assert.deepEqual(serviceWindows(r,'2026-09-12',[r],{beyondValidity:true}),serviceWindows(r,'2026-09-10',[r]));
 assert.deepEqual(serviceWindows(r,'2026-06-01',[r],{beyondValidity:true}),[[14400,82800]]);
 // Una variante posterior de la misma familia sigue reemplazando a la anterior aunque ambas estén vencidas.
 const nueva={...r,id:'nueva',valid_from:'2026-08-01',calendar:[{days:'L-D',start:14400,end:40000}]};
 assert.deepEqual(serviceWindows(r,'2026-09-12',[r,nueva],{beyondValidity:true}),[[40000,82800]]);
 // Un servicio sin datos nunca opera, tenga o no vigencia abierta.
 assert.deepEqual(serviceWindows({...r,ready:false},'2026-09-12',[r],{beyondValidity:true}),[]);
});
test('Operating past validity is an explicit boolean parameter',()=>{
 assert.equal(DEFAULTS.beyondValidity,true);
 assert.equal(parameters({}).beyondValidity,true);
 assert.equal(parameters({beyondValidity:false}).beyondValidity,false);
 assert.throws(()=>parameters({beyondValidity:'sí'}));
});
test('Ciclovía replaces overlapping regular departures only',()=>{const r=route(),c={...r,id:'cic',variant:'ciclovia',calendar:[{days:'D-F',start:25200,end:50400}]};assert.deepEqual(serviceWindows(r,'2026-09-13',[r,c]),[[14400,25200],[50400,82800]]);assert.deepEqual(serviceWindows(c,'2026-09-10',[r,c]),[]);});
test('Distance-domain speed respects metres, speed cap, acceleration and braking',()=>{const path=new MetricPath([[0,0],[2000,0]]),p=travelProfile(path,0,2000,13.333,.8,1.1);assert.equal(travelAt(p,0).speed,0);assert.equal(travelAt(p,p.duration).s,2000);assert.ok(travelAt(p,p.duration).speed<1e-8);for(let t=.1;t<p.duration;t+=.2){const a=travelAt(p,t-.1),b=travelAt(p,t);assert.ok(b.s>=a.s);assert.ok(b.speed<=13.333+1e-8);assert.ok((b.speed-a.speed)/.1<=.8+1e-6);assert.ok((a.speed-b.speed)/.1<=1.1+1e-6);}});
test('Tight bends slow buses and cannot create a shortcut',()=>{const straight=travelProfile(new MetricPath([[0,0],[200,0]]),0,200,13.333),bend=travelProfile(new MetricPath([[0,0],[100,0],[100,100]]),0,200,13.333);assert.ok(bend.duration>straight.duration);assert.equal(bend.distance,200);});
test('Short legs use a triangular acceleration profile',()=>{const m=motion(10,15);assert.equal(m.cruise,0);assert.ok(Math.abs(motionAt(m,m.duration).s-10)<1e-9);});
test('Backward and forward seek returns exactly the same trips and passengers',()=>{const s=new Operation(fixture());s.seek(86400+25250);const expected=structuredClone(s.buses);s.seek(86400+60000);s.seek(86400+25250);assert.deepEqual(s.buses,expected);});
test('Clock acceleration does not alter distance at the same simulated instant',()=>{const s=new Operation(fixture());s.seek(86400+25200);for(let i=1;i<=120;i++)s.seek(86400+25200+i);const a=structuredClone(s.buses);s.seek(86400+25200);s.seek(86400+25320);assert.deepEqual(s.buses,a);});
test('No vehicles created outside dispatch hours, trips may finish after closing',()=>{const r=route();r.calendar=[{days:'L-D',start:25200,end:25260}];const s=new Operation(fixture([r]));s.seek(86400+25290);assert.ok(s.buses.length);s.seek(86400+26000);assert.equal(s.buses.length,0);assert.ok(s.trips.every(t=>t.start>=86400+25200&&t.start<86400+25260));});
test('More frequent departures increase simultaneous fleet without changing geometry',()=>{const a=new Operation(fixture()),b=new Operation(fixture(),{params:{peakHeadway:120}});assert.ok(b.trips.length>a.trips.length);assert.equal(b.routes.get('r').path.length,a.routes.get('r').path.length);});
test('Crowded stopping points never block express services',()=>{const express=route('express',['a','c']),busy=Array.from({length:20},(_,i)=>route('slow'+i));const alone=new Operation(fixture([express]));const mixed=new Operation(fixture([express,...busy]));const trip=mixed.trips.find(t=>t.routeId==='express'&&t.start>86400);assert.equal(trip.stops.length,2);assert.equal(trip.moves[0].profile.distance,2000);assert.equal(trip.moves[0].profile.duration,alone.trips[0].moves[0].profile.duration);});
test('Two berths per wagon do not overlap reservations',()=>{const s=new Operation(fixture(Array.from({length:24},(_,i)=>route('r'+i))));const reservations=new Map();for(const t of s.trips){const r=s.routes.get(t.routeId);for(const [i,st] of t.stops.entries()){const key=r.stops[i].station_id+'/'+st.direction+'/'+st.wagon+'/'+st.slot;const values=reservations.get(key)||[];values.push(st);reservations.set(key,values);}}for(const events of reservations.values()){events.sort((a,b)=>a.open-b.open);for(let i=1;i<events.length;i++)assert.ok(events[i].open>=events[i-1].close-1e-8);}});
test('Passenger conservation and vehicle capacity hold at every stop',()=>{const s=new Operation(fixture(),{params:{demand:3}});for(const t of s.trips){let load=0;for(const st of t.stops){load+=st.board-st.alight;assert.equal(load,st.load);assert.ok(load>=0&&load<=t.capacity);assert.ok(st.left>=0);}assert.equal(load,0);}});
test('Boarding demand is independent of bus count and points toward centre AM / away PM',()=>{const st={xy:[EMPLOYMENT_CENTER[0]-10000,EMPLOYMENT_CENTER[1]],kind:'station',name:'Periferia'};assert.ok(directionalFactor(st,0,7*3600)>directionalFactor(st,Math.PI,7*3600));assert.ok(directionalFactor(st,0,18*3600)<directionalFactor(st,Math.PI,18*3600));const all=generatedPassengers(st,0,6*3600,8*3600,'2026-09-10',DEFAULTS),split=generatedPassengers(st,0,6*3600,7*3600,'2026-09-10',DEFAULTS)+generatedPassengers(st,0,7*3600,8*3600,'2026-09-10',DEFAULTS);assert.ok(Math.abs(all-split)<1e-8);});
test('Terminal reuse never assigns one bus to simultaneous trips',()=>{const r=route(),reverse={...route('back'),points:[[2000,0],[1000,0],[0,0]],stops:[...route().stops].reverse().map(s=>({...s,at_m:2000-s.at_m}))};const s=new Operation(fixture([r,reverse]));const byVehicle=new Map();for(const t of s.trips){const a=byVehicle.get(t.vehicle)||[];a.push(t);byVehicle.set(t.vehicle,a);}for(const trips of byVehicle.values()){trips.sort((a,b)=>a.start-b.start);for(let i=1;i<trips.length;i++)assert.ok(trips[i].start>=trips[i-1].end+DEFAULTS.turnaround-1e-8);}});
test('Selections change the simulated service set',()=>{const s=new Operation(fixture([route('one'),route('two')]),{selection:{mode:'route',route:'two'}});assert.deepEqual([...s.routes.keys()],['two']);});
test('Invalid operating parameters fail explicitly',()=>{assert.throws(()=>parameters({peakHeadway:0}));assert.throws(()=>parameters({demand:Infinity}));assert.throws(()=>parameters({mode:'random'}));});
test('Real M85 crops its reverse geometry and retains street stops',()=>{const r=source.routes.find(r=>r.id==='1315');assert.ok(r.ready);assert.ok(r.source_crop_m[0]>9000);assert.ok(r.length_m>11000&&r.length_m<12000);assert.equal(r.stops[0].at_m,0);assert.ok(r.stops.some(s=>s.kind==='street'));});
test('Missing and inconsistent official shapes are never admitted as playable',()=>{
 // The rule is asserted over the whole catalogue rather than over pinned identifiers: a record
 // that later gains a published shape should stop being pending without editing this test.
 for(const r of source.routes){
  const shaped=r.points.length>1&&r.stops.length>1;
  if(!shaped)assert.equal(r.ready,false,`${r.code}/${r.id} sin trazado utilizable no puede estar activo`);
  if(r.ready){
   assert.ok(shaped,`${r.code}/${r.id}`);
   assert.equal(r.issues.length,0,`${r.code}/${r.id} activo con incidencias`);
   for(let i=1;i<r.stops.length;i++)assert.ok(r.stops[i].at_m>r.stops[i-1].at_m,r.id);
  }
 }
 // 692 keeps returning neither shape nor stops, so it stays the pinned example of a pending record.
 assert.equal(source.routes.find(r=>r.id==='692').ready,false);
 assert.ok(source.routes.filter(r=>!r.ready).length>0);
});
test('A refreshed detail records which snapshot it came from',()=>{
 const refreshed=source.routes.filter(r=>r.detail_snapshot&&r.detail_snapshot.startsWith('refresh_'));
 for(const r of refreshed){
  assert.equal(r.ready,true,`${r.code}/${r.id}`);
  assert.ok(r.points.length>1&&r.stops.length>1);
  // Validity still comes from the base catalogue, never from the refreshed detail.
  assert.match(r.valid_until,/^\d{4}-\d{2}-\d{2}$/);
 }
 for(const r of source.routes)assert.ok(typeof r.detail_snapshot==='string'&&r.detail_snapshot.length>0,`${r.id} sin procedencia de detalle`);
});

test('Zonal C15 never replaces trunk C15/H15 on Sundays',()=>{assert.ok(!source.routes.some(r=>r.id==='366'));const c=source.routes.find(r=>r.id==='3915'),h=source.routes.find(r=>r.id==='367');assert.ok(c.ready&&h.ready);assert.ok(c.paired_ids.includes(h.id));assert.ok(serviceWindows(c,'2026-09-13',source.routes).some(([a,b])=>a<=7*3600&&b>7*3600));});

test('Electric F63/Z63 always keeps 160 places',()=>{for(const id of ['5450','5451']){const r=source.routes.find(r=>r.id===id);assert.ok(r.ready&&r.dual);const s=new Operation({...source,routes:[r]},{});for(const v of s.vehicles){assert.equal(v.spec.capacity,160);assert.equal(v.spec.kind,'dual_electric');}}});
test('Vehicle type remains constant during reuse between opposite directions',()=>{const r=route(),reverse={...route('back'),points:[[2000,0],[1000,0],[0,0]],stops:[...route().stops].reverse().map(s=>({...s,at_m:2000-s.at_m}))};const s=new Operation(fixture([r,reverse]),{});for(const t of s.trips){assert.equal(t.capacity,s.vehicles[t.vehicle].spec.capacity);}assert.ok(s.vehicles.every(v=>v.spec.kind==='articulated'));});
test('Overnight departures and previous-day journeys remain visible after midnight',()=>{const r=route();r.calendar=[{days:'L-D',start:85800,end:87000}];const s=new Operation(fixture([r]));s.seek(86400+120);assert.ok(s.buses.length);assert.ok(s.buses.every(b=>b.id.startsWith('2026-09-09/')));const expected=structuredClone(s.buses);s.seek(86400+1800);assert.equal(s.buses.length,0);s.seek(86400+120);assert.deepEqual(s.buses,expected);});

test('Bus size comes from the observed fleet profile and stays fixed for the service',()=>{const observado=(type,buses)=>({type,capacity:type==='biarticulated'?240:160,status:'observed',buses,snapshot:'2026-09-12'});const specs=Array.from({length:20},(_,i)=>vehicleSpec({code:'J23',vehicle_profile:observado('biarticulated',41)},DEFAULTS,i));assert.equal(new Set(specs.map(v=>v.kind)).size,1);assert.equal(specs[0].capacity,240);assert.match(specs[0].typeSource,/observada/);assert.equal(vehicleSpec({code:'8',vehicle_profile:observado('articulated',60)},DEFAULTS,3).capacity,160);assert.equal(vehicleSpec({code:'M85',dual:true},DEFAULTS,1).capacity,80);});
test('Route length no longer decides the body type and an unobserved service says so',()=>{const largo=vehicleSpec({code:'H27',length_m:31000},DEFAULTS,1);assert.equal(largo.capacity,160);assert.match(largo.typeSource,/estimada/);const corto=vehicleSpec({code:'J23',length_m:14362,vehicle_profile:{type:'biarticulated',capacity:240,status:'observed',buses:41,snapshot:'2026-09-12'}},DEFAULTS,1);assert.equal(corto.capacity,240);});
test('The catalogue carries the fleet reading for the services it was observed on',()=>{const perfiles=source.routes.filter(r=>r.vehicle_profile?.source==='gtfs_rt_fleet_labels');assert.ok(perfiles.length>80);for(const code of ['J23','F23','M51','F51','2'])assert.equal(source.routes.find(r=>r.code===code).vehicle_profile.type,'biarticulated');for(const code of ['1','3','8','K23','B13'])assert.equal(source.routes.find(r=>r.code===code).vehicle_profile.type,'articulated');for(const r of perfiles){assert.ok(r.vehicle_profile.buses>=3);assert.equal(r.vehicle_profile.source_feed,'GTFS-Realtime de TRANSMILENIO S.A., datos abiertos');}});
test('The measured speed of each stretch sets the pace and the schedule still sets the total',()=>{
 // 3 km en dos trechos: el primero medido lento, el segundo medido rápido.
 const campo={routes:{r:{coverage:1,profile:[[0,150,40],[1500,450,2]]}}};
 const d={...fixture([{...route(),stops:[{station_id:'a',name:'a',kind:'station',wagons:2,at_m:0},{station_id:'c',name:'c',kind:'station',wagons:2,at_m:3000}],points:[[0,0],[3000,0]]}]),speed_profiles:campo};
 const s=new Operation(d,{});
 const move=s.trips[0].moves[0];
 assert.ok(move,'el tramo existe');
 const lento=move.profile.v[Math.floor(move.profile.v.length*.2)]*3.6,rapido=move.profile.v[Math.floor(move.profile.v.length*.8)]*3.6;
 assert.ok(lento<rapido-10,`el trecho medido lento (${lento.toFixed(1)}) va por debajo del rápido (${rapido.toFixed(1)})`);
 assert.ok(move.profile.v.some(v=>v>0),'el bus se mueve');
});
test('A trunk bus never stands still mid-corridor: what it has to spare it gives back rolling slower',()=>{
 // Sobre el catálogo real y su horario: en los tramos con velocidad medida no puede haber ni una
 // espera fabricada. Detenerse queda para el rojo y para la cola por el andén.
 const perfiles=JSON.parse(fs.readFileSync(new URL('../dist/speed_profiles.json',import.meta.url)));
 const activos=gtfsServices(horario,'2026-09-12');
 const ids=Object.keys(horario.routes).filter(k=>horario.routes[k].segments&&perfiles.routes[k]&&programmedDepartures(horario,k,activos).length>20).slice(0,4);
 assert.ok(ids.length,'hay servicios con horario y con campo medido');
 const s=new Operation({...source,routes:source.routes.filter(r=>ids.includes(r.id)),schedule:horario,speed_profiles:perfiles},{date:'2026-09-12'});
 let tramos=0,rodando=0;
 for(const t of s.trips){
  const ruta=s.routes.get(t.routeId);
  t.moves.forEach((m,i)=>{
   if(!ruta.visits[i+1]||ruta.visits[i].kind==='street'||ruta.visits[i+1].kind==='street')return;
   tramos++;
   assert.equal(m.holds.filter(h=>h.congestion).length,0,'un tramo con campo medido no fabrica esperas');
   if(m.profile.v.some(v=>v>1))rodando++;
  });
 }
 assert.ok(tramos>100,`se revisaron ${tramos} tramos`);
 assert.equal(rodando,tramos,'el bus se mueve en todos ellos');
});
test('Running ahead is paid back on the next stretch, and the trip never arrives early by much',()=>{
 const perfiles=JSON.parse(fs.readFileSync(new URL('../dist/speed_profiles.json',import.meta.url)));
 const activos=gtfsServices(horario,'2026-09-12');
 const id=Object.keys(horario.routes).find(k=>horario.routes[k].segments&&perfiles.routes[k]&&programmedDepartures(horario,k,activos).length>20);
 const ruta=source.routes.find(r=>r.id===id);
 const s=new Operation({...source,routes:[ruta],schedule:horario,speed_profiles:perfiles},{date:'2026-09-12'});
 const objetivo=horario.routes[id].segments.reduce((a,x)=>a+(x[3]||x[0]),0);
 const duraciones=s.trips.filter(t=>t.start>=DAY&&t.start<2*DAY).map(t=>t.end-t.start).sort((a,b)=>a-b);
 assert.ok(duraciones.length,'hay viajes ese día');
 const mediana=duraciones[Math.floor(duraciones.length/2)];
 assert.ok(mediana>objetivo*.85,`el viaje no se adelanta de más: ${(mediana/60).toFixed(1)} min frente a ${(objetivo/60).toFixed(1)}`);
 assert.ok(mediana<objetivo*1.25,`ni se retrasa de más: ${(mediana/60).toFixed(1)} min`);
});
test('Vehicle cruise variation is stable and bounded by ±5 km/h',()=>{const values=Array.from({length:50},(_,i)=>vehicleSpec({code:'1'},DEFAULTS,i).speedOffset);assert.ok(new Set(values).size>1);assert.ok(values.every(v=>v>=-5&&v<=5));assert.equal(DEFAULTS.cruiseKmh,60);assert.equal(DEFAULTS.streetKmh,50);});
test('Irregular departures and bounded peak reinforcements are deterministic',()=>{const d=fixture();d.stations=d.stations.map(s=>({...s,demand_profile:{hourly:Array(24).fill(100000)}}));const a=new Operation(d),b=new Operation(d),plain=new Operation(d,{params:{reinforcements:false}});assert.deepEqual(a.trips.map(t=>t.id),b.trips.map(t=>t.id));assert.ok(a.trips.some(t=>t.reinforcement));assert.ok(a.trips.length>plain.trips.length);assert.ok(a.trips.length<plain.trips.length*1.25);});
test('F23 has one published playable destination after user correction',()=>{const routes=source.routes.filter(r=>r.code==='F23');assert.equal(routes.length,1);assert.equal(routes[0].id,'396');assert.ok(source.excluded.some(r=>r.id==='10082'));});

test('OSM station placements remain on each directed route and keep stop order',async()=>{const {placeVisit}=await import('../dist/station-layouts.mjs');const {hash}=await import('../dist/operation.mjs');const layouts=JSON.parse(fs.readFileSync(new URL('../dist/station_layouts.json',import.meta.url)));const byId=new Map(layouts.stations.map(l=>[l.station_id,l]));let located=0;const ricaurte=new Set();for(const r of source.routes.filter(r=>r.ready)){const path=new MetricPath(r.points),visits=r.stops.map((s,i)=>{const p=placeVisit({...r,path},i,byId.get(s.station_id),hash(r.family));if(p){located++;assert.ok(p.at_m>=0&&p.at_m<=path.length);assert.ok(Math.abs(p.at_m-s.at_m)<=400.01);assert.ok(p.placement_source.startsWith('https://www.openstreetmap.org/'));if(s.station_id==='7111')ricaurte.add(p.platform_id);}return p?.at_m??s.at_m;});for(let i=1;i<visits.length;i++)assert.ok(visits[i]>visits[i-1],r.code);}assert.ok(located>100);assert.ok(ricaurte.size>=4);for(const id of ['7000','3000','5000'])assert.ok(byId.get(id).platforms.filter(p=>p.closed&&p.role==='platform_trunk').length>=2);});
test('Measured day-type profiles replace the estimated weekend reduction',()=>{
 const demand=JSON.parse(fs.readFileSync(new URL('../dist/demand.json',import.meta.url)));
 assert.ok(demand.profiles.length>100);
 for(const p of demand.profiles){
  assert.ok(p.hourly_by_day_type,`${p.station_id} sin perfil por tipo de día`);
  for(const kind of ['weekday','saturday','holiday']){
   const hourly=p.hourly_by_day_type[kind];
   assert.equal(hourly.length,24,`${p.station_id}/${kind}`);
   assert.ok(hourly.every(v=>Number.isFinite(v)&&v>=0),`${p.station_id}/${kind}`);
   assert.ok(p.days_observed[kind]>=1,`${p.station_id}/${kind} sin días observados`);
  }
  // The legacy field must stay the weekday profile so an older reader keeps working.
  assert.deepEqual(p.hourly,p.hourly_by_day_type.weekday,p.station_id);
 }
 const station={...base.stations[0],demand_profile:demand.profiles.find(p=>p.station_id==='2000')};
 const rate=(date)=>generatedPassengers(station,0,8*3600,8*3600+600,date,parameters({}));
 // A Sunday must now come out of the measured Sunday profile, not a 0,55 factor on a Wednesday.
 const semana=rate('2026-09-10'),domingo=rate('2026-09-13'),sabado=rate('2026-09-12');
 assert.ok(semana>0&&sabado>0&&domingo>0);
 assert.ok(domingo<sabado&&sabado<semana,`domingo ${domingo} sábado ${sabado} semana ${semana}`);
 assert.ok(domingo/semana<0.55,'el domingo medido debe quedar por debajo del factor estimado que reemplaza');
 // A station without a profile keeps the estimated path and still responds to the day type.
 const sinPerfil={...base.stations[0]};
 assert.ok(generatedPassengers(sinPerfil,0,8*3600,8*3600+600,'2026-09-10',parameters({}))>0);
});

// --- Salidas del horario publicado -----------------------------------------------------------
const horario=JSON.parse(fs.readFileSync(new URL('../dist/schedule.json',import.meta.url)));
test('El calendario GTFS se resuelve sobre la fecha real, con sus excepciones',()=>{
 // Viernes laborable, sábado y domingo activan conjuntos distintos y disjuntos en su día propio.
 assert.deepEqual([...gtfsServices(horario,'2026-09-11')].sort(),['1','3','5','7']);
 assert.deepEqual([...gtfsServices(horario,'2026-09-12')].sort(),['2','3','6','7']);
 assert.deepEqual([...gtfsServices(horario,'2026-09-13')].sort(),['4','5','6','7']);
 // Un festivo entre semana: el paquete lo trae como excepción añadida al servicio dominical y
 // retirada del laborable, que es justo lo que se perdería al traducirlo a un tipo de día.
 const festivo=gtfsServices(horario,'2026-08-17');
 assert.ok(festivo.has('4')&&!festivo.has('1'),'el 17 de agosto opera como domingo');
 assert.equal(gtfsServices({},'2026-09-12').size,0);
});
test('Un servicio despacha exactamente a las horas publicadas y no a un intervalo',()=>{
 const activos=gtfsServices(horario,'2026-09-12');
 const id=Object.keys(horario.routes).find(k=>programmedDepartures(horario,k,activos).length>20);
 const esperadas=programmedDepartures(horario,id,activos);
 const ruta=source.routes.find(r=>r.id===id);
 const datos={...source,routes:[ruta],schedule:horario};
 const op=new Operation(datos,{date:'2026-09-12'});
 const salidas=op.trips.filter(t=>t.start>=DAY&&t.start<2*DAY).map(t=>t.start-DAY).sort((a,b)=>a-b);
 assert.deepEqual(salidas,esperadas);
 assert.ok(op.programmedRoutes.has(id));
 // Los intervalos publicados no son constantes: es lo que la regla de cuatro y ocho minutos borraba.
 const huecos=new Set(esperadas.slice(1).map((t,i)=>t-esperadas[i]));
 assert.ok(huecos.size>1,'el horario real tiene intervalos distintos a lo largo del día');
});
test('Sin horario, o con el interruptor apagado, vuelve la regla sintética',()=>{
 const activos=gtfsServices(horario,'2026-09-12');
 const id=Object.keys(horario.routes).find(k=>programmedDepartures(horario,k,activos).length>20);
 const ruta=source.routes.find(r=>r.id===id);
 const con=new Operation({...source,routes:[ruta],schedule:horario},{date:'2026-09-12'});
 const sin=new Operation({...source,routes:[ruta],schedule:horario},{date:'2026-09-12',params:{programmedDispatch:false}});
 const huerfana=new Operation({...source,routes:[ruta]},{date:'2026-09-12'});
 assert.equal(sin.programmedRoutes.size,0);
 assert.equal(huerfana.programmedRoutes.size,0);
 assert.notDeepEqual(con.trips.map(t=>t.start),sin.trips.map(t=>t.start));
 // Ausencia de archivo y apagado deliberado producen la misma operación: una sola regla de reserva.
 assert.deepEqual(huerfana.trips.map(t=>t.start),sin.trips.map(t=>t.start));
 assert.ok(parameters({}).programmedDispatch);
 assert.throws(()=>parameters({programmedDispatch:'sí'}));
});
test('El horario cubre la mayoría del catálogo y lo que falta queda declarado, no inventado',()=>{
 const listas=source.routes.filter(r=>r.ready);
 const conHorario=listas.filter(r=>horario.routes[r.id]);
 assert.ok(conHorario.length>=100,`${conHorario.length} servicios con horario publicado`);
 // Cada servicio sin horario aparece en la lista de pendientes con un motivo escrito.
 const pendientes=new Map(horario.pending.map(p=>[p.id,p]));
 for(const r of listas)if(!horario.routes[r.id]){
  assert.ok(pendientes.has(r.id),`${r.code} ${r.name} sin horario y sin constar como pendiente`);
  assert.ok(pendientes.get(r.id).reason);
 }
 // Ninguna ruta apunta a un registro de vuelta completa entero: contaría un bus dos veces. Sí
 // puede apuntar a una de sus dos mitades, que es el corte.
 const auditoria=JSON.parse(fs.readFileSync(new URL('../../data/processed/schedule_audit.json',import.meta.url)));
 const combinadas=new Set(auditoria.combined_records.map(c=>c.route_id));
 for(const entrada of Object.values(horario.routes))for(const g of entrada.gtfs)assert.ok(!combinadas.has(g),`${g} es una vuelta completa sin cortar`);
 // Cada mitad citada por un servicio existe como corte, y las dos mitades de un corte son dos
 // servicios locales distintos: si fueran el mismo, el bus saldría dos veces de la misma cabecera.
 const mitades=new Map();
 for(const c of auditoria.split_records){
  assert.ok(combinadas.has(c.route_id),'un corte sale de un registro de vuelta completa');
  assert.equal(c.halves.length,2);
  assert.notEqual(c.halves[0].local_id,c.halves[1].local_id);
  // tramos = los de la primera mitad + el giro + los de la segunda.
  assert.equal(c.halves[0].segments+1+c.halves[1].segments,c.segments);
  for(const h of c.halves)mitades.set(h.route_id,h);
 }
 for(const entrada of Object.values(horario.routes))for(const g of entrada.gtfs)
  if(g.includes('#'))assert.ok(mitades.has(g),`${g} cita una mitad que no consta como corte`);
 // Y la comprobación que de verdad importa: la segunda mitad nunca sale antes que la primera. Se
 // hace sobre los pares cuyas salidas vienen solo del corte, donde las dos listas son comparables.
 let comprobados=0;
 for(const c of auditoria.split_records){
  const [a,b]=c.halves.map(h=>horario.routes[h.local_id]);
  if(!a||!b||[...a.gtfs,...b.gtfs].some(g=>!g.includes('#')))continue;
  for(const servicio of Object.keys(a.departures)){
   const ida=a.departures[servicio],vuelta=b.departures[servicio];
   assert.ok(vuelta,'las dos mitades corren el mismo calendario');
   assert.equal(ida.length,vuelta.length,'un viaje publicado da una salida a cada mitad');
   for(let i=0;i<ida.length;i++){assert.ok(vuelta[i]>ida[i],'la vuelta empieza cuando la ida ya salió');comprobados++;}
  }
 }
 assert.ok(comprobados>100,`${comprobados} salidas de vuelta comprobadas`);
});

// --- Duración del recorrido publicada ---------------------------------------------------------
test('La velocidad se despeja del tiempo del tramo y nunca supera el crucero',()=>{
 const a=.8,b=1.1,cap=60/3.6;
 // Sin semáforos, la velocidad devuelta reproduce el tiempo objetivo: distancia/v + (v/2)(1/a+1/b).
 for(const [distancia,objetivo] of [[1200,150],[800,120],[2000,240]]){
  const v=programmedSpeed(objetivo,distancia,cap,a,b,0);
  assert.ok(v<cap,'un tramo holgado tiene que ir por debajo del crucero');
  assert.ok(Math.abs(distancia/v+v/2*(1/a+1/b)-objetivo)<1e-6);
 }
 // Un objetivo imposible no inventa velocidad: se queda en el techo del escenario.
 assert.equal(programmedSpeed(5,3000,cap,a,b,0),cap);
 assert.equal(programmedSpeed(0,1200,cap,a,b,0),cap);
 assert.equal(programmedSpeed(150,0,cap,a,b,0),cap);
 // Más semáforos en el mismo tramo se comen parte del tiempo publicado, así que para llegar a la
 // misma hora hay que rodar más rápido entre ellos. Es justamente lo que evita contarlos dos veces:
 // si la velocidad bajara además de esperar en los rojos, el viaje se pasaría del horario.
 const sin=programmedSpeed(300,2000,cap,a,b,0),con=programmedSpeed(300,2000,cap,a,b,4);
 assert.ok(con>sin,'el tiempo que se van los semáforos hay que recuperarlo rodando');
 // El suelo físico se respeta aunque el tramo sea absurdamente holgado.
 assert.equal(programmedSpeed(10000,100,cap,a,b,0),3);
});
test('Con tiempos publicados el recorrido dura lo programado; sin ellos se queda corto',()=>{
 const activos=gtfsServices(horario,'2026-09-12');
 const id=Object.keys(horario.routes).find(k=>horario.routes[k].segments&&programmedDepartures(horario,k,activos).length>20);
 const ruta=source.routes.find(r=>r.id===id);
 const datos={...source,routes:[ruta],schedule:horario};
 const objetivo=horario.routes[id].segments.reduce((a,s)=>a+s[3],0)/60; // columna sábado
 const media=op=>{const v=op.trips.filter(t=>t.start>=DAY&&t.start<2*DAY).map(t=>(t.end-t.start)/60).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
 const con=media(new Operation(datos,{date:'2026-09-12'}));
 const sin=media(new Operation(datos,{date:'2026-09-12',params:{programmedRunning:false}}));
 assert.ok(sin<objetivo*.85,`a crucero fijo el recorrido sale corto: ${sin.toFixed(1)} frente a ${objetivo.toFixed(1)}`);
 assert.ok(Math.abs(con-objetivo)<objetivo*.15,`con tiempos publicados se acerca: ${con.toFixed(1)} frente a ${objetivo.toFixed(1)}`);
 assert.ok(con>sin,'los tiempos publicados solo pueden alargar el recorrido, nunca acortarlo');
 assert.ok(parameters({}).programmedRunning);
 assert.throws(()=>parameters({programmedRunning:1}));
});

test('En calzada segregada el bus rueda a su crucero y el sobrante del horario se gasta detenido',()=>{
 // El tiempo publicado de un tramo se cumple igual, pero se reparte como es: rodando a lo que rueda
 // un bus troncal y parado el resto. Antes se repartía bajando el crucero a la velocidad media del
 // tramo, y el velocímetro marcaba 23 km/h en un viaducto donde el bus real va a 50.
 const activos=gtfsServices(horario,'2026-09-12');
 const id=Object.keys(horario.routes).find(k=>horario.routes[k].segments&&programmedDepartures(horario,k,activos).length>20);
 const ruta=source.routes.find(r=>r.id===id);
 const op=new Operation({...source,routes:[ruta],schedule:horario},{date:'2026-09-12'});
 let maxima=0,detenidos=0,rodando=0;
 for(let t=DAY+8*3600;t<DAY+8*3600+1800;t+=15)for(const bus of op.seek(t)){
  if(bus.state==='traffic'){detenidos++;assert.equal(bus.speed,0,'una detención es velocidad cero, no un crucero lento');}
  if(bus.state==='moving'){rodando++;maxima=Math.max(maxima,bus.speed);}
 }
 assert.ok(rodando>0&&detenidos>0,'tiene que haber buses rodando y buses detenidos');
 assert.ok(maxima>DEFAULTS.cruiseKmh/3.6*.9,`el bus tiene que alcanzar su crucero: ${(maxima*3.6).toFixed(1)} km/h`);
 // Y lo mismo visto al revés: sin tiempos publicados nadie se detiene por tráfico, porque no hay
 // sobrante que gastar.
 const libre=new Operation({...source,routes:[ruta],schedule:horario},{date:'2026-09-12',params:{programmedRunning:false}});
 libre.seek(DAY+8*3600);
 assert.equal(libre.stats().traffic,0,'sin horario publicado no hay sobrante y no se inventan detenciones');
});
test('Las detenciones por tráfico se ordenan en el tiempo y nunca preceden al semáforo del tramo',()=>{
 // El muestreo recorre las detenciones en el orden del array acumulando demora: una detención fuera
 // de orden devolvería un bus que retrocede. Y una cola por delante del semáforo que la causa sería
 // una cola inventada en otro sitio.
 const activos=gtfsServices(horario,'2026-09-12');
 const id=Object.keys(horario.routes).find(k=>horario.routes[k].segments&&programmedDepartures(horario,k,activos).length>20);
 const ruta=source.routes.find(r=>r.id===id);
 const op=new Operation({...source,routes:[ruta],schedule:horario},{date:'2026-09-12'});
 let conDetencion=0;
 for(const viaje of op.trips.slice(0,60))for(const move of viaje.moves){
  let previo=-Infinity,ultimoSemaforo=-Infinity;
  for(const hold of move.holds){
   assert.ok(hold.start>=previo-1e-9,'las detenciones tienen que ir en orden de tiempo');
   assert.ok(hold.end>=hold.start,'una detención no puede acabar antes de empezar');
   assert.ok(hold.at_m>=move.from-1e-6&&hold.at_m<=move.from+move.profile.distance+1e-6,'la detención cae dentro del tramo');
   if(hold.congestion){assert.ok(hold.at_m>=ultimoSemaforo-1e-6,'la cola no se forma por delante del semáforo que la causa');conDetencion++;}
   else ultimoSemaforo=hold.at_m;
   previo=hold.start;
  }
 }
 assert.ok(conDetencion>0,'la ruta de prueba tiene que traer detenciones por tráfico');
 assert.ok(TRAFFIC.chunk>0&&TRAFFIC.minimum>0);
 // Ir y volver devuelve exactamente lo mismo, con detenciones y todo.
 const antes=structuredClone(op.seek(DAY+8*3600+1234));
 op.seek(DAY+12*3600);
 assert.deepEqual(op.seek(DAY+8*3600+1234),antes);
});

// --- La ficha de un bus no puede depender de qué función gane un nombre repetido ---------------
test('app.mjs no declara dos veces un mismo nombre de función en ámbitos que se tapan',()=>{
 // Una declaración dentro del bloque principal tapa a la del módulo en todo ese bloque, y el
 // error no aparece al cargar sino al pintar: la ficha de un bus quedaba a medias, sin sus
 // botones, y la excepción se repetía en cada fotograma dejando el mapa congelado.
 const fuente=fs.readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8').split('\n');
 const nivel=[],vistos=new Map();
 let profundidad=0;
 for(const linea of fuente){
  const nombre=linea.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if(nombre){
   const previo=vistos.get(nombre[1]);
   assert.ok(previo===undefined||previo===profundidad,
    `La función ${nombre[1]} se declara en dos ámbitos anidados: la interior tapa a la exterior.`);
   vistos.set(nombre[1],profundidad);
  }
  profundidad+=(linea.match(/\{/g)||[]).length-(linea.match(/\}/g)||[]).length;
 }
 assert.ok(vistos.size>20,'el recorrido no encontró funciones: la prueba no estaría comprobando nada');
});
