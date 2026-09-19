import test from 'node:test';import assert from 'node:assert/strict';
import {JourneyPlanner,routeSlice,ALTERNATIVES} from '../dist/planner.mjs';import {MetricPath} from '../dist/simulation.mjs';
const stations=[{id:'a',name:'Origen',xy:[0,0]},{id:'b',name:'Intercambio',xy:[1000,0]},{id:'c',name:'Destino',xy:[2000,0]},{id:'d',name:'Norte',xy:[1000,1000]}];
function route(id,ids,extra={}){const points=ids.map(id=>stations.find(s=>s.id===id).xy);let at=0;return {id,code:id,name:'Dirección '+ids.at(-1),family:id,ready:true,color:'#c00',variant:'regular',valid_from:'2026-01-01',valid_until:'2026-12-31',calendar:[{days:'L-D',start:4*3600,end:23*3600}],points,stops:ids.map((id,i)=>{if(i)at+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);return {station_id:id,name:stations.find(s=>s.id===id).name,kind:'station',at_m:at,wagons:2};}),...extra};}
const planner=(routes,params={})=>new JourneyPlanner({stations,routes},params);const query=(extra={})=>({origin:'a',destination:'c',date:'2026-09-11',time:7*3600,...extra});
test('A direct journey boards and alights in published order, never traverses in reverse',()=>{const p=planner([route('R',['a','b','c'])]),r=p.plan(query());assert.equal(r.status,'found');assert.equal(r.journeys[0].transfers,0);assert.equal(r.journeys[0].legs[0].fromIndex,0);assert.equal(r.journeys[0].legs[0].toIndex,2);assert.equal(p.plan(query({origin:'c',destination:'a'})).status,'none');});
test('A transfer includes walking time, usable stops and a later connecting departure',()=>{const p=planner([route('A',['a','b']),route('B',['b','d'])]);const r=p.plan(query({destination:'d'})),legs=r.journeys[0].legs;assert.equal(r.journeys[0].transfers,1);assert.equal(legs[0].to,legs[1].from);assert.ok(legs[1].walk>=90);assert.ok(legs[1].depart>=legs[0].arrive+legs[1].walk);assert.equal(p.plan(query({destination:'d',maxTransfers:0})).status,'none');});
test('The planner never uses a pending route or fabricates a stop on an express',()=>{assert.equal(planner([route('X',['a','c'])]).plan(query({destination:'b'})).status,'none');assert.equal(planner([route('X',['a','c'],{ready:false})]).plan(query()).status,'none');});
test('Weekday calendars and no-service windows are enforced for the journey date',()=>{const p=planner([route('R',['a','c'],{calendar:[{days:'L-V',start:7*3600,end:8*3600}]})]);assert.equal(p.plan(query()).status,'found');assert.equal(p.plan(query({date:'2026-09-13'})).status,'none');assert.equal(p.plan(query({time:14*3600})).status,'none');});
test('An expired schedule stops the search only when operating past validity is disabled',()=>{
 const expirado=[route('R',['a','c'],{valid_until:'2026-09-30'})];// vigente en la fecha base, vencido en 2027
 // 2027-01-04 es lunes: el calendario L-D aplica y solo la vigencia puede excluir el servicio.
 assert.equal(planner(expirado,{beyondValidity:false}).plan(query({date:'2027-01-04'})).status,'none');
 assert.equal(planner(expirado,{beyondValidity:false}).plan(query()).status,'found');
 const abierto=planner(expirado).plan(query({date:'2027-01-04'}));
 assert.equal(abierto.status,'found');
 assert.equal(abierto.journeys[0].legs[0].routeId,'R');
 const futuro=[route('R',['a','c'],{valid_from:'2027-06-01',valid_until:'2027-12-31'})];
 assert.equal(planner(futuro,{beyondValidity:false}).plan(query()).status,'none');
 assert.equal(planner(futuro).plan(query()).status,'found');
});
test('Up to four transfers are searched and options that do not arrive earlier stay visible',()=>{
 const p=planner([route('A',['a','b']),route('B',['b','d']),route('C',['a','b','c'])]);
 const r=p.plan(query({destination:'c',maxTransfers:4}));
 assert.equal(r.status,'found');assert.equal(r.maxTransfers,4);
 assert.ok(r.journeys.every(j=>j.transfers<=4));
 assert.ok(r.journeys.some(j=>j.transfers===0));
 assert.ok(r.journeys.every(j=>typeof j.dominated==='boolean'));
 assert.ok(r.journeys.every((j,i)=>!i||j.transfers>=r.journeys[i-1].transfers));
 assert.throws(()=>p.plan(query({maxTransfers:5})));
 assert.throws(()=>p.plan(query({maxTransfers:-1})));
});
test('A trip dispatched the previous day can be boarded after midnight',()=>{const r=route('N',['a','b','c'],{calendar:[{days:'L-D',start:86300,end:86330}]});const result=planner([r]).plan(query({origin:'b',time:0}));assert.equal(result.status,'found');assert.ok(result.journeys[0].legs[0].depart<300);});
test('Same station and invalid dates are handled explicitly; planning is reproducible',()=>{const p=planner([route('R',['a','c'])]);assert.equal(p.plan(query({destination:'a'})).status,'same');assert.throws(()=>p.plan(query({date:'2026-02-30'})));assert.throws(()=>p.plan(query({time:Infinity})));assert.deepEqual(p.plan(query()),p.plan(query()));});
test('A planned segment retains intermediate geometry through bends',()=>{assert.deepEqual(routeSlice(new MetricPath([[0,0],[100,0],[100,100]]),50,150),[[50,0],[100,0],[100,50]]);});

test('Distinct services for one transfer count are all offered, capped and without duplicates',()=>{
 // Tres servicios que hacen el mismo viaje directo son tres opciones reales para quien espera,
 // no una repetición: antes solo sobrevivía el que llegaba primero.
 const tres=planner([route('R',['a','b','c']),route('S',['a','b','c']),route('T',['a','b','c'])]);
 const directos=tres.plan(query()).journeys.filter(j=>j.transfers===0);
 assert.equal(directos.length,3);
 assert.deepEqual([...new Set(directos.map(j=>j.legs[0].routeId))].sort(),['R','S','T']);
 // El tope evita que un corredor concurrido llene el panel.
 const cuatro=planner(['R','S','T','U'].map(id=>route(id,['a','b','c'])));
 assert.equal(cuatro.plan(query()).journeys.filter(j=>j.transfers===0).length,ALTERNATIVES);
 // Un solo servicio no se ofrece varias veces por salir más tarde.
 assert.equal(planner([route('R',['a','b','c'])]).plan(query()).journeys.filter(j=>j.transfers===0).length,1);
});
