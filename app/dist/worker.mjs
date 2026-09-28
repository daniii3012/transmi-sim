import {Operation} from './operation.mjs?v=20260928.3';
import {JourneyPlanner} from './planner.mjs?v=20260928.3';
import {Guideway,Traffic,SERVICE_START} from './traffic.mjs?v=20260928.3';
import {DAY,addDays} from './calendar.mjs?v=20260928.3';
// El motor de espacio físico corre aquí. La página pide un instante —fecha y segundos desde la
// medianoche anterior más un día, como hasta ahora— y el worker lo traduce a su día de servicio,
// que va de las 03:00 a las 03:00: pasar la medianoche no reinicia nada, y cambiar de fecha solo
// arranca otro día cuando de verdad es otro día de servicio.
//
// Llegar a una hora exige simular desde las 03:00. Eso se hace por tandas cortas, avisando del
// avance y mandando de vez en cuando cómo va el día, para que el mapa lo muestre ponerse al día en
// vez de quedarse en blanco; una petición nueva reemplaza a la anterior sin esperar a que termine.
let generation=0,op=null,guide=null,traffic=null,planner=null,target=null,timer=0,selected=null,lastPreview=0;
const post=(m,transfer)=>self.postMessage(m,transfer||[]);
function serviceOf(date,time){let d=date,t=time-DAY;if(t<SERVICE_START){d=addDays(date,-1);t+=DAY;}return {date:d,t};}
// De la hora del día de servicio a la de la página, que se cuenta desde la fecha que tiene puesta.
const toPage=(t,request)=>t+(traffic.date===request.date?DAY:0);
function packFrame(request){
 const f=traffic.frame(request.service.t);
 const index=selected&&selected.startsWith(traffic.date+'#')?Number(selected.slice(traffic.date.length+1)):-1;
 const detail=index>=0?traffic.detail(index):null;
 if(detail){detail.busId=selected;detail.tripStart=toPage(detail.tripStart,request);detail.scheduled=toPage(detail.scheduled,request);}
 return {msg:{type:'state',generation,requestId:request.requestId,time:request.time,serviceDate:traffic.date,frame:f,stats:traffic.stats(),detail},
  transfer:[f.trip.buffer,f.route.buffer,f.s.buffer,f.lat.buffer,f.len.buffer,f.state.buffer,f.speed.buffer,f.load.buffer,f.cap.buffer,f.offnet.buffer]};
}
function pump(){
 timer=0;if(!target||!op)return;
 const request=target;
 if(!traffic||traffic.date!==request.service.date){traffic=new Traffic(op,guide,request.service.date);post({type:'building',generation,serviceDate:traffic.date});}
 const from=traffic.t,done=traffic.seek(request.service.t,45);
 if(target!==request)return schedule();
 if(!done){
  // Un retraso corto —el reloj que avanzó un poco más que la última tanda— se recupera en silencio:
  // avisar ahí hacía parpadear el aviso de carga y saltar a los buses.
  if(request.service.t-traffic.t<300)return schedule();
  const now=performance.now();
  // Cada medio segundo, cómo va el día: el mapa lo dibuja mientras se pone al día.
  if(now-lastPreview>500){lastPreview=now;const f=traffic.frame(traffic.t);post({type:'progress',generation,serviceDate:traffic.date,at:toPage(traffic.t,request),target:request.time,from:toPage(SERVICE_START,request),frame:f,stats:traffic.stats()},[f.trip.buffer,f.route.buffer,f.s.buffer,f.lat.buffer,f.len.buffer,f.state.buffer,f.speed.buffer,f.load.buffer,f.cap.buffer,f.offnet.buffer]);}
  else post({type:'progress',generation,serviceDate:traffic.date,at:toPage(traffic.t,request),target:request.time,from:toPage(SERVICE_START,request)});
  return schedule();
 }
 const {msg,transfer}=packFrame(request);post(msg,transfer);
 if(target===request)target=null;
}
// Entre tandas se cede el turno con un MessageChannel y no con setTimeout: el navegador frena los
// temporizadores de una pestaña en segundo plano a uno por segundo, y la simulación del día se
// arrastraba si uno cambiaba de pestaña mientras cargaba.
const channel=new MessageChannel();channel.port1.onmessage=()=>pump();
function schedule(){if(!timer){timer=1;channel.port2.postMessage(0);}}
self.onmessage=({data:m})=>{
 try{
  if(m.type==='init'){
   generation=m.generation;traffic=null;planner=null;target=null;
   const start=performance.now();op=new Operation(m.data,{...m.config,plan:true});guide=new Guideway([...op.routes.values()],{lanes:m.data.busway_lanes,geometry:m.data.busway_geometry});
   // Los desfases semafóricos coordinados se calculan una vez y viajan a la página, que dibuja las
   // luces con los mismos.
   const probe=new Traffic(op,guide,m.date);
   post({type:'ready',generation,buildMs:performance.now()-start,routeIds:[...op.routes.keys()],guide:guide.summary,signalOffsets:Object.fromEntries(op.signalOffsets.map),
    // La calzada sobre la que ruedan los buses, para dibujarla con sus carriles.
    guideway:guide.links.map(l=>({points:l.points,lanes:l.lanes,station:l.station,street:l.street,bridge:l.bridge||null}))});
   traffic=probe;
   if(m.time!=null){target={date:m.date,time:m.time,requestId:0,service:serviceOf(m.date,m.time)};schedule();}
   return;
  }
  if(m.generation!==generation||!op)return;
  if(m.type==='select'){selected=m.id;return;}
  if(m.type==='plan'){planner ||= new JourneyPlanner(op.data,op.params);post({type:'plan',generation,requestId:m.requestId,result:planner.plan(m.query)});return;}
  if(m.type==='sample'){if('selected' in m)selected=m.selected;target={date:m.date,time:m.time,requestId:m.requestId,service:serviceOf(m.date,m.time)};schedule();return;}
  if(!traffic)return;
  const request={date:m.date||traffic.date,time:0};
  if(m.type==='station'){const s=traffic.stationStats(m.id);for(const u of s.upcoming)u.arrival=toPage(u.arrival,request);post({type:'station',generation,id:m.id,...s});}
  else if(m.type==='depots'){const d=traffic.depotStats();for(const x of d)if(Number.isFinite(x.next))x.next=toPage(x.next,request);post({type:'depots',generation,depots:d});}
  else if(m.type==='overview')post({type:'overview',generation,pressure:traffic.pressure(6),zones:traffic.zoneLoad()});
 }catch(error){console.error(error);post({type:m.type==='plan'?'plan-error':'error',generation,requestId:m.requestId,message:error.message});}
};
