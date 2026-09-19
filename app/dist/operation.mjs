import {DAY,addDays,serviceWindows,demandPeriod,dayType,gtfsServices,programmedDepartures} from './calendar.mjs?v=20260912.1';
import {vehicleSpec} from './vehicles.mjs?v=20260912.1';
import {matchSignals,signalTravel,signalTravelAt,SIGNAL_EXPECTED} from './signals.mjs?v=20260912.1';
import {travelTimeAtDistance} from './travel.mjs?v=20260912.1';
import {generatedPassengers,alightFraction,DEMAND_BASELINE} from './passengers.mjs?v=20260912.1';
import {placeVisit} from './station-layouts.mjs?v=20260912.1';
import {MetricPath} from './simulation.mjs?v=20260912.1';
export const DEFAULTS=Object.freeze({peakHeadway:240,offpeakHeadway:480,demand:1,mode:'auto',cruiseKmh:60,streetKmh:50,acceleration:.8,braking:1.1,turnaround:240,variableDispatch:true,reinforcements:true,signals:true,beyondValidity:true,programmedDispatch:true,programmedRunning:true,observedRunning:true});
export function parameters(input={}){const p={...DEFAULTS,...input};for(const [k,min,max] of [['peakHeadway',120,1200],['offpeakHeadway',180,1800],['demand',.25,3],['cruiseKmh',25,75],['streetKmh',20,60],['acceleration',.4,1.4],['braking',.5,1.8],['turnaround',60,900]])if(!Number.isFinite(p[k])||p[k]<min||p[k]>max)throw new Error('Parámetro fuera de rango: '+k);if(typeof p.variableDispatch!=='boolean'||typeof p.reinforcements!=='boolean'||typeof p.signals!=='boolean'||typeof p.beyondValidity!=='boolean'||typeof p.programmedDispatch!=='boolean'||typeof p.programmedRunning!=='boolean'||typeof p.observedRunning!=='boolean')throw new Error('Opciones de despacho inválidas');if(!['auto','peak','offpeak'].includes(p.mode))throw new Error('Demanda inválida');return p;}
export function hash(text){let h=2166136261;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
// Cómo se gasta el tiempo que el horario publicado le da a un tramo.
//
// Hasta ahora el sobrante se repartía bajando la velocidad de forma uniforme: el bus recorría los
// 2 km entre Marsella y Distrito Grafiti a 23 km/h clavados. Eso cuadra el reloj y falsea el
// movimiento. Un bus troncal no circula a 23 km/h: circula a 50-60 y pierde el tiempo parado —en
// el rojo, en la cola de entrada a la estación, detrás de otro bus—. La captura del feed lo
// respalda en la forma, aunque sus percentiles instantáneos arrastren ruido de refresco de GPS:
// lo que se ve es «rápido o quieto», no un crucero plano a un cuarto de la velocidad.
//
// Así que el tiempo publicado se gasta en dos partes:
//
//   1. En calzada segregada el bus rueda a su crucero, sin rebajarlo. En calzada mixta —Séptima,
//      Av. 68, los tramos de calle— sí se rebaja de forma continua, porque ahí el bus va dentro
//      del tráfico y no delante de él.
//   2. Lo que quede se gasta en detenciones explícitas en la aproximación a la estación siguiente,
//      después del último semáforo del tramo —para no alterar la fase que ya se resolvió— y en
//      trozos de TRAFFIC.chunk como mucho, que es lo que dura una cola razonable antes de avanzar.
//
// La hora de llegada a cada parada no cambia ni un segundo: sigue siendo la publicada. Lo que
// cambia es que la demora queda donde se puede ver y medir, en vez de disuelta en el velocímetro.
export const TRAFFIC=Object.freeze({chunk:45,spacing:40,margin:15,minimum:4});
export function congestionHolds(profile,from,to,departure,signals,signalDelay,surplus){
 const distance=to-from;
 let last=0;for(const s of signals)if(s.at_m>from+.1&&s.at_m<to-.1)last=Math.max(last,s.at_m-from);
 const count=Math.max(1,Math.min(12,Math.ceil(surplus/TRAFFIC.chunk))),each=surplus/count;
 // Nunca por delante del último semáforo del tramo: si no queda aproximación libre, la cola se
 // forma en el propio semáforo, que es donde se forma de verdad.
 const far=Math.max(last,distance-TRAFFIC.margin),near=Math.max(last,far-(count-1)*TRAFFIC.spacing);
 const step=count>1?(far-near)/(count-1):0;
 const holds=[];let delay=signalDelay;
 for(let i=0;i<count;i++){
  const at=near+step*i,arrival=departure+travelTimeAtDistance(profile,at)+delay;
  holds.push({at_m:from+at,start:arrival,end:arrival+each,congestion:true});delay+=each;
 }
 return holds;
}

// --- Campo medido por trecho de corredor -----------------------------------------------------
//
// `speed_profiles.json` trae, cada 100 m de cada ruta, lo que ese trecho le cuesta a un bus que
// pasa: la velocidad de travesía medida sobre las lecturas de posición, ya descontadas la atención y
// la cola del propio servicio. El campo da la VELOCIDAD y el horario publicado sigue dando el
// TOTAL, así que un único factor por tramo ajusta la primera al segundo y ninguna llegada se mueve.
//
// Un trecho congestionado se representa como bus lento, no como bus plantado. En calzada segregada
// un bus solo se detiene por dos razones que se ven desde la calle: el andén de su estación está
// ocupado y hay cola para entrar, o tiene un semáforo en rojo. Quedarse quieto en mitad del
// corredor no le pasa, y por eso el sobrante que no cabe bajando la velocidad va entero a la
// aproximación a la estación siguiente, que es donde se forma la cola de verdad.
//
// Lo importante de que la velocidad sea del lugar y no del vehículo: dos servicios distintos que
// pasan por el mismo trecho van igual de rápido. Antes cada bus calculaba su sobrante y se detenía
// por su cuenta, así que en el mismo punto uno se paraba y otro le pasaba al lado.
export const FIELD=Object.freeze({minFactor:.35,maxFactor:3,step:.05,giveBack:90});

/** Perfil de una ruta, de [abscisa, km/h×10, % detenido] a arreglos en metros y m/s. */
export function routeField(entry){
 if(!entry?.profile?.length)return null;
 const n=entry.profile.length,at=new Float64Array(n),v=new Float64Array(n),stop=new Float64Array(n);
 for(let i=0;i<n;i++){at[i]=entry.profile[i][0];v[i]=entry.profile[i][1]/10/3.6;stop[i]=entry.profile[i][2]/100;}
 return {at,v,stop,coverage:entry.coverage};
}

/** Techo de velocidad en cada posición de la ruta, con el campo escalado por `factor`. */
export function fieldLimit(field,factor){
 if(!field)return null;
 return at=>{
  const i=upperBound(field.at,at,x=>x)-1;
  return (i<0?field.v[0]:field.v[i])*factor;
 };
}

// Velocidad de crucero que hace durar un tramo lo que dura en el horario publicado.
//
// El tiempo publicado de un tramo lleva dentro la atención en estación y los rojos, porque el feed
// da llegada y salida iguales en todas las paradas. Así que primero se descuenta lo que el motor ya
// modela aparte —la atención recién calculada y el coste esperado de los semáforos del tramo— y el
// resto es el presupuesto de movimiento. Sobre él:
//
//   t(v) = distancia/v + (v/2)(1/a+1/b)(1 + n·p)
//
// el primer término es el crucero y el segundo lo que cuestan el arranque y la frenada, una vez en
// las paradas y otra en cada semáforo en que toque parar. Igualar t(v) al presupuesto deja una
// ecuación de segundo grado; se toma la raíz menor, que es la de ir más despacio, no la de correr
// desperdiciando el tiempo en acelerar. Si el presupuesto no alcanza ni yendo al máximo, se va al
// máximo y el viaje sale más corto que el horario: se prefiere eso a inventar una velocidad
// imposible. El techo sigue siendo el crucero del escenario; esto nunca acelera un bus.
export function programmedSpeed(target,distance,cap,a,b,signals=0){
 if(!(target>0)||!(distance>0))return cap;
 const budget=target-signals*SIGNAL_EXPECTED.wait;
 const k=(1/a+1/b)*(1+signals*SIGNAL_EXPECTED.stopChance);
 const disc=budget*budget-2*distance*k;
 if(!(disc>0))return cap;
 const v=(budget-Math.sqrt(disc))/k;
 return Math.max(3,Math.min(cap,v));
}
export function motion(distance,v,a=.8,b=1.1){const top=Math.min(v,Math.sqrt(2*Math.max(0,distance)/(1/a+1/b))),ta=top/a,tb=top/b,cruise=Math.max(0,(distance-top*top/2/a-top*top/2/b)/Math.max(top,.01));return {distance,top,ta,tb,cruise,duration:ta+cruise+tb,a,b};}
export function motionAt(m,t){t=Math.max(0,Math.min(t,m.duration));if(t<m.ta)return {s:.5*m.a*t*t,speed:m.a*t};if(t<m.ta+m.cruise)return {s:.5*m.top*m.ta+m.top*(t-m.ta),speed:m.top};const remaining=m.duration-t;return {s:m.distance-.5*m.b*remaining*remaining,speed:m.b*remaining};}
class Heap{constructor(){this.a=[];this.n=0;}push(e){e.seq=this.n++;let i=this.a.length;this.a.push(e);while(i){const p=(i-1)>>1;if(this.less(this.a[p],e))break;this.a[i]=this.a[p];i=p;}this.a[i]=e;}less(a,b){return a.time<b.time||(a.time===b.time&&a.seq<b.seq);}pop(){const first=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let j=i*2+1;if(j+1<this.a.length&&this.less(this.a[j+1],this.a[j]))j++;if(this.less(last,this.a[j]))break;this.a[i]=this.a[j];i=j;}this.a[i]=last;}return first;}get length(){return this.a.length;}}
function upperBound(a,value,key){let l=0,h=a.length;while(l<h){const m=(l+h)>>1;if(key(a[m])<=value)l=m+1;else h=m;}return l;}
export class Operation {
 constructor(data,config={}){
  this.data=data;this.params=parameters(config.params);this.date=config.date||data.scenario_date;this.selection=config.selection||{mode:'all'};
  this.vehicle=data.vehicle;this.routes=new Map();this.stations=new Map(data.stations.map(s=>[s.id,s]));this.time=DAY+7*3600;this.buses=[];
  const picked=r=>this.selection.mode==='route'?r.id===this.selection.route:this.selection.mode==='zones'?(this.selection.zones||[]).some(z=>r.served_zones.includes(z)||r.zone===z):true;
  const fields=data.speed_profiles?.routes||{};
  for(const r of data.routes.filter(r=>r.ready&&picked(r)))this.routes.set(r.id,{...r,typeSource:vehicleSpec(r).typeSource,path:new MetricPath(r.points),field:routeField(fields[r.id])});
  this.prepareDirections();for(const r of this.routes.values())r.signals=this.params.signals?matchSignals(r.path,data.busway_signals):[];this.motionCache=new Map();this.build();this.seek(this.time);
 }
 prepareDirections(){
  const allRoutes=this.data.routes.filter(r=>r.ready).map(r=>({...r,path:new MetricPath(r.points)}));const axes=new Map();for(const r of allRoutes)for(const s of r.stops){const angle=r.path.sample(Math.min(r.path.length-.1,Math.max(.1,s.at_m))).angle;const accum=axes.get(s.station_id)||[0,0];accum[0]+=Math.cos(2*angle);accum[1]+=Math.sin(2*angle);axes.set(s.station_id,accum);}
  this.demandShares=new Map();for(const r of allRoutes)for(const s of r.stops.slice(0,-1)){const sum=axes.get(s.station_id),axis=Math.atan2(sum[1],sum[0])/2,angle=r.path.sample(s.at_m).angle,direction=Math.cos(angle-axis)>=0?0:1,key=s.station_id+'/'+direction,entry=this.demandShares.get(key)||{all:0,selected:0,angle:axis+(direction?Math.PI:0)};entry.all++;if(this.routes.has(r.id))entry.selected++;this.demandShares.set(key,entry);}
  // El punto de atención publicado, donde el tablero de la estación lo dice; si no, el reparto
  // determinista de siempre, que sigue rotulado como estimación.
  const published=new Map((this.data.station_wagons?.assignments||[]).map(a=>[a.route_id+'/'+a.station_id,a]));
  for(const r of this.routes.values())r.visits=r.stops.map(s=>{const angle=r.path.sample(Math.min(r.path.length-.1,Math.max(.1,s.at_m))).angle,axis=axes.get(s.station_id),direction=Math.cos(angle-Math.atan2(axis[1],axis[0])/2)>=0?0:1;
   const official=s.kind==='street'?null:published.get(r.id+'/'+s.station_id);
   const wagon=s.kind==='street'?1:official?official.wagon:1+hash(r.family)%s.wagons;
   return {...s,direction,wagon,wagonLabel:official?official.label:null,wagonDoors:official?official.doors:null,wagonSource:s.kind==='street'?'not_applicable':official?'published':'estimated'};});
  const layouts=new Map((this.data.station_layouts?.stations||[]).map(s=>[s.station_id,s]));
  for(const r of this.routes.values())for(let i=0;i<r.visits.length;i++){const s=r.visits[i];if(s.kind==='street')continue;const layout=layouts.get(s.station_id),placed=placeVisit(r,i,layout,hash(r.family));if(placed){Object.assign(s,placed);continue;}if(layout||i===0||i===r.visits.length-1)continue;const shift=(s.wagon-(s.wagons+1)/2)*64*(s.direction===0?1:-1),bound=Math.min((r.stops[i].at_m-r.stops[i-1].at_m)/4,(r.stops[i+1].at_m-r.stops[i].at_m)/4);s.at_m+=Math.max(-bound,Math.min(bound,shift));}
 }
 build(){
  const queue=new Heap(),berths=new Map(),parked=new Map(),waiting=new Map();this.passengerEvents=new Map();this.trips=[];this.vehicles=[];this.depotEvents=[];this.routeWindows={};this.programmedRoutes=new Set();this.programmedIdle=new Set();this.programmedMoves=0;this.programmedCapped=0;this.trafficHolds=0;this.trafficSeconds=0;this.observedSegments=0;
  for(let day=-1;day<=0;day++){
   const date=addDays(this.date,day),offset=(day+1)*DAY;
   const active=this.params.programmedDispatch?gtfsServices(this.data.schedule,date):null;
   for(const r of this.routes.values()){
    const windows=serviceWindows(r,date,this.data.routes,{beyondValidity:this.params.beyondValidity});if(day===0)this.routeWindows[r.id]=windows;
    // El horario publicado sustituye la regla de cuatro y ocho minutos donde existe. La vigencia
    // local sigue decidiendo si el servicio opera ese día, para que el interruptor de la interfaz
    // conserve su sentido; lo que deja de inventarse es a qué hora sale cada bus.
    const programmed=active&&windows.length?programmedDepartures(this.data.schedule,r.id,active):null;
    if(programmed){
     // Horario publicado sin ninguna salida ese día, pero el calendario local sí lo hace operar:
     // los dos catálogos se contradicen. Gana el publicado, y la discrepancia se cuenta en vez de
     // dejar que el servicio desaparezca del mapa sin decir por qué.
     if(day===0){this.programmedRoutes.add(r.id);if(!programmed.length)this.programmedIdle.add(r.id);}
     // Sin variación ni refuerzos: las salidas ya son las publicadas, incluidas las adicionales.
     for(const t of programmed)queue.push({type:'dispatch',time:offset+t,rid:r.id,date,departure:t,programmed:true});
     continue;
    }
    for(let wi=0;wi<windows.length;wi++){
     const [start,end]=windows[wi];let t=start+hash(r.id)%23;
     let sequence=0;while(t<end){
      const period=demandPeriod(t,date,this.params.mode),nominal=period==='peak'?this.params.peakHeadway:this.params.offpeakHeadway;
      const seed=hash(r.id+'/'+date+'/'+sequence++),jitter=this.params.variableDispatch?(seed%25-12)/100:0;
      queue.push({type:'dispatch',time:offset+t,rid:r.id,date,departure:t});
      // At most one interleaved reinforcement on a minority of peak departures.
      const hour=Math.floor((t%DAY)/3600),pressure=Math.max(...r.visits.slice(0,-1).map(s=>{const station=this.stations.get(s.station_id),share=this.demandShares.get(s.station_id+'/'+s.direction);return (station.demand_profile?.hourly[hour]||0)*.5*DEMAND_BASELINE*this.params.demand/Math.max(1,share?.all||1)/3600*nominal;}));
      if(this.params.reinforcements&&period==='peak'&&nominal>=210&&seed%7===0&&pressure>vehicleSpec(r).capacity*.9&&t+120<end)queue.push({type:'dispatch',time:offset+t+120,rid:r.id,date,departure:t+120,reinforcement:true});
      t+=nominal*(1+jitter);
     }
    }
   }
  }
  let peak=0,active=0;
  while(queue.length){
   const e=queue.pop();
   if(e.type==='complete'){active--;continue;}
   if(e.type==='release'){
    const parkingKey=e.station+'/'+this.vehicles[e.vehicle].spec.kind;const list=parked.get(parkingKey)||[];list.push(e.vehicle);parked.set(parkingKey,list);this.depotEvents.push({time:e.time,station:e.station,delta:1});continue;
   }
   if(e.type==='dispatch'){
    const r=this.routes.get(e.rid),origin=r.stops[0].station_id,spec=vehicleSpec(r,this.params,hash(r.id+'/'+e.date+'/'+e.departure)),parkingKey=origin+'/'+spec.kind,list=parked.get(parkingKey)||[];
    let vehicle=list.pop();
    if(vehicle===undefined){vehicle=this.vehicles.length;this.vehicles.push({id:`TM-${String(vehicle+1).padStart(4,'0')}`,home:origin,spec,created:e.time,journeys:[]});}
    else this.depotEvents.push({time:e.time,station:origin,delta:-1});
    parked.set(parkingKey,list);
    const trip={id:`${e.date}/${r.id}/${Math.round(e.departure)}`,routeId:r.id,vehicle,start:e.time,end:Infinity,stops:[],moves:[],passengers:0,reinforcement:!!e.reinforcement,capacity:this.vehicles[vehicle].spec.capacity};
    const index=this.trips.length;this.trips.push(trip);this.vehicles[vehicle].journeys.push(index);active++;peak=Math.max(peak,active);
    queue.push({type:'stop',time:e.time,trip:index,index:0,date:e.date});continue;
   }
   const trip=this.trips[e.trip],r=this.routes.get(trip.routeId),s=r.visits[e.index],isLast=e.index===r.visits.length-1;
   const actualDate=addDays(this.date,Math.floor(e.time/DAY)-1),period=demandPeriod(e.time,actualDate,this.params.mode),station=this.stations.get(s.station_id),angle=r.path.sample(s.at_m).angle;
   const passengerKey=s.station_id+'/'+s.direction,share=this.demandShares.get(passengerKey)||{all:1,selected:1,angle},group=waiting.get(passengerKey)||{time:Math.max(0,Math.floor(e.time/DAY)*DAY+4*3600),count:0};
   const alight=isLast?trip.passengers:Math.min(trip.passengers,Math.floor(trip.passengers*alightFraction(station,e.time)));
   let board=0,offered=0,abandoned=0;
   if(!isLast){
    // Explicit aggregate impatience model: no hidden maximum queue or vanished buses.
    const retained=group.count*Math.exp(-Math.max(0,e.time-group.time)/1800);abandoned=group.count-retained;
    const generated=generatedPassengers(station,share.angle,group.time,e.time,addDays(this.date,-1),this.params)*share.selected/share.all;
    group.count=retained+generated;group.time=e.time;offered=Math.floor(group.count);board=Math.min(trip.capacity-(trip.passengers-alight),offered);
    group.count-=board;waiting.set(passengerKey,group);
    const passengerEvents=this.passengerEvents.get(passengerKey)||[];passengerEvents.push({time:e.time,count:group.count,angle:share.angle,station:s.station_id,share:share.selected/share.all,board,alight,abandoned});this.passengerEvents.set(passengerKey,passengerEvents);
   }
   trip.passengers+=board-alight;
   const dwell=(s.kind==='street'?9:13)+Math.max(board/2.5,alight/3)+(period==='peak'?4:0);
   const key=`${s.station_id}/${s.direction}/${s.platform_id||s.wagon}`,slots=berths.get(key)||Array(s.kind==='street'?1:2).fill(0);
   let slot=slots[0]<=slots.at(-1)?0:1;const arrival=e.time,open=Math.max(arrival,slots[slot]),close=open+dwell;slots[slot]=close+3;berths.set(key,slots);
   trip.stops.push({arrival,open,close,at_m:s.at_m,wagon:s.wagon,wagonLabel:s.wagonLabel,wagonDoors:s.wagonDoors,wagonSource:s.wagonSource,slot,direction:s.direction,board,alight,load:trip.passengers,left:offered-board});
   if(isLast){trip.end=close;queue.push({type:'complete',time:close});queue.push({type:'release',time:close+this.params.turnaround,station:s.station_id,vehicle:trip.vehicle});continue;}
   const next=r.visits[e.index+1],distance=next.at_m-s.at_m,isStreet=s.kind==='street'||next.kind==='street';
   const speedOffset=this.vehicles[trip.vehicle].spec.speedOffset;const cap=((isStreet?this.params.streetKmh:this.params.cruiseKmh)+speedOffset)/3.6;
   // Stop-to-stop acceleration/braking is metric; street congestion is a slower estimated cruise profile.
   // El tiempo del tramo sale de lo medido en la calle cuando hay bastantes observaciones, y del
   // horario publicado cuando no. Los dos traen la misma forma —base, punta, laborable, sábado,
   // festivo— y los dos llevan la atención dentro, así que el resto del cálculo no se entera.
   const horario=this.params.programmedRunning?this.data.schedule?.routes?.[r.id]:null;
   const medido=this.params.observedRunning?horario?.observed?.[e.index]:null;
   const published=medido||horario?.segments?.[e.index]||null;
   if(medido&&e.time>=DAY)this.observedSegments++;
   let v=cap*(isStreet&&period==='peak'?.82:1),budget=0;
   if(published){
    // El tiempo publicado ya incluye la congestión de la punta: aplicarle además el factor de calle
    // sería contarla dos veces.
    // [base, punta, laborable, sábado, festivo]. La punta solo existe dentro del laborable.
    const kind=dayType(actualDate),column=kind==='weekday'?(period==='peak'?1:2):kind==='saturday'?3:4;
    // Se descuenta la atención realmente aplicada, que es la que el tiempo publicado lleva dentro.
    // Redondeada a diez segundos: sin redondear, cada viaje pediría su propio perfil por diferencias
    // de décimas en el embarque y la caché se cuadruplicaría. El error de un tramo queda por debajo
    // de cinco segundos y no se acumula, porque unos redondean hacia arriba y otros hacia abajo.
    budget=Math.round(((published[column]||published[0])-(close-arrival))/10)*10;
    const crossings=r.signals.reduce((n,sg)=>n+(sg.at_m>s.at_m+.1&&sg.at_m<next.at_m-.1?1:0),0);
    // Redondear antes de usarla: el presupuesto lleva dentro la atención, que cambia en cada viaje
    // con la demanda, y sin redondeo cada bus pediría su propio perfil y la caché no serviría de nada.
    // En calzada mixta el bus sí rueda más despacio de forma continua —va en el tráfico—, y ahí el
    // crucero se ajusta al tiempo publicado como hasta ahora. En calzada segregada no: rueda a lo
    // suyo y pierde el tiempo detenido. Ese sobrante se gasta abajo, en detenciones visibles.
    if(isStreet)v=Math.round(programmedSpeed(budget,distance,cap,this.params.acceleration,this.params.braking,crossings)*10)/10;
    if(e.time>=DAY){if(v<cap-1e-9)this.programmedMoves++;else this.programmedCapped++;}
   }
   const field=isStreet?null:r.field;
   let holds,duration,standing=0,moveProfile=null;
   if(field){
    // El campo medido manda la velocidad y el horario publicado el tiempo del tramo. Entre los dos
    // hay un solo número por tramo: el factor que estira o encoge la velocidad hasta que el tramo
    // dura lo publicado. La variación de ±5 km/h por bus se pliega dentro de él en vez de ir en el
    // techo, así el perfil depende de un único valor y la caché no guarda cinco copias casi iguales;
    // y el factor se cuantiza en pasos de 0,05 por lo mismo.
    //
    // Lo que el redondeo deja corto NO se convierte en espera. En calzada segregada un bus no se
    // planta en mitad del corredor: si va sobrado llega antes, y lo que se adelanta se lo devuelve
    // al tramo siguiente rodando más despacio. Por eso el adelanto viaja con el viaje —`ahead`— y
    // entra en el presupuesto del tramo que viene. Detenerse queda para lo que de verdad detiene a
    // un bus: el rojo, que resuelve el modelo de semáforos, y el andén ocupado, que sale de la cola
    // por vagón.
    // Al escalón de arriba y no al más cercano: el tramo sale corto antes que largo, y lo que se
    // adelanta se devuelve solo en el siguiente. Redondear al más cercano dejaba la mitad de los
    // tramos largos y el viaje acumulaba retraso que ya no había forma de recuperar.
    const paso=f=>Math.min(FIELD.maxFactor,Math.max(FIELD.minFactor,Math.ceil(f/FIELD.step)*FIELD.step));
    const viaje=f=>signalTravel(r.path,s.at_m,next.at_m,cap,this.params.acceleration,this.params.braking,
      close,r.signals,this.motionCache,r.id+'/'+e.index+'/'+f.toFixed(2),fieldLimit(field,f));
    const m1=viaje(1),demora1=m1.holds.reduce((a,h)=>a+(h.end-h.start),0);
    // El adelanto acumulado se devuelve aquí, repartido: alarga el presupuesto de este tramo hasta
    // FIELD.giveBack segundos, que es lo que un bus puede aflojar sin parecer que se arrastra.
    const devuelve=Math.max(0,Math.min(FIELD.giveBack,trip.ahead||0));
    const objetivo=budget>0?Math.max(1,budget+devuelve-demora1):0;
    let factor=paso((budget>0?m1.profile.duration/objetivo:1)*(1+speedOffset/60));
    let m=Math.abs(factor-1)<1e-9?m1:viaje(factor);
    // Arrancar y frenar no escalan con la velocidad, y el rojo que toca cambia al cambiarla, así que
    // rodar al factor no cuesta exactamente lo previsto. Dos correcciones con el tiempo ya medido
    // bastan casi siempre, y cada escalón repetido sale de la caché.
    for(let intento=0;budget>0&&intento<2;intento++){
     const demoraActual=m.holds.reduce((a,h)=>a+(h.end-h.start),0);
     const margen=Math.max(1,budget+devuelve-demoraActual);
     const corregido=paso(factor*m.profile.duration/margen);
     if(Math.abs(corregido-factor)<1e-9)break;
     factor=corregido;m=viaje(factor);
    }
    holds=m.holds;duration=m.duration;moveProfile=m.profile;
    if(budget>0){
     trip.ahead=(trip.ahead||0)-devuelve+(budget-duration);
     if(e.time>=DAY&&duration<budget-.5){this.trafficHolds++;this.trafficSeconds+=budget-duration;}
    }
   }else{
    const profileKey=r.id+'/'+e.index+'/'+period+'/'+speedOffset+'/'+v;
    const m=signalTravel(r.path,s.at_m,next.at_m,v,this.params.acceleration,this.params.braking,close,r.signals,this.motionCache,profileKey);
    // Sin campo —calle, dual o corredor sin cobertura— sigue el reparto anterior: lo que el horario
    // da de más se gasta detenido en la aproximación a la estación siguiente.
    holds=m.holds;duration=m.duration;moveProfile=m.profile;
    const surplus=budget>0?budget-duration:0;
    if(surplus>=TRAFFIC.minimum){
     const signalDelay=m.holds.reduce((sum,h)=>sum+(h.end-h.start),0);
     holds=[...m.holds,...congestionHolds(m.profile,s.at_m,next.at_m,close,r.signals,signalDelay,surplus)];
     duration=budget;
     if(e.time>=DAY){this.trafficHolds++;this.trafficSeconds+=surplus;}
    }
   }
   trip.moves.push({profile:moveProfile,holds,start:close,end:close+duration,from:s.at_m});
   queue.push({type:'stop',time:close+duration,trip:e.trip,index:e.index+1,date:e.date});
  }
  for(const [key,events] of this.passengerEvents){const n=upperBound(events,DAY,e=>e.time);if(n>1)this.passengerEvents.set(key,events.slice(n-1));}
  this.peakActive=peak;
  // Retain only yesterday's journeys which can still be visible today.
  this.trips=this.trips.filter(t=>t.end>=DAY);
  this.vehicles.forEach(v=>delete v.journeys);
  this.trips.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
  this.maxDuration=this.trips.reduce((m,t)=>Math.max(m,t.end-t.start),1);
  // Sorted interval indexes make sampling independent of the number of earlier departures.
  this.ends=[...this.trips].sort((a,b)=>a.end-b.end);this.stopEvents=[];
  for(const t of this.trips)for(const [i,s] of t.stops.entries())this.stopEvents.push({time:s.close,station:this.routes.get(t.routeId).stops[i].station_id,board:s.board,alight:s.alight,left:s.left,wait:s.open-s.arrival});
  this.stopEvents.sort((a,b)=>a.time-b.time);this.boardPrefix=[0];this.waitPrefix=[0];this.leftPrefix=[0];
  for(const s of this.stopEvents){this.boardPrefix.push(this.boardPrefix.at(-1)+s.board);this.waitPrefix.push(this.waitPrefix.at(-1)+s.wait);this.leftPrefix.push(this.leftPrefix.at(-1)+s.left);}
  this.depotEvents.sort((a,b)=>a.time-b.time);
 }
 sampleTrip(t,time){
  const r=this.routes.get(t.routeId),index=Math.min(t.stops.length-1,upperBound(t.stops,time,s=>s.arrival)-1);
  if(index<0)return null;
  const stop=t.stops[index];let state,s,speed=0,load=stop.load,nextIndex=index,signalId=null,signalWait=0;
  if(time<stop.open){state='queue';s=stop.at_m;load=index?t.stops[index-1].load:0;}
  else if(time<stop.close){state='dwell';s=stop.at_m;}
  else {const move=t.moves[index];if(!move)return null;const pose=signalTravelAt(move,time);signalId=pose.signalId||null;signalWait=pose.signalWait||0;state=signalId?'signal':pose.congestion?'traffic':'moving';s=move.from+pose.s;speed=pose.speed;nextIndex=index+1;}
  const pose=r.path.sample(s),next=r.visits[nextIndex];
  return {id:t.id,vehicleId:this.vehicles[t.vehicle].id,routeId:r.id,laneId:r.id,code:r.code,pattern:r.name,color:r.color,state,signalId,signalWait,s,speed,speed_kmh:speed*3.6,xy:pose.xy,angle:pose.angle,
    load,capacity:t.capacity,reinforcement:t.reinforcement,busType:this.vehicles[t.vehicle].spec.label,typeSource:r.typeSource,length_m:this.vehicles[t.vehicle].spec.length,next_stop:next?.name||'Fin del servicio',next_station:next?.station_id,stopIndex:index,stopsServed:index+(time>=stop.close?1:0),wagon:next?.wagon||1,wagonLabel:next?.wagonLabel||null,wagonDoors:next?.wagonDoors||null,wagonSource:next?.wagonSource||'estimated',slot:stop.slot,
    delay:Math.max(0,stop.open-stop.arrival),street:['moving','signal'].includes(state)?r.stops[index].kind==='street'||next.kind==='street':r.stops[index].kind==='street',
    tripStart:t.start,tripEnd:t.end,progress:s/r.path.length};
 }
 seek(time){if(!Number.isFinite(time))throw new Error('Hora inválida');this.time=time;const a=upperBound(this.trips,time-this.maxDuration,t=>t.start),b=upperBound(this.trips,time,t=>t.start);this.buses=[];for(let i=a;i<b;i++){const t=this.trips[i];if(t.end>time){const bus=this.sampleTrip(t,time);if(bus)this.buses.push(bus);}}this.byId=new Map(this.buses.map(b=>[b.id,b]));return this.buses;}
 inspect(id){return this.byId.get(id)||null;}
 stats(){const counts={moving:0,dwell:0,queue:0,signal:0,traffic:0};let load=0;for(const b of this.buses){counts[b.state]++;load+=b.load;}const n=upperBound(this.stopEvents,this.time,e=>e.time),start=upperBound(this.stopEvents,DAY,e=>e.time),events=Math.max(0,n-start);return {time_s:this.time,fleet:this.buses.length,...counts,onboard:load,boarded:this.boardPrefix[n]-this.boardPrefix[Math.min(start,n)],stops:events,averageWait:events?(this.waitPrefix[n]-this.waitPrefix[start])/events:0,boardingDenials:this.leftPrefix[n]-this.leftPrefix[Math.min(start,n)],scheduled:this.trips.filter(t=>t.start>=DAY).length,completed:upperBound(this.ends,this.time,t=>t.end)-upperBound(this.ends,DAY,t=>t.end),routes:this.routes.size,peakActive:this.peakActive,programmedRoutes:this.programmedRoutes.size,programmedIdle:this.programmedIdle.size,observedSegments:this.observedSegments,programmedMoves:this.programmedMoves,programmedCapped:this.programmedCapped,trafficHolds:this.trafficHolds,trafficSeconds:Math.round(this.trafficSeconds)};}
 depotStats(){const map=new Map();for(const t of this.trips){const r=this.routes.get(t.routeId),origin=r.stops[0].station_id;if(!map.has(origin))map.set(origin,{id:origin,name:this.stations.get(origin)?.name||r.stops[0].name,departures:0,next:Infinity,reserve:0});const d=map.get(origin);if(t.start>=DAY&&t.start<=this.time)d.departures++;if(t.start>this.time)d.next=Math.min(d.next,t.start);}
 for(const e of this.depotEvents){if(e.time>this.time)break;if(!map.has(e.station))map.set(e.station,{id:e.station,name:this.stations.get(e.station)?.name||e.station,departures:0,next:Infinity,reserve:0});map.get(e.station).reserve+=e.delta;}
 return [...map.values()].sort((a,b)=>b.departures-a.departures);
 }
 waitingAt(stationId){let count=0;for(const [key,events] of this.passengerEvents){if(!key.startsWith(stationId+'/'))continue;const index=upperBound(events,this.time,e=>e.time)-1;if(index<0)continue;const e=events[index];count+=e.count*Math.exp(-Math.max(0,this.time-e.time)/1800)+e.share*generatedPassengers(this.stations.get(stationId),e.angle,e.time,this.time,addDays(this.date,-1),this.params);}return Math.round(count);}
 // Waiting passengers for every station in one pass. waitingAt scans the whole event map
 // per station, so asking it for all of them would be quadratic; the overview needs a ranking,
 // not a per-station query.
 pressure(limit=6){
  const totals=new Map();
  for(const [key,events] of this.passengerEvents){
   const index=upperBound(events,this.time,e=>e.time)-1;if(index<0)continue;
   const e=events[index],stationId=key.slice(0,key.lastIndexOf('/'));const station=this.stations.get(stationId);if(!station)continue;
   const count=e.count*Math.exp(-Math.max(0,this.time-e.time)/1800)+e.share*generatedPassengers(station,e.angle,e.time,this.time,addDays(this.date,-1),this.params);
   totals.set(stationId,(totals.get(stationId)||0)+count);
  }
  return [...totals].map(([id,waiting])=>({id,name:this.stations.get(id).name,kind:this.stations.get(id).kind,waiting:Math.round(waiting)}))
   .filter(s=>s.waiting>0).sort((a,b)=>b.waiting-a.waiting||a.name.localeCompare(b.name,'es')).slice(0,limit);
 }
 // Buses and load per trunk, for the overview. Zone identity comes from the route, never from geometry.
 zoneLoad(){
  const zones=new Map();
  for(const bus of this.buses){
   const route=this.routes.get(bus.routeId);if(!route)continue;
   const id=route.zone||'?';const entry=zones.get(id)||{id,buses:0,onboard:0,capacity:0};
   entry.buses++;entry.onboard+=bus.load;entry.capacity+=bus.capacity;zones.set(id,entry);
  }
  return [...zones.values()].sort((a,b)=>b.buses-a.buses);
 }
 stationStats(id){const buses=this.buses.filter(b=>b.next_station===id&&['dwell','queue'].includes(b.state));const routes=[...this.routes.values()].filter(r=>r.stops.some(s=>s.station_id===id));const upcoming=[];for(const t of this.trips){if(t.end<this.time||t.start>this.time+1800)continue;const r=this.routes.get(t.routeId);r.stops.forEach((s,i)=>{const event=t.stops[i];if(s.station_id===id&&event.close>=this.time&&event.arrival<this.time+1800)upcoming.push({code:r.code,routeId:r.id,name:r.name,arrival:event.arrival,wagon:event.wagon,wagonLabel:event.wagonLabel,wagonDoors:event.wagonDoors,wagonSource:event.wagonSource,wait:event.open-event.arrival});});}return {waiting:this.waitingAt(id),buses,routes:routes.map(r=>({id:r.id,code:r.code,name:r.name,color:r.color})),upcoming:upcoming.sort((a,b)=>a.arrival-b.arrival).slice(0,8)};}
}
