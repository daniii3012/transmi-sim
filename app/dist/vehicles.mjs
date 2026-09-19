/** El tipo de bus de un servicio sale de la flota que lo atiende, no de su longitud.
 *
 * Las lecturas de posición publica la etiqueta de flota de cada vehículo y esa etiqueta separa
 * articulados, biarticulados y duales; un día de lecturas basta para ver que cada servicio usa una
 * sola familia. `tools/classify_fleet.py` deriva la tabla y `build_services.py` la adjunta a cada
 * ruta como `vehicle_profile`. Un servicio sin lecturas no recibe perfil: se dibuja con el
 * articulado de referencia y la ficha del bus lo declara estimado.
 */
const PERFILES={
 dual_articulated_electric:{kind:'dual_electric',capacity:160,length:18.5,label:'Dual articulado eléctrico'},
 biarticulated:{kind:'biarticulated',capacity:240,length:27.2,label:'Biarticulado'},
 articulated:{kind:'articulated',capacity:160,length:18.5,label:'Articulado'},
 dual:{kind:'dual',capacity:80,length:12,label:'Padrón dual'}};
const ORIGEN={published:'Tipo publicado',observed:'Flota observada en las lecturas de posición',
 observed_majority:'Flota observada, con mezcla en el día'};

export function vehicleSpec(route,params={},seed=0){
 const variation=[-5,-2,0,2,5][seed%5],perfil=route.vehicle_profile,base=PERFILES[perfil?.type];
 if(base){
  const buses=perfil.buses?` · ${perfil.buses} buses`:'';
  const capacidad=perfil.type==='dual'?', capacidad estimada':'';
  return {...base,capacity:perfil.capacity||base.capacity,
   typeSource:(ORIGEN[perfil.status]||'Tipo declarado')+buses+capacidad,speedOffset:variation};
 }
 if(route.dual)return {...PERFILES.dual,typeSource:'Asignación estimada: servicio dual sin lecturas de flota',speedOffset:variation};
 return {...PERFILES.articulated,typeSource:'Asignación estimada: servicio sin lecturas de flota',speedOffset:variation};
}
