#!/usr/bin/env node
// Puntos de control del escenario inicial, para publicarlos con la página.
//
// Quien abre el simulador a las seis de la tarde espera ver la red a las seis de la tarde, y el motor
// tiene que simular desde las 03:00 para llegar: medio minuto en un computador, más en un teléfono.
// Esta herramienta simula de antemano el día completo del escenario con que arranca la página —toda
// la red, parámetros iniciales— y guarda el estado cada hora. El worker carga el más cercano y
// simula solo lo que falta; el resultado es idéntico al de simular desde cero (lo comprueba
// app/tests/traffic.test.mjs).
//
// Los días se agrupan por la llave del escenario (Traffic.scenarioKey): todos los martes normales
// comparten la misma, así que alcanza con simular una vez cada tipo de día que aparezca en las
// próximas semanas. La salida no se versiona: la genera el flujo de Pages en cada publicación.
//
// Uso: node tools/build_day_checkpoints.mjs [--from AAAA-MM-DD] [--days 21] [--out app/dist/checkpoints]
import fs from 'node:fs';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const ROOT=new URL('../',import.meta.url),DIST=new URL('app/dist/',ROOT);
const arg=(name,fallback)=>{const x=process.argv.indexOf('--'+name);return x>0?process.argv[x+1]:fallback;};
const version=fs.readFileSync(new URL('index.html',DIST),'utf8').match(/\?v=([0-9.]+)/)[1];
const load=m=>import(new URL(`${m}?v=${version}`,DIST).href);
const [{Operation,DEFAULTS},{Guideway,Traffic,SERVICE_START},{DAY,addDays}]=await Promise.all([load('operation.mjs'),load('traffic.mjs'),load('calendar.mjs')]);

const bogotaToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const from=arg('from',bogotaToday()),days=Number(arg('days',21)),every=3600;
const out=new URL(arg('out','app/dist/checkpoints')+'/',ROOT);

// Los datos, armados igual que en app.mjs antes de pasarlos al worker.
const read=f=>JSON.parse(fs.readFileSync(new URL(f,DIST)));
const data=read('services.json');
for(const [k,f] of [['schedule','schedule.json'],['speed_profiles','speed_profiles.json'],['busway_geometry','busway_geometry.json'],['wagon_stops','wagon_stops.json'],['field_corrections','field_corrections.json'],['od_profiles','od_profiles.json'],['busway_structures','busway_structures.json'],['busway_signals','busway_signals.json'],['busway_lanes','busway_lanes.json'],['station_layouts','station_layouts.json'],['station_wagons','station_wagons.json']])data[k]=read(f);
data.demand=read('demand.json');{const profiles=new Map(data.demand.profiles.map(p=>[p.station_id,p]));for(const s of data.stations){const p=profiles.get(s.id);if(p)s.demand_profile=p;}}
const config={date:from,params:{...DEFAULTS},selection:{mode:'all'}};
const op=new Operation(data,{...config,plan:true});
const guide=new Guideway([...op.routes.values()],{lanes:data.busway_lanes,geometry:data.busway_geometry,structures:data.busway_structures});

// Un día de servicio por llave: la primera fecha en que aparece.
const scenarios=new Map();
for(let d=0;d<days;d++){
 const date=addDays(from,d),traffic=new Traffic(op,guide,date),key=traffic.scenarioKey();
 if(!scenarios.has(key))scenarios.set(key,{date,kind:traffic.kind,dates:[],traffic});
 scenarios.get(key).dates.push(date);
}
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const index={version,every,generated_at:new Date().toISOString(),from,days,scenarios:{}};
let bytes=0;
for(const [key,s] of scenarios){
 const start=performance.now(),folder=new URL(key+'/',out),times=[];fs.mkdirSync(folder);
 for(let t=SERVICE_START+every;t<SERVICE_START+DAY;t+=every){
  s.traffic.seek(t);
  const packed=zlib.gzipSync(Buffer.from(s.traffic.exportCheckpoint(t)),{level:9});
  fs.writeFileSync(new URL(`${t}.ckpt`,folder),packed);times.push(t);bytes+=packed.length;
 }
 const stats=s.traffic.stats();
 index.scenarios[key]={date:s.date,kind:s.kind,dates:s.dates,times,trips:s.traffic.trips.length,vehicles:stats.vehicles,forced:stats.forced};
 console.log(`${key} ${s.kind.padEnd(8)} ${s.date} (${s.dates.length} fechas): ${times.length} puntos, ${stats.vehicles} buses, ${((performance.now()-start)/1000).toFixed(1)} s`);
 s.traffic=null;
}
fs.writeFileSync(new URL('index.json',out),JSON.stringify(index,null,1)+'\n');
console.log(`${scenarios.size} escenarios, ${(bytes/1e6).toFixed(1)} MB en ${fileURLToPath(out)} (versión ${version})`);
