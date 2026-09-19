import {DAY,addDays,dateNumber,serviceWindows,demandPeriod} from './calendar.mjs?v=20260912.1';
import {MetricPath} from './simulation.mjs?v=20260912.1';
import {travelProfile} from './travel.mjs?v=20260912.1';
import {parameters,hash} from './operation.mjs?v=20260912.1';
import {placeVisit} from './station-layouts.mjs?v=20260912.1';

// Alternativas distintas que se ofrecen por cada cantidad de transbordos.
export const ALTERNATIVES=3;
function lowerBound(a,time){let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m]<time)lo=m+1;else hi=m;}return lo;}
class Queue{
 constructor(){this.a=[];}
 push(value){let i=this.a.length;this.a.push(value);while(i){const p=(i-1)>>1;if(this.a[p].time<=value.time)break;this.a[i]=this.a[p];i=p;}this.a[i]=value;}
 pop(){const first=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let j=i*2+1;if(j+1<this.a.length&&this.a[j+1].time<this.a[j].time)j++;if(last.time<=this.a[j].time)break;this.a[i]=this.a[j];i=j;}this.a[i]=last;}return first;}
}
export function routeSlice(path,from,to){return [path.sample(from).xy,...path.points.filter((_,i)=>path.cumulative[i]>from&&path.cumulative[i]<to),path.sample(to).xy];}

/** All usable services, with published calendars and estimated journey times.
 * States retain the incoming route: transfers on different physical platforms
 * can have different walking times, so station-only dominance would be wrong.
 */
export class JourneyPlanner{
 constructor(data,input={}){
  this.data=data;this.params=parameters(input);this.stations=new Map(data.stations.map(s=>[s.id,s]));this.routes=[];this.boardings=new Map();
  const layouts=new Map((data.station_layouts?.stations||[]).map(s=>[s.station_id,s]));
  for(const source of data.routes.filter(r=>r.ready)){
   const path=new MetricPath(source.points),r={...source,path};r.stops=source.stops.map((s,i)=>({...s,...placeVisit(r,i,layouts.get(s.station_id),hash(r.family))}));
   r.profiles={};
   for(const period of ['peak','offpeak']){
    const arrivals=[0],departures=[0];
    for(let i=1;i<r.stops.length;i++){
     const a=r.stops[i-1],b=r.stops[i],street=a.kind==='street'||b.kind==='street';
     const speed=(street?this.params.streetKmh*(period==='peak'?.82:1):this.params.cruiseKmh)/3.6;
     const run=travelProfile(path,a.at_m,b.at_m,speed,this.params.acceleration,this.params.braking).duration;
     arrivals.push(departures[i-1]+run);departures.push(arrivals[i]+(b.kind==='street'?15:30));
    }
    r.profiles[period]={arrivals,departures};
   }
   this.routes.push(r);r.stops.slice(0,-1).forEach((s,index)=>{const values=this.boardings.get(s.station_id)||[];values.push({r,index});this.boardings.set(s.station_id,values);});
  }
 }
 plan({origin,destination,date,time=7*3600,maxTransfers=3}){
  dateNumber(date);if(!this.stations.has(origin)||!this.stations.has(destination))throw Error('Selecciona estaciones válidas.');
  if(!Number.isFinite(time)||time<0||time>=DAY)throw Error('Selecciona una hora válida.');
  if(!Number.isInteger(maxTransfers)||maxTransfers<0||maxTransfers>4)throw Error('Máximo de transbordos inválido.');
  if(origin===destination)return {status:'same',origin,destination,date,time,journeys:[]};
  const deadline=time+6*3600,schedules=new Map();
  for(const r of this.routes){
   const schedule={peak:[],offpeak:[]};
   for(const day of [-1,0,1]){const label=addDays(date,day);for(const [start,end] of serviceWindows(r,label,this.data.routes,{beyondValidity:this.params.beyondValidity})){
    let departure=start+hash(r.id)%23;
    while(departure<end){const absolute=day*DAY+departure,period=demandPeriod(departure,label,this.params.mode);if(absolute<=deadline)schedule[period].push(absolute);departure+=period==='peak'?this.params.peakHeadway:this.params.offpeakHeadway;}
   }}
   for(const values of Object.values(schedule))values.sort((a,b)=>a-b);schedules.set(r.id,schedule);
  }
  const queue=new Queue(),best=new Map(),goals=[];
  const first={station:origin,time,legs:[],lastRoute:'',key:`0/${origin}/`};best.set(first.key,time);queue.push(first);
  while(queue.a.length){
   const current=queue.pop();if(current.time!==best.get(current.key)||current.time>deadline)continue;
   if(current.station===destination){goals.push(current);continue;}
   if(current.legs.length>maxTransfers)continue;
   for(const {r,index} of this.boardings.get(current.station)||[]){
    if(r.id===current.lastRoute)continue;
    const from=r.stops[index],xy=r.path.sample(from.at_m).xy,last=current.legs.at(-1);
    const walk=last?Math.max(90,60+Math.hypot(xy[0]-last.toXY[0],xy[1]-last.toXY[1])*1.25/1.2):0;
    for(const period of ['peak','offpeak']){
     const profile=r.profiles[period],schedule=schedules.get(r.id)[period],position=lowerBound(schedule,current.time+walk-profile.departures[index]);if(position===schedule.length)continue;
     const departure=schedule[position],board=departure+profile.departures[index];if(board>deadline)continue;
     for(let j=index+1;j<r.stops.length;j++){
      const to=r.stops[j],arrival=departure+profile.arrivals[j];if(arrival>deadline)break;
      const key=`${current.legs.length+1}/${to.station_id}/${r.id}/${j}`;if(arrival>=(best.get(key)??Infinity))continue;
      const leg={routeId:r.id,code:r.code,name:r.name,color:r.color,from:from.station_id,to:to.station_id,fromName:from.name,toName:to.name,fromIndex:index,toIndex:j,depart:board,arrive:arrival,walk,wait:board-current.time-walk,from_m:from.at_m,to_m:to.at_m,toXY:r.path.sample(to.at_m).xy};
      const next={station:to.station_id,time:arrival,lastRoute:r.id,legs:[...current.legs,leg],key};best.set(key,arrival);queue.push(next);
     }
    }
   }
  }
  // Every transfer count that reaches the destination is offered, and up to ALTERNATIVES distinct
  // combinations of services within each: two routes along the same corridor are a real choice for
  // whoever is waiting, not a duplicate. Distinct means a different sequence of services, never the
  // same one leaving later. An option that adds transfers without arriving earlier is kept but
  // flagged, so a slower alternative stays visible instead of disappearing.
  const byTransfers=new Map();
  for(const goal of goals.sort((a,b)=>a.time-b.time)){
   const count=goal.legs.length-1,list=byTransfers.get(count)||[],services=goal.legs.map(l=>l.routeId).join('>');
   if(list.length>=ALTERNATIVES||list.some(other=>other.legs.map(l=>l.routeId).join('>')===services))continue;
   list.push(goal);byTransfers.set(count,list);
  }
  const all=[...byTransfers.values()].flat().sort((a,b)=>a.legs.length-b.legs.length||a.time-b.time);
  const choices=all.map(g=>({goal:g,dominated:all.some(other=>other.legs.length<g.legs.length&&other.time<=g.time)})).sort((a,b)=>a.goal.legs.length-b.goal.legs.length);
  const byId=new Map(this.routes.map(r=>[r.id,r]));
  return {status:choices.length?'found':'none',origin,destination,date,time,horizonHours:6,maxTransfers,journeys:choices.map(({goal:g,dominated})=>({duration:g.time-time,arrive:g.time,transfers:g.legs.length-1,dominated,legs:g.legs.map(l=>({...l,points:routeSlice(byId.get(l.routeId).path,l.from_m,l.to_m)}))}))};
 }
}
