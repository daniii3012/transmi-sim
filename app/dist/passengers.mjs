/** Aggregate, deterministic synthetic passenger demand. Not an OD survey. */
import {DAY,addDays,demandPeriod,dayType} from './calendar.mjs?v=20260913.3';
export const DEMAND_BASELINE=2.25; // User-calibrated reference; 1× means this scenario baseline.
export const EMPLOYMENT_CENTER=[6960,-300]; // Approx. Centro Internacional, projected metres; scenario assumption.
export function centrality(xy){return Math.exp(-Math.hypot(xy[0]-EMPLOYMENT_CENTER[0],xy[1]-EMPLOYMENT_CENTER[1])/6500);}
export function directionalFactor(station,angle,second){
 const hour=((second%DAY)+DAY)%DAY/3600,dx=EMPLOYMENT_CENTER[0]-station.xy[0],dy=EMPLOYMENT_CENTER[1]-station.xy[1];
 const toward=(Math.cos(angle)*dx+Math.sin(angle)*dy)/Math.max(1,Math.hypot(dx,dy));
 return hour>=6&&hour<10?1+.65*toward:hour>=16&&hour<20?1-.65*toward:1;
}
export function arrivalRate(station,angle,time,date,params){
 const hour=((time%DAY)+DAY)%DAY/3600;if(hour<4||hour>=23.5)return 0;
 if(station.demand_profile){
  const profile=station.demand_profile,kind=dayType(date),measured=profile.hourly_by_day_type?.[kind];
  // With several days observed per type, Saturday and Sunday are measured rather than a flat
  // reduction of a weekday. The estimated factors only remain for a single-day aggregate.
  const hourly=measured||profile.hourly,dayFactor=measured?1:kind==='weekday'?1:kind==='saturday'?.7:.55;
  const observed=hourly[Math.floor(hour)]/3600,override=params.mode==='peak'?1.5:params.mode==='offpeak'?.7:1;
  return DEMAND_BASELINE*observed*.5*directionalFactor(station,angle,time)*dayFactor*override*params.demand;
 }
 const central=centrality(station.xy),morning=hour<11,peak=demandPeriod(time,date,params.mode)==='peak';
 const landUse=peak?(morning?1.35-.6*central:.6+1.2*central):1;
 const weight=station.demand_weight||(/portal/i.test(station.name)?3.2:station.kind==='street'?.2:.7+central);
 // Station-direction passengers/second. Reference magnitude is configurable, not measured ridership.
 return DEMAND_BASELINE*(.035*(peak?2.3:.85)*weight*landUse*directionalFactor(station,angle,time))*params.demand;
}
export function generatedPassengers(station,angle,start,end,baseDate,params){
 let sum=0;for(let t=start;t<end;){const next=Math.min(end,(Math.floor(t/900)+1)*900),mid=(t+next)/2,date=addDays(baseDate,Math.floor(mid/DAY));sum+=(next-t)*arrivalRate(station,angle,mid,date,params);t=next;}return sum;
}
export function alightFraction(station,time){const h=((time%DAY)+DAY)%DAY/3600,c=centrality(station.xy);return h>=6&&h<10?.08+.42*c:h>=16&&h<20?.1+.3*(1-c):.16+.15*c;}
