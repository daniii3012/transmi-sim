/** Aggregate, deterministic synthetic passenger demand. Not an OD survey. */
import {DAY,addDays,demandPeriod,dayType} from './calendar.mjs?v=20260930.27';
export const DEMAND_BASELINE=2.25; // User-calibrated reference; 1× means this scenario baseline.
// Con la matriz origen-destino medida, cada entrada es un viaje entero: 1× son las entradas
// registradas. Quien transborda baja en la estación de cambio y vuelve a esperar allí (transferRate),
// porque el archivo solo registra la entrada y dentro del sistema no se valida otra vez. El 2,25 se
// calibró con el descenso supuesto, más alto, y con la demanda que se perdía en las terminales.
export const demandBase=params=>params.odDemand?1:DEMAND_BASELINE;
export const EMPLOYMENT_CENTER=[6960,-300]; // Approx. Centro Internacional, projected metres; scenario assumption.
export function centrality(xy){return Math.exp(-Math.hypot(xy[0]-EMPLOYMENT_CENTER[0],xy[1]-EMPLOYMENT_CENTER[1])/6500);}
export function directionalFactor(station,angle,second){
 const hour=((second%DAY)+DAY)%DAY/3600,dx=EMPLOYMENT_CENTER[0]-station.xy[0],dy=EMPLOYMENT_CENTER[1]-station.xy[1];
 const toward=(Math.cos(angle)*dx+Math.sin(angle)*dy)/Math.max(1,Math.hypot(dx,dy));
 return hour>=6&&hour<10?1+.65*toward:hour>=16&&hour<20?1-.65*toward:1;
}
// Franjas de la matriz origen-destino (tools/build_od_matrix.py), en horas del día de servicio.
const OD_PERIODS=[['madrugada',3,6],['pico_am',6,9],['valle',9,16],['pico_pm',16,20],['noche',20,27]];
export function odPeriod(second){let h=((second%DAY)+DAY)%DAY/3600;if(h<3)h+=24;for(const [name,a,b] of OD_PERIODS)if(h>=a&&h<b)return name;return 'noche';}
/** Parte de la demanda de la estación que toma el bus en el sentido `angle`. Medida donde hay matriz
 * origen-destino: el sentido del primer tramo de los viajes enlazados, en 16 sectores. Donde no, el
 * supuesto de siempre: mitad y mitad, cargada hacia el centro de empleo en las horas pico. */
export function directionShare(station,angle,second,date){
 const hist=station.od_profile?.[dayType(date)]?.sectors?.[odPeriod(second)];
 if(hist){
  let toward=0,total=0;
  for(let k=0;k<hist.length;k++){const w=hist[k];if(!w)continue;total+=w;const cos=Math.cos((k+.5)/hist.length*2*Math.PI-angle);toward+=cos>1e-9?w:cos<-1e-9?0:w/2;}
  if(total>=50)return toward/total;
 }
 return .5*directionalFactor(station,angle,second);
}
// Parte de un histograma de 16 sectores que va en el sentido `angle` (la mitad del sector de costado).
function sectorShare(hist,angle){
 let toward=0,total=0;
 for(let k=0;k<hist.length;k++){const w=hist[k];if(!w)continue;total+=w;const cos=Math.cos((k+.5)/hist.length*2*Math.PI-angle);toward+=cos>1e-9?w:cos<-1e-9?0:w/2;}
 return total>0?toward/total:.5;
}
/** Quien cambia de servicio en la estación: se bajó de un bus y espera el siguiente, aunque no haya
 * validado. Viajes por día en la franja (od_profiles.json, `transfer`) repartidos en ella, en el
 * sentido de su segundo tramo. Sin perfil medido no hay transbordo aparte: el viaje sigue de largo. */
export function transferRate(station,angle,time,date){
 const od=station.od_profile?.[dayType(date)],period=odPeriod(time),n=od?.transfer?.[period];if(!n)return 0;
 const [,a,b]=OD_PERIODS.find(p=>p[0]===period);
 return n/((b-a)*3600)*sectorShare(od.transfer_sectors?.[period]||[],angle);
}
/** Cuántos de los servicios que paran en la estación le sirven, en promedio, a quien espera en el
 * sentido `angle`: los que van directo hasta donde se baja o transborda (od_profiles.json,
 * `options`). Sin dato, `fallback`. Con uno o dos que sirven, cada bus se lleva poca gente de la
 * espera y el andén se llena, como en la calle. */
export function routeOptions(station,angle,time,date,fallback){
 const cells=station.od_profile?.[dayType(date)]?.options?.[odPeriod(time)];if(!cells)return fallback;
 let trips=0,weighted=0;
 for(let k=0;k<cells.length;k++){const [n,o]=cells[k];if(!n)continue;const cos=Math.cos((k+.5)/cells.length*2*Math.PI-angle),w=cos>1e-9?n:cos<-1e-9?0:n/2;trips+=w;weighted+=w*o;}
 return trips>=10?Math.max(1,weighted/trips):fallback;
}
/** Qué parte de la fila de un andén acepta el servicio `routeId`: la de los viajes para los que ese
 * servicio va directo hasta donde se bajan o transbordan (od_profiles.json, `accept`), sobre los que
 * esperan en ese andén (los que aceptan alguno de los servicios de `group`). Null sin dato: entonces
 * rige el promedio de servicios que sirven. En una estación donde en el mismo sentido salen servicios
 * hacia sitios distintos —el F51 a las Américas y el G47 al sur desde Museo Nacional—, cada bus se
 * lleva a los suyos y no un reparto parejo. */
export function routeAcceptance(station,group,routeId,time,date){
 const sets=station.od_profile?.[dayType(date)]?.accept?.[odPeriod(time)];if(!sets)return null;
 let waiting=0,mine=0;
 for(const [w,ids] of sets){let here=false,ok=false;for(const id of ids){if(group.has(id))here=true;if(id===routeId)ok=true;}if(here){waiting+=w;if(ok)mine+=w;}}
 return waiting>=10?mine/waiting:null;
}
export function arrivalRate(station,angle,time,date,params){
 const hour=((time%DAY)+DAY)%DAY/3600;if(hour<4||hour>=23.5)return 0;
 if(station.demand_profile){
  const profile=station.demand_profile,kind=dayType(date),measured=profile.hourly_by_day_type?.[kind];
  // With several days observed per type, Saturday and Sunday are measured rather than a flat
  // reduction of a weekday. The estimated factors only remain for a single-day aggregate.
  const hourly=measured||profile.hourly,dayFactor=measured?1:kind==='weekday'?1:kind==='saturday'?.7:.55;
  const observed=hourly[Math.floor(hour)]/3600,override=params.mode==='peak'?1.5:params.mode==='offpeak'?.7:1;
  return (demandBase(params)*observed*directionShare(station,angle,time,date)*dayFactor+(params.odDemand?transferRate(station,angle,time,date):0))*override*params.demand;
 }
 const central=centrality(station.xy),morning=hour<11,peak=demandPeriod(time,date,params.mode)==='peak';
 const landUse=peak?(morning?1.35-.6*central:.6+1.2*central):1;
 const weight=station.demand_weight||(/portal/i.test(station.name)?3.2:station.kind==='street'?.2:.7+central);
 // Station-direction passengers/second. Reference magnitude is configurable, not measured ridership.
 return demandBase(params)*(.035*(peak?2.3:.85)*weight*landUse*directionalFactor(station,angle,time))*params.demand;
}
// Media de la espera antes de desistir, en segundos (parámetro `abandonMinutes`): la misma para lo
// acumulado y para lo que llega. Cada pasajero es una validación, alguien que pagó y se subió a algún
// bus: casi nadie se va. Con 30 min desistía el 28 % de quien esperaba 10, y en las estaciones centrales
// de la tarde, con filas largas, se perdía justo la gente que llena los buses hacia los portales.
export const ABANDON_S=1800;
export const abandonSeconds=params=>(params?.abandonMinutes>0?params.abandonMinutes*60:ABANDON_S);
/** Pasajeros que llegan a la estación entre `start` y `end` y que siguen esperando en `end`: cada
 * tramo de 15 min se descuenta con el abandono desde su mitad. Sin ese descuento, en una parada que
 * se queda sin buses lo que llegó hasta el cierre seguía esperando toda la madrugada, y el primer bus
 * del día siguiente se lo llevaba. */
export function generatedPassengers(station,angle,start,end,baseDate,params){
 let sum=0;for(let t=start;t<end;){const next=Math.min(end,(Math.floor(t/900)+1)*900),mid=(t+next)/2,date=addDays(baseDate,Math.floor(mid/DAY));sum+=(next-t)*arrivalRate(station,angle,mid,date,params)*Math.exp(-(end-mid)/abandonSeconds(params));t=next;}return sum;
}
/** Qué parte de los que llegan en un bus que para aquí se baja. Medida donde hay matriz
 * origen-destino —viajes que terminan en la estación sobre los que llegan a ella—, salvo en las
 * paradas de calle: ahí se valida dentro del bus, fuera del archivo troncal, y la medida daría cero.
 * Donde no, el supuesto por hora y centralidad. */
export function alightFraction(station,time,date){
 if(date&&station.kind!=='street'){const measured=station.od_profile?.[dayType(date)]?.alight?.[odPeriod(time)];if(measured!=null)return measured;}
 const h=((time%DAY)+DAY)%DAY/3600,c=centrality(station.xy);return h>=6&&h<10?.08+.42*c:h>=16&&h<20?.1+.3*(1-c):.16+.15*c;
}
