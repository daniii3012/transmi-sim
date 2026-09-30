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
import {MetricPath} from './simulation.mjs?v=20260930.18';

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

export class MetroLayer{
 constructor(scene,data,palette={}){
  this.data=data;this.group=new THREE.Group();scene.add(this.group);
  this.path=new MetricPath(data.alignment);
  this.stations=data.stations;this.timetable=metroTimetable(this.stations);
  const deck=new THREE.MeshLambertMaterial({color:palette.metroDeck||'#c9ced4'}),pier=new THREE.MeshLambertMaterial({color:palette.metroPier||'#b3b9c0'});
  // Viaducto: tablero de 9 m a 13 m de altura, con rampa desde el patio taller en los primeros 300 m.
  const z=s=>METRO.deck*Math.min(1,s/300),W=4.5,verts=[];
  for(let s=0;s<this.path.length;s+=10){
   const a=this.path.sample(s),b=this.path.sample(Math.min(this.path.length,s+10)),n=[-Math.sin(a.angle),Math.cos(a.angle)],m=[-Math.sin(b.angle),Math.cos(b.angle)];
   const za=z(s),zb=z(Math.min(this.path.length,s+10)),A=[a.xy[0]+n[0]*W,a.xy[1]+n[1]*W],B=[a.xy[0]-n[0]*W,a.xy[1]-n[1]*W],C=[b.xy[0]+m[0]*W,b.xy[1]+m[1]*W],D=[b.xy[0]-m[0]*W,b.xy[1]-m[1]*W];
   for(const [p,q,h] of [[za,zb,0],[za-1.6,zb-1.6,0]])verts.push(A[0],A[1],p,B[0],B[1],p,C[0],C[1],q,C[0],C[1],q,B[0],B[1],p,D[0],D[1],q);
   for(const [P,Q] of [[A,C],[B,D]])verts.push(P[0],P[1],za,Q[0],Q[1],zb,P[0],P[1],za-1.6,P[0],P[1],za-1.6,Q[0],Q[1],zb,Q[0],Q[1],zb-1.6);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();
  const deckMesh=new THREE.Mesh(g,deck);deckMesh.material.side=THREE.DoubleSide;this.group.add(deckMesh);
  // El trazado como una línea roja por encima de todo: de lejos el tablero no se distingue.
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(data.alignment.map(p=>new THREE.Vector3(p[0],p[1],METRO.deck+.5))),new THREE.LineBasicMaterial({color:palette.metroLine||'#d4252f',depthTest:false,transparent:true,opacity:.9}));
  line.renderOrder=9;this.group.add(line);
  // Pilas cada 35 m bajo el tablero.
  const piers=[];for(let s=300;s<this.path.length;s+=35)piers.push(this.path.sample(s));
  const box=new THREE.BoxGeometry(1,1,1);box.translate(0,0,.5);
  const pm=new THREE.InstancedMesh(box,pier,piers.length),o=new THREE.Object3D();
  piers.forEach((p,i)=>{o.position.set(p.xy[0],p.xy[1],0);o.rotation.set(0,0,p.angle);o.scale.set(2.2,3.2,METRO.deck-1.6);o.updateMatrix();pm.setMatrixAt(i,o.matrix);});
  this.group.add(pm);
  // Estaciones: su contorno publicado, como un volumen translúcido alrededor del tablero.
  const stationMat=new THREE.MeshLambertMaterial({color:palette.metroStation||'#e2574c',transparent:true,opacity:.55,depthWrite:false});
  for(const s of this.stations){
   const pts=s.outline.slice(0,-1).map(p=>new THREE.Vector2(p[0],p[1]));if(pts.length<3)continue;
   const geo=new THREE.ExtrudeGeometry(new THREE.Shape(pts),{depth:9,bevelEnabled:false});geo.translate(0,0,METRO.deck-2);
   const mesh=new THREE.Mesh(geo,stationMat);mesh.renderOrder=8.5;this.group.add(mesh);
  }
  // Trenes: un bloque por vagón.
  this.maxTrains=64;
  const carGeo=new THREE.BoxGeometry(1,1,1);carGeo.translate(0,0,.5);
  this.cars=new THREE.InstancedMesh(carGeo,new THREE.MeshLambertMaterial({color:palette.metroTrain||'#d4252f'}),this.maxTrains*METRO.cars);
  this.cars.frustumCulled=false;this.group.add(this.cars);this.o=new THREE.Object3D();
  this.trains=[];
 }
 setVisible(v){this.group.visible=v;}
 /** Trenes en la vía a la hora `t` (segundos del día). */
 trainsAt(t){
  const tt=this.timetable,out=[];
  for(const dep of tt.departures){
   const since=t-dep;if(since<0)break;if(since>tt.oneWay)continue;
   for(const reverse of [false,true]){const s=positionAfter(since,tt.legs,reverse);if(s!=null)out.push({s,reverse,dep});}
  }
  return out;
 }
 update(t){
  if(!this.group.visible)return;
  const trains=this.trainsAt(t),o=this.o,L=METRO.trainLength/METRO.cars;let i=0;
  for(const tr of trains.slice(0,this.maxTrains)){
   for(let c=0;c<METRO.cars;c++){
    const off=(c+.5)*L*(tr.reverse?1:-1),p=this.path.sample(Math.max(0,Math.min(this.path.length,tr.s+off)));
    const lat=tr.reverse?1.9:-1.9;
    o.position.set(p.xy[0]-Math.sin(p.angle)*lat,p.xy[1]+Math.cos(p.angle)*lat,METRO.deck+.1);o.rotation.set(0,0,p.angle);o.scale.set(L-.8,METRO.width,METRO.height);o.updateMatrix();this.cars.setMatrixAt(i++,o.matrix);
   }
  }
  this.cars.count=i;this.cars.instanceMatrix.needsUpdate=true;this.trains=trains;
 }
}
