import {travelProfile,travelTimeAtDistance,travelAt} from './travel.mjs?v=20260913.3';

// Existence is sourced from OSM. These phases are explicitly scenario estimates.
export const SIGNAL_CYCLE=Object.freeze({cycle:90,green:52,amber:3});
// Lo que un semáforo cuesta en promedio, deducido del mismo ciclo que usa signalPhase: se detiene
// quien llega fuera del verde, y la espera media es la integral de (ciclo−fase) sobre el ciclo.
// Sirve para descontar del tiempo publicado lo que ya lleva dentro de semáforos, sin simularlos dos veces.
export const SIGNAL_EXPECTED=Object.freeze({
 stopChance:(SIGNAL_CYCLE.cycle-SIGNAL_CYCLE.green)/SIGNAL_CYCLE.cycle,
 wait:(SIGNAL_CYCLE.cycle-SIGNAL_CYCLE.green)**2/(2*SIGNAL_CYCLE.cycle),
});
function phaseOffset(id){let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0)%SIGNAL_CYCLE.cycle;}
export function signalPhase(id,time){
 const {cycle,green,amber}=SIGNAL_CYCLE,p=((time+phaseOffset(id))%cycle+cycle)%cycle;
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
// Las detenciones de tráfico se resuelven junto con los semáforos y no después. Si el bus se queda
// quieto antes de un semáforo, llega a él más tarde y le toca otra fase: calcularlas por separado
// daría un rojo que no le corresponde. Por eso `congestion` —posiciones y segundos, que salen del
// campo medido— entra aquí y se intercala en orden, sumando su demora al reloj con el que se
// consulta cada fase.
export function signalTravel(path,from,to,limit,a,b,departure,signals,cache=new Map(),key='',congestion=[],limitAt=null){
 const checkpoints=signals.filter(s=>s.at_m>from+.1&&s.at_m<to-.1),forced=new Set();
 const planned=congestion.filter(c=>c.seconds>1e-7).sort((x,y)=>x.at_m-y.at_m);
 for(let pass=0;pass<=checkpoints.length;pass++){
  const mask=[...forced].sort((a,b)=>a-b).join(','),profileKey=key+'/'+mask;
  let profile=cache.get(profileKey);if(!profile){profile=travelProfile(path,from,to,limit,a,b,{checkpoints:checkpoints.map(s=>s.at_m-from),stops:[...forced].map(i=>checkpoints[i].at_m-from),limitAt});cache.set(profileKey,profile);}
  const holds=[];let delay=0,retry=false,pending=0;
  const soltar=hasta=>{while(pending<planned.length&&planned[pending].at_m<=hasta){const c=planned[pending++];
   const start=departure+travelTimeAtDistance(profile,Math.max(0,Math.min(to-from,c.at_m-from)))+delay;
   holds.push({at_m:c.at_m,start,end:start+c.seconds,congestion:true});delay+=c.seconds;}};
  for(const [i,signal] of checkpoints.entries()){
   soltar(signal.at_m);
   const arrival=departure+travelTimeAtDistance(profile,signal.at_m-from)+delay,phase=signalPhase(signal.id,arrival);
   if(phase.wait>1e-7&&!forced.has(i)){forced.add(i);retry=true;break;}
   if(phase.wait>1e-7){holds.push({signalId:signal.id,at_m:signal.at_m,start:arrival,end:arrival+phase.wait});delay+=phase.wait;}
  }
  if(!retry){soltar(Infinity);return {profile,holds,duration:profile.duration+delay};}
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
