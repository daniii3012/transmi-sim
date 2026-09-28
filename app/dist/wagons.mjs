// Vagones físicos de una estación, desde el contorno que publica OpenStreetMap.
//
// En la mayoría de estaciones el contorno no es un solo polígono: son piezas, una por vagón y por
// sentido, más una pieza corta y ancha donde llega el acceso (la rampa o el puente peatonal). Con eso
// se puede saber dónde está cada vagón y en qué orden se numeran: el vagón A es el del extremo por el
// que se entra a la estación, y la letra sigue hacia el otro extremo.
//
// Para una parada de un recorrido se toman las piezas alineadas con el trazado, a su izquierda —el
// lado de las puertas en la troncal— y dentro del tramo de esa parada; las piezas largas que agrupan
// varios vagones se parten en módulos de unos 50 m. Así Ricaurte o Jiménez, con andenes sobre dos
// ejes, dan a cada recorrido los de su eje, y un biarticulado no se asigna a un vagón donde no cabe.

const ALIGN=Math.cos(25*Math.PI/180);// pieza alineada con el trazado
const SIDE=[1.5,24];                  // m a la izquierda del eje del recorrido
const MODULE=50;                      // m por vagón al partir una pieza larga
const ACCESS_MAX=16;                  // m: una pieza más corta que esto a lo largo del eje es acceso

// Eje principal, largo y ancho de un polígono, en metros.
export function pieceShape(points){
  const pts=points.length>1&&points[0][0]===points.at(-1)[0]&&points[0][1]===points.at(-1)[1]?points.slice(0,-1):points;
  let cx=0,cy=0;for(const p of pts){cx+=p[0];cy+=p[1];}cx/=pts.length;cy/=pts.length;
  let sxx=0,syy=0,sxy=0;for(const p of pts){const dx=p[0]-cx,dy=p[1]-cy;sxx+=dx*dx;syy+=dy*dy;sxy+=dx*dy;}
  const angle=.5*Math.atan2(2*sxy,sxx-syy),u=[Math.cos(angle),Math.sin(angle)];
  let lo=Infinity,hi=-Infinity,wlo=Infinity,whi=-Infinity;
  for(const p of pts){const a=(p[0]-cx)*u[0]+(p[1]-cy)*u[1],b=-(p[0]-cx)*u[1]+(p[1]-cy)*u[0];lo=Math.min(lo,a);hi=Math.max(hi,a);wlo=Math.min(wlo,b);whi=Math.max(whi,b);}
  const mid=(lo+hi)/2;
  return {center:[cx+u[0]*mid,cy+u[1]*mid],u,length:hi-lo,width:whi-wlo};
}

// Piezas de la estación: los andenes troncales cerrados y, si no hay, las piezas del contorno.
export function stationPieces(layout){
  if(!layout)return [];
  if(layout.pieces)return layout.pieces;
  const closed=f=>f.closed&&f.points.length>3;
  let source=(layout.platforms||[]).filter(p=>p.role==='platform_trunk'&&closed(p));
  if(!source.length)source=(layout.areas||[]).filter(a=>a.role==='station_area'&&closed(a));
  return layout.pieces=source.map(f=>pieceShape(f.points)).filter(p=>p.length>=4);
}

/** Vagones de una parada, en orden de la letra (A primero), con su centro y su largo; o null. */
export function visitWagons(path,atM,lo,hi,layout){
  const pieces=stationPieces(layout);if(!pieces.length)return null;
  const pose=path.sample(Math.max(0,Math.min(path.length,atM))),t=[Math.cos(pose.angle),Math.sin(pose.angle)];
  const wagons=[],access=[];
  for(const p of pieces){
    if(Math.abs(p.u[0]*t[0]+p.u[1]*t[1])<ALIGN&&p.length>ACCESS_MAX)continue;
    const hit=projectPoint(path,p.center,lo-60,hi+60);if(!hit)continue;
    const q=path.sample(hit.at_m),left=Math.cos(q.angle)*(p.center[1]-q.xy[1])-Math.sin(q.angle)*(p.center[0]-q.xy[0]);
    if(p.length<=ACCESS_MAX&&p.width>=p.length*.7){if(Math.abs(left)<30)access.push(hit.at_m);continue;}
    if(hit.at_m<lo||hit.at_m>hi||left<SIDE[0]||left>SIDE[1])continue;
    // Una pieza larga agrupa varios vagones: se parte en módulos iguales de unos 50 m.
    const parts=Math.max(1,Math.round(p.length/MODULE)),size=p.length/parts,dir=p.u[0]*t[0]+p.u[1]*t[1]>=0?1:-1;
    for(let k=0;k<parts;k++){const off=(k+.5-parts/2)*size*dir,xy=[p.center[0]+p.u[0]*off,p.center[1]+p.u[1]*off];const h=projectPoint(path,xy,lo,hi);if(h)wagons.push({xy,at_m:h.at_m,length:size});}
  }
  if(!wagons.length)return null;
  wagons.sort((a,b)=>a.at_m-b.at_m);
  // El vagón A está en el extremo por donde se entra. Sin acceso publicado se conserva la convención
  // anterior —A al occidente, o al sur en los ejes norte-sur— y la parada lo rotula como estimación.
  const first=wagons[0].at_m,last=wagons.at(-1).at_m;let fromEntrance=null;
  if(access.length){const a=access.reduce((s,x)=>s+x,0)/access.length;fromEntrance=Math.abs(a-last)<Math.abs(a-first)?'end':'start';}
  const west=Math.abs(t[0])>=Math.abs(t[1])?t[0]<0:t[1]<0;// el recorrido va hacia el occidente (o el sur)
  const reverse=fromEntrance?fromEntrance==='end':west;
  if(reverse)wagons.reverse();
  return {wagons,entrance:!!fromEntrance};
}

function projectPoint(path,point,lo,hi){
  let best=null;
  for(let i=1;i<path.points.length;i++){
    const start=path.cumulative[i-1],end=path.cumulative[i];if(end<lo||start>hi||end===start)continue;
    const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dy=b[1]-a[1];
    const f=Math.max(Math.max(0,(lo-start)/(end-start)),Math.min(Math.min(1,(hi-start)/(end-start)),((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));
    const x=a[0]+dx*f,y=a[1]+dy*f,d=Math.hypot(x-point[0],y-point[1]);
    if(!best||d<best.distance)best={at_m:start+(end-start)*f,distance:d};
  }
  return best&&best.distance<40?best:null;
}
