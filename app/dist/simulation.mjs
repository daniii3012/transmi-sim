/** Metric, deterministic lane trials. No renderer or browser dependency.
 * A lane is one directed source component. Crossing polylines never connect.
 * Terminals reverse direction in place after regulation; turns are abstract.
 */
export class MetricPath {
  constructor(points) {
    if(!Array.isArray(points)||points.length<2||points.some(p=>p.length!==2||p.some(x=>!Number.isFinite(x))))throw new Error('Invalid metric polyline');
    this.points=points;this.cumulative=[0];
    for(let i=1;i<points.length;i++){const d=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);this.cumulative.push(this.cumulative[i-1]+d);}
    this.length=this.cumulative.at(-1);if(this.length<=0)throw new Error('Empty metric path');
  }
  sample(distance) {
    const s=Math.max(0,Math.min(distance,this.length));let lo=1,hi=this.cumulative.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(this.cumulative[mid]<s)lo=mid+1;else hi=mid;}
    let i=lo;while(i<this.points.length-1&&this.cumulative[i]===this.cumulative[i-1])i++;
    const a=this.points[i-1],b=this.points[i],d=this.cumulative[i]-this.cumulative[i-1],t=d?(s-this.cumulative[i-1])/d:0;
    return {xy:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],angle:Math.atan2(b[1]-a[1],b[0]-a[0])};
  }
}

export class Simulation {
  constructor(data,{scenario='pilot',fleet=24}={}) {
    if(!['pilot','load'].includes(scenario)||!Number.isInteger(fleet)||fleet<1||fleet>10000)throw new Error('Invalid trial scenario or fleet');
    this.scenario=scenario;this.vehicle=data.vehicle;this.gap=data.assumptions.min_gap_m;
    if(!(this.vehicle.length_m>0&&this.gap>0))throw new Error('Invalid vehicle spacing');
    this.time=0;this.tickCount=0;this.completedStops=0;this.completedLegs=0;this.buses=[];
    this.lanes=new Map();this.events=[];this.maxEvents=400;
    for(const p of data.patterns.filter(p=>p.scenario===scenario)){
      const path=new MetricPath(p.points);
      if(Math.abs(path.length-p.length_m)>.2)throw new Error('Metric path length does not match source');
      if(!(p.max_speed_mps>0&&p.dwell_s>0&&p.terminal_s>0))throw new Error('Invalid trial parameters');
      let previous=-Infinity;
      for(const stop of p.stops){if(!Number.isFinite(stop.at_m)||stop.at_m<0||stop.at_m>path.length+.05||stop.at_m<=previous)throw new Error('Unordered or out-of-range stop');previous=stop.at_m;}
      this.lanes.set(p.id,{...p,path,buses:[],capacity:Math.floor(path.length/(this.vehicle.length_m+this.gap+1))});
    }
    if(!this.lanes.size)throw new Error('No trial patterns');
    for(const lane of this.lanes.values()){
      const reverse=this.lanes.get(lane.reverse_id);
      if(!reverse||reverse.reverse_id!==lane.id||Math.hypot(...lane.path.sample(lane.path.length).xy.map((v,i)=>v-reverse.path.sample(0).xy[i]))>.01)throw new Error('Disconnected reverse pattern');
    }
    const lanes=[...this.lanes.values()];const capacity=lanes.reduce((sum,l)=>sum+l.capacity,0);
    if(fleet>capacity)throw new Error(`Fleet exceeds trial spacing capacity (${capacity})`);
    // Weighted allocation, bounded by physical storage; deterministic even on ties.
    const quotas=lanes.map(l=>({lane:l,count:0,weight:l.path.length}));const total=quotas.reduce((s,q)=>s+q.weight,0);
    for(const q of quotas)q.count=Math.min(q.lane.capacity,Math.floor(fleet*q.weight/total));
    let assigned=quotas.reduce((s,q)=>s+q.count,0);
    while(assigned<fleet){let best=null;for(const q of quotas)if(q.count<q.lane.capacity&&(!best||q.weight/(q.count+1)>best.weight/(best.count+1)))best=q;best.count++;assigned++;}
    for(const {lane,count} of quotas)for(let i=0;i<count;i++){
      const s=lane.path.length*(i+.5)/count;
      const bus={id:'E'+String(this.buses.length+1).padStart(4,'0'),laneId:lane.id,s,speed:0,state:'moving',remaining:0,
        nextStop:lane.stops.findIndex(stop=>stop.at_m>s+.01),stopsServed:0,legs:0,distance:0};
      if(bus.nextStop<0)bus.nextStop=lane.stops.length;
      lane.buses.push(bus);this.buses.push(bus);
    }
    this.capacity=capacity;this.byId=new Map(this.buses.map(b=>[b.id,b]));
  }
  event(type,bus,extra={}){this.events.push({type,bus_id:bus.id,lane_id:bus.laneId,time_s:this.time,...extra});if(this.events.length>this.maxEvents)this.events.shift();}
  step(dt=.1){
    if(!Number.isFinite(dt)||dt<=0||dt>.100001)throw new Error('Step must be at most 0.1 simulated seconds');
    this.time+=dt;this.tickCount++;const turning=[];const spacing=this.vehicle.length_m+this.gap;
    for(const lane of this.lanes.values()){
      lane.buses.sort((a,b)=>b.s-a.s||a.id.localeCompare(b.id));let leader=null;
      for(const bus of lane.buses){
        const stop=lane.stops[bus.nextStop];
        if(bus.remaining>0){bus.remaining=Math.max(0,bus.remaining-dt);bus.speed=0;
          if(bus.remaining===0&&bus.state==='dwell'){bus.nextStop++;bus.state='moving';this.event('depart_stop',bus);}
          else if(bus.remaining===0&&bus.state==='terminal')turning.push(bus);
        }else if(bus.state==='terminal'){bus.speed=0;turning.push(bus);
        }else{
          const target=stop?stop.at_m:lane.path.length;
          const available=Math.max(0,(leader?leader.s-spacing:Infinity)-bus.s);
          const remaining=Math.max(0,target-bus.s);
          const braking=2.4, acceleration=1.25;
          const desired=Math.min(lane.max_speed_mps,Math.sqrt(2*braking*remaining),Math.sqrt(2*braking*available));
          bus.speed=desired>bus.speed?Math.min(desired,bus.speed+acceleration*dt):Math.max(desired,bus.speed-braking*dt);
          const delta=Math.max(0,Math.min(bus.speed*dt,available,remaining));bus.s+=delta;bus.distance+=delta;
          if(delta<bus.speed*dt-1e-8)bus.speed=delta/dt;
          bus.state=available<1&&remaining>1?'queue':'moving';
          if(target-bus.s<.002){
            bus.s=target;bus.speed=0;
            if(stop){bus.state='dwell';bus.remaining=lane.dwell_s;bus.stopsServed++;this.completedStops++;this.event('arrive_stop',bus,{station_id:stop.station_id,s:bus.s});}
            else{bus.state='terminal';bus.remaining=lane.terminal_s;bus.legs++;this.completedLegs++;this.event('arrive_terminal',bus);}
          }
        }
        leader=bus;
      }
    }
    // Transfers happen after all lane updates so no vehicle moves twice in a tick.
    for(const bus of turning){
      const from=this.lanes.get(bus.laneId),to=this.lanes.get(from.reverse_id);
      if(to.buses.some(b=>b.s<spacing+.01))continue;
      from.buses.splice(from.buses.indexOf(bus),1);to.buses.push(bus);bus.laneId=to.id;bus.s=0;bus.speed=0;
      bus.nextStop=0;bus.state='moving';bus.remaining=0;this.event('reverse_trial',bus);
    }
  }
  stats(){const counts={moving:0,dwell:0,queue:0,terminal:0};let distance=0;for(const b of this.buses){counts[b.state]++;distance+=b.distance;}return {scenario:this.scenario,time_s:this.time,fleet:this.buses.length,...counts,stops:this.completedStops,legs:this.completedLegs,distance_km:distance/1000};}
  inspect(id){const bus=this.byId.get(id);if(!bus)return null;const lane=this.lanes.get(bus.laneId);return {...bus,pattern:lane.label,color:lane.color,next_stop:lane.stops[bus.nextStop]?.name??'Regulación en extremo de ensayo',xy:lane.path.sample(bus.s).xy,speed_kmh:bus.speed*3.6};}
}

/** Render cadence never sets simulation step size. Work budget retains backlog. */
export class FixedClock {
  constructor(simulation){this.sim=simulation;this.speed=1;this.paused=false;this.pending=0;this.stepSeconds=.1;}
  advance(realSeconds,budget=250){
    if(!Number.isFinite(realSeconds)||realSeconds<0||!Number.isInteger(budget)||budget<1)throw new Error('Invalid clock input');
    if(this.paused)return 0;
    this.pending+=realSeconds*this.speed;let count=0;
    while(this.pending+1e-9>=this.stepSeconds&&count<budget){this.sim.step(this.stepSeconds);this.pending-=this.stepSeconds;count++;}
    if(Math.abs(this.pending)<1e-9)this.pending=0;
    return count;
  }
}
