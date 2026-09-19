// Geometry is evidence; a service's assignment to a physical stop remains estimated.
export function physicalCandidates(layout){
 if(!layout)return [];
 const stops=layout.platforms.filter(p=>p.role==='trunk_stop_position');
 if(stops.length)return stops;
 return [...layout.platforms.filter(p=>p.role==='platform_trunk'),...layout.areas.filter(p=>p.role==='station_area'&&p.axis&&p.length_m>30&&p.width_m<18)];
}
function project(path,point,lo,hi){
 let best=null;
 for(let i=1;i<path.points.length;i++){
  const start=path.cumulative[i-1],end=path.cumulative[i];if(end<lo||start>hi||end===start)continue;
  const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dy=b[1]-a[1];
  const fraction=Math.max(0,(lo-start)/(end-start),Math.min(1,(hi-start)/(end-start),((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));
  const at_m=start+(end-start)*fraction,xy=[a[0]+dx*fraction,a[1]+dy*fraction],distance=Math.hypot(xy[0]-point[0],xy[1]-point[1]);
  if(!best||distance<best.distance)best={at_m,xy,distance,angle:Math.atan2(dy,dx)};
 }
 return best;
}
export function placeVisit(route,index,layout,seed){
 const stop=route.stops[index],path=route.path,at=stop.at_m;
 const lo=Math.max(0,at-400,index?(route.stops[index-1].at_m+at)/2:0);
 const hi=Math.min(path.length,at+400,index<route.stops.length-1?(at+route.stops[index+1].at_m)/2:path.length);
 const options=[];
 for(const feature of physicalCandidates(layout)){
  const p=project(path,feature.centroid,lo,hi);if(!p||p.distance>28)continue;
  if(feature.axis){const [a,b]=feature.axis,angle=Math.atan2(b[1]-a[1],b[0]-a[0]);if(Math.abs(Math.cos(angle-p.angle))<.8)continue;}
  options.push({...p,feature,score:p.distance+Math.abs(p.at_m-at)*.015});
 }
 if(!options.length)return null;
 options.sort((a,b)=>a.score-b.score);const nearby=options.filter(o=>o.score<=options[0].score+12).sort((a,b)=>a.at_m-b.at_m);
 const chosen=nearby[seed%nearby.length];
 return {at_m:chosen.at_m,platform_id:chosen.feature.id,placement_source:chosen.feature.source,placement_estimated:true};
}
