import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MetricPath,Simulation,FixedClock} from '../dist/simulation.mjs';
import {registerSimulationTools} from '../dist/webmcp.mjs';
const data=JSON.parse(readFileSync(new URL('../dist/network.json',import.meta.url)));
const state=sim=>sim.buses.map(b=>({...b}));
function spacing(sim){for(const lane of sim.lanes.values()){const buses=[...lane.buses].sort((a,b)=>a.s-b.s);for(let i=1;i<buses.length;i++)assert.ok(buses[i].s-buses[i-1].s>=sim.vehicle.length_m+sim.gap-1e-6,`overlap ${lane.id} ${buses[i].id}`);}}

test('metric paths retain metres through bends and duplicate vertices',()=>{
 const p=new MetricPath([[0,0],[0,0],[300,0],[300,400]]);assert.equal(p.length,700);assert.deepEqual(p.sample(500).xy,[300,200]);assert.deepEqual(p.sample(1e6).xy,[300,400]);
 assert.throws(()=>new MetricPath([[0,0],[NaN,2]]));
 const pilot=data.patterns.find(p=>p.scenario==='pilot');assert.ok(Math.abs(new MetricPath(pilot.points).length-1602.465665)<.02);
});
test('identical simulated time is independent of render cadence and pause freezes state',()=>{
 const a=new Simulation(data),b=new Simulation(data);const ca=new FixedClock(a),cb=new FixedClock(b);ca.speed=cb.speed=32;
 for(let i=0;i<600;i++)ca.advance(1/60);for(let i=0;i<100;i++)cb.advance(.1);
 assert.equal(a.tickCount,3200);assert.deepEqual(state(a),state(b));
 const saved=state(a),time=a.time;ca.paused=true;ca.advance(500);assert.equal(a.time,time);assert.deepEqual(state(a),saved);
});
test('work budget retains clock backlog instead of skipping time or stations',()=>{
 const s=new Simulation(data),c=new FixedClock(s);c.advance(10,4);assert.equal(s.tickCount,4);assert.ok(c.pending>9);
 for(let i=0;i<24;i++)c.advance(0,4);assert.equal(s.tickCount,100);assert.ok(Math.abs(c.pending)<1e-8);
 assert.throws(()=>s.step(1));assert.throws(()=>c.advance(-1));
});
test('buses stop at ordered stations, dwell, reverse at same coordinate and remain spaced',()=>{
 const s=new Simulation(data,{fleet:8});const waiting=new Map(),served=new Set();let reversed=0;
 for(let i=0;i<18000;i++){
   const before=new Map(s.buses.map(b=>[b.id,{lane:b.laneId,xy:s.inspect(b.id).xy}]));
   s.events=[];s.step(.1);if(i%10===0)spacing(s);
   for(const e of s.events){
     if(e.type==='arrive_stop'){assert.equal(s.byId.get(e.bus_id).speed,0);served.add(e.station_id);waiting.set(e.bus_id,e.time_s);}
     if(e.type==='depart_stop'){assert.ok(e.time_s-waiting.get(e.bus_id)>=18-1e-6);waiting.delete(e.bus_id);}
     if(e.type==='reverse_trial'){reversed++;const a=before.get(e.bus_id).xy,b=s.inspect(e.bus_id).xy;assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<.01);}
   }
 }
 assert.deepEqual([...served].sort(),['05101','05102','05103']);assert.ok(reversed>8);assert.ok(s.completedStops>24);
});
test('3000 concurrent buses retain identity, no overlaps or invalid positions under load',()=>{
 const s=new Simulation(data,{scenario:'load',fleet:3000});const ids=s.buses.map(b=>b.id);let sawQueue=false;
 for(let i=0;i<3000;i++){s.step(.1);if(i%100===0){spacing(s);sawQueue||=s.buses.some(b=>b.state==='queue');}}
 assert.equal(s.buses.length,3000);assert.deepEqual(s.buses.map(b=>b.id),ids);assert.equal([...s.lanes.values()].reduce((n,l)=>n+l.buses.length,0),3000);
 for(const b of s.buses){assert.ok(Number.isFinite(b.s)&&b.s>=0&&b.s<=s.lanes.get(b.laneId).path.length+.05);assert.ok(b.speed>=0);}
 assert.ok(s.completedStops>100);assert.ok(sawQueue);spacing(s);
});
test('bad scenarios, excessive density and disconnected reverse paths are rejected',()=>{
 assert.throws(()=>new Simulation(data,{scenario:'official'}));assert.throws(()=>new Simulation(data,{fleet:3000}));
 const broken=structuredClone(data);broken.patterns.find(p=>p.scenario==='pilot').reverse_id='missing';assert.throws(()=>new Simulation(broken));
});
test('optional tool surface shares clock actions and invalid input leaves state unchanged',()=>{
 const registered=new Map();let current={paused:false,speed:1};const dispose=registerSimulationTools({registerTool(t){registered.set(t.name,t);}},{read:()=>({...current}),control:i=>Object.assign(current,i)});
 assert.equal(registered.size,2);const control=registered.get('control_transmi_clock');assert.deepEqual(control.execute({paused:true,speed:8}),{paused:true,speed:8});
 assert.throws(()=>control.execute({paused:false,speed:99}));assert.deepEqual(current,{paused:true,speed:8});
 assert.deepEqual(registered.get('read_transmi_simulation').execute({}),current);dispose();assert.equal(registerSimulationTools(null,{}),null);
});
