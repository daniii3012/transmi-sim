/** Civil Bogotá calendar. UTC is used only as arithmetic over local date labels. */
export const DAY=86400;
export function dateNumber(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Fecha inválida');const n=Date.parse(date+'T00:00:00Z')/1000;if(!Number.isFinite(n)||new Date(n*1000).toISOString().slice(0,10)!==date)throw new Error('Fecha inválida');return n;}
export function addDays(date,n){return new Date((dateNumber(date)+n*DAY)*1000).toISOString().slice(0,10);}
export function easter(year){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
const holidaysCache=new Map();
export function holidays(year){
 if(holidaysCache.has(year))return holidaysCache.get(year);
 const set=new Set(),fixed=md=>`${year}-${md}`,monday=date=>addDays(date,(8-new Date(date+'T12:00:00Z').getUTCDay())%7);
 for(const md of ['01-01','05-01','07-20','08-07','12-08','12-25'])set.add(fixed(md));
 for(const md of ['01-06','03-19','06-29','08-15','10-12','11-01','11-11'])set.add(monday(fixed(md)));
 const e=easter(year);for(const n of [-3,-2])set.add(addDays(e,n));for(const n of [39,60,68])set.add(monday(addDays(e,n)));
 holidaysCache.set(year,set);return set;
}
export function dayType(date){const weekday=new Date(date+'T12:00:00Z').getUTCDay();return weekday===0||holidays(Number(date.slice(0,4))).has(date)?'holiday':weekday===6?'saturday':'weekday';}
export function dayMatches(code,date){const kind=dayType(date);return code==='L-D'||(kind==='holiday'?code==='D-F':kind==='saturday'?['S','L-S'].includes(code):['L-V','L-S'].includes(code));}
export function validityState(r,date){if(r.valid_from&&date<r.valid_from)return 'future';if(r.valid_until&&date>r.valid_until)return 'expired';return 'current';}
export function dateEligible(r,date){return validityState(r,date)==='current';}
export function mergeWindows(windows){const out=[];for(const [a,b] of windows.sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;}
export function subtractWindows(windows,blocks){let out=windows;for(const [x,y] of blocks)out=out.flatMap(([a,b])=>y<=a||x>=b?[[a,b]]:[[a,Math.min(x,b)],[Math.max(y,a),b]].filter(([c,d])=>d>c));return out;}
// beyondValidity keeps a service running past its published validity window using its last published
// calendar. The window itself is never rewritten; the interface states the published dates instead.
export function serviceWindows(route,date,routes,{beyondValidity=false}={}){
 const usable=r=>r.ready&&(beyondValidity||dateEligible(r,date));
 if(!usable(route))return [];
 let windows=mergeWindows(route.calendar.filter(h=>dayMatches(h.days,date)).map(h=>[h.start,h.end]));
 const peers=routes.filter(r=>usable(r)&&r.family===route.family);
 // Only explicit D-F variants may override regular departures. Ambiguous variants stay pending in the importer.
 if(route.variant==='regular'){
  const blocks=peers.filter(r=>r.variant==='ciclovia').flatMap(r=>r.calendar.filter(h=>dayMatches(h.days,date)).map(h=>[h.start,h.end]));
  windows=subtractWindows(windows,blocks);
 }
 const newer=peers.filter(r=>r.variant===route.variant&&r.valid_from>route.valid_from);
 if(newer.length)windows=subtractWindows(windows,newer.flatMap(r=>r.calendar.filter(h=>dayMatches(h.days,date)).map(h=>[h.start,h.end])));
 return windows;
}
// El horario publicado trae su propio calendario: banderas por día de la semana, vigencia y fechas
// añadidas o retiradas una a una. Los festivos colombianos vienen ahí como excepciones, así que se
// resuelve sobre la fecha real y no se traduce a los tres tipos de día del proyecto: traducir
// perdería precisamente los días que el operador trata aparte.
export function gtfsServices(schedule,date){
 const tag=date.replace(/-/g,''),weekday=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
 const out=new Set();
 for(const [id,calendar] of Object.entries(schedule?.calendar||{})){
  const exception=schedule.exceptions?.[id];
  if(exception?.added?.includes(tag)){out.add(id);continue;}
  if(exception?.removed?.includes(tag))continue;
  if(tag>=calendar.start&&tag<=calendar.end&&calendar.days[weekday])out.add(id);
 }
 return out;
}
// Las salidas de un servicio ese día, o null si no hay horario publicado para él. Null y lista
// vacía significan cosas distintas: sin horario se recurre a la regla sintética; con horario y sin
// salidas, ese día no opera.
export function programmedDepartures(schedule,routeId,active){
 const entry=schedule?.routes?.[routeId];
 if(!entry)return null;
 const out=[];
 for(const [service,list] of Object.entries(entry.departures))if(active.has(service))out.push(...list);
 return out.sort((a,b)=>a-b);
}
export function demandPeriod(second,date,mode='auto'){
 if(mode==='peak'||mode==='offpeak')return mode;
 const h=((second%DAY)+DAY)%DAY/3600;
 return dayType(date)==='weekday'&&((h>=6&&h<9)||(h>=16&&h<20))?'peak':'offpeak';
}
