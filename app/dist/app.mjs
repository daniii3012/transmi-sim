import {mountShell} from './shell.mjs?v=20260913.2';
import {NetworkMap} from './map.mjs?v=20260913.2';
import {DAY,addDays,dayType,dateNumber,dateEligible,validityState,serviceWindows,demandPeriod} from './calendar.mjs?v=20260913.2';
import {DEFAULTS,parameters} from './operation.mjs?v=20260913.2';
import {registerSimulationTools} from './webmcp.mjs?v=20260913.2';
import {LiveFeed,groupByDestination,occupancyText,ageText,sameName} from './live.mjs?v=20260913.2';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const fmt=n=>Math.round(n).toLocaleString('es-CO');
const timeText=s=>new Date(Math.floor(((s%DAY)+DAY)%DAY)*1000).toISOString().slice(11,19);
const stateNames={moving:'En recorrido',dwell:'Puertas abiertas',queue:'Esperando atención',signal:'Esperando luz verde',traffic:'Detenido en tráfico'};
// La hora de una lectura en vivo, siempre la civil de Bogotá: el equipo puede estar en otro huso.
function readingClock(iso){
 try{return new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(iso));}
 catch{return null;}
}
// Punto de atención: el que publica el tablero de la estación cuando se conoce, con sus puertas;
// si no, el reparto determinista del modelo, que se sigue rotulando como estimación.
function boardingPoint(x){
 if(x?.wagonSource!=='published')return 'Vagón '+(x?.wagon??1)+' · est.';
 const donde=/^T\d/.test(x.wagonLabel)?'Plataforma '+x.wagonLabel:'Vagón '+x.wagonLabel;
 return donde+(x.wagonDoors?.length?' · puertas '+x.wagonDoors.join(' ó '):'')+' · publicado';
}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
const shell=mountShell();
try{
 const [response,contextResponse,demandResponse,layoutsResponse,signalsResponse,lanesResponse,wagonsResponse,scheduleResponse,speedResponse]=await Promise.all([fetch('./services.json',{cache:'no-store'}),fetch('./context.json',{cache:'no-store'}),fetch('./demand.json',{cache:'no-store'}),fetch('./station_layouts.json',{cache:'no-store'}),fetch('./busway_signals.json',{cache:'no-store'}),fetch('./busway_lanes.json',{cache:'no-store'}),fetch('./station_wagons.json',{cache:'no-store'}),fetch('./schedule.json',{cache:'no-store'}),fetch('./speed_profiles.json',{cache:'no-store'})]);
 if(!response.ok)throw new Error('No se pudieron cargar los servicios locales.');
 const data=await response.json();if(scheduleResponse.ok)data.schedule=await scheduleResponse.json();if(speedResponse.ok)data.speed_profiles=await speedResponse.json();if(signalsResponse.ok)data.busway_signals=await signalsResponse.json();if(lanesResponse.ok)data.busway_lanes=await lanesResponse.json();if(layoutsResponse.ok)data.station_layouts=await layoutsResponse.json();if(wagonsResponse.ok)data.station_wagons=await wagonsResponse.json();if(demandResponse.ok){data.demand=await demandResponse.json();const profiles=new Map(data.demand.profiles.map(p=>[p.station_id,p]));for(const s of data.stations){const p=profiles.get(s.id);if(p)s.demand_profile=p;}}const routeById=new Map(data.routes.map(r=>[r.id,r]));
 let saved=null;try{const current=localStorage.getItem('transmi-scenario-v3');saved=JSON.parse(current||localStorage.getItem('transmi-scenario-v2'));if(saved&&!current){const p=saved.config.params;if(p.cruiseKmh===48)p.cruiseKmh=60;if(p.streetKmh===30)p.streetKmh=50;delete p.biarticulatedShare;delete p.biarticulatedCapacity;delete p.biShare;delete p.bioShare;delete p.bioCapacity;delete p.capacity;if(saved.config.selection.route==='10082')saved.config.selection.route='396';}if(saved?.revision!==data.revision)saved=null;}catch{}
 // Hora civil de Bogotá, independiente del huso del equipo.
 function bogotaNow(){
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {date:`${v.year}-${v.month}-${v.day}`,time:DAY+Number(v.hour)*3600+Number(v.minute)*60+Number(v.second)};
 }
 // Arranca en la fecha y hora actuales de Bogotá. Los servicios conservan su último horario
 // publicado aunque la fecha sea posterior a su vigencia, y la interfaz lo rotula.
 const inicio=bogotaNow();
 let config={date:inicio.date,params:{...DEFAULTS},selection:{mode:'all'}};
 let clock={time:inicio.time,speed:1,paused:false};
 if(saved){try{saved.config.params=parameters(saved.config.params);dateNumber(saved.config.date);if(!Number.isFinite(saved.clock.time)||saved.clock.time<DAY||saved.clock.time>=2*DAY||![1,8,32,120].includes(saved.clock.speed))throw Error();if(!['all','route','zones'].includes(saved.config.selection.mode))throw Error();if(saved.config.selection.mode==='route'&&!routeById.get(saved.config.selection.route)?.ready)throw Error();if(saved.config.selection.mode==='zones'&&!saved.config.selection.zones?.length)throw Error();config=saved.config;clock={...clock,...saved.clock,paused:true};}catch{saved=null;}}
 let selection=null,following=false,focusedRoute=null,activePanel='routes',generation=0,ready=false,pendingSample=false,lastUI=0,lastList=0,lastInspect=0,lastSample=0,windows={},snap={buses:[],stats:{}};
 let viewMode=config.selection.mode,scrubbing=false,sampleSequence=0,planSequence=0;
 let selectedZones=new Set(config.selection.zones||[]);const map=new NetworkMap($('#canvas-host'),$('#labels'),data,onSelect);
 if(contextResponse.ok)map.setContext(await contextResponse.json());
 let theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';try{theme=localStorage.getItem('transmi-theme')||theme;}catch{}
 function applyTheme(){document.body.dataset.theme=theme;map.setTheme(theme);$('#theme').textContent=theme==='dark'?'☀':'☾';$('#theme').setAttribute('aria-label',theme==='dark'?'Usar modo claro':'Usar modo oscuro');}applyTheme();
 $('#theme').onclick=()=>{theme=theme==='dark'?'light':'dark';applyTheme();try{localStorage.setItem('transmi-theme',theme);}catch{}};
 let worker=new Worker('./worker.mjs?v=20260913.2',{type:'module'});
 function badge(r){const b=el('span',r.code,'route-code');b.style.setProperty('--route',r.color);const rgb=r.color.match(/[0-9a-f]{2}/gi)?.map(s=>parseInt(s,16));if(rgb?.length===3&&rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>155)b.style.setProperty('--route-ink','#24303f');return b;}
 function row(label,value,parent=$('#selection')){const r=el('div',undefined,'metric-row');r.append(el('span',label),el('strong',value));parent.append(r);return r;}
 function rebuild({fit=false,clear=true}={}){
  planSequence++;$('#plan-journey').disabled=true;$('#journey-results').replaceChildren(el('p','Elige origen, destino y fecha para buscar conexiones.','muted'));generation++;const messageHandler=worker.onmessage,errorHandler=worker.onerror;worker.terminate();worker=new Worker('./worker.mjs?v=20260913.2',{type:'module'});worker.onmessage=messageHandler;worker.onerror=errorHandler;ready=false;pendingSample=false;sampleSequence=0;$('#loading').hidden=false;$('#loading').textContent='Calculando despachos y estaciones…';$('#error').hidden=true;
  if(clear)clearSelection();
  map.routeSet=new Set(data.routes.filter(r=>r.ready&&(config.selection.mode==='all'||config.selection.mode==='route'&&r.id===config.selection.route||config.selection.mode==='zones'&&config.selection.zones.some(z=>r.served_zones.includes(z)||r.zone===z))).map(r=>r.id));map.rebuildHighlight();map.signalsEnabled=config.params.signals;
  worker.postMessage({type:'init',generation,data,config,time:clock.time});syncControls();renderRoutes();
  $('#view-title').textContent=config.selection.mode==='all'?'Toda la red':config.selection.mode==='route'?`${routeById.get(config.selection.route)?.code||''} · ${routeById.get(config.selection.route)?.name||''}`:'Troncales '+config.selection.zones.join(' · ');
  if(fit)fitSelection();
 }
 function fitSelection(){const r=routeById.get(focusedRoute);if(r?.points.length)map.fitPoints(r.points);else if(config.selection.mode==='zones'){const points=data.routes.filter(r=>map.routeSet.has(r.id)).flatMap(r=>r.points);if(points.length)map.fitPoints(points);}else map.fitNetwork();}
 function clearSelection(){following=false;selection=null;focusedRoute=null;$('#inspector').hidden=true;map.selected=null;map.updateMarker();map.setRoute(null);}
 function sample(force=false){if(ready&&(force||!pendingSample)&&(force||snap.time!==clock.time)){pendingSample=true;worker.postMessage({type:'sample',generation,time:clock.time,requestId:++sampleSequence});}}
 worker.onmessage=({data:m})=>{
  if(m.generation!==generation)return;
  if(m.type==='error'){ready=false;$('#loading').hidden=true;$('#error').hidden=false;$('#error').textContent='No se pudo preparar el escenario: '+m.message;return;}
  if(m.type==='ready'){ready=true;$('#plan-journey').disabled=false;windows=m.windows;$('#loading').hidden=true;renderRoutes();if(activePanel==='depots')worker.postMessage({type:'depots',generation});requestOverview();}
  if(m.type==='state'){if(m.requestId!==sampleSequence)return;pendingSample=false;const animate=!clock.paused&&!scrubbing&&m.time>=snap.time&&m.time-snap.time<clock.speed*.5;snap=m;map.acceptSimulation(snap,animate);updateUI();if(selection?.kind==='bus'&&!snap.buses.some(b=>b.id===selection.id))renderBus();}
  if(m.type==='station'&&selection?.kind==='station'&&selection.id===m.id&&activePanel!=='live')renderStation(m);
  if(m.type==='depots')renderDepots(m.depots);
  if(m.type==='overview')renderOverview(m);
  if((m.type==='plan'||m.type==='plan-error')&&m.requestId===planSequence){$('#plan-journey').disabled=false;if(m.type==='plan')renderJourneys(m.result);else $('#journey-results').replaceChildren(el('p',m.message,'muted'));}
 };
 worker.onerror=e=>{$('#loading').hidden=true;$('#error').hidden=false;$('#error').textContent='No pudo iniciarse el motor: '+e.message;ready=false;};
 function jump(value){clock.time=value;if(clock.time<DAY||clock.time>=2*DAY){const day=Math.floor(clock.time/DAY)-1;config.date=addDays(config.date,day);clock.time-=day*DAY;rebuild();}else{sample(true);updateUI();}following=false;}
 function syncControls(displayMode=viewMode){
  $('#date').value=config.date;$$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===displayMode));$('#zone-options').hidden=displayMode!=='zones';$('#network-now').hidden=displayMode!=='all';$('#route-browser').hidden=displayMode==='all';
  $('#peak').value=config.params.peakHeadway/60;$('#offpeak').value=config.params.offpeakHeadway/60;$('#demand').value=config.params.demand;$('#demand-value').textContent=config.params.demand+'×';$('#demand-mode').value=config.params.mode;$('#programmed-dispatch').checked=config.params.programmedDispatch;$('#programmed-running').checked=config.params.programmedRunning;$('#variable-dispatch').checked=config.params.variableDispatch;$('#reinforcements').checked=config.params.reinforcements;$('#signals').checked=config.params.signals;$('#beyond-validity').checked=config.params.beyondValidity;$('#cruise').value=config.params.cruiseKmh;$('#street-speed').value=config.params.streetKmh;
  $$('[data-speed]').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===clock.speed));$('#pause').textContent=clock.paused?'▶':'Ⅱ';$('#pause').setAttribute('aria-label',clock.paused?'Reanudar':'Pausar');
 }
 const validityNote={expired:'horario vencido',future:'horario aún no vigente'};
 function status(r){if(!r.ready)return 'Datos pendientes';const state=validityState(r,config.date);const w=serviceWindows(r,config.date,data.routes,{beyondValidity:config.params.beyondValidity});
  if(!w.length)return state==='current'?'Sin servicio este día':'Fuera de vigencia';
  const note=validityNote[state]?' · '+validityNote[state]:'';
  if(!w.some(([a,b])=>clock.time-DAY>=a&&clock.time-DAY<b))return 'Fuera de horario'+note;
  return (map.routeSet.has(r.id)?'En operación':'Disponible · fuera de selección')+note;}
 function renderRoutes(){
  const search=$('#search').value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const routes=data.routes.filter(r=>`${r.code} ${(r.paired_ids||[]).map(id=>routeById.get(id)?.code||'').join(' ')} ${r.name} ${r.stops.map(s=>s.name).join(' ')}`.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(search)).sort((a,b)=>Number(b.ready)-Number(a.ready)||a.code.localeCompare(b.code,'es',{numeric:true})||a.name.localeCompare(b.name));
  $('#list-count').textContent=routes.length+' servicios y variantes';
  const counts=new Map();for(const b of snap.buses)counts.set(b.routeId,(counts.get(b.routeId)||0)+1);
  const fragment=document.createDocumentFragment();for(const r of routes){const b=el('button',undefined,'route-row'+(focusedRoute===r.id?' selected':''));b.dataset.routeId=r.id;b.setAttribute('aria-label',`${r.code} a ${r.name}, ${status(r)}`);b.append(badge(r));const text=el('div',undefined,'route-text');text.append(el('strong',r.name),el('small',status(r)));b.append(text,el('span',counts.get(r.id)||'','route-count'));b.onclick=()=>selectRoute(r.id);fragment.append(b);}$('#route-list').replaceChildren(fragment);
 }
 function selectRoute(id,{fit=true}={}){const r=routeById.get(id);if(!r)return;focusedRoute=id;following=false;selection={kind:'route',id};map.selected=null;map.updateMarker();map.setRoute(id);renderRoute(r);if(fit&&r.points.length)map.fitPoints(r.points);renderRoutes();}
 function onSelect(value){following=false;selection=value;$('#inspector').hidden=false;map.select(value.kind,value.id,value.label);if(value.kind==='realbus'){renderRealBus();$('#inspector').scrollTop=0;return;}if(value.kind==='station'){if(activePanel==='live')requestLiveStation({force:true});else requestStation();}else{const b=snap.buses.find(b=>b.id===value.id);if(b){selection.routeId=b.routeId;focusedRoute=b.routeId;map.setRoute(b.routeId,{subtle:true});}renderBus();renderRoutes();$('#inspector').scrollTop=0;}}
 function renderRoute(r){
  $('#inspector').scrollTop=0;const panel=$('#selection');panel.replaceChildren(badge(r),el('span','  SERVICIO','eyebrow'),el('h2',r.name));$('#inspector').hidden=false;
  row('Recorrido',r.length_m?(r.length_m/1000).toFixed(2)+' km':'Pendiente');row('Paradas',r.stops.length);row('Estado',status(r));
  const mates=(r.paired_ids||[]).map(id=>routeById.get(id)).filter(Boolean);for(const mate of mates){const btn=el('button','Ver sentido '+mate.code+' → '+mate.name,'full');btn.onclick=()=>selectRoute(mate.id);panel.append(btn);}
  const w=serviceWindows(r,config.date,data.routes,{beyondValidity:config.params.beyondValidity});for(const [a,b] of w)row('Salidas publicadas',timeText(a).slice(0,5)+'–'+timeText(b).slice(0,5)+(b>DAY?' (+1 día)':''));
  if(r.valid_from||r.valid_until)row('Vigencia publicada',(r.valid_from||'?')+' a '+(r.valid_until||'?'));
  const state=validityState(r,config.date);
  if(state!=='current')panel.append(el('p',state==='expired'?`El horario mostrado es el último publicado, vigente hasta el ${r.valid_until}. Se sigue operando para que la fecha elegida funcione; no es un horario confirmado para ${config.date}.`:`El horario mostrado empieza a regir el ${r.valid_from}. Se aplica a esta fecha anterior como aproximación.`,'muted'));
  const enVivo=activePanel==='live';
  if(r.ready&&!enVivo){const b=el('button','Simular solo este servicio','primary full');b.onclick=()=>{config.selection={mode:'route',route:r.id};viewMode='route';rebuild({clear:false});selection={kind:'route',id:r.id};renderRoute(r);};panel.append(b);const f=el('button','Seguir un bus de esta ruta','full');f.onclick=()=>followBus(r.id);panel.append(f);}
  if(r.ready&&enVivo&&livePerService&&[...$('#live-route').options].some(o=>o.value===r.code)){
   // Con el servicio ya en foco, «ver sus buses» es volver a la lista: soltar la ficha basta, y
   // pedir la misma ruta otra vez no hacía nada porque la lectura sale temprano si no cambia el
   // código, así que la única salida era la ✕.
   const enFoco=()=>activePanel==='live'&&liveScope==='route'&&$('#live-route').value===r.code;
   const v=el('button',(enFoco()?'Volver a los buses de ':'Ver los buses de ')+r.code+' en tiempo real','primary full');
   v.onclick=()=>{const volver=enFoco();clearSelection();if(volver)restoreLiveRoute();else{switchPanel('live');setLiveScope('route');$('#live-route').value=r.code;$('#live-route').onchange();}};
   panel.append(v);
  }
  for(const issue of r.issues)panel.append(el('p',issue,'muted'));
  const list=el('ol',undefined,'stop-list');for(const s of r.stops){const li=el('li',undefined,s.kind==='street'?'street':'');const b=el('button',s.name);b.onclick=()=>{const st=data.stations.find(st=>st.id===s.station_id);if(st){onSelect({kind:'station',id:st.id});map.focusStation(st);}};li.append(b,el('small',`${s.kind==='street'?'Paradero en calle':'Estación'}${s.coordinate_source==='route_linear_reference_estimated'?' · ubicación aproximada':''}`));list.append(li);}panel.append(list);
  panel.append(el('p','Horarios publicados; frecuencias, ocupación y asignación a vagones estimadas.','muted'));const source=el('a','Detalle de la fuente ↗');source.href=r.source_url;source.target='_blank';source.rel='noreferrer';panel.append(source);
 }
 function followBus(routeId){const b=snap.buses.find(b=>!routeId||b.routeId===routeId);if(!b){toast('No hay buses de este servicio a esta hora. Prueba otra hora o inclúyelo en la simulación.');return;}selection={kind:'bus',id:b.id,routeId:b.routeId};focusedRoute=b.routeId;map.select('bus',b.id);map.setRoute(b.routeId,{subtle:true});following=true;map.focusOn(b.xy,.9);renderBus();$('#inspector').scrollTop=0;}
 function renderBus(){
  const b=snap.buses.find(b=>b.id===selection?.id);if(!b){const route=selection?.routeId||focusedRoute;if(route)selectRoute(route);else clearSelection();return;}
  const p=$('#selection');p.replaceChildren(badge(b),el('span','  '+b.vehicleId,'eyebrow'),el('h2',b.pattern),el('div',stateNames[b.state]+(b.street?' · calle':''),'bus-state'));$('#inspector').hidden=false;
  row('Velocidad',b.speed_kmh.toFixed(0)+' km/h');row('Tipo de bus',b.busType);$('#selection').append(el('p',b.typeSource,'muted'));row('A bordo',`${b.load} / ${b.capacity}`);const track=el('div',undefined,'load-track'),fill=el('i');fill.style.width=b.load/b.capacity*100+'%';track.append(fill);p.append(track);row(['moving','signal'].includes(b.state)?'Próxima parada':'Parada',b.next_stop);row('Punto de atención',b.street?'Paradero calle':boardingPoint(b));row('Recorrido',(b.s/1000).toFixed(2)+' km');if(b.signalId)row('Luz verde en',Math.ceil(b.signalWait)+' s · est.');row('Atención pendiente',b.delay>0?b.delay.toFixed(0)+' s':'Sin espera');
  const button=el('button',following?'Dejar de seguir':'Seguir este bus','primary full');button.id='follow';button.onclick=()=>{following=!following;if(following)map.focusOn(b.xy,.9);renderBus();};p.append(button);const route=el('button','Ver paradas de '+b.code,'full');route.onclick=()=>selectRoute(b.routeId);p.append(route);
 }
 // Ficha de un bus en tiempo real. Son dos fuentes distintas y la ficha lo dice: la lectura GPS trae
 // ocupación y hora del reporte propias del bus, y la instantánea solo una posición que calcula
 // el planificador. Lo que no llega no se rellena con una estimación.
 function renderRealBus(){
  const bus=map.realBus(selection?.id,selection?.label)||selection?.last;
  if(!bus){clearSelection();return;}
  selection.last=bus;
  const gps=Number.isFinite(bus.reported_age_s);
  const code=bus.code||bus.line||'';
  const route=(code&&liveRouteFor(code,bus.destination))||data.routes.find(r=>r.code===code&&r.ready)||null;
  const p=$('#selection');p.replaceChildren();
  if(route)p.append(badge(route));
  // La lectura GPS identifica el vehículo y la instantánea no: sin número, el título es el destino
  // y no se repite debajo lo que ya dice arriba.
  p.append(el('span','  BUS EN TIEMPO REAL','eyebrow'),el('h2',bus.label||bus.destination||code||'Bus'));
  if(bus.label)p.append(el('div',bus.destination?'Hacia '+bus.destination:'Sin destino publicado','bus-state'));
  $('#inspector').hidden=false;
  if(code)row('Servicio',code+(route?'':' · fuera del catálogo'));
  if(gps){
   row('Ocupación',occupancyText(bus.occupancy));
   row('Último reporte',ageText(bus.reported_age_s));
   if(Number.isFinite(bus.travelled_m))row('Recorrido',(bus.travelled_m/1000).toFixed(1)+' km');
   if(bus.accessibility)row('Accesibilidad',bus.accessibility);
  }else{
   row('Operador',bus.operator||'Sin dato');
   p.append(el('p','Posición reportada al alimentador de datos abiertos. Va sellada con la hora en que se reconstruyó el lote, no con la del GPS de cada bus, y esa fuente no publica ocupación.','muted'));
  }
  const seguir=el('button',following?'Dejar de seguir':'Seguir este bus','primary full');seguir.id='follow';
  seguir.onclick=()=>{following=!following;if(following)map.focusOn(bus.xy,Math.min(map.mpp,.9));renderRealBus();};
  p.append(seguir);
  // Desde la instantánea, el servicio del bus es un salto a su propia vista, que es la que trae
  // la lectura GPS. Estando ya en ella el botón no tendría a dónde llevar.
  if(!gps&&route&&colorByCode.has(code)){
   const ver=el('button','Ver '+code+' en vivo','full');
   // Las dos fuentes numeran los vehículos de forma distinta, así que este bus no tiene equivalente
   // en la otra vista: se suelta la selección y el encuadre pasa a ser el del servicio, que es lo
   // que se pidió ver.
   ver.onclick=()=>{clearSelection();setLiveScope('route');$('#live-route').value=code;$('#live-route').onchange();};
   p.append(ver);
  }
  if(route){const paradas=el('button','Ver paradas de '+code,'full');paradas.onclick=()=>selectRoute(route.id);p.append(paradas);}
  if(!map.realBus(selection.id,selection.label))p.append(el('p','Este bus dejó de aparecer en la última lectura. Lo que se muestra es su último reporte.','muted'));
 }
 // El punto de embarque que publica el tablero: "Calle 72 C - 4" es vagón C, puerta 4, y
 // "Portal Américas T5" la plataforma 5 de un portal. El terminal se prueba primero porque "T5"
 // también se leería como vagón T con puerta 5. Lo que no encaje se muestra tal cual llega.
 const TERMINAL=/(?:^|\s)T\s*(\d+)\s*([A-Z]?)\s*\.?$/,VAGON=/(?:^|\s)([A-Z])\s*-?\s*(\d+(?:\s*ó\s*\d+)*)\s*(?:-\s*[A-Z])?\s*(?:I+\s*)?\.?$/;
 // Nombre propio, y no boardingPoint: hay otra con ese nombre en el ámbito del módulo que recibe
 // una visita y no un texto. Declararlas iguales tapaba a aquella en todo este bloque, así que la
 // ficha de un bus y las llegadas de una estación le pasaban un objeto a esta y reventaban en cada
 // fotograma, congelando el mapa entero.
 function boardingPointFromBoard(text){
  const limpio=(text||'').trim();if(!limpio)return '';
  const terminal=limpio.match(TERMINAL);
  if(terminal)return 'Plataforma T'+terminal[1]+terminal[2];
  const vagon=limpio.match(VAGON);
  if(!vagon)return limpio;
  const puertas=vagon[2].match(/\d+/g)||[];
  return 'Vagón '+vagon[1]+(puertas.length?' · puerta'+(puertas.length>1?'s ':' ')+puertas.join(' ó '):'');
 }
 // Tablero de una estación, leído en vivo. Es lo que el operador publica para los próximos
 // minutos —hora y punto de embarque—, no algo medido en la calle, y la ficha lo dice. No mezcla
 // nada del escenario: los pasajeros esperando y las llegadas del modelo son estimaciones, y en
 // esta pestaña la pregunta es qué está pasando de verdad.
 let liveStationAsked=0,liveStationId=null;
 async function requestLiveStation({force=false}={}){
  const station=data.stations.find(st=>st.id===selection?.id);if(!station)return;
  if(liveStationId!==station.id){liveStationId=station.id;renderLiveStation(station,{phase:'loading'});}
  else if(!force&&performance.now()-liveStationAsked<15000)return;
  liveStationAsked=performance.now();
  try{
   const response=await fetch('./api/en-vivo/estacion?id='+encodeURIComponent(station.id),{cache:'no-store'});
   const payload=await response.json();
   if(selection?.id!==station.id)return;
   renderLiveStation(station,response.ok?{phase:'ok',payload}:{phase:'error',message:payload.detail||'No se pudo completar la consulta.'});
  }catch{
   if(selection?.id===station.id)renderLiveStation(station,{phase:'error',message:'Sin respuesta.'});
  }
 }
 function renderLiveStation(station,{phase,payload,message}){
  const p=$('#selection');p.replaceChildren(el('span',station.kind==='street'?'PARADERO EN CALLE':'ESTACIÓN','eyebrow'),el('h2',station.name));
  $('#inspector').hidden=false;
  row('Estado publicado',station.status);
  if(station.kind!=='street')row('Vagones',station.wagons?String(station.wagons)+' · publicados':'2 · estimados');
  p.append(el('h2','Próximas salidas'));
  if(phase!=='ok'){p.append(el('p',phase==='loading'?'Consultando el tablero…':message,'muted'));return;}
  if(!payload.departures?.length){p.append(el('p','El tablero de esta estación no anuncia salidas ahora mismo.','muted'));return;}
  for(const salida of payload.departures){
   const conocido=colorByCode.has(salida.line);
   const fila=el('button',undefined,'route-row');
   fila.append(badge({code:salida.line,color:colorByCode.get(salida.line)||'#8b98a8'}));
   const texto=el('div',undefined,'route-text');
   const punto=boardingPointFromBoard(salida.stop);
   texto.append(el('strong',salida.destination||'Sin destino publicado'),
    el('small',`${salida.time}${punto?' · '+punto:''}${conocido?'':' · fuera del catálogo'}`));
   fila.append(texto,el('span',salida.in_min<=0?'Ahora':salida.in_min+' min','value'));
   // Cada salida lleva a su servicio en vivo, que es donde se ve dónde están sus buses.
   if(conocido)fila.onclick=()=>{clearSelection();setLiveScope('route');$('#live-route').value=salida.line;$('#live-route').onchange();};
   else fila.disabled=true;
   fila.setAttribute('aria-label',`${salida.line} hacia ${salida.destination}, ${salida.in_min<=0?'llegando':'en '+salida.in_min+' minutos'}${punto?', '+punto:''}.`);
   p.append(fila);
  }
  const reloj=readingClock(payload.queried_at);
  p.append(el('p',`Salidas que el operador anuncia para esta estación${reloj?', consultadas a las '+reloj:''}. Son lo previsto para los próximos minutos y el punto de atención publicado, no la posición medida de cada bus: para eso está el mapa de esta misma pestaña.`,'muted'));
 }
 function requestStation(){const s=data.stations.find(s=>s.id===selection?.id);if(!s)return;$('#selection').replaceChildren(el('span',s.kind==='street'?'PARADERO EN CALLE':'ESTACIÓN','eyebrow'),el('h2',s.name),el('p','Consultando próximos servicios…','muted'));$('#inspector').hidden=false;if(ready)worker.postMessage({type:'station',generation,id:s.id});}
 function renderStation(info){
  const s=data.stations.find(s=>s.id===info.id);if(!s)return;const p=$('#selection');p.replaceChildren(el('span',s.kind==='street'?'PARADERO EN CALLE':'ESTACIÓN','eyebrow'),el('h2',s.name));row('Estado publicado',s.status);
  if(s.kind!=='street'){row('Vagones',s.wagons?String(s.wagons)+' · publicados':'2 · estimados');const diagram=el('div',undefined,'wagon-diagram');for(let i=1;i<=(s.wagons||2);i++){const w=el('span','V'+i,info.buses.some(b=>b.wagon===i)?'busy':'');diagram.append(w);}p.append(diagram);row('Carriles por sentido','Atención + paso');}
  const layout=data.station_layouts?.stations.find(l=>l.station_id===s.id);if(layout)p.append(el('p','Geometría física OSM: plataformas, cubiertas y accesos separados. La asignación del servicio al punto de atención es estimada.','muted'));
  if(s.coordinate_source==='route_linear_reference_estimated')p.append(el('p','Ubicación aproximada sobre el trazado publicado.','muted'));
  row('Pasajeros esperando',fmt(info.waiting)+' · est.');row('Servicios seleccionados',info.routes.length);p.append(el('h2','Próximas llegadas'));
  if(!info.upcoming.length)p.append(el('p','Sin llegadas en los próximos 30 minutos dentro del escenario seleccionado.','muted'));
  for(const arrival of info.upcoming){const b=el('button',undefined,'route-row');const r=routeById.get(arrival.routeId);b.append(badge(r));const text=el('div',undefined,'route-text');text.append(el('strong',arrival.name),el('small',Math.max(0,Math.ceil((arrival.arrival-clock.time)/60))+' min'+(s.kind==='street'?'':' · '+boardingPoint(arrival))));b.append(text);b.onclick=()=>selectRoute(r.id);p.append(b);}
  p.append(el('p',info.upcoming.some(a=>a.wagonSource==='published')
   ? 'El punto de atención es el que publica el tablero de esta estación. Donde no se conoce, el reparto sigue siendo estimado y se rotula. Los expresos usan el carril de paso.'
   : 'Distribución operativa de vagones estimada. Los expresos usan el carril de paso.','muted'));if(s.demand_profile){p.append(el('h2','Referencia de demanda'));row('Entradas del archivo diario',fmt(s.demand_profile.total));p.append(el('p','Validaciones = entradas registradas por recaudo, no pasajeros presentes ahora. Archivo oficial del 9 sep. 2026; el reparto por sentido se estima.','muted'));}
 }
 // Demanda observada por hora para el tipo de día del escenario. Son medias de los días
 // medidos, no una predicción; la curva solo agrega los perfiles de todas las estaciones.
 const demandCurves=new Map();
 function demandCurve(date){
  const kind=dayType(date);
  if(demandCurves.has(kind))return demandCurves.get(kind);
  const hours=new Array(24).fill(0);let measured=false;
  for(const profile of data.demand?.profiles||[]){
   const hourly=profile.hourly_by_day_type?.[kind]||(kind==='weekday'?profile.hourly:null);
   if(!hourly)continue;measured=measured||!!profile.hourly_by_day_type;
   for(let h=0;h<24;h++)hours[h]+=hourly[h];
  }
  const curve={hours,measured,days:data.demand?.profiles?.[0]?.days_observed?.[kind]||null};
  demandCurves.set(kind,curve);return curve;
 }
 let overviewAt=0;
 function requestOverview(){if(ready&&viewMode==='all'){worker.postMessage({type:'overview',generation});overviewAt=performance.now();}}
 function renderOverview({pressure,zones}){
  const list=$('#pressure-list');list.replaceChildren();
  if(!pressure.length)list.append(el('li','Sin pasajeros esperando a esta hora.','muted'));
  for(const s of pressure){
   const li=el('li'),b=el('button',s.name);
   b.onclick=()=>{const station=data.stations.find(st=>st.id===s.id);if(station){onSelect({kind:'station',id:s.id});map.focusStation(station);}};
   li.append(b,el('span',fmt(s.waiting),'value'));list.append(li);
  }
  const zoneList=$('#zone-load');zoneList.replaceChildren();
  const byZone=new Map(data.zones.map(z=>[z.id,z]));
  if(!zones.length)zoneList.append(el('li','Sin buses en circulación a esta hora.','muted'));
  for(const z of zones.slice(0,8)){
   const meta=byZone.get(z.id),li=el('li'),swatch=el('i',undefined,'swatch');
   swatch.style.background=meta?.color||'#8b98a8';
   const share=z.capacity?Math.round(z.onboard/z.capacity*100):0;
   li.append(swatch,el('span',meta?.name||('Troncal '+z.id),'zone-name'),el('span',`${fmt(z.buses)} · ${share}%`,'value'));
   zoneList.append(li);
  }
 }
 function renderNow(){
  if(viewMode!=='all')return;
  const kind=dayType(config.date),curve=demandCurve(config.date),hour=Math.floor(((clock.time%DAY)+DAY)%DAY/3600);
  const label=kind==='holiday'?'domingo o festivo':kind==='saturday'?'sábado':'día de semana';
  $('#now-context').textContent=`${new Date(config.date+'T12:00:00Z').toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})} · ${timeText(clock.time)} · perfil de ${label}`;
  const host=$('#demand-curve'),top=Math.max(1,...curve.hours);
  if(host.dataset.kind!==kind){
   host.dataset.kind=kind;host.replaceChildren();
   curve.hours.forEach((value,h)=>{
    const bar=el('button');bar.style.height=Math.max(2,value/top*100)+'%';
    bar.title=`${String(h).padStart(2,'0')}:00 · ${fmt(value)} validaciones`;bar.setAttribute('aria-label',bar.title);
    if(h%6===0)bar.append(el('span',String(h).padStart(2,'0')));
    bar.onclick=()=>{jump(DAY+h*3600);};host.append(bar);
   });
  }
  [...host.children].forEach((bar,h)=>bar.classList.toggle('now',h===hour));
  $('#demand-note').textContent=curve.measured&&curve.days
   ? `Media de ${curve.days} ${curve.days===1?'día':'días'} de este tipo, del archivo oficial de validaciones. No es una predicción.`
   : 'Perfil horario del archivo oficial de validaciones.';
  const s=snap.stats,total=Math.max(1,s.fleet||0);
  const partes=[['moving','En recorrido','#2f7d68'],['dwell','Puertas abiertas','#3f6ea8'],['queue','Esperando atención','#b9822a'],['signal','En semáforo','#b0503f'],['traffic','Detenido en tráfico','#8a6a4f']];
  const split=$('#fleet-split');split.replaceChildren();
  const legend=$('#fleet-legend');legend.replaceChildren();
  for(const [key,name,color] of partes){
   const value=s[key]||0,bar=el('i');bar.style.width=value/total*100+'%';bar.style.background=color;split.append(bar);
   const li=el('li'),dot=el('i');dot.style.background=color;li.append(dot,el('span',name),el('b',fmt(value)));legend.append(li);
  }
  if(ready&&performance.now()-overviewAt>4000)requestOverview();
 }
 function renderDepots(depots){const p=$('#depot-list');p.replaceChildren();if(!depots.length)p.append(el('p','No hay salidas para esta selección y fecha.','muted'));for(const d of depots){const r=el('div',undefined,'depot-row'),b=el('button',d.name);b.onclick=()=>{const station=data.stations.find(s=>s.id===d.id);if(station){onSelect({kind:'station',id:d.id});map.focusStation(station);}};r.append(b,el('small',`${fmt(d.departures)} salidas hoy · ${fmt(d.reserve)} buses disponibles`),el('small',Number.isFinite(d.next)?'Próxima salida '+timeText(d.next).slice(0,5):'Sin más salidas programadas'));p.append(r);}}
 function updateUI(){const s=snap.stats;$('#active-count').textContent=fmt(s.fleet||0);$('#onboard-count').textContent=fmt(s.onboard||0);$('#dwell-count').textContent=fmt(s.dwell||0);$('#queue-count').textContent=fmt((s.queue||0)+(s.signal||0));$('#queue-count').parentElement.title=`${fmt(s.queue||0)} esperando atención · ${fmt(s.signal||0)} en semáforo`;if(!scrubbing&&document.activeElement!==$('#time'))$('#time').value=timeText(clock.time);if(!scrubbing)$('#scrub').value=Math.floor(clock.time%DAY);$('#day-type').textContent=dayType(config.date)==='holiday'?'Domingo / festivo':new Date(config.date+'T12:00:00Z').toLocaleDateString('es-CO',{weekday:'long'});$('#period').textContent=demandPeriod(clock.time,config.date,config.params.mode)==='peak'?'Hora pico':'Hora valle';}
 function switchPanel(name){if(name==='planner'||activePanel==='planner'&&selection?.kind==='journey')clearSelection();activePanel=name;shell.show(name);$$('button[data-panel]').forEach(b=>b.classList.toggle('nav-active',b.dataset.panel===name));$$('.panel').forEach(p=>p.hidden=p.id!==name+'-panel');$('#sidebar').scrollTop=0;if(name==='depots'&&ready)worker.postMessage({type:'depots',generation});syncLive();}
 // Buses en tiempo real. Es la única parte que sale a la red y a un tercero: vive en su pestaña, se apaga
 // al salir de ella o al ocultar la ventana, y no toca el escenario, el reloj ni el planificador.
 // La última lectura de cada alcance se guarda para poder repintar al cambiar de vista sin esperar
 // a que llegue otra.
 const live=new LiveFeed({onState:state=>{if(state.phase==='ok')ultimoServicio=state;renderLive(state);}});
 let liveFitted=null,liveScope='network',liveUsable=false,livePerService=false,ultimoServicio=null;
 const liveNetwork=new LiveFeed({onState:state=>{ultimaRed=state;renderLiveNetwork(state);},url:()=>'./api/en-vivo/red'});
 // Identificadores que la vista por servicio ya dibuja, y el último estado de la red, para poder
 // repintarla sin volver a pedirla cuando cambia lo que está en foco.
 let enFoco=new Set(),ultimaRed=null;
 const colorByCode=new Map(data.routes.filter(r=>r.ready).map(r=>[r.code,r.color]));
 const stationById=new Map(data.stations.map(s=>[s.id,s]));
 // El servicio no dice si un bus está detenido, así que se infiere por cercanía a una parada del
 // propio servicio. Su campo de metros recorridos no sirve: coincide con la referencia del
 // proyecto en un sentido y está corrida cientos de metros en el otro. 60 m cubre el largo de un
 // andén sin alcanzar la estación siguiente.
 const PARADA_M=60;
 const atStop=bus=>{
  const route=bus.routeId&&routeById.get(bus.routeId);
  return !!route&&route.stops.some(s=>{const st=stationById.get(s.station_id);return st&&Math.hypot(st.xy[0]-bus.xy[0],st.xy[1]-bus.xy[1])<=PARADA_M;});
 };
 function syncLive(){
  const inLive=activePanel==='live',awake=inLive&&!document.hidden;
  // La instantánea de la red acompaña a las dos vistas: en «Por servicio» queda detrás, atenuada.
  liveNetwork.setCadence(liveScope==='route'?30000:20000);
  liveNetwork.setActive(awake);
  live.setActive(awake&&liveScope==='route'&&livePerService);
  map.setSimulationVisible(!inLive);
  scenarioControls(!inLive);
  // Los indicadores del escenario no hablan de los buses en tiempo real, así que en esta pestaña ceden el
  // sitio a los de la lectura en vivo. «En parada» solo tiene sentido con un servicio en foco: en
  // la vista general pasarían por detenidos buses que solo cruzan cerca de una estación sin parar.
  $$('[data-scenario-metric]').forEach(d=>d.hidden=inLive);
  $$('[data-live-metric]').forEach(d=>d.hidden=!inLive);
  // Sin nada que contar, el recuadro entero sobra: dejarlo con un guion es peor que no ponerlo.
  $('#metrics').hidden=inLive&&!liveUsable;
  // Aquí los semáforos están escondidos pase lo que pase, así que su interruptor no tiene qué hacer.
  $('#signals-toggle').disabled=inLive;
  $('#live-stopped-cell').hidden=!inLive||liveScope!=='route';
  $('#live-count-label').textContent=liveScope==='route'?'del servicio':'buses en tiempo real';
  // Sin servicio elegido, el indicador conservaba el conteo de la red rotulado «del servicio».
  if(inLive&&liveScope==='route'&&!$('#live-route').value){$('#live-count').textContent='—';$('#live-stopped').textContent='—';}
  if(!inLive){$('#live-count').textContent='—';$('#live-stopped').textContent='—';}
  $('#live-network').hidden=liveScope!=='network';
  $('#live-route-block').hidden=liveScope!=='route';
  $$('[data-live-scope]').forEach(b=>{b.classList.toggle('active',b.dataset.liveScope===liveScope);
   // Sin configuración local no hay lectura por servicio: el botón se desactiva en vez de llevar
   // a una vista que no puede responder.
   if(b.dataset.liveScope==='route')b.disabled=!livePerService;});
  if(liveScope==='route'&&!livePerService)$('#live-status').textContent='Esta vista necesita la configuración local del servicio.';
  // Fuera de la pestaña no queda ningún bus en tiempo real dibujado, así que su ficha tampoco se sostiene.
  // Con una estación abierta, entrar o salir de la pestaña cambia de qué fuente se responde: el
  // tablero del operador dentro, la estimación del escenario fuera.
  if(selection?.kind==='station'){liveStationId=null;if(inLive)requestLiveStation({force:true});else requestStation();}
  if(!inLive){liveFitted=null;if(selection?.kind==='realbus')clearSelection();map.setLiveBuses([]);map.setNetworkBuses([]);map.setRoute(focusedRoute);}
  else if(liveScope!=='route'){map.setLiveBuses([]);map.setRoute(null);}
  else restoreLiveRoute();
  map.setNetworkDimmed(liveScope==='route');
 }
 function renderLiveNetwork({phase,payload,message}){
  const status=$('#live-network-status'),list=$('#live-network-list');
  if(phase==='error'){status.textContent=message;list.replaceChildren();map.setNetworkBuses([]);return;}
  if(phase!=='ok')return;
  const todos=payload.vehicles.map(v=>({...v,color:colorByCode.get(v.line)}));
  const vehicles=liveScope==='route'?todos.filter(v=>!v.label||!enFoco.has(v.label)):todos;
  map.setNetworkBuses(vehicles,{dimmed:liveScope==='route'});
  if(liveScope!=='route')$('#live-count').textContent=fmt(todos.length);
  const age=Number(payload.age_s)||0;
  const lote=Number(payload.build_age_s);
  const reloj=readingClock(payload.queried_at);
  status.textContent=`${fmt(todos.length)} ${todos.length===1?'bus troncal o dual':'buses troncales y duales'} · consultado ${reloj?`a las ${reloj}`:ageText(age)}${reloj&&age>=2?` (${ageText(age)})`:''}`
   // El lote viejo es la única forma de saber que lo dibujado dejó de moverse hace rato. Se dice a
   // partir de minuto y medio, que es seis veces lo que el alimentador tarda en reconstruirse.
   +(Number.isFinite(lote)&&lote>=90?` · el alimentador no se reconstruye desde hace ${ageText(lote)}`:'')
   +(payload.unmatched?` · ${fmt(payload.unmatched)} ${payload.unmatched===1?'bus':'buses'} de servicios que el simulador todavía no tiene`:'');
  const porLinea=new Map();
  for(const v of vehicles)porLinea.set(v.line,(porLinea.get(v.line)||0)+1);
  const filas=[...porLinea].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'es',{numeric:true}));
  list.replaceChildren();
  if(!filas.length){list.append(el('li','El planificador no ubica ningún bus troncal ahora mismo.','muted'));return;}
  for(const [code,count] of filas.slice(0,14)){
   const li=el('li'),swatch=el('i',undefined,'swatch');swatch.style.background=colorByCode.get(code)||'#8b98a8';
   const boton=el('button',code+(colorByCode.has(code)?'':' · fuera del catálogo'));
   boton.onclick=()=>{if(!colorByCode.has(code))return;setLiveScope('route');$('#live-route').value=code;$('#live-route').onchange();};
   li.append(swatch,boton,el('span',fmt(count),'value'));list.append(li);
  }
  if(filas.length>14)list.append(el('li',`y ${filas.length-14} servicios más`,'muted'));
 }
 function setLiveScope(scope){
  liveScope=scope;liveFitted=null;
  // El indicador cambia de significado con el alcance: dejar debajo de la etiqueta nueva el número
  // del alcance anterior —los buses del sistema rotulados «del servicio», o al revés— era decir algo
  // falso hasta la siguiente lectura. Se borra y se repinta en el acto con lo último que ya se tiene,
  // que además devuelve al mapa los buses que la otra vista escondía.
  $('#live-count').textContent='—';$('#live-stopped').textContent='—';
  syncLive();
  if(scope==='route'){if(ultimoServicio?.payload?.code===$('#live-route').value)renderLive(ultimoServicio);}
  else if(ultimaRed)renderLiveNetwork(ultimaRed);
 }
 // El trazado del servicio en foco no depende de qué ficha esté abierta: al soltar una, tiene que
 // seguir resaltado y no esperar a la próxima lectura para volver a aparecer.
 function restoreLiveRoute(){
  if(!(activePanel==='live')||liveScope!=='route')return;
  const code=$('#live-route').value,trazados=code?liveRoutes(code):[];
  map.setRoute(trazados.length?trazados.map(r=>r.id):null,{subtle:true});
 }
 // En vivo es lectura: el reloj del escenario no manda sobre buses que ya están en la calle, así
 // que sus controles se apagan en vez de dar la impresión de que mueven algo.
 function scenarioControls(enabled){
  for(const control of [$('#date'),$('#now'),$('#back'),$('#pause'),$('#forward'),$('#time'),$('#scrub'),...$$('[data-speed]')])control.disabled=!enabled;
  $('#timeline').classList.toggle('readonly',!enabled);
  $('#timeline').title=enabled?'':'Controles en pausa: la pestaña En vivo muestra el momento actual, no el reloj del escenario.';
 }
 function liveRouteFor(code,destination){return data.routes.find(r=>r.code===code&&sameName(r.name,destination));}
 const liveRoutes=code=>data.routes.filter(r=>r.code===code&&r.ready);
 async function setUpLive(){
  const status=await live.probe();
  // La vista de toda la red sale de datos abiertos y la de un servicio de la configuración local:
  // condicionar la pestaña entera a la segunda escondería una que sí funciona.
  const porServicio=!!status.configured;
  const usable=!!status.available&&(!!status.network||porServicio);
  liveUsable=usable;livePerService=porServicio;
  $('#live-unavailable').hidden=usable;$('#live-controls').hidden=!usable;
  syncLive();
  if(!usable)return;
  for(const code of status.codes){
   const names=[...new Set(data.routes.filter(r=>r.code===code&&r.ready).map(r=>r.name))];
   const option=el('option',`${code} · ${names.join(' / ')}`);option.value=code;$('#live-route').append(option);
  }
 }
 function renderLive({phase,payload,message,code}){
  const status=$('#live-status'),results=$('#live-results');
  if(phase==='idle'||phase==='error'){
   status.textContent=phase==='idle'?'Elige un servicio para ver sus buses.':message;results.replaceChildren();map.setLiveBuses([]);
   // Sin servicio en foco no hay nada que ocultar detrás: la red vuelve a mostrarlos todos.
   if(enFoco.size){enFoco=new Set();renderLiveNetwork(ultimaRed||{phase:'idle'});}
   return;
  }
  if(phase==='loading'){status.textContent='Consultando el servicio…';return;}
  const buses=payload.buses.map(b=>{const r=liveRouteFor(payload.code,b.destination);return {...b,code:payload.code,color:r?.color,routeId:r?.id};});
  map.setLiveBuses(buses);
  // Las dos fuentes numeran los vehículos de forma distinta, pero las dos rotulan el bus con su
  // número de flota: es lo único con lo que se puede saber que el que está en foco y el de la
  // instantánea general son el mismo, y no dibujarlo dos veces.
  enFoco=new Set(buses.map(b=>b.label).filter(Boolean));
  renderLiveNetwork(ultimaRed||{phase:'idle'});
  $('#live-count').textContent=fmt(buses.length);
  $('#live-stopped').textContent=fmt(buses.filter(atStop).length);
  // El trazado del servicio queda resaltado como al elegirlo en la simulación, los dos sentidos
  // si los tiene, y el encuadre es el del corredor completo: los buses se leen sobre su recorrido.
  const trazados=liveRoutes(payload.code);
  map.setRoute(trazados.length?trazados.map(r=>r.id):null,{subtle:true});
  if(liveFitted!==payload.code&&(trazados.length||buses.length)){
   liveFitted=payload.code;
   map.fitPoints(trazados.length?trazados.flatMap(r=>r.points):buses.map(b=>b.xy));
  }
  const age=Number(payload.age_s)||0;
  const descartados=payload.discarded?` · ${payload.discarded} sin posición utilizable`:'';
  const reloj=readingClock(payload.queried_at);
  status.textContent=buses.length?`${buses.length} ${buses.length===1?'bus reportando':'buses reportando'} · consultado ${reloj?`a las ${reloj}`:ageText(age)}${reloj&&age>=2?` (${ageText(age)})`:''}${descartados}`:'El servicio no reporta buses de esta ruta en este momento.'+descartados;
  results.replaceChildren();
  if(!buses.length){results.append(el('p','Fuera del horario de operación, o ningún bus de este servicio está reportando posición ahora.','muted'));return;}
  for(const group of groupByDestination(buses)){
   const section=el('section',undefined,'live-group');
   const route=liveRouteFor(payload.code,group.destination);
   const head=el('div',undefined,'live-head');
   if(route)head.append(badge(route));
   head.append(el('strong','Hacia '+group.destination),el('span',`${group.buses.length} ${group.buses.length===1?'bus':'buses'}`,'value'));
   section.append(head);
   for(const bus of group.buses){
    const entry=el('button',undefined,'live-bus');
    const dot=el('i',undefined,'live-dot');dot.style.background=bus.color||'#dc253b';
    const text=el('div',undefined,'route-text');
    text.append(el('strong',bus.label||bus.id),el('small',`${occupancyText(bus.occupancy)} · ${ageText(bus.reported_age_s)}${Number.isFinite(bus.travelled_m)?' · km '+(bus.travelled_m/1000).toFixed(1)+' del recorrido':''}`));
    entry.append(dot,text);
    entry.onclick=()=>{onSelect({kind:'realbus',id:bus.id,label:bus.label||''});requestAnimationFrame(()=>map.focusOn(bus.xy,Math.min(map.mpp,1.4)));};
    entry.setAttribute('aria-label',`Bus ${bus.label||bus.id} hacia ${group.destination}, ${occupancyText(bus.occupancy)}. Ver su ficha y centrarlo en el mapa.`);
    section.append(entry);
   }
   if(route?.ready){const trazado=el('button','Ver las paradas de '+route.code+' → '+route.name,'full');trazado.onclick=()=>selectRoute(route.id);section.append(trazado);}
   results.append(section);
  }
 }

 function showJourney(legs){clearSelection();selection={kind:'journey',id:String(planSequence)};map.setJourney(legs);map.fitPoints(legs.flatMap(l=>l.points));}
 function journeyTime(second,date){return timeText(second).slice(0,5)+(second>=DAY?' · '+addDays(date,Math.floor(second/DAY)):'');}
 const journeyLabel=journey=>journey.transfers?`${journey.transfers} transbordo${journey.transfers>1?'s':''}`:'Viaje directo';
 // Dentro de un pliegue el encabezado sobra: el resumen del pliegue ya lo dice.
 function journeyCard(journey,result,{header=true}={}){
  const card=el('section',undefined,'journey-card'+(journey.dominated?' journey-alternative':''));
  if(header)card.append(el('h2',journeyLabel(journey)),el('p',`≈ ${Math.ceil(journey.duration/60)} min · llegada ${journeyTime(journey.arrive,result.date)}`,'journey-duration'));
  if(journey.dominated)card.append(el('p','Alternativa: no llega antes que una opción con menos transbordos.','muted'));
  const vencidos=[...new Set(journey.legs.filter(l=>validityState(routeById.get(l.routeId)||{},result.date)!=='current').map(l=>l.code))];
  if(vencidos.length)card.append(el('p',`Horario publicado vencido en ${vencidos.join(', ')}. Se usa su último horario disponible.`,'muted'));
  for(const [index,leg] of journey.legs.entries()){
   if(index)card.append(el('p',`Transbordo en ${leg.fromName} · caminata ≈ ${Math.ceil(leg.walk/60)} min`,'transfer-note'));
   const step=el('div',undefined,'journey-leg');step.append(badge(leg),el('strong','Hacia '+leg.name),el('p',`${journeyTime(leg.depart,result.date)} · Sube en ${leg.fromName}`),el('p',`${journeyTime(leg.arrive,result.date)} · Baja en ${leg.toName}`),el('small',`${leg.toIndex-leg.fromIndex} parada${leg.toIndex-leg.fromIndex===1?'':'s'} · espera ≈ ${Math.max(0,Math.ceil(leg.wait/60))} min`));card.append(step);
  }
  const button=el('button','Ver este viaje en el mapa','full');button.onclick=()=>showJourney(journey.legs);card.append(button);
  return card;
 }
 function renderJourneys(result){
  const panel=$('#journey-results');panel.replaceChildren();const edit=el('button','Editar viaje','full');edit.onclick=()=>{$('#sidebar').scrollTop=0;$('#journey-origin').focus({preventScroll:true});};panel.append(edit);requestAnimationFrame(()=>{if(activePanel==='planner')$('#sidebar').scrollTop=panel.offsetTop-24;});
  if(result.status==='same'){if(activePanel==='planner')clearSelection();panel.append(el('p','Ya estás en la estación de destino.'));const station=data.stations.find(s=>s.id===result.origin);if(station&&activePanel==='planner')map.focusStation(station);return;}
  if(result.status==='none'){if(activePanel==='planner')clearSelection();panel.append(el('p',`No se encontró un viaje en las próximas seis horas con hasta ${result.maxTransfers} transbordo${result.maxTransfers===1?'':'s'}. Prueba otra hora, otra fecha o permitir más transbordos.`,'muted'),el('p','La búsqueda excluye los servicios con datos pendientes.','muted'));return;}
  // Una sola opción a la vista —la que llega antes, y con menos transbordos si empatan— y todas
  // las demás detrás de un mismo pliegue. Agrupar por transbordos dejaba tres tarjetas abiertas
  // que se leían como tres viajes distintos y hundían el resto del panel.
  // Tres cosas hacen mejor a un viaje: llegar antes, tener menos transbordos y salir más tarde —esto
  // último vale, porque son minutos que uno no pasa esperando—. Una opción que no gana en ninguna de
  // las tres frente a otra no es una alternativa, es la misma peor, y con un pliegue por opción solo
  // estorbaría: el buscador ofrecía «3 transbordos, llega 00:05» al lado de «2 transbordos, llega
  // 00:05». Se queda la frontera de lo que de verdad se puede elegir.
  const salida=j=>j.legs[0]?.depart??0;
  const superaA=(b,a)=>b.arrive<=a.arrive&&b.transfers<=a.transfers&&salida(b)>=salida(a)
   &&(b.arrive<a.arrive||b.transfers<a.transfers||salida(b)>salida(a));
  const opciones=result.journeys.filter(a=>!result.journeys.some(b=>b!==a&&superaA(b,a)))
   .sort((a,b)=>a.arrive-b.arrive||a.transfers-b.transfers||salida(b)-salida(a));
  panel.append(journeyCard(opciones[0],result));
  // Cada alternativa en su propio pliegue, y no todas dentro de uno: así una lista larga cabe de un
  // vistazo y el resumen dice lo que hace falta para elegir —cuánto tarda, a qué hora llega y por
  // qué servicios va— sin abrir ninguna.
  for(const journey of opciones.slice(1)){
   const plegado=el('details',undefined,'journey-option'),resumen=el('summary');
   resumen.append(el('span',`${journeyLabel(journey)} · ≈ ${Math.ceil(journey.duration/60)} min · llega ${journeyTime(journey.arrive,result.date)}`),
    el('small',[...new Set(journey.legs.map(l=>l.code))].join(' · ')));
   plegado.append(resumen,journeyCard(journey,result,{header:false}));
   panel.append(plegado);
  }
  panel.append(el('p','Horarios y paradas publicados; frecuencias, tiempos de viaje y caminatas estimados, sin predecir aforo ni fases semafóricas. La búsqueda considera toda la red utilizable y no modifica el reloj.','muted'));if(activePanel==='planner')showJourney(opciones[0].legs);
 }
 const usedStations=new Set(data.routes.filter(r=>r.ready).flatMap(r=>r.stops.map(s=>s.station_id)));
 for(const station of data.stations.filter(s=>usedStations.has(s.id)).sort((a,b)=>a.name.localeCompare(b.name,'es'))){for(const selector of ['#journey-origin','#journey-destination']){const option=el('option',station.name+(station.kind==='street'?' · calle':''));option.value=station.id;$(selector).append(option);}}
 $('#journey-date').value=config.date;$('#journey-time').value=timeText(clock.time).slice(0,5);
 // Un filtro encima de cada desplegable: con más de mil paradas, escribir el nombre llega antes que
 // recorrer la lista. El desplegable conserva su valor y su validación, así que el formulario sigue
 // siendo el mismo; solo se le esconden las opciones que no coinciden.
 const journeySearch=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const pickerOptions={};
 function restoreOptions(kind){const select=$('#journey-'+kind),value=select.value;select.replaceChildren();for(const o of pickerOptions[kind]){const option=el('option',o.text);option.value=o.value;select.append(option);}select.value=value;}
 for(const kind of ['origin','destination']){
  const select=$('#journey-'+kind);pickerOptions[kind]=[...select.options].map(o=>({value:o.value,text:o.text}));
  const input=el('input');input.type='search';input.id='journey-'+kind+'-search';input.placeholder='Filtrar estaciones…';
  input.setAttribute('aria-label','Buscar estación de '+(kind==='origin'?'origen':'destino'));select.before(input);
  input.oninput=()=>{
   const q=journeySearch(input.value),previous=select.value;select.replaceChildren();
   for(const o of pickerOptions[kind].filter(o=>!o.value||journeySearch(o.text).includes(q))){const option=el('option',o.text);option.value=o.value;select.append(option);}
   select.value=[...select.options].some(o=>o.value===previous)?previous:'';
  };
  select.addEventListener('change',()=>{input.value=select.selectedOptions[0]?.text||'';});
 }
 // Intercambiar con un filtro puesto dejaría fuera la estación que entra, así que las listas vuelven
 // a estar completas antes de cruzar los valores.
 $('#swap-journey').onclick=()=>{
  const a=$('#journey-origin').value,b=$('#journey-destination').value;
  restoreOptions('origin');restoreOptions('destination');
  $('#journey-origin').value=b;$('#journey-destination').value=a;
  for(const kind of ['origin','destination'])$('#journey-'+kind+'-search').value=$('#journey-'+kind).selectedOptions[0]?.text||'';
 };
 $('#planner-form').onsubmit=e=>{e.preventDefault();if(!ready)return;const time=$('#journey-time').value.split(':').map(Number),query={origin:$('#journey-origin').value,destination:$('#journey-destination').value,date:$('#journey-date').value,time:time[0]*3600+time[1]*60,maxTransfers:Number($('#journey-transfers').value)};$('#plan-journey').disabled=true;$('#journey-results').replaceChildren(el('p','Buscando conexiones…','muted'));worker.postMessage({type:'plan',generation,requestId:++planSequence,query});};
 $$('button[data-panel]').forEach(b=>b.onclick=()=>switchPanel(b.dataset.panel));
 $$('[data-mode]').forEach(b=>b.onclick=()=>{viewMode=b.dataset.mode;clearSelection();if(viewMode==='all'&&config.selection.mode!=='all'){config.selection={mode:'all'};rebuild({fit:true});}else{syncControls();renderRoutes();if(viewMode==='all'){map.fitNetwork();requestOverview();}}});
 for(const z of data.zones.filter(z=>z.id!=='?')){const b=el('button',undefined,'zone-button');b.style.setProperty('--zone',z.color);b.append(el('b',z.id),el('span',z.name));b.classList.toggle('active',selectedZones.has(z.id));b.setAttribute('aria-pressed',selectedZones.has(z.id));b.onclick=()=>{if(selectedZones.has(z.id))selectedZones.delete(z.id);else selectedZones.add(z.id);b.classList.toggle('active',selectedZones.has(z.id));b.setAttribute('aria-pressed',selectedZones.has(z.id));};$('#zones').append(b);}
 $('#apply-zones').onclick=()=>{if(!selectedZones.size){toast('Selecciona al menos una troncal.');return;}config.selection={mode:'zones',zones:[...selectedZones]};viewMode='zones';rebuild({fit:true});};
 $('#search').oninput=renderRoutes;$('#demand').oninput=()=>$('#demand-value').textContent=$('#demand').value+'×';
 $('#settings-form').onsubmit=e=>{e.preventDefault();config.params=parameters({...config.params,programmedDispatch:$('#programmed-dispatch').checked,programmedRunning:$('#programmed-running').checked,variableDispatch:$('#variable-dispatch').checked,reinforcements:$('#reinforcements').checked,signals:$('#signals').checked,beyondValidity:$('#beyond-validity').checked,peakHeadway:Number($('#peak').value)*60,offpeakHeadway:Number($('#offpeak').value)*60,demand:Number($('#demand').value),mode:$('#demand-mode').value,cruiseKmh:Number($('#cruise').value),streetKmh:Number($('#street-speed').value)});rebuild();toast('Escenario reconstruido con la nueva operación.');};
 $('#date').onchange=()=>{if(!$('#date').value)return;config.date=$('#date').value;rebuild();};$('#time').onchange=()=>{if(!$('#time').value)return;const p=$('#time').value.split(':').map(Number);jump(DAY+p[0]*3600+p[1]*60+(p[2]||0));};
 function commitScrub(){if(!scrubbing)return;const value=Number($('#scrub').value);scrubbing=false;jump(DAY+value);}
 $('#scrub').onpointerdown=()=>{scrubbing=true;};$('#scrub').oninput=()=>{scrubbing=true;$('#time').value=timeText(Number($('#scrub').value));};$('#scrub').onchange=commitScrub;$('#scrub').onpointerup=commitScrub;$('#scrub').onpointercancel=commitScrub;$('#scrub').onblur=commitScrub;
 $('#now').onclick=()=>{const {date,time}=bogotaNow();clock.time=time;following=false;if(date!==config.date){config.date=date;rebuild();}else sample(true);syncControls();updateUI();};
 $('#back').onclick=()=>jump(clock.time-900);$('#forward').onclick=()=>jump(clock.time+900);$('#pause').onclick=()=>{clock.paused=!clock.paused;syncControls();};
 $$('[data-speed]').forEach(b=>b.onclick=()=>{clock.speed=Number(b.dataset.speed);syncControls();});
 $('#zoom-in').onclick=()=>map.zoom(1/1.4);$('#zoom-out').onclick=()=>map.zoom(1.4);$('#fit').onclick=()=>{following=false;fitSelection();};$('#context-toggle').onclick=()=>{map.contextGroup.visible=!map.contextGroup.visible;$('#context-toggle').setAttribute('aria-pressed',map.contextGroup.visible);};$('#lanes-toggle').onclick=()=>{map.carriagewaysEnabled=map.carriagewaysEnabled===false;$('#lanes-toggle').setAttribute('aria-pressed',map.carriagewaysEnabled);if(map.carriagewayGroup)map.carriagewayGroup.visible=map.carriagewaysEnabled&&map.mpp<6;};
 $('#signals-toggle').onclick=()=>{const oculto=map.signalsEnabled;map.setSignals(!oculto);$('#signals-toggle').setAttribute('aria-pressed',oculto);$('#signals-toggle').classList.toggle('active',oculto);};
 $('#corridors-toggle').onclick=()=>{const faded=!map.corridorsFaded;map.setCorridorsFaded(faded);$('#corridors-toggle').setAttribute('aria-pressed',faded);$('#corridors-toggle').classList.toggle('active',faded);};map.onPan=()=>following=false;
 $('#close-inspector').onclick=()=>{clearSelection();renderRoutes();restoreLiveRoute();};
 $('#save').onclick=()=>{try{localStorage.setItem('transmi-scenario-v3',JSON.stringify({revision:data.revision,config,clock}));toast('Escenario guardado. Se restaurará pausado al abrirlo.');}catch{toast('No se pudo guardar en este dispositivo.');}};
 const coverage=el('div',undefined,'coverage-grid');for(const [value,label] of [[data.counts.map_records,'registros del mapa'],[data.counts.map_codes,'códigos distintos'],[data.counts.ready,'variantes utilizables'],[data.counts.pending,'registros pendientes']]){const box=el('div');box.append(el('strong',value),el('span',label));coverage.append(box);}$('#coverage').append(coverage);// Fechas y cifras derivadas del propio dato: una instantánea nueva las actualiza sola.
 const mes=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'});
 const snapshotDate=`${data.snapshot.slice(0,4)}-${data.snapshot.slice(4,6)}-${data.snapshot.slice(6,8)}`;
 $('#snapshot-note').textContent=`Catálogo de servicios: instantánea del ${mes(snapshotDate)}. Las fechas de vigencia se respetan y se rotulan; un registro del catálogo no implica una ruta activa.`;
 // Punto de atención: la cifra sale del propio curado, no escrita a mano, y desaparece si el dato falta.
 if(data.station_wagons?.coverage){
  const c=data.station_wagons.coverage,publicadas=c.visits_with_published_point,total=c.trunk_visits_in_catalogue;
  $('#wagons-note').hidden=false;
  $('#wagons-note').textContent=`Punto de atención: ${fmt(publicadas)} de ${fmt(total)} paradas troncales tienen el vagón y las puertas que publica el tablero de su estación, tomado el ${mes(data.station_wagons.reference_date)} en ${data.station_wagons.windows.length} franjas horarias. Las ${fmt(total-publicadas)} restantes conservan el reparto estimado y la interfaz lo rotula. ${fmt(c.stations_in_catalogue-c.stations_with_board)} estaciones no publican tablero.`;
 }
 if(data.demand){
  const p=data.demand.period,tipos=data.demand.days_by_type||{};
  const detalle=p?`Demanda medida entre el ${mes(p.from)} y el ${mes(p.to)}: ${p.days} días observados (${tipos.weekday?.length||0} de semana, ${tipos.saturday?.length||0} sábados, ${tipos.holiday?.length||0} domingos o festivos). Cada estación tiene un perfil por hora y tipo de día.`
   :`Perfil horario de un solo día observado.`;
  $('#coverage').append(el('p',detalle,'muted'),el('p',`${fmt(Math.round(data.demand.matched_validations))} validaciones enlazadas por estación y hora en el día de semana medio. No equivalen a una matriz origen-destino.`,'muted'));
 }
 for(const r of data.routes.filter(r=>!r.ready)){const d=el('details');d.append(el('summary',r.code+' · '+r.name),el('p',r.issues.join(' ')));$('#pending-list').append(d);}
 for(const r of data.excluded||[]){const p=el('p',r.code+' · '+r.name+': '+r.reason,'muted');$('#pending-list').append(p);}
 $('#live-route').onchange=()=>{
  const code=$('#live-route').value,trazados=code?liveRoutes(code):[];
  liveFitted=null;live.select(code);
  // Resaltar y encuadrar en cuanto se elige, sin esperar a que el servicio conteste. Atenuado:
  // aquí el protagonista es el bus en tiempo real, no el trazado.
  map.setRoute(trazados.length?trazados.map(r=>r.id):null,{subtle:true});
  if(trazados.length){liveFitted=code;map.fitPoints(trazados.flatMap(r=>r.points));}
 };
 $('#live-refresh').onclick=()=>live.refresh();
 $$('[data-live-scope]').forEach(b=>b.onclick=()=>setLiveScope(b.dataset.liveScope));
 liveNetwork.select('red');
 setUpLive();
 let last=performance.now();document.addEventListener('visibilitychange',()=>{last=performance.now();syncLive();});
 function frame(now){const dt=(now-last)/1000;last=now;if(!document.hidden){if(ready&&!clock.paused&&!scrubbing&&document.activeElement!==$('#time')){clock.time+=dt*clock.speed;if(clock.time>=2*DAY)jump(clock.time);}if(now-lastSample>=50){sample();lastSample=now;}
  map.animateBuses(now);map.animateLive(now);map.animateNetwork(now);if(following&&selection?.kind==='bus'){const b=(map.visualBuses||snap.buses).find(b=>b.id===selection.id);if(b){map.follow(b.xy,dt);}}if(following&&selection?.kind==='realbus'){const b=map.realBus(selection.id);if(b)map.follow(b.xy,dt);}if(selection?.kind==='realbus')map.updateMarker();
  map.render();if(now-lastUI>200){updateUI();renderNow();lastUI=now;}if(now-lastList>5000){if(activePanel==='routes'&&!$('#route-list').contains(document.activeElement))renderRoutes();if(activePanel==='depots'&&ready)worker.postMessage({type:'depots',generation});lastList=now;}
  if(now-lastInspect>1000){if(selection?.kind==='bus'||selection?.kind==='realbus'){const focus=document.activeElement?.id;if(selection.kind==='realbus')renderRealBus();else renderBus();if(focus==='follow')$('#follow')?.focus({preventScroll:true});}if(selection?.kind==='station'){if(activePanel==='live')requestLiveStation();else if(ready&&!$('#inspector').contains(document.activeElement))worker.postMessage({type:'station',generation,id:selection.id});}lastInspect=now;}}
 requestAnimationFrame(frame);}
 const dispose=registerSimulationTools(document.modelContext,{read:()=>({...snap.stats,date:config.date,paused:clock.paused,speed:clock.speed,selected:selection}),control:input=>{if('paused'in input)clock.paused=input.paused;if('speed'in input)clock.speed=input.speed;syncControls();}});
 window.addEventListener('pagehide',()=>{worker.terminate();live.stop();liveNetwork.stop();dispose?.();},{once:true});
 document.addEventListener('keydown',e=>{if(e.code==='Space'&&activePanel!=='live'&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();clock.paused=!clock.paused;syncControls();}});
 rebuild();requestAnimationFrame(frame);
}catch(error){$('#loading').hidden=true;$('#error').hidden=false;$('#error').textContent='No fue posible abrir el simulador. '+error.message;console.error(error);}
