#!/usr/bin/env node
// Huella del motor: lo que decide el estado de la simulación en un instante dado.
//
// Los puntos de control guardados solo sirven si el motor que los restaura llega exactamente al mismo
// estado que simulando desde cero. Hasta ahora se ligaban a la versión `?v=` de la página, que sube
// con cualquier cambio —un color, un texto del panel— y dejaba inservibles los precalculados: el
// navegador volvía a simular el día desde las 03:00 (minutos en un teléfono).
//
// La huella cubre los módulos del motor y los datos que entran a la simulación. Al texto de los
// módulos se le quita la cadena `?v=`, que cambia sin que cambie el comportamiento. La interfaz, el
// mapa y los estilos quedan fuera. app/tests/engine.test.mjs falla si `app/dist/engine.json` no
// coincide con los archivos: hay que volver a correr esta herramienta tras tocar el motor o los datos.
//
// Uso: node tools/engine_fingerprint.mjs          # escribe app/dist/engine.json
//      node tools/engine_fingerprint.mjs --check  # solo compara; sale con 1 si difiere
import fs from 'node:fs';
import crypto from 'node:crypto';

export const ENGINE_MODULES=['calendar.mjs','checkpoints.mjs','operation.mjs','passengers.mjs','signals.mjs','simulation.mjs','station-layouts.mjs','traffic.mjs','travel.mjs','vehicles.mjs','wagons.mjs','worker.mjs'];
export const ENGINE_DATA=['services.json','schedule.json','speed_profiles.json','demand.json','busway_geometry.json','wagon_stops.json','field_corrections.json','od_profiles.json','busway_structures.json','busway_signals.json','busway_lanes.json','station_layouts.json','station_wagons.json'];

export function fingerprint(dist=new URL('../app/dist/',import.meta.url)){
 const h=crypto.createHash('sha256');
 for(const f of ENGINE_MODULES){h.update(f+'\0');h.update(fs.readFileSync(new URL(f,dist),'utf8').replace(/\?v=[0-9.]+/g,''));}
 for(const f of ENGINE_DATA){h.update(f+'\0');h.update(fs.readFileSync(new URL(f,dist)));}
 return h.digest('hex').slice(0,16);
}

if(import.meta.url===`file://${process.argv[1]}`){
 const dist=new URL('../app/dist/',import.meta.url),file=new URL('engine.json',dist),engine=fingerprint(dist);
 const current=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).engine:null;
 if(process.argv.includes('--check')){
  if(current!==engine){console.error(`engine.json dice ${current}; los archivos dan ${engine}. Correr node tools/engine_fingerprint.mjs`);process.exit(1);}
  console.log(`Huella del motor al día: ${engine}`);
 }else{
  fs.writeFileSync(file,JSON.stringify({engine,modules:ENGINE_MODULES,data:ENGINE_DATA},null,1)+'\n');
  console.log(`${current===engine?'Sin cambios':'Nueva huella'}: ${engine}`);
 }
}
