import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {MetricPath} from '../dist/simulation.mjs';import {travelProfile,travelAt,travelTimeAtDistance} from '../dist/travel.mjs';
import {matchSignals,signalPhase,signalTravel,signalTravelAt} from '../dist/signals.mjs';import {Operation} from '../dist/operation.mjs';
const path=new MetricPath([[0,0],[1000,0]]);
const signal=(id='s',xy=[500,0],oneway='yes',angle=0)=>({id,xy,direction:{},evidence:{direct_membership:true,qualifying_ways:[{oneway,directed_angle_deg:angle}]}});
test('Traffic controls require direct evidence, nearby matching carriageway and permitted direction',()=>{
 assert.equal(matchSignals(path,{signals:[signal()]}).length,1);
 assert.equal(matchSignals(path,{signals:[{...signal(),evidence:{direct_membership:false}}]}).length,0);
 assert.equal(matchSignals(path,{signals:[signal('s',[500,13])]}).length,0);
 assert.equal(matchSignals(path,{signals:[signal('s',[500,0],'yes',90)]}).length,0);
 assert.equal(matchSignals(new MetricPath([[1000,0],[0,0]]),{signals:[signal()]}).length,0);
 const bidirectional=signal('s',[500,0],'no');assert.equal(matchSignals(new MetricPath([[1000,0],[0,0]]),{signals:[bidirectional]}).length,1);
 bidirectional.direction={'traffic_signals:direction':'backward'};assert.equal(matchSignals(path,{signals:[bidirectional]}).length,0);
 assert.equal(matchSignals(path,{signals:[signal('s',[500,0],'-1',180)]}).length,1);
});
test('Adjacent vertices deduplicate one approach but a separate lap remains distinct',()=>{
 const loop=new MetricPath([[0,0],[500,0],[1000,0],[1000,100],[0,100],[0,0],[1000,0]]);
 assert.equal(matchSignals(loop,{signals:[signal()]}).length,2);
});
test('Intermediate signal stops brake to zero at exact metres; inverse motion is accurate',()=>{
 const p=travelProfile(path,0,1000,60/3.6,.8,1.1,{checkpoints:[401,405],stops:[401,405]});
 for(const distance of [0,20,180,400,401,402,405,750,999,1000]){const pose=travelAt(p,travelTimeAtDistance(p,distance));assert.ok(Math.abs(pose.s-distance)<1e-6,`${pose.s} / ${distance}`);}
 for(const distance of [401,405])assert.ok(travelAt(p,travelTimeAtDistance(p,distance)).speed<1e-5);
 for(let t=.1;t<p.duration;t+=.1){const a=travelAt(p,t-.1),b=travelAt(p,t);assert.ok((b.speed-a.speed)/.1<=.80001);assert.ok((a.speed-b.speed)/.1<=1.10001);}
});
test('Red and amber arrivals stop, holds end on green, and seeks preserve exact position',()=>{
 const signals=[{id:'a',at_m:310},{id:'b',at_m:720}],cache=new Map();let stopped=0;
 for(let departure=0;departure<90;departure+=2){
  const p=signalTravel(path,0,1000,60/3.6,.8,1.1,departure,signals,cache,'leg'),move={...p,from:0,start:departure,end:departure+p.duration};
  for(const h of p.holds){stopped++;assert.notEqual(signalPhase(h.signalId,h.start).color,'green');assert.equal(signalPhase(h.signalId,h.end).color,'green');const pose=signalTravelAt(move,(h.start+h.end)/2);assert.equal(pose.speed,0);assert.equal(pose.s,h.at_m);assert.equal(pose.signalId,h.signalId);}
  for(const s of signals){const crossing=departure+travelTimeAtDistance(p.profile,s.at_m)+p.holds.filter(h=>h.at_m<=s.at_m).reduce((sum,h)=>sum+h.end-h.start,0);assert.equal(signalPhase(s.id,crossing+1e-6).color,'green');}
  assert.ok(Math.abs(signalTravelAt(move,move.end).s-1000)<1e-6);
  let prev=-1;for(let time=move.start;time<=move.end;time+=.1){const pose=signalTravelAt(move,time);assert.ok(pose.s>=prev-1e-6);prev=pose.s;}
 }
 assert.ok(stopped>20);assert.ok(cache.size<=4);
});
test('No corroborated controls leaves the original stop-to-stop duration unchanged',()=>{
 const ordinary=travelProfile(path,0,1000,15),signalled=signalTravel(path,0,1000,15,.8,1.1,0,[]);assert.equal(ordinary.duration,signalled.duration);assert.deepEqual(signalled.holds,[]);
});
test('Operation integrates signal waits, supports opt-out and reproduces backward seeking',()=>{
 const data={scenario_date:'2026-09-10',vehicle:{length_m:18.5,width_m:2.5},stations:[{id:'a',xy:[0,0],name:'A',wagons:2},{id:'b',xy:[1000,0],name:'B',wagons:2}],busway_signals:{signals:[signal()]},routes:[{id:'r',code:'1',name:'B',color:'#ff0000',family:'r',ready:true,valid_from:'2026-01-01',valid_until:'2026-12-31',variant:'regular',calendar:[{days:'L-D',start:25200,end:28800}],points:path.points,served_zones:['F'],zone:'F',stops:[{station_id:'a',at_m:0,kind:'station',wagons:2},{station_id:'b',at_m:1000,kind:'station',wagons:2}]}]};
 const engine=new Operation(data),plain=new Operation(data,{params:{signals:false}}),trip=engine.trips.find(t=>t.moves[0].holds.length);assert.ok(trip);const h=trip.moves[0].holds[0],time=(h.start+h.end)/2;engine.seek(time);const snapshot=structuredClone(engine.buses);assert.ok(engine.stats().signal>0);assert.equal(engine.inspect(trip.id).speed,0);assert.equal(engine.stationStats('b').buses.some(b=>b.id===trip.id),false);engine.seek(time+500);engine.seek(time);assert.deepEqual(engine.buses,snapshot);assert.ok(plain.trips.every(t=>t.moves.every(m=>!m.holds.length)));
});
test('Every portal has sourced physical evidence; layouts never substitute a continuous estimated wagon row',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../dist/station_layouts.json',import.meta.url))),ids=['2000','3000','4000','5000','6000','7000','8000','90004','10000'];
 for(const id of ids){const layout=d.stations.find(s=>s.station_id===id);assert.ok(layout,id);assert.ok(layout.platforms.length+layout.areas.length>0);assert.ok(layout.internal_lines.length>0);for(const p of [...layout.platforms,...layout.areas])assert.ok(p.source.startsWith('https://www.openstreetmap.org/'));}
 const north=d.stations.find(s=>s.station_id==='2000');assert.ok(north.platforms.some(p=>p.role==='trunk_stop_position'&&p.points.length===1));
});
test('The catalogue separates busway signals from shared-street ones and covers both',()=>{
 const catalogue=JSON.parse(fs.readFileSync(new URL('../dist/busway_signals.json',import.meta.url)));
 const services=JSON.parse(fs.readFileSync(new URL('../dist/services.json',import.meta.url)));
 const kinds=new Set(catalogue.signals.map(s=>s.carriageway));
 assert.deepEqual([...kinds].sort(),['busway','street']);
 for(const s of catalogue.signals){
  // Existence evidence is required whatever the carriageway: a signal is never accepted on proximity alone.
  assert.ok(s.evidence?.direct_membership,s.id);
  assert.ok((s.evidence.qualifying_ways||[]).length>0,s.id);
  const declared=s.evidence.qualifying_ways.some(w=>w.carriageway===s.carriageway);
  assert.ok(declared,`${s.id} declara ${s.carriageway} sin una vía que lo respalde`);
  if(s.carriageway==='street')assert.ok(s.evidence.qualifying_ways.every(w=>w.tags.highway!=='busway'),s.id);
 }
 // Every service that leaves the busway must now have at least one control on its street part.
 const street=services.routes.filter(r=>r.ready&&r.stops.some(x=>x.kind==='street'));
 assert.ok(street.length>0);
 for(const r of street){
  const matches=matchSignals(new MetricPath(r.points),catalogue);
  assert.ok(matches.length>0,`${r.code}/${r.id} sin ningún semáforo en su recorrido`);
 }
});
