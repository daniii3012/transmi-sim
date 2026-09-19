import fs from 'node:fs';import {Operation} from '../dist/operation.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../dist/services.json',import.meta.url)));const demand=JSON.parse(fs.readFileSync(new URL('../dist/demand.json',import.meta.url)));const profiles=new Map(demand.profiles.map(p=>[p.station_id,p]));for(const s of data.stations)s.demand_profile=profiles.get(s.id);
data.busway_signals=JSON.parse(fs.readFileSync(new URL('../dist/busway_signals.json',import.meta.url)));
data.station_layouts=JSON.parse(fs.readFileSync(new URL('../dist/station_layouts.json',import.meta.url)));
// Los vagones publicados y el horario son lo que carga la aplicación. Añadir los vagones mueve el
// techo del escenario de estrés de 3.303 a 3.231 buses: es el reparto real de andenes, no una
// regresión del motor, que en el camino sintético da exactamente lo mismo que antes.
data.station_wagons=JSON.parse(fs.readFileSync(new URL('../dist/station_wagons.json',import.meta.url)));
// El horario publicado es lo que corre la aplicación: sin él el banco mediría un motor que ya no es el vigente.
data.schedule=JSON.parse(fs.readFileSync(new URL('../dist/schedule.json',import.meta.url)));
// La velocidad medida por trecho también: sin ella el banco mediría el crucero plano que se retiró.
data.speed_profiles=JSON.parse(fs.readFileSync(new URL('../dist/speed_profiles.json',import.meta.url)));
// El estrés apaga el horario publicado a propósito: con él, los intervalos de 2 y 3 min solo
// afectarían a los pocos servicios sin horario y la prueba dejaría de cargar el motor. Así sigue
// midiendo el mismo techo que las referencias anteriores.
const config=process.argv.includes('--stress')?{params:{peakHeadway:120,offpeakHeadway:180,demand:3,programmedDispatch:false,programmedRunning:false}}:{};
const start=performance.now(),s=new Operation(data,config),build_ms=performance.now()-start;let maxFleet=0,maxQueue=0,maxSignals=0,maxTraffic=0;const t=performance.now();for(let second=4*3600;second<24*3600;second+=60){s.seek(86400+second);maxFleet=Math.max(maxFleet,s.buses.length);maxQueue=Math.max(maxQueue,s.buses.filter(b=>b.state==='queue').length);maxSignals=Math.max(maxSignals,s.buses.filter(b=>b.state==='signal').length);maxTraffic=Math.max(maxTraffic,s.buses.filter(b=>b.state==='traffic').length);if(s.buses.some(b=>!Number.isFinite(b.s)||!Number.isFinite(b.speed)||b.load>b.capacity||b.load<0))throw Error('Invalid bus');}const sample_ms=(performance.now()-t)/1200;s.seek(86400+7*3600);const report={mode:config.params?'stress':'default',build_ms,sample_ms,maxFleet,maxQueue,maxSignals,maxTraffic,profileCache:s.motionCache.size,heap_MB:process.memoryUsage().heapUsed/1e6,stats:s.stats(),limits:'CPU engine only, not FPS. Fixed route capacities 80/160/240; 2.25 demand baseline, historical entries and estimated OD. Published departures and published stretch times where the feed has them; the synthetic rule elsewhere. Corroborated busway signals with estimated phases enabled.'};console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--save'))fs.writeFileSync(new URL('../../data/processed/operation_benchmark'+(config.params?'_stress':'')+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
