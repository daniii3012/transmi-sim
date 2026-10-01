// Metro de Bogotá, Línea 1 (proyecto): viaducto, estaciones y trenes con una operación estimada.
//
// La geometría es la publicada por la Empresa Metro de Bogotá (datos abiertos, CC BY 4.0; ver
// tools/build_metro.py). La operación no está publicada salvo el intervalo inicial (140 s), la
// velocidad máxima (80 km/h) y la comercial (42,5 km/h): el horario, el intervalo fuera de la punta y
// la parada son estimados y se rotulan como tales. Con aceleración de 1 m/s², 80 km/h de máxima y 35 s
// de parada, la velocidad comercial entre Gibraltar y Calle 72 sale en la publicada.
//
// Los trenes no pasan por el motor de carriles: van por vía propia, sin cruces ni colas, así que su
// posición a cualquier hora se calcula directamente del horario. Es reproducible hacia atrás y hacia
// adelante, como todo el simulador.
import * as THREE from './vendor/three.module.js';
import {MetricPath} from './simulation.mjs?v=20260930.36';

export const METRO=Object.freeze({deck:13,accel:1,brake:1,vmax:80/3.6,dwell:35,turnaround:180,peak:140,offpeak:240,
 start:4.5*3600,end:23*3600,trainLength:135,cars:6,width:3,height:3.8,capacity:1800});
const PEAKS=[[5.5*3600,9*3600],[16.5*3600,19.5*3600]];

/** Tiempo de marcha entre dos paradas separadas `d` metros: trapecio o triángulo. */
export function runTime(d,{accel,brake,vmax}=METRO){
 const da=vmax*vmax/(2*accel),db=vmax*vmax/(2*brake);
 if(d>=da+db)return vmax/accel+vmax/brake+(d-da-db)/vmax;
 const v=Math.sqrt(2*d*accel*brake/(accel+brake));return v/accel+v/brake;
}
/** Distancia recorrida `t` segundos después de arrancar, en un tramo de `d` metros. */
function runDistance(t,d,{accel,brake,vmax}=METRO){
 const T=runTime(d),da=vmax*vmax/(2*accel),db=vmax*vmax/(2*brake);
 let v=vmax,ta=vmax/accel,tb=vmax/brake;
 if(d<da+db){v=Math.sqrt(2*d*accel*brake/(accel+brake));ta=v/accel;tb=v/brake;}
 if(t<=0)return 0;if(t>=T)return d;
 if(t<ta)return accel*t*t/2;
 if(t<T-tb)return v*ta/2+v*(t-ta);
 const r=T-t;return d-brake*r*r/2;
}
export const headwayAt=t=>PEAKS.some(([a,b])=>t>=a&&t<b)?METRO.peak:METRO.offpeak;

/** El horario estimado del día: salidas desde cada extremo y el perfil de cada sentido. */
export function metroTimetable(stations){
 const at=stations.map(s=>s.at_m),legs=[];
 for(let i=1;i<at.length;i++)legs.push({from:at[i-1],d:at[i]-at[i-1],run:runTime(at[i]-at[i-1])});
 const oneWay=legs.reduce((s,l)=>s+l.run+METRO.dwell,0)-METRO.dwell;
 const departures=[];for(let t=METRO.start;t<=METRO.end;t+=headwayAt(t))departures.push(t);
 const cycle=2*oneWay+2*METRO.turnaround;
 const peakTrains=Math.ceil(cycle/METRO.peak);
 return {legs,oneWay,departures,cycle,peakTrains,commercialKmh:(at.at(-1)-at[0])/oneWay*3.6};
}

/** Abscisa de un tren `t` segundos después de salir de su extremo; null si ya llegó. */
function positionAfter(t,legs,reverse){
 const seq=reverse?[...legs].reverse():legs;let clock=0;
 for(let i=0;i<seq.length;i++){
  const l=seq[i];
  if(t<clock+l.run){const x=runDistance(t-clock,l.d);return reverse?l.from+l.d-x:l.from+x;}
  clock+=l.run;
  if(i<seq.length-1&&t<clock+METRO.dwell)return reverse?l.from:l.from+l.d;
  clock+=METRO.dwell;
 }
 return null;
}

// Un vagón es un cuerpo rígido entre sus dos bogies: su centro va en la cuerda entre los dos puntos
// del trazado y su rumbo es el de esa cuerda. Antes cada vagón tomaba el rumbo del tramo del trazado
// donde caía su centro, y el trazado publicado trae vértices a 20 cm: al arrancar los vagones se
// torcían de a saltos. `dir` es 1 hacia Calle 72 y −1 hacia Gibraltar; el tren va por la vía de la
// derecha de su marcha, a 1,9 m del eje.
const CAR=METRO.trainLength/METRO.cars,GAP=.8,TRACK=1.9;
function carsOf(path,front,dir,z,emit){
 for(let c=0;c<METRO.cars;c++){
  const a=path.sample(front-dir*c*CAR).xy,b=path.sample(front-dir*((c+1)*CAR-GAP)).xy,ang=Math.atan2(a[1]-b[1],a[0]-b[0]);
  const x=(a[0]+b[0])/2+Math.sin(ang)*TRACK,y=(a[1]+b[1])/2-Math.cos(ang)*TRACK;
  emit(x,y,typeof z==='function'?z(front-dir*(c+.5)*CAR):z,ang,Math.hypot(a[0]-b[0],a[1]-b[1]));
 }
}

export class MetroLayer{
 constructor(scene,data,palette={}){
  this.data=data;this.group=new THREE.Group();scene.add(this.group);
  this.path=new MetricPath(data.alignment);
  this.stations=data.stations;this.timetable=metroTimetable(this.stations);
  const deck=new THREE.MeshLambertMaterial({color:palette.metroDeck||'#c9ced4'}),pier=new THREE.MeshLambertMaterial({color:palette.metroPier||'#b3b9c0'});
  // Viaducto: tablero de 9 m a 13 m de altura, con rampa desde el patio taller en los primeros 300 m.
  const z=this.deckZ=s=>METRO.deck*Math.max(0,Math.min(1,s/300)),W=4.5,verts=[];
  for(let s=0;s<this.path.length;s+=10){
   const a=this.path.sample(s),b=this.path.sample(Math.min(this.path.length,s+10)),n=[-Math.sin(a.angle),Math.cos(a.angle)],m=[-Math.sin(b.angle),Math.cos(b.angle)];
   const za=z(s),zb=z(Math.min(this.path.length,s+10)),A=[a.xy[0]+n[0]*W,a.xy[1]+n[1]*W],B=[a.xy[0]-n[0]*W,a.xy[1]-n[1]*W],C=[b.xy[0]+m[0]*W,b.xy[1]+m[1]*W],D=[b.xy[0]-m[0]*W,b.xy[1]-m[1]*W];
   for(const [p,q] of [[za,zb],[za-1.6,zb-1.6]])verts.push(A[0],A[1],p,B[0],B[1],p,C[0],C[1],q,C[0],C[1],q,B[0],B[1],p,D[0],D[1],q);
   for(const [P,Q] of [[A,C],[B,D]])verts.push(P[0],P[1],za,Q[0],Q[1],zb,P[0],P[1],za-1.6,P[0],P[1],za-1.6,Q[0],Q[1],zb,Q[0],Q[1],zb-1.6);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();
  const deckMesh=new THREE.Mesh(g,deck);deckMesh.material.side=THREE.DoubleSide;this.group.add(deckMesh);
  // El trazado como una línea roja por encima de todo: de lejos el tablero no se distingue.
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(data.alignment.map((p,i)=>new THREE.Vector3(p[0],p[1],METRO.deck+.5))),new THREE.LineBasicMaterial({color:palette.metroLine||'#d4252f',depthTest:false,transparent:true,opacity:.9}));
  line.renderOrder=9;this.group.add(line);
  // Pilas cada 35 m bajo el tablero.
  const piers=[];for(let s=300;s<this.path.length;s+=35)piers.push(this.path.sample(s));
  const box=new THREE.BoxGeometry(1,1,1);box.translate(0,0,.5);
  const pm=new THREE.InstancedMesh(box,pier,piers.length),o=new THREE.Object3D();
  piers.forEach((p,i)=>{o.position.set(p.xy[0],p.xy[1],0);o.rotation.set(0,0,p.angle);o.scale.set(2.2,3.2,METRO.deck-1.6);o.updateMatrix();pm.setMatrixAt(i,o.matrix);});
  this.group.add(pm);
  // Estaciones en tres pisos, como en los planos de la Empresa Metro: el de ingreso (segundo piso) bajo
  // el tablero, la plataforma con sus dos andenes laterales a la altura del viaducto y la cubierta.
  // El contorno es el publicado; las alturas de cada piso son estimadas. Los edificios de acceso y sus
  // puentes salen del plano de ubicación de cada estación (tools/build_metro.py).
  const mat=(color,opacity=1,extra={})=>new THREE.MeshLambertMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity>=1,...extra});
  const concourse=mat(palette.metroConcourse||'#d9dee3',.85),roof=mat(palette.metroRoof||'#e2574c',.45,{side:THREE.DoubleSide}),glass=mat(palette.metroGlass||'#9fc3d9',.18,{side:THREE.DoubleSide});
  const platform=mat(palette.metroPlatform||'#eef1f4'),access=mat(palette.metroAccess||'#efc58f'),bridge=mat(palette.metroBridge||'#c9ced4',.8);
  const prism=(pts,z0,z1,material,order=4.6)=>{const shape=new THREE.Shape(pts.map(p=>new THREE.Vector2(p[0],p[1])));const g=new THREE.ExtrudeGeometry(shape,{depth:z1-z0,bevelEnabled:false});g.translate(0,0,z0);const m=new THREE.Mesh(g,material);m.renderOrder=order;this.group.add(m);return m;};
  const ring=pts=>pts.length>1&&pts[0][0]===pts.at(-1)[0]&&pts[0][1]===pts.at(-1)[1]?pts.slice(0,-1):pts;
  for(const s of this.stations){
   const pts=ring(s.outline);if(pts.length<3)continue;
   // El rectángulo de la estación: eje, largo y ancho del contorno publicado.
   let best=null;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!best||L>best.L)best={L,u:[(b[0]-a[0])/L,(b[1]-a[1])/L]};}
   const u=best.u,v=[-u[1],u[0]],c=[pts.reduce((x,p)=>x+p[0],0)/pts.length,pts.reduce((x,p)=>x+p[1],0)/pts.length];
   const proj=pts.map(p=>[(p[0]-c[0])*u[0]+(p[1]-c[1])*u[1],(p[0]-c[0])*v[0]+(p[1]-c[1])*v[1]]),L=Math.max(...proj.map(p=>p[0]))-Math.min(...proj.map(p=>p[0])),W=Math.max(...proj.map(p=>p[1]))-Math.min(...proj.map(p=>p[1]));
   const box=(along,across,dl,dw)=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sa,sb])=>[c[0]+u[0]*(along+sa*dl/2)+v[0]*(across+sb*dw/2),c[1]+u[1]*(along+sa*dl/2)+v[1]*(across+sb*dw/2)]);
   prism(pts,6.5,10.5,concourse);
   // Andenes laterales: a cada lado de las dos vías (a 1,9 m del eje), de 4 m.
   for(const side of [-1,1])prism(box(0,side*(1.9+1.6+2),L-6,4),METRO.deck,METRO.deck+1.05,platform,4.65);
   prism(box(0,0,L+2,W+2),19.5,20.2,roof,8.4);
   for(const side of [-1,1])prism(box(0,side*(W/2+.9),L,.2),METRO.deck+1,19.5,glass,8.3);
   for(const a of s.access||[]){const q=ring(a.outline);if(q.length<3)continue;prism(q,a.z0,a.z1,a.kind==='puente'?bridge:access,a.kind==='puente'?8.2:4.7);}
  }
  this.slots=this.buildDepot(data.depot,palette);
  // Trenes: un bloque por vagón, los de la vía y los guardados en el patio.
  this.maxTrains=64;
  const carGeo=new THREE.BoxGeometry(1,1,1);carGeo.translate(0,0,.5);
  this.cars=new THREE.InstancedMesh(carGeo,new THREE.MeshLambertMaterial({color:palette.metroTrain||'#d4252f'}),(this.maxTrains+this.slots.length)*METRO.cars);
  this.cars.frustumCulled=false;this.group.add(this.cars);this.o=new THREE.Object3D();
  this.trains=[];this.parked=0;
 }
 /** Patio taller El Corzo (OpenStreetMap): su terreno, sus vías y sus naves con altura estimada.
  *  Devuelve los cupos donde se guardan los trenes que no están en la vía: dos por vía de patio. */
 buildDepot(depot,palette){
  if(!depot)return [];
  const ground=new THREE.Shape(depot.outline.slice(0,-1).map(p=>new THREE.Vector2(p[0],p[1])));
  const area=new THREE.Mesh(new THREE.ShapeGeometry(ground),new THREE.MeshBasicMaterial({color:palette.metroYard||'#d9dde2',depthWrite:false,transparent:true,opacity:.85}));
  area.position.z=.02;area.renderOrder=.13;this.group.add(area);
  const rails=[];for(const t of depot.tracks)for(let i=1;i<t.points.length;i++)rails.push(...t.points[i-1],.05,...t.points[i],.05);
  const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(rails,3));
  const rl=new THREE.LineSegments(rg,new THREE.LineBasicMaterial({color:palette.metroRail||'#8b96a1'}));rl.renderOrder=.14;this.group.add(rl);
  const shed=new THREE.MeshLambertMaterial({color:palette.metroShed||'#cfd5db',transparent:true,opacity:.6,depthWrite:false,side:THREE.DoubleSide});
  const solid=new THREE.MeshLambertMaterial({color:palette.metroOffice||'#dfe3e7'});
  for(const b of depot.buildings){
   const pts=b.outline.slice(0,-1).map(p=>new THREE.Vector2(p[0],p[1]));if(pts.length<3)continue;
   // Una nave es una cubierta sobre las vías: se ve a través, como los puentes.
   const geo=new THREE.ExtrudeGeometry(new THREE.Shape(pts),{depth:b.roof?1.2:b.height_m,bevelEnabled:false});if(b.roof)geo.translate(0,0,b.height_m-1.2);
   const mesh=new THREE.Mesh(geo,b.roof?shed:solid);mesh.renderOrder=b.roof?8.3:4.7;this.group.add(mesh);
  }
  const slots=[];
  for(const t of depot.tracks){
   const path=new MetricPath(t.points);if(path.length<METRO.trainLength+20||path.length>700)continue;
   for(let k=0;k<2&&(k+1)*(METRO.trainLength+15)+5<=path.length;k++)slots.push({path,front:path.length-5-k*(METRO.trainLength+15)});
  }
  return slots;
 }
 setVisible(v){this.group.visible=v;}
 /** Trenes en la vía a la hora `t` (segundos del día). */
 trainsAt(t){
  const tt=this.timetable,out=[];
  for(const dep of tt.departures){
   const since=t-dep;if(since<0)break;if(since>tt.oneWay)continue;
   for(const reverse of [false,true]){const s=positionAfter(since,tt.legs,reverse);if(s!=null)out.push({id:`${dep}:${reverse?'s':'n'}`,s,reverse,dep,speed:Math.abs((positionAfter(since+1,tt.legs,reverse)??s)-s)});}
  }
  return out;
 }
 /** Dónde va un tren: detenido en una estación o entre dos, y la siguiente. */
 describe(tr){
  const at=this.stations.map(s=>s.at_m),dir=tr.reverse?-1:1;
  const here=this.stations.find(s=>Math.abs(s.at_m-tr.s)<1&&tr.speed<.05);
  const next=dir>0?this.stations.find(s=>s.at_m>tr.s+1):[...this.stations].reverse().find(s=>s.at_m<tr.s-1);
  return {here,next,toward:dir>0?this.stations.at(-1):this.stations[0],from:dir>0?this.stations[0]:this.stations.at(-1),at};
 }
 update(t){
  if(!this.group.visible)return;
  const trains=this.trainsAt(t).slice(0,this.maxTrains),o=this.o;let i=0;
  const emit=(x,y,z,ang,len)=>{o.position.set(x,y,z);o.rotation.set(0,0,ang);o.scale.set(len,METRO.width,METRO.height);o.updateMatrix();this.cars.setMatrixAt(i++,o.matrix);};
  for(const tr of trains){
   // La abscisa del horario es el centro del tren: en la estación queda centrado en el andén.
   const dir=tr.reverse?-1:1,front=tr.s+dir*METRO.trainLength/2,first=i;
   carsOf(this.path,front,dir,s=>this.deckZ(s)+.1,emit);
   const m=new THREE.Matrix4(),p=new THREE.Vector3();this.cars.getMatrixAt(first+METRO.cars/2,m);p.setFromMatrixPosition(m);
   tr.xy=[p.x,p.y];tr.z=p.z+METRO.height/2;tr.angle=Math.atan2(dir*Math.sin(this.path.sample(tr.s).angle),dir*Math.cos(this.path.sample(tr.s).angle));
  }
  // Los que no están en la vía duermen en el patio: 30 trenes publicados.
  const parked=Math.max(0,Math.min(this.slots.length,(this.data.operation?.published?.trains||30)-trains.length));
  for(let k=0;k<parked;k++)carsOf(this.slots[k].path,this.slots[k].front,1,.1,emit);
  this.cars.count=i;this.cars.instanceMatrix.needsUpdate=true;this.trains=trains;this.parked=parked;
  // Para tocar un tren en el mapa: un punto por vagón, a la altura del techo.
  this.samples=[];for(const tr of trains)for(let c=0;c<METRO.cars;c++){const s=tr.s+(tr.reverse?-1:1)*(METRO.trainLength/2-(c+.5)*CAR),p=this.path.sample(s).xy;this.samples.push({id:tr.id,xy:[p[0],p[1],this.deckZ(s)+METRO.height]});}
 }
}
