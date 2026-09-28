import {MetricPath} from './simulation.mjs?v=20260929.5';
import {signalPhase,signalClusters,SIGNAL_CYCLE} from './signals.mjs?v=20260929.5';
import * as THREE from './vendor/three.module.js';
import {pieceShape} from './wagons.mjs?v=20260929.5';

// Cámara en perspectiva sobre el plano de la ciudad, en metros, con z hacia arriba. Mirando recto
// hacia abajo se ve igual que el mapa 2D de siempre; inclinada, es la vista 3D. El estado de la
// cámara es el punto que mira, la distancia, la inclinación desde la vertical y el rumbo.
const FOV=35,TAN=Math.tan(FOV/2*Math.PI/180),TILT_3D=56*Math.PI/180,MAX_TILT=72*Math.PI/180;
const LANE=3.4,BUS_WIDTH=2.55,BUS_HEIGHT=3.25,CELL_M=5;
// Cuerpos de cada tipo de bus, del frente hacia atrás: el articulado dobla en una rótula y el
// biarticulado en dos. Así los volúmenes siguen la curva en vez de atravesarla.
const BODIES={12:[12],18.5:[10.9,7.3],27.2:[9.8,8.4,8.4]};
const JOINT=.3;
const PALETTE={
 light:{crowd:'#dc253b',depot:'#dfe4e9',parked:'#c7343f',clear:'#edf1f4',park:'#d4e3d8',water:'#c5dce8',road:'#ffffff',waterLine:'#b6d5e4',bridge:'#c1cbd5',asphalt:'#c9d1d9',berth:'#bcc6cf',laneMark:'#ffffff',platform:'#f7f9fb',platformEdge:'#8a9dac',roof:'#9fb1c1',building:'#d9dfe5',stopInner:'#ffffff'},
 dark:{crowd:'#ef3b52',depot:'#1c2835',parked:'#a8323c',clear:'#131d28',park:'#1d3530',water:'#1d3547',road:'#2b3947',waterLine:'#35596c',bridge:'#607383',asphalt:'#26333f',berth:'#2f3e4c',laneMark:'#51647a',platform:'#51667a',platformEdge:'#8aa1b5',roof:'#6f879c',building:'#233140',stopInner:'#293746'},
};

// Una tesela de edificios: paredes y techo de cada huella extruida a sus pisos, en un solo
// BufferGeometry. Formato en tools/build_buildings.py.
function buildingGeometry(buffer,ox,oy,floorHeight){
  const view=new DataView(buffer),count=view.getUint32(4,true),positions=[];let at=8;
  for(let b=0;b<count;b++){
    const floors=view.getUint8(at),n=view.getUint8(at+1);at+=2;
    const h=floors*floorHeight,ring=[];
    for(let k=0;k<n;k++){ring.push(new THREE.Vector2(ox+view.getInt16(at,true)/10,oy+view.getInt16(at+2,true)/10));at+=4;}
    for(let k=0;k<n;k++){const a=ring[k],c=ring[(k+1)%n];positions.push(a.x,a.y,0,c.x,c.y,0,c.x,c.y,h,a.x,a.y,0,c.x,c.y,h,a.x,a.y,h);}
    for(const [i,j,k] of THREE.ShapeUtils.triangulateShape(ring,[]))positions.push(ring[i].x,ring[i].y,h,ring[j].x,ring[j].y,h,ring[k].x,ring[k].y,h);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return geometry;
}
export class NetworkMap {
  constructor(host, labels, data, onSelect) {
    this.host=host;this.labels=labels;this.labelEntries=new Map();this.data=data;this.onSelect=onSelect;
    this.routeId=null;this.routeSet=new Set(data.routes.filter(r=>r.ready).map(r=>r.id));
    this.metricPaths=new Map(data.routes.filter(r=>r.ready).map(r=>[r.id,new MetricPath(r.points)]));
    this.target=[0,0];this.distance=30000;this.tilt=0;this.bearing=0;this.mpp=30;this.selected=null;this.busSamples=[];this.busColor='route';
    this.palette=PALETTE.light;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(this.palette.clear);host.append(this.renderer.domElement);
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(FOV,1,1,400000);
    // Luz suave de cielo y un sol bajo del occidente: basta para leer los volúmenes sin sombras.
    this.scene.add(new THREE.HemisphereLight('#ffffff','#8494a5',1.6));
    const sun=new THREE.DirectionalLight('#ffffff',1.4);sun.position.set(-.5,-.35,1);this.scene.add(sun);
    this.contextGroup=new THREE.Group();this.scene.add(this.contextGroup);this.paths=[];
    this.streetGroup=new THREE.Group();this.scene.add(this.streetGroup);
    for(const points of data.street_context||[]){const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p,0)));const line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#8d9aa5',dashSize:18,gapSize:12,transparent:true,opacity:.65,depthTest:true,depthWrite:false}));line.computeLineDistances();line.renderOrder=.8;this.streetGroup.add(line);}
    this.highlight=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:'#dc253b',depthTest:true,depthWrite:false,transparent:true,opacity:.95}));this.highlight.renderOrder=2;this.scene.add(this.highlight);
    this.clusterLayer=document.createElement('div');this.clusterLayer.className='clusters';host.parentElement.append(this.clusterLayer);this.clusterLayer.setAttribute('aria-hidden','true');this.clusterLayer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';
    for(const c of data.corridors.filter(c=>c.kind!=='street')){
      const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:c.color,transparent:true,opacity:c.zone==='Z'?.25:.88,depthTest:true,depthWrite:false}));
      mesh.renderOrder=1;this.scene.add(mesh);this.paths.push({c,mesh});
    }
    // Las capas del suelo no escriben profundidad —entre ellas manda el orden de dibujo— pero sí la
    // respetan: un bus, un andén o un edificio siempre las tapa, se miren de arriba o inclinadas.
    const flat=(color)=>new THREE.MeshBasicMaterial({color,depthTest:true,depthWrite:false,transparent:true});
    this.stopOuter=new THREE.InstancedMesh(new THREE.CircleGeometry(1,16),flat('#6c7c8a'),data.stations.length);
    this.stopInner=new THREE.InstancedMesh(new THREE.CircleGeometry(1,16),flat('#ffffff'),data.stations.length);
    this.stopOuter.renderOrder=2;this.stopInner.renderOrder=3;this.stopOuter.frustumCulled=false;this.stopInner.frustumCulled=false;this.scene.add(this.stopOuter,this.stopInner);
    this.marker=new THREE.Mesh(new THREE.RingGeometry(.7,1,32),flat('#dc253b'));this.marker.renderOrder=7;this.marker.visible=false;this.scene.add(this.marker);
    this.axes=new Map();for(const r of data.routes.filter(r=>r.ready)){const path=this.metricPaths.get(r.id);for(const st of r.stops){const angle=path.sample(st.at_m).angle,sum=this.axes.get(st.station_id)||[0,0];sum[0]+=Math.cos(2*angle);sum[1]+=Math.sin(2*angle);this.axes.set(st.station_id,sum);}}
    this.object=new THREE.Object3D();this.w=1;this.h=1;this.raycaster=new THREE.Raycaster();this.ground=new THREE.Plane(new THREE.Vector3(0,0,1),0);
    this.buildCarriageways();
    this.buildStationGeometry();
    this.signalsEnabled=true;const signalCount=data.busway_signals?.signals.length||0;
    if(signalCount){this.signalMesh=new THREE.InstancedMesh(new THREE.CircleGeometry(1,12),new THREE.MeshBasicMaterial({depthTest:true,depthWrite:false,transparent:true}),signalCount);this.signalMesh.frustumCulled=false;this.signalMesh.renderOrder=4.5;this.scene.add(this.signalMesh);}
    this.resizeObserver=new ResizeObserver(()=>{this.resize();});this.resizeObserver.observe(host);
    this.resize();this.fitNetwork();this.bind();
  }

  // --- Cámara -----------------------------------------------------------------------------------
  get is3D(){return this.tilt>.02;}
  forward(){return [Math.sin(this.bearing),Math.cos(this.bearing)];}
  right(){return [Math.cos(this.bearing),-Math.sin(this.bearing)];}
  // Los paneles tapan parte del lienzo, así que el centro útil no es el geométrico. El mismo
  // cálculo sirve para encuadrar y para centrar o seguir: lo que se mira tiene que caer en el
  // hueco libre y no debajo de la hoja inferior, que en el móvil se lleva media pantalla.
  insets(){
    const mobile=this.w<800,left=mobile?18:350;
    const inspector=document.querySelector('#inspector');
    const right=!mobile&&this.w>1100&&!inspector.hidden?400:60;
    const top=mobile?120:70;
    const panel=inspector.hidden?document.querySelector('#sidebar'):inspector;
    const rect=panel?.getBoundingClientRect();
    const bottom=mobile&&rect?.height?Math.max(40,this.host.getBoundingClientRect().bottom-rect.top+20):235;
    return {left,right,top,bottom};
  }
  // Cuánto hay que correr el punto mirado para que un lugar quede en medio del hueco libre. Se
  // recuerda unas décimas porque seguir un bus lo pregunta en cada fotograma.
  focusShift({fresh=false}={}){
    const now=performance.now();
    if(fresh||!this.shiftCache||now-this.shiftCache.at>200||this.shiftCache.mpp!==this.mpp||this.shiftCache.bearing!==this.bearing){
      const {left,right,top,bottom}=this.insets(),sx=-(left-right)/2*this.mpp,sy=(top-bottom)/2*this.mpp/Math.max(.35,Math.cos(this.tilt)),r=this.right(),f=this.forward();
      this.shiftCache={at:now,mpp:this.mpp,bearing:this.bearing,value:[r[0]*sx+f[0]*sy,r[1]*sx+f[1]*sy]};
    }
    return this.shiftCache.value;
  }
  get center(){return this.target;}
  set center(v){this.target=v;}
  setDistanceFromMpp(mpp){this.distance=Math.max(25,Math.min(160000,mpp*this.h/(2*TAN)));}
  focusOn(xy,mpp){if(mpp!==undefined)this.setDistanceFromMpp(mpp);this.updateMpp();const [dx,dy]=this.focusShift({fresh:true});this.target=[xy[0]+dx,xy[1]+dy];this.updateCamera();}
  fit(bounds){const {left,right,top,bottom}=this.insets();const mpp=Math.max((bounds[2]-bounds[0])/Math.max(100,this.w-left-right),(bounds[3]-bounds[1])/Math.max(100,this.h-top-bottom),.3);this.setDistanceFromMpp(mpp);this.updateMpp();const [dx,dy]=this.focusShift({fresh:true});this.target=[(bounds[0]+bounds[2])/2+dx,(bounds[1]+bounds[3])/2+dy];this.updateCamera();}
  fitNetwork(){this.fit(this.data.bounds);}
  fitPilot(){this.fitNetwork();}
  focusStation(station){const layout=this.data.station_layouts?.stations.find(s=>s.station_id===station.id);const points=layout?[...layout.platforms,...layout.areas].flatMap(p=>p.points):[];if(points.length){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);this.fit([Math.min(...xs)-45,Math.min(...ys)-45,Math.max(...xs)+45,Math.max(...ys)+45]);}else this.focusOn(station.xy,.8);}
  fitPoints(points){this.fit([Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))-80,Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))+80]);}
  resize(){this.w=this.host.clientWidth;this.h=this.host.clientHeight;if(!this.w||!this.h)return;this.renderer.setSize(this.w,this.h);this.camera.aspect=this.w/this.h;this.updateCamera();}
  updateMpp(){this.mpp=2*this.distance*TAN/Math.max(1,this.h);}
  placeCamera(){
    const f=this.forward(),d=this.distance,st=Math.sin(this.tilt),ct=Math.cos(this.tilt);
    this.camera.position.set(this.target[0]-f[0]*d*st,this.target[1]-f[1]*d*st,d*ct);
    this.camera.up.set(f[0],f[1],0);this.camera.lookAt(this.target[0],this.target[1],0);
    this.camera.near=Math.max(.5,d*.01);this.camera.far=d*(this.is3D?12:3)+5000;
    this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
  }
  worldToScreen(p){this.v3||=new THREE.Vector3();const v=this.v3.set(p[0],p[1],p[2]||0).project(this.camera);if(v.z>1)return [-1e5,-1e5];return [(v.x+1)/2*this.w,(1-v.y)/2*this.h];}
  screenToWorld(p){
    this.v2||=new THREE.Vector2();this.hit||=new THREE.Vector3();
    this.raycaster.setFromCamera(this.v2.set(p[0]/this.w*2-1,1-p[1]/this.h*2),this.camera);
    const hit=this.raycaster.ray.intersectPlane(this.ground,this.hit);
    if(hit)return [hit.x,hit.y];
    // Por encima del horizonte: el punto del suelo más lejano en esa dirección.
    const dir=this.raycaster.ray.direction,far=this.distance*6;return [this.camera.position.x+dir.x*far,this.camera.position.y+dir.y*far];
  }
  zoom(factor,anchor=[this.w/2,this.h/2]){const before=this.screenToWorld(anchor);this.distance=Math.max(25,Math.min(160000,this.distance*factor));this.updateMpp();this.placeCamera();const after=this.screenToWorld(anchor);this.target=[this.target[0]+before[0]-after[0],this.target[1]+before[1]-after[1]];this.updateCamera();}
  rotate(dBearing,dTilt){this.bearing=((this.bearing+dBearing)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);this.tilt=Math.max(0,Math.min(MAX_TILT,this.tilt+dTilt));this.mode=this.is3D?'3d':'2d';this.updateCamera();this.onView?.();}
  /** Pasa entre la vista cenital y la inclinada con una transición corta. */
  setView(mode){
    const from={tilt:this.tilt,bearing:this.bearing},to=mode==='3d'?{tilt:TILT_3D,bearing:this.is3D?this.bearing:-25*Math.PI/180}:{tilt:0,bearing:0};
    let db=to.bearing-from.bearing;db=((db+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
    this.transition={start:performance.now(),from,db,to,duration:650};this.mode=mode;
  }
  resetNorth(){const from={tilt:this.tilt,bearing:this.bearing};let db=-this.bearing;db=((db+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;this.transition={start:performance.now(),from,db,to:{tilt:this.tilt,bearing:0},duration:500};}
  stepTransition(now){
    const t=this.transition;if(!t)return;const u=Math.min(1,(now-t.start)/t.duration),e=u<.5?2*u*u:1-(-2*u+2)**2/2;
    this.tilt=t.from.tilt+(t.to.tilt-t.from.tilt)*e;this.bearing=((t.from.bearing+t.db*e)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
    if(u>=1)this.transition=null;this.updateCamera();this.onView?.();
  }
  updateCamera({labels=true}={}){
    this.updateMpp();this.placeCamera();
    const q=2**(Math.round(Math.log2(this.mpp)*4)/4);
    if(this.builtMpp!==q){
      this.builtMpp=q;const mpp=q;
      for(const line of this.streetGroup.children){line.material.dashSize=Math.max(12,mpp*5);line.material.gapSize=Math.max(8,mpp*3);}
      // De cerca la troncal se vuelve una línea fina: lo que se lee entonces es la calzada, con sus
      // carriles, y los buses encima.
      const width=mpp<1.6?Math.max(.9,mpp*1.6):Math.max(9,mpp*3.2);
      for(const {c,mesh} of this.paths){
        const vertices=[];
        for(const line of c.components)for(let i=1;i<line.length;i++){
          const [x,y]=line[i-1],[a,b]=line[i],len=Math.hypot(a-x,b-y);if(len<1e-6)continue;
          const dx=-(b-y)/len*width/2,dy=(a-x)/len*width/2;
          vertices.push(x+dx,y+dy,0,x-dx,y-dy,0,a+dx,b+dy,0,a+dx,b+dy,0,x-dx,y-dy,0,a-dx,b-dy,0);
        }
        mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      }
      this.data.stations.forEach((s,i)=>{
        const radius=Math.max(3,mpp*(mpp<5?4.5:2.7));this.object.position.set(...s.xy,0);this.object.rotation.set(0,0,0);
        this.object.scale.set(radius,radius,1);this.object.updateMatrix();this.stopOuter.setMatrixAt(i,this.object.matrix);
        this.object.scale.set(radius*.62,radius*.62,1);this.object.updateMatrix();this.stopInner.setMatrixAt(i,this.object.matrix);
      });
      this.rebuildHighlight();this.stopOuter.instanceMatrix.needsUpdate=true;this.stopInner.instanceMatrix.needsUpdate=true;
    }
    const near=this.mpp;
    this.stopOuter.visible=this.stopInner.visible=near>1.2;
    if(this.stationGroup)this.stationGroup.visible=near<3;
    if(this.stationRoofs)this.stationRoofs.visible=near<3&&this.is3D;
    if(this.infrastructureGroup)this.infrastructureGroup.visible=near<8;
    if(this.roadBands)this.roadBands.visible=near<3;
    if(this.carriagewayGroup)this.carriagewayGroup.visible=this.carriagewaysEnabled!==false&&near<6&&!this.guidewayGroup;
    // Con la calzada a la vista, la línea de la troncal sobra: se muestra una u otra, igual en 2D y en
    // 3D. El interruptor de la calzada manda en las dos vistas.
    if(this.guidewayGroup){this.guidewayGroup.visible=this.carriagewaysEnabled!==false&&near<5;if(this.laneMarks)this.laneMarks.visible=near<1.4;for(const {mesh} of this.paths)mesh.visible=!this.guidewayGroup.visible;}
    if(this.buildingGroup){this.buildingGroup.visible=this.buildingsEnabled!==false&&near<(this.is3D?14:6);this.updateBuildingTiles();}
    if(this.crowdMesh&&this.crowdList&&Math.abs((this.crowdMpp||0)-near)>near*.15){this.crowdMpp=near;this.setCrowd(this.crowdList);}
    if(this.depotGroup){this.depotGroup.visible=near<10;if(this.depotBuses)this.depotBuses.visible=this.depotJoints.visible=near<4;}
    if(labels)this.updateLabels();this.positionLabels();this.updateMarker();this.updateScale();
    if(this.lastSimulation)this.updateBuses(this.lastSimulation,'all',true);
    this.updateCompass();
  }
  updateCompass(){const n=document.querySelector('.north');if(n){n.style.transform=`rotate(${-this.bearing}rad)`;n.title=this.is3D?'Vista inclinada · clic para mirar al norte':'Norte';}}
  updateLabels(){
    const occupied=[],visible=new Set();
    const priority=s=>s.id===this.selected?.id?0:s.name.startsWith('Portal')?1:s.kind==='street'?3:2;
    for(const s of [...this.data.stations].sort((a,b)=>priority(a)-priority(b))){
      if(this.mpp>20&&priority(s)>1)continue;if(this.mpp>3&&priority(s)>2)continue;
      const [x,y]=this.worldToScreen(s.xy); const width=Math.min(s.name.length*6.3+8,245), r=[x+10,y-10,x+10+width,y+12];
      if(x<0||y<85||r[2]>this.w-55||y>this.h-130||occupied.some(a=>r[0]<a[2]+5&&r[2]>a[0]-5&&r[1]<a[3]+5&&r[3]>a[1]-5))continue;
      let entry=this.labelEntries.get(s.id);if(!entry){const label=document.createElement('div');label.className='station-label'+(s.kind==='street'?' street':'');label.textContent=s.name;this.labels.append(label);entry={label,station:s};this.labelEntries.set(s.id,entry);}visible.add(s.id);occupied.push(r);
    }
    for(const [id,entry] of this.labelEntries)if(!visible.has(id)){entry.label.remove();this.labelEntries.delete(id);}this.positionLabels();
  }
  positionLabels(){for(const {label,station} of this.labelEntries.values()){const [x,y]=this.worldToScreen(station.xy);label.style.transform=`translate3d(${x+10}px,${y-10}px,0)`;}}
  updateScale(){const approx=this.mpp*100;const power=10**Math.floor(Math.log10(approx));const step=[1,2,5,10].find(n=>n*power>=approx)*power;const el=document.querySelector('#scale');el.textContent=(step>=1000?(step/1000)+' km':step+' m')+(this.is3D?' · aprox.':'');el.style.width=step/this.mpp+'px';}
  select(kind,id,label){this.selected={kind,id,label};this.updateMarker();this.updateLabels();}
  selectedItem(){
    const chosen=this.selected;if(!chosen)return null;
    if(chosen.kind==='station')return this.data.stations.find(s=>s.id===chosen.id)||null;
    return this.busSamples.find(b=>b.id===chosen.id)||null;
  }
  updateMarker(){const item=this.selectedItem();if(!item){this.marker.visible=false;return;}this.marker.visible=true;this.marker.position.set(item.xy[0],item.xy[1],.2);this.marker.scale.setScalar(Math.max(10,this.mpp*11));}

  // --- Gestos -----------------------------------------------------------------------------------
  bind(){
    const pointers=new Map();let gesture=null;
    const local=e=>{const r=this.host.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
    const startGesture=e=>{
      const values=[...pointers.values()],mid=values.length>1?[(values[0][0]+values[1][0])/2,(values[0][1]+values[1][1])/2]:values[0];
      gesture={values,grab:this.screenToWorld(mid),distance:this.distance,bearing:this.bearing,tilt:this.tilt,moved:false,rotate:values.length===1&&(e?.button===2||e?.ctrlKey||e?.metaKey||e?.shiftKey)};
    };
    this.host.addEventListener('contextmenu',e=>e.preventDefault());
    this.host.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0&&e.button!==2)return;
      this.host.focus({preventScroll:true});this.host.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId,local(e));startGesture(e);
    });
    this.host.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId)||!gesture)return;
      pointers.set(e.pointerId,local(e));const values=[...pointers.values()];
      const midpoint=a=>a.length>1?[(a[0][0]+a[1][0])/2,(a[0][1]+a[1][1])/2]:a[0];
      const before=midpoint(gesture.values),after=midpoint(values);
      if(gesture.rotate){
        // Girar e inclinar: arrastre con el botón derecho, o con Ctrl o Mayúsculas.
        this.transition=null;this.bearing=gesture.bearing+(after[0]-before[0])*.006;this.tilt=Math.max(0,Math.min(MAX_TILT,gesture.tilt+(after[1]-before[1])*.005));
        this.mode=this.is3D?'3d':'2d';this.updateCamera();this.onView?.();gesture.moved=true;return;
      }
      if(values.length>1&&gesture.values.length>1){
        const dist=a=>Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]),ang=a=>Math.atan2(a[1][1]-a[0][1],a[1][0]-a[0][0]);
        this.distance=Math.max(25,Math.min(160000,gesture.distance*dist(gesture.values)/Math.max(1,dist(values))));
        // Dos dedos: girar el par cambia el rumbo; moverlos juntos en vertical inclina.
        let turn=ang(values)-ang(gesture.values);if(turn>Math.PI)turn-=2*Math.PI;if(turn<-Math.PI)turn+=2*Math.PI;
        const lift=after[1]-before[1],spread=Math.abs(dist(values)-dist(gesture.values));
        if(Math.abs(turn)>.08)this.bearing=gesture.bearing-turn;
        if(Math.abs(lift)>30&&spread<40){this.tilt=Math.max(0,Math.min(MAX_TILT,gesture.tilt+lift*.006));this.mode=this.is3D?'3d':'2d';this.onView?.();}
      }
      this.updateMpp();this.placeCamera();
      const now=this.screenToWorld(after);this.target=[this.target[0]+gesture.grab[0]-now[0],this.target[1]+gesture.grab[1]-now[1]];
      gesture.moved ||= values.length>1||Math.hypot(after[0]-before[0],after[1]-before[1])>5;
      this.onPan?.();this.updateCamera();
    });
    const end=e=>{
      if(!pointers.has(e.pointerId))return;
      const click=e.type==='pointerup'&&pointers.size===1&&!gesture?.moved&&!gesture?.rotate;
      pointers.delete(e.pointerId);if(pointers.size){startGesture();gesture.moved=true;}else gesture=null;
      if(click)this.pick(local(e));
    };
    this.host.addEventListener('pointerup',end);this.host.addEventListener('pointercancel',end);
    this.host.addEventListener('wheel',e=>{e.preventDefault();this.zoom(Math.exp(Math.max(-1,Math.min(1,e.deltaY*(e.ctrlKey?.018:.004)))),local(e));},{passive:false});
    this.host.addEventListener('keydown',e=>{
      const f=this.forward(),r=this.right(),m=80*this.mpp;
      const offsets={ArrowLeft:[-r[0]*m,-r[1]*m],ArrowRight:[r[0]*m,r[1]*m],ArrowUp:[f[0]*m,f[1]*m],ArrowDown:[-f[0]*m,-f[1]*m]};
      if(offsets[e.key]){e.preventDefault();this.target=[this.target[0]+offsets[e.key][0],this.target[1]+offsets[e.key][1]];this.onPan?.();this.updateCamera();}
      else if(['+','=','-'].includes(e.key)){e.preventDefault();this.zoom(e.key==='-'?1.3:1/1.3);}
      else if(e.key==='q'||e.key==='e'){e.preventDefault();this.rotate(e.key==='q'?-.12:.12,0);}
    });
  }
  pick(point){
    const distanceTo=item=>{const p=this.worldToScreen(item.xy);return Math.hypot(point[0]-p[0],point[1]-p[1]);};
    let chosen=null,limit=14;
    for(const [kind,items] of [['bus',this.busSamples],['station',this.data.stations]])for(const item of items){const d=distanceTo(item);if(d<limit){chosen={kind,id:item.id};limit=d;}}
    if(chosen){this.select(chosen.kind,chosen.id,chosen.label);this.onSelect(chosen);}
  }

  // --- Capas del suelo --------------------------------------------------------------------------
  // Acepta un identificador o varios: los servicios numerados tienen un registro por sentido y se
  // resaltan juntos.
  setRoute(id,{subtle=false}={}){this.journey=null;this.routeId=id;this.subtleRoute=subtle;this.rebuildHighlight();}
  setJourney(legs){this.routeId=null;this.subtleRoute=false;this.journey=legs;this.rebuildHighlight();}
  rebuildHighlight(){
    const ids=this.routeId==null?[]:[this.routeId].flat();
    const routes=this.journey||this.data.routes.filter(r=>ids.includes(r.id)&&r.ready),focused=!!ids.length||!!this.journey?.length,mpp=this.builtMpp||this.mpp;
    const vertices=[],colors=[];for(const r of routes){const color=new THREE.Color(r.color),width=mpp<1.6?Math.max(1.4,mpp*2.4):Math.max(4,mpp*(focused?5:2.1));
      // Con la altura de la calzada a mano, el recorrido se remuestrea cada 8 m y sube y baja con los
      // puentes y deprimidos; si no, va por los vértices publicados, a ras de suelo.
      const path=this.routeLinks?.[r.id]&&this.metricPaths?.get(r.id);let P=r.points,Z=null;
      if(path){P=[];Z=[];for(let at=0;;at=Math.min(path.length,at+8)){P.push(path.sample(at).xy);Z.push(this.elevationAt(r.id,at)+.05);if(at>=path.length)break;}}
      for(let i=1;i<P.length;i++){const [x,y]=P[i-1],[a,b]=P[i],len=Math.hypot(a-x,b-y);if(!len)continue;const z0=Z?Z[i-1]:0,z1=Z?Z[i]:0,dx=-(b-y)/len*width/2,dy=(a-x)/len*width/2;vertices.push(x+dx,y+dy,z0,x-dx,y-dy,z0,a+dx,b+dy,z1,a+dx,b+dy,z1,x-dx,y-dy,z0,a-dx,b-dy,z1);for(let j=0;j<6;j++)colors.push(color.r,color.g,color.b);}}
    this.highlight.geometry.dispose();this.highlight.geometry=new THREE.BufferGeometry();this.highlight.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.highlight.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));this.highlight.material.vertexColors=true;this.highlight.material.color.set('#ffffff');this.highlight.material.needsUpdate=true;
    this.highlight.material.opacity=this.subtleRoute?.62:.98;for(const {mesh} of this.paths)mesh.material.opacity=this.corridorsFaded?.07:focused?(this.subtleRoute?.24:.3):.86;
    for(const line of this.streetGroup.children)line.material.opacity=this.corridorsFaded?.08:.65;
  }
  // Las troncales casi apagadas: sirven de referencia pero dejan ver la ciudad y la estación.
  setCorridorsFaded(faded){this.corridorsFaded=faded;this.rebuildHighlight();}
  buildCarriageways(){
    // Calzada de OSM como contexto, mientras no llega la red de tramos del motor. Se conserva para
    // quien apague la capa de carriles, igual que antes.
    this.carriagewaysEnabled=true;this.carriagewayGroup=new THREE.Group();this.carriagewayGroup.visible=false;this.scene.add(this.carriagewayGroup);
    const ways=this.data.busway_lanes?.ways||[];if(!ways.length)return;
    const exclusive=[],shared=[];
    for(const way of ways){
      const width=Math.max(3.5,(way.lanes||1)*3.5),target=way.exclusive?exclusive:shared;
      for(let i=1;i<way.points.length;i++){
        const [x,y]=way.points[i-1],[a,b]=way.points[i],len=Math.hypot(a-x,b-y);if(!len)continue;
        const dx=-(b-y)/len*width/2,dy=(a-x)/len*width/2;
        target.push(x+dx,y+dy,0, x-dx,y-dy,0, a+dx,b+dy,0, a+dx,b+dy,0, x-dx,y-dy,0, a-dx,b-dy,0);
      }
    }
    for(const [vertices,palette] of [[exclusive,['#dfe5ea','#222e3b']],[shared,['#e6eaee','#1d2733']]]){
      if(!vertices.length)continue;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:palette[0],depthTest:true,depthWrite:false}));
      mesh.renderOrder=.2;mesh.userData.palette=palette;this.carriagewayGroup.add(mesh);
    }
  }
  /** La calzada que usa el motor: cada tramo con su carril que sigue de largo y, donde lo hay, el del
   * andén, del lado del separador en la troncal y de la acera en calle. Es la geometría exacta sobre
   * la que ruedan los buses, así que de cerca se ven en su carril. */
  // La calzada de TransMilenio con sus carriles, muestreada cada 5 m: el segundo carril se abre y se
  // cierra en 30 m en vez de en escalón, y los puentes y deprimidos de OSM suben o bajan la calzada
  // con sus rampas (la altura la calcula el motor, Guideway.elevate). `routeLinks` dice qué tramos
  // recorre cada servicio, para poner a cada bus a la altura de la calzada por la que va.
  setGuideway(links,routeLinks=null){
    if(this.guidewayGroup){this.scene.remove(this.guidewayGroup);this.guidewayGroup.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
    this.guidewayGroup=new THREE.Group();this.scene.add(this.guidewayGroup);
    this.guideLinks=links;this.routeLinks=routeLinks;if(routeLinks)this.rebuildHighlight();
    const main=[],berth=[],marks=[],walls=[],STEP=5,TAPER=30,DECK=1.1;
    const quad=(t,a,b,na,nb,o1a,o2a,o1b,o2b,za,zb)=>{t.push(a[0]+na[0]*o1a,a[1]+na[1]*o1a,za,a[0]+na[0]*o2a,a[1]+na[1]*o2a,za,b[0]+nb[0]*o1b,b[1]+nb[1]*o1b,zb,b[0]+nb[0]*o1b,b[1]+nb[1]*o1b,zb,a[0]+na[0]*o2a,a[1]+na[1]*o2a,za,b[0]+nb[0]*o2b,b[1]+nb[1]*o2b,zb);};
    const wall=(a,b,na,nb,oa,ob,za,zb,ha,hb)=>{const A=[a[0]+na[0]*oa,a[1]+na[1]*oa],B=[b[0]+nb[0]*ob,b[1]+nb[1]*ob];walls.push(A[0],A[1],za,B[0],B[1],zb,A[0],A[1],ha,A[0],A[1],ha,B[0],B[1],zb,B[0],B[1],hb);};
    for(const link of links){
      const pts=link.points,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
      const length=cum.at(-1),n=Math.max(1,Math.ceil(length/STEP)),side=link.street?1:-1,P=[],Z=[],W=[];
      let seg=1;
      for(let j=0;j<=n;j++){
        const at=Math.min(length,j*STEP);while(seg<pts.length-1&&cum[seg]<at)seg++;
        const a=pts[seg-1],b=pts[seg],f=(at-cum[seg-1])/((cum[seg]-cum[seg-1])||1),c=Math.min(link.lanes.length-1,Math.floor(Math.min(at,length-.01)/CELL_M));
        P.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);Z.push(link.z?link.z[c]:0);W.push(link.lanes[c]===2?1:0);
      }
      const d=STEP/TAPER;for(let j=1;j<W.length;j++)W[j]=Math.min(W[j],W[j-1]+d);for(let j=W.length-2;j>=0;j--)W[j]=Math.min(W[j],W[j+1]+d);
      // Normal hacia la derecha de la marcha, de la cuerda entre las muestras vecinas: las juntas cierran.
      const N=P.map((p,j)=>{const a=P[Math.max(0,j-1)],b=P[Math.min(P.length-1,j+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return [dy/l,-dx/l];});
      for(let j=1;j<P.length;j++){
        const a=P[j-1],b=P[j],na=N[j-1],nb=N[j],za=Z[j-1],zb=Z[j];
        quad(main,a,b,na,nb,-LANE/2,LANE/2,-LANE/2,LANE/2,za,zb);
        const wa=W[j-1]*LANE,wb=W[j]*LANE;
        if(wa>.01||wb>.01){
          quad(berth,a,b,na,nb,side*LANE/2,side*(LANE/2+wa),side*LANE/2,side*(LANE/2+wb),za+.01,zb+.01);
          if(W[j-1]>.95&&W[j]>.95&&j%2){const o=side*LANE/2;marks.push(a[0]+na[0]*o,a[1]+na[1]*o,za+.02,b[0]+nb[0]*o,b[1]+nb[1]*o,zb+.02);}
        }
        // Puente: el canto del tablero a los dos lados. Deprimido: los muros hasta el nivel de la calle.
        if(za>.3||zb>.3)for(const [oa,ob] of [[-side*LANE/2,-side*LANE/2],[side*(LANE/2+wa),side*(LANE/2+wb)]])wall(a,b,na,nb,oa,ob,za,zb,Math.max(0,za-DECK),Math.max(0,zb-DECK));
      }
    }
    const add=(vertices,key,order,line=false)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const m=line?new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:this.palette[key],depthTest:true,depthWrite:false})):new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:this.palette[key],depthTest:true,depthWrite:false,side:THREE.DoubleSide}));m.renderOrder=order;m.userData.key=key;this.guidewayGroup.add(m);return m;};
    // Calzada de TransMilenio que ningún recorrido usa (busway_context.json): la media glorieta de
    // Banderas, vías internas de portales, accesos a patios. Un carril, sin buses.
    const extra=[];
    // Donde un trozo pasa por un puente de OSM (busway_structures.json) sube igual que la calzada del
    // motor, con rampas de 7 %: así se ve, por ejemplo, el conector de la Av. 68 a la Calle 26.
    const structs=(this.data.busway_structures?.structures||[]).filter(t=>t.kind==='bridge');
    const levelAt=(p,ang)=>{for(const t of structs)for(let i=1;i<t.points.length;i++){const a=t.points[i-1],b=t.points[i],ex=b[0]-a[0],ey=b[1]-a[1],l2=ex*ex+ey*ey;if(!l2)continue;const u=((p[0]-a[0])*ex+(p[1]-a[1])*ey)/l2;if(u<0||u>1)continue;if(Math.hypot(p[0]-a[0]-u*ex,p[1]-a[1]-u*ey)>6)continue;if(Math.abs(Math.cos(ang)*ex+Math.sin(ang)*ey)/Math.sqrt(l2)<.8)continue;return t.layer*5.5;}return 0;};
    for(const piece of this.data.busway_context?.pieces||[]){
      const P=piece.points,N=P.map((p,j)=>{const a=P[Math.max(0,j-1)],b=P[Math.min(P.length-1,j+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return [dy/l,-dx/l];});
      let Z=P.map((p,j)=>piece.bridge?levelAt(p,Math.atan2(-N[j][0],N[j][1])):0);
      if(Z.some(z=>z)){for(let j=1;j<Z.length;j++)Z[j]=Math.max(Z[j],Z[j-1]-.07*Math.hypot(P[j][0]-P[j-1][0],P[j][1]-P[j-1][1]));for(let j=Z.length-2;j>=0;j--)Z[j]=Math.max(Z[j],Z[j+1]-.07*Math.hypot(P[j][0]-P[j+1][0],P[j][1]-P[j+1][1]));}
      for(let j=1;j<P.length;j++){quad(extra,P[j-1],P[j],N[j-1],N[j],-LANE/2,LANE/2,-LANE/2,LANE/2,Z[j-1],Z[j]);if(Z[j-1]>.3||Z[j]>.3)for(const o of [-LANE/2,LANE/2])wall(P[j-1],P[j],N[j-1],N[j],o,o,Z[j-1],Z[j],Math.max(0,Z[j-1]-DECK),Math.max(0,Z[j]-DECK));}
    }
    add(main,'asphalt',.25);add(berth,'berth',.26);this.laneMarks=add(marks,'laneMark',.27,true);if(extra.length)add(extra,'asphalt',.24);
    if(walls.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(walls,3));g.computeVertexNormals();const m=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:this.palette.bridge,side:THREE.DoubleSide}));m.renderOrder=4.5;m.userData.key='bridge';this.guidewayGroup.add(m);}
    this.updateCamera();
  }
  /** Altura de la calzada bajo un punto del recorrido de un servicio, en metros (0 sin puente). */
  elevationAt(routeId,s){
    const rl=this.routeLinks?.[routeId];if(!rl)return 0;const starts=rl.starts;let lo=0,hi=rl.links.length-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(starts[mid]<=s)lo=mid;else hi=mid-1;}
    const link=this.guideLinks[rl.links[lo]];if(!link?.z)return 0;
    const x=Math.max(0,(s-starts[lo])/CELL_M-.5),c=Math.min(link.z.length-1,Math.floor(x)),f=Math.min(1,x-c);
    return link.z[c]+(link.z[Math.min(link.z.length-1,c+1)]-link.z[c])*f;
  }
  // Patios troncales (depots.json, capa Patios SITP de IDECA): el terreno y, adentro, en filas, los
  // buses que no están en servicio a esa hora. Se reparten por área, como aproximación: el simulador no
  // sabe de qué patio sale cada bus.
  setDepots(depots){
    if(this.depotGroup){this.scene.remove(this.depotGroup);this.depotGroup.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
    this.depotGroup=new THREE.Group();this.scene.add(this.depotGroup);this.depotSlots=[];this.depotParked=-1;
    const fill=[];const inside=(pts,x,y)=>{let c=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const [xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
    for(const d of depots||[]){
      const pts=d.points;const contour=pts.slice(0,-1).map(p=>new THREE.Vector2(...p));if(contour.length<3)continue;
      for(const [i,j,k] of THREE.ShapeUtils.triangulateShape(contour,[]))fill.push(contour[i].x,contour[i].y,0,contour[j].x,contour[j].y,0,contour[k].x,contour[k].y,0);
      // Como en los patios reales: los buses de lado, en bloques de dos de fondo (2 × 19,5 m) con un
      // pasillo de 11 m entre bloques, 3,6 m entre buses. Se llenan bloque por bloque desde un extremo.
      const shape=pieceShape(pts),u=shape.u,v=[-u[1],u[0]],half=shape.length/2,w=Math.max(shape.length,shape.width)*.75,slots=[],ang=Math.atan2(v[1],v[0]);
      for(let b=-w;b<=w;b+=2*19.5+11)for(const depth of [9.75,29.25])for(let a=-half;a<=half;a+=3.6){const bb=b+depth,x=shape.center[0]+u[0]*a+v[0]*bb,y=shape.center[1]+u[1]*a+v[1]*bb;
        if([[-1.6,-9.5],[1.6,-9.5],[-1.6,9.5],[1.6,9.5]].every(([da,db])=>inside(pts,x+u[0]*da+v[0]*db,y+u[1]*da+v[1]*db)))slots.push([x,y,ang]);}
      this.depotSlots.push({depot:d,slots});
    }
    if(fill.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(fill,3));const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:this.palette.depot,depthTest:true,depthWrite:false}));m.renderOrder=.15;m.userData.key='depot';this.depotGroup.add(m);}
    const capacity=this.depotSlots.reduce((s,d)=>s+d.slots.length,0),box=new THREE.BoxGeometry(1,1,1);box.translate(0,0,.5);
    this.depotBuses=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:this.palette.parked}),Math.max(1,capacity));this.depotBuses.count=0;this.depotBuses.frustumCulled=false;this.depotBuses.userData.key='parked';this.depotBuses.renderOrder=5;this.depotGroup.add(this.depotBuses);
    this.depotJoints=new THREE.InstancedMesh(box.clone(),new THREE.MeshLambertMaterial({color:'#2a3138'}),Math.max(1,capacity));this.depotJoints.count=0;this.depotJoints.frustumCulled=false;this.depotJoints.renderOrder=5;this.depotGroup.add(this.depotJoints);
    this.depotCapacity=capacity;
  }
  /** Pasajeros esperando: un disco en el suelo de cada estación, de área proporcional a la gente. */
  setCrowd(list){
    if(!this.crowdMesh){const g=new THREE.CircleGeometry(1,40);this.crowdMesh=new THREE.InstancedMesh(g,new THREE.MeshBasicMaterial({color:this.palette.crowd,transparent:true,opacity:.35,depthTest:true,depthWrite:false}),400);this.crowdMesh.frustumCulled=false;this.crowdMesh.renderOrder=.3;this.crowdMesh.userData.key='crowd';this.scene.add(this.crowdMesh);}
    this.crowdList=list;const byId=new Map(this.data.stations.map(s=>[s.id,s]));let i=0;
    for(const [id,waiting] of list||[]){const s=byId.get(id);if(!s||waiting<5||i>=400)continue;// Área proporcional a la gente, con un tamaño mínimo en pantalla para leerlo desde lejos.
      const r=Math.max(Math.sqrt(waiting)*1.6,this.mpp*(3+Math.sqrt(waiting)*.32));this.object.position.set(s.xy[0],s.xy[1],.1);this.object.rotation.set(0,0,0);this.object.scale.set(r,r,1);this.object.updateMatrix();this.crowdMesh.setMatrixAt(i++,this.object.matrix);}
    this.crowdMesh.count=i;this.crowdMesh.instanceMatrix.needsUpdate=true;this.crowdMesh.visible=!!list;
  }
  /** Llena los patios con `idle` buses, repartidos según el área de cada uno. */
  updateDepotBuses(idle){
    if(!this.depotBuses||idle===this.depotParked)return;this.depotParked=idle;
    const total=this.depotSlots.reduce((s,d)=>s+d.depot.area_m2,0)||1;let i=0;
    for(const {depot,slots} of this.depotSlots){
      const n=Math.min(slots.length,Math.round(idle*depot.area_m2/total));
      // Articulado de 18,5 m con su fuelle a 10,9 m del frente.
      for(let k=0;k<n;k++){const [x,y,ang]=slots[k],c=Math.cos(ang),s=Math.sin(ang);this.object.position.set(x,y,0);this.object.rotation.set(0,0,ang);this.object.scale.set(18.5,2.55,3.1);this.object.updateMatrix();this.depotBuses.setMatrixAt(i,this.object.matrix);
        this.object.position.set(x+c*(9.25-10.9),y+s*(9.25-10.9),.25);this.object.scale.set(.8,2.3,2.7);this.object.updateMatrix();this.depotJoints.setMatrixAt(i,this.object.matrix);i++;}
    }
    this.depotBuses.count=i;this.depotBuses.instanceMatrix.needsUpdate=true;this.depotJoints.count=i;this.depotJoints.instanceMatrix.needsUpdate=true;
  }
  /** Vagones alineados con la calzada, desde el punto donde atiende cada servicio (worker). Los de
   * un mismo vagón y lado se juntan; su largo es el de la pieza de OSM o 45 m. */
  setPlatforms(mods){
    if(!mods?.length)return;
    const groups=[];
    for(const m of mods){let g=groups.find(g=>g.station===m.station&&Math.hypot(g.x/g.n-m.xy[0],g.y/g.n-m.xy[1])<14);if(!g){g={station:m.station,x:0,y:0,n:0,c:0,s:0,length:0};groups.push(g);}g.x+=m.xy[0];g.y+=m.xy[1];g.n++;g.c+=Math.cos(2*m.angle);g.s+=Math.sin(2*m.angle);g.length=Math.max(g.length,m.length||0);}
    this.alignedPlatforms=groups.map(g=>({station:g.station,xy:[g.x/g.n,g.y/g.n],angle:Math.atan2(g.s,g.c)/2,length:Math.max(28,Math.min(62,g.length||45))}));
    for(const o of [this.stationGroup,this.stationRoofs]){if(!o)continue;this.scene.remove(o);o.traverse(x=>{x.geometry?.dispose();x.material?.dispose?.();});}
    this.buildStationGeometry();
  }
  buildStationGeometry(){
    // Plataformas y cubiertas de OSM en relieve bajo; de arriba se leen como antes, inclinado se ve
    // el andén. Las estaciones sin geometría publicada conservan sus vagones esquemáticos.
    this.stationGroup=new THREE.Group();this.scene.add(this.stationGroup);this.layoutIds=new Set();
    this.stationRoofs=new THREE.Group();this.scene.add(this.stationRoofs);
    const solid=(points,height,z,key,opacity=1)=>{
      const contour=points.slice(0,-1).map(p=>new THREE.Vector2(...p));if(contour.length<3)return;
      const shape=new THREE.Shape(contour);const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});geometry.translate(0,0,z);
      const mesh=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color:this.palette[key],transparent:opacity<1,opacity,depthWrite:opacity>=1}));
      mesh.renderOrder=opacity<1?8:4.6;mesh.userData.key=key;(opacity<1?this.stationRoofs:this.stationGroup).add(mesh);
    };
    const line=(points,key,order)=>{const g=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p,.05)));const l=new THREE.Line(g,new THREE.LineBasicMaterial({color:this.palette[key],depthTest:true,depthWrite:false}));l.renderOrder=order;l.userData.key=key;this.stationGroup.add(l);};
    const aligned=new Set((this.alignedPlatforms||[]).map(p=>p.station));
    for(const layout of this.data.station_layouts?.stations||[]){
      // Con vagones alineados, la geometría de OSM solo queda en los portales, donde es la del patio.
      if(aligned.has(layout.station_id)&&!/^portal/i.test(layout.name||''))continue;
      const areas=layout.areas.filter(a=>a.closed&&a.role==='station_area'),platforms=layout.platforms.filter(p=>p.points.length>1);
      if(!areas.length&&!platforms.length)continue;
      this.layoutIds.add(layout.station_id);
      for(const area of areas)solid(area.points,.35,4.2,'roof',.28);
      // Sin andenes mapeados aparte, el contorno de la estación es el andén: la estructura con su cubierta.
      if(!platforms.some(p=>p.closed&&p.role==='platform_trunk'))for(const area of areas)solid(area.points,.9,0,'platform');
      for(const p of platforms){if(p.closed)solid(p.points,.9,0,'platform');else line(p.points,'platformEdge',3.6);}
    }
    // Vagones esquemáticos donde no hay geometría: un andén de 58 m por vagón a lo largo del eje.
    const wagons=[];
    // Sin geometría de OSM, los vagones van donde el GTFS pone sus paradas: cada letra en su lugar, en
    // una o dos filas según las puertas de cada lado. Si tampoco hay eso, módulos cada 64 m.
    const gtfs=this.data.wagon_stops?.stations||{};
    for(const p of this.alignedPlatforms||[]){if(this.layoutIds.has(p.station))continue;wagons.push({xy:p.xy,angle:p.angle,length:p.length});}
    for(const s of this.data.stations){
      if(s.kind==='street'||s.status==='En obras'||this.layoutIds.has(s.id)||aligned.has(s.id))continue;
      const sum=this.axes.get(s.id)||[1,0],angle=Math.atan2(sum[1],sum[0])/2,u=[Math.cos(angle),Math.sin(angle)],v=[-u[1],u[0]];
      const stops=(gtfs[s.id]||[]).filter(w=>/^[A-Z]$/.test(w.letter||'')&&Math.hypot(w.xy[0]-s.xy[0],w.xy[1]-s.xy[1])<250);
      if(stops.length){
        const groups=new Map();
        for(const w of stops){const dx=w.xy[0]-s.xy[0],dy=w.xy[1]-s.xy[1],a=dx*u[0]+dy*u[1],b=dx*v[0]+dy*v[1],key=w.letter+'/'+Math.round(b/9);const g=groups.get(key)||{a:0,b:0,n:0,letter:w.letter};g.a+=a;g.b+=b;g.n++;groups.set(key,g);}
        const centers=[...groups.values()].map(g=>({a:g.a/g.n,b:g.b/g.n,letter:g.letter}));
        const letters=[...new Set(centers.map(c=>c.letter))].sort(),along=letters.map(l=>{const cs=centers.filter(c=>c.letter===l);return cs.reduce((x,c)=>x+c.a,0)/cs.length;}).sort((x,y)=>x-y);
        let gap=Infinity;for(let k=1;k<along.length;k++)gap=Math.min(gap,along[k]-along[k-1]);
        const length=Math.max(25,Math.min(58,Number.isFinite(gap)?gap*.85:45));
        for(const c of centers)wagons.push({xy:[s.xy[0]+u[0]*c.a+v[0]*c.b,s.xy[1]+u[1]*c.a+v[1]*c.b],angle,length});
        continue;
      }
      const n=s.wagons||2;for(let w=1;w<=n;w++)wagons.push({xy:[s.xy[0]+u[0]*(w-(n+1)/2)*64,s.xy[1]+u[1]*(w-(n+1)/2)*64],angle});
    }
    const box=new THREE.BoxGeometry(1,1,1);box.translate(0,0,.5);
    this.wagonMesh=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:this.palette.platform}),Math.max(1,wagons.length));this.wagonMesh.userData.key='platform';
    this.wagonRoof=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:this.palette.roof,transparent:true,opacity:.28,depthWrite:false}),Math.max(1,wagons.length));this.wagonRoof.userData.key='roof';
    wagons.forEach((w,i)=>{this.object.position.set(w.xy[0],w.xy[1],0);this.object.rotation.set(0,0,w.angle);this.object.scale.set(w.length||58,5,.9);this.object.updateMatrix();this.wagonMesh.setMatrixAt(i,this.object.matrix);this.object.position.z=4.2;this.object.scale.set((w.length||58)+4,7,.35);this.object.updateMatrix();this.wagonRoof.setMatrixAt(i,this.object.matrix);});
    this.wagonMesh.count=this.wagonRoof.count=wagons.length;this.wagonMesh.renderOrder=4.6;this.wagonRoof.renderOrder=8;this.stationGroup.add(this.wagonMesh);this.stationRoofs.add(this.wagonRoof);
  }
  /** Volúmenes de la ciudad, por tesela, solo en la vista inclinada. */
  // Edificios de Catastro junto a las troncales, por teselas de 1 km (tools/build_buildings.py). Solo
  // se piden en 3D y de cerca, las más próximas primero y de a dos; las lejanas se sueltan.
  async loadBuildings(base){
    try{
      const r=await fetch(base+'index.json');if(!r.ok)return;const index=await r.json();
      this.buildingIndex={base,size:index.method.tile_m,floor:index.method.floor_height_m||3,coverage:index.coverage,source:index.source,tiles:index.tiles.map(([x,y,count])=>({key:x+'_'+y,x,y,count}))};
      this.buildingTiles=new Map();this.buildingLoading=0;
      this.buildingGroup=new THREE.Group();this.buildingGroup.visible=false;this.scene.add(this.buildingGroup);
      this.buildingMaterial=new THREE.MeshLambertMaterial({color:this.palette.building});
      this.updateBuildingTiles();
    }catch{}
  }
  updateBuildingTiles(){
    const idx=this.buildingIndex;if(!idx||this.buildingsEnabled===false||this.mpp>=(this.is3D?14:6))return;
    const size=idx.size,[cx,cy]=this.target,reach=Math.min(3500,Math.max(900,this.distance*1.4)),want=[];
    for(const t of idx.tiles){const dx=Math.max(0,Math.abs(cx-(t.x+.5)*size)-size/2),dy=Math.max(0,Math.abs(cy-(t.y+.5)*size)-size/2),d=Math.hypot(dx,dy);if(d<reach)want.push([d,t]);}
    want.sort((a,b)=>a[0]-b[0]);
    for(const [,t] of want){
      if(this.buildingTiles.has(t.key))continue;if(this.buildingLoading>=2)break;
      this.buildingLoading++;this.buildingTiles.set(t.key,null);
      fetch(`${idx.base}${t.key}.bin`).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer();}).then(buffer=>{
        if(this.buildingIndex!==idx)return;
        const mesh=new THREE.Mesh(buildingGeometry(buffer,t.x*size,t.y*size,idx.floor),this.buildingMaterial);
        mesh.renderOrder=4.7;mesh.userData={key:'building',tile:t};this.buildingGroup.add(mesh);this.buildingTiles.set(t.key,mesh);
      }).catch(()=>this.buildingTiles.delete(t.key)).finally(()=>{this.buildingLoading--;this.updateBuildingTiles();});
    }
    // Más de 40 teselas en memoria: fuera las más lejanas.
    const loaded=[...this.buildingTiles.values()].filter(Boolean);
    if(loaded.length>40){
      loaded.sort((a,b)=>Math.hypot(cx-(b.userData.tile.x+.5)*size,cy-(b.userData.tile.y+.5)*size)-Math.hypot(cx-(a.userData.tile.x+.5)*size,cy-(a.userData.tile.y+.5)*size));
      for(const mesh of loaded.slice(0,loaded.length-40)){this.buildingGroup.remove(mesh);mesh.geometry.dispose();this.buildingTiles.delete(mesh.userData.tile.key);}
    }
  }
  setContext(data){
    const roads=[],waterLines=[],parks=[],water=[],bridges=[];
    const segments=(points,target)=>{for(let i=1;i<points.length;i++)target.push(...points[i-1],0,...points[i],0);};
    for(const f of data.features){
      if(f.closed&&f.points.length>=4&&f.kind!=='road'){
        const contour=f.points.slice(0,-1).map(p=>new THREE.Vector2(...p)),holes=(f.holes||[]).map(h=>h.slice(0,-1).map(p=>new THREE.Vector2(...p))),all=[...contour,...holes.flat()],target=f.kind==='water'?water:parks;
        for(const tri of THREE.ShapeUtils.triangulateShape(contour,holes))for(const i of tri)target.push(all[i].x,all[i].y,0);
      }else segments(f.points,f.kind==='water'?waterLines:roads);
      if(f.bridge||f.tunnel)segments(f.points,bridges);
    }
    const add=(points,key,line=false,opacity=1)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const mesh=line?new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:this.palette[key],depthTest:true,depthWrite:false,transparent:true,opacity})):new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:this.palette[key],depthTest:true,depthWrite:false,side:THREE.DoubleSide}));mesh.renderOrder=0;mesh.userData.key=key;this.contextGroup.add(mesh);(this.contextMeshes||=[]).push(mesh);};
    this.infrastructureGroup=new THREE.Group();this.contextGroup.add(this.infrastructureGroup);this.infrastructureGroup.visible=this.mpp<8;
    const rails=[];for(const f of data.features.filter(f=>f.bridge&&!f.tunnel))for(let i=1;i<f.points.length;i++){
      const a=f.points[i-1],b=f.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;
      const nx=-(b[1]-a[1])/len*6,ny=(b[0]-a[0])/len*6;
      for(const side of [-1,1])rails.push(a[0]+nx*side,a[1]+ny*side,0,b[0]+nx*side,b[1]+ny*side,0);
    }
    const railGeometry=new THREE.BufferGeometry();railGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rails,3));const railMesh=new THREE.LineSegments(railGeometry,new THREE.LineBasicMaterial({color:'#8394a3',depthTest:true,depthWrite:false,transparent:true,opacity:.8}));railMesh.renderOrder=3;this.infrastructureGroup.add(railMesh);
    for(const f of data.features.filter(f=>f.tunnel)){const geometry=new THREE.BufferGeometry().setFromPoints(f.points.map(p=>new THREE.Vector3(...p,0)));const line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#7f93a3',dashSize:12,gapSize:9,depthTest:true,depthWrite:false,transparent:true,opacity:.7}));line.computeLineDistances();line.renderOrder=.5;this.infrastructureGroup.add(line);}
    add(parks,'park');add(water,'water');add(roads,'road',true,.75);add(waterLines,'waterLine',true,.85);add(bridges,'bridge',true,.75);
    // De cerca las calles son franjas de calzada, no líneas: dan contexto a los semáforos y a los
    // cruces. Un puente vial sube 5,5 m por nivel con rampas dentro de su propio tramo.
    const bands=[],decks=[],W=3.6;
    for(const f of data.features){
      if(f.kind!=='road'||f.closed||f.tunnel||f.points.length<2)continue;
      const P=f.points,cum=[0];for(let i=1;i<P.length;i++)cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
      const L=cum.at(-1),H=f.bridge?Math.max(1,Number(f.layer)||1)*5.5:0,ramp=Math.min(60,L/3),z=s=>H?H*Math.min(1,s/ramp,(L-s)/ramp):0;
      for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],len=cum[i]-cum[i-1];if(!len)continue;const nx=-(b[1]-a[1])/len*W,ny=(b[0]-a[0])/len*W,za=z(cum[i-1]),zb=z(cum[i]);
        bands.push(a[0]+nx,a[1]+ny,za,a[0]-nx,a[1]-ny,za,b[0]+nx,b[1]+ny,zb,b[0]+nx,b[1]+ny,zb,a[0]-nx,a[1]-ny,za,b[0]-nx,b[1]-ny,zb);
        if(H)for(const sd of [1,-1])decks.push(a[0]+nx*sd,a[1]+ny*sd,za,b[0]+nx*sd,b[1]+ny*sd,zb,a[0]+nx*sd,a[1]+ny*sd,Math.max(0,za-1.1),a[0]+nx*sd,a[1]+ny*sd,Math.max(0,za-1.1),b[0]+nx*sd,b[1]+ny*sd,zb,b[0]+nx*sd,b[1]+ny*sd,Math.max(0,zb-1.1));}
    }
    this.roadBands=new THREE.Group();this.contextGroup.add(this.roadBands);this.roadBands.visible=false;
    const bandGeometry=new THREE.BufferGeometry();bandGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bands,3));const bandMesh=new THREE.Mesh(bandGeometry,new THREE.MeshBasicMaterial({color:this.palette.road,depthTest:true,depthWrite:false,side:THREE.DoubleSide}));bandMesh.renderOrder=.12;bandMesh.userData.key='road';this.roadBands.add(bandMesh);
    if(decks.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(decks,3));g.computeVertexNormals();const m=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:this.palette.bridge,side:THREE.DoubleSide}));m.renderOrder=4.4;m.userData.key='bridge';this.roadBands.add(m);}
    this.contextMeshes=[...(this.contextMeshes||[]),...this.roadBands.children];
  }

  // --- Buses ------------------------------------------------------------------------------------
  acceptSimulation(simulation,animate=false){
    this.previousVisual=new Map((animate?this.visualBuses||[]:[]).map(b=>[b.id,b]));this.targetSimulation=simulation;this.visualSettled=false;this.visualStart=performance.now();this.visualBuses=simulation.buses;if(!animate)this.updateBuses(simulation);
  }
  animateBuses(now){
    this.stepTransition(now);
    if(!this.targetSimulation||this.visualSettled)return;
    const blend=Math.min(1,(now-this.visualStart)/60);
    // Entre dos muestras cada bus avanza por su recorrido y se desliza de carril; nunca retrocede.
    this.visualBuses=this.targetSimulation.buses.map(b=>{const a=this.previousVisual.get(b.id);if(!a||blend>=1||a.routeId!==b.routeId||b.s<a.s||b.s-a.s>400)return b;const s=a.s+(b.s-a.s)*blend,lat=a.lat+(b.lat-a.lat)*blend,pose=this.metricPaths.get(b.routeId).sample(s);return {...b,s,lat,angle:pose.angle,xy:[pose.xy[0]+Math.sin(pose.angle)*lat,pose.xy[1]-Math.cos(pose.angle)*lat]};});
    this.updateBuses({...this.targetSimulation,buses:this.visualBuses});this.visualSettled=blend>=1;
  }
  setBusColorMode(mode){this.busColor=mode;if(this.lastSimulation)this.updateBuses(this.lastSimulation,'all',true);}
  updateBuses(simulation,filter='all',forceClusters=false){
    this.lastSimulation=simulation;const buses=simulation.buses;this.updateSignals(simulation.signalTime??simulation.time);
    // El largo llega en un arreglo de 32 bits (27,2 m es 27,2000007…): se redondea para dar con sus cuerpos.
    const bodiesOf=len=>BODIES[Math.round(len*10)/10];
    let segments=0;for(const b of buses)segments+=(bodiesOf(b.length_m)||[b.length_m]).length;
    if(!this.busMesh||this.busCapacity<segments){
      if(this.busMesh){for(const m of [this.busMesh,this.busNose,this.busJoint]){this.scene.remove(m);m.dispose();m.geometry.dispose();m.material.dispose();}}
      this.busCapacity=Math.max(4096,segments*2);
      const box=new THREE.BoxGeometry(1,1,1);box.translate(0,0,.5);
      this.busMesh=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:'#ffffff'}),this.busCapacity);
      this.busNose=new THREE.InstancedMesh(box.clone(),new THREE.MeshLambertMaterial({color:'#f4f7fa'}),this.busCapacity);
      // El fuelle entre cuerpos: más angosto, más bajo y oscuro, como la unión de goma del articulado.
      this.busJoint=new THREE.InstancedMesh(box.clone(),new THREE.MeshLambertMaterial({color:'#2a3138'}),this.busCapacity);
      this.busMesh.renderOrder=5;this.busNose.renderOrder=6;this.busJoint.renderOrder=5;for(const m of [this.busMesh,this.busNose,this.busJoint]){m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(m);}
    }
    this.trailers||=new Map();const seen=new Set();
    this.busSamples=[];let i=0,nose=0,joint=0;const color=new THREE.Color(),cells=new Map(),clusters=[];
    // De lejos cada bus es un volumen de tamaño mínimo en pantalla y los dos sentidos se separan un
    // poco; de cerca, cada cuerpo en su carril, con su largo, doblando en las rótulas.
    const far=Math.max(0,this.mpp*2.2-2.5),close=this.mpp<1.2;
    for(const b of buses){
      if(filter!=='all'&&filter!==b.routeId)continue;
      const xy=[b.xy[0]+Math.sin(b.angle)*far,b.xy[1]-Math.cos(b.angle)*far];
      const screen=this.worldToScreen(xy);if(screen[0]<-40||screen[0]>this.w+40||screen[1]<-40||screen[1]>this.h+40)continue;
      if(this.mpp>10&&b.id!==this.selected?.id){const key=Math.floor(screen[0]/28)+':'+Math.floor(screen[1]/28),cell=cells.get(key);if(cell){cell.count++;continue;}const c={count:1,xy,screen};cells.set(key,c);clusters.push(c);}
      this.busSamples.push({id:b.id,xy});
      if(this.busColor==='load'){const u=Math.min(1,b.load/Math.max(1,b.capacity));color.setHSL((1-u)*.33,.72,.47);}else color.set(b.color);
      const len=b.length_m||18.5,width=Math.max(BUS_WIDTH,this.mpp*3.4),height=Math.max(BUS_HEIGHT,width*1.15);
      const bodies=close&&bodiesOf(len)?bodiesOf(len):[Math.max(len,this.mpp*8)];
      // De cerca, cada cuerpo es un remolque del anterior: el primero va donde manda el trazado —con
      // su desvío de carril y la altura de la calzada— y cada uno sigue la unión del que lleva
      // delante, en planta y en pendiente. Así el bus se dobla en las curvas, en los cambios de carril
      // y en las rampas, en vez de mover cuerpos paralelos y sueltos.
      const path=close?this.metricPaths.get(b.routeId):null;
      if(path){
        const front=Math.min(path.length,b.s+len/2),pose=path.sample(front),at=(s,l)=>{const q=path.sample(Math.max(0,Math.min(path.length,s)));return [q.xy[0]+Math.sin(q.angle)*l,q.xy[1]-Math.cos(q.angle)*l,this.elevationAt(b.routeId,s)];};
        let F=[pose.xy[0]+Math.sin(pose.angle)*b.lat,pose.xy[1]-Math.cos(pose.angle)*b.lat,this.elevationAt(b.routeId,front)],back=0;
        const prev=this.trailers.get(b.id),rears=[];
        for(let k=0;k<bodies.length;k++){
          const body=bodies[k];let R=prev?.[k];
          const d=R?Math.hypot(F[0]-R[0],F[1]-R[1],F[2]-R[2]):0;
          const ideal=at(front-back-body,b.lat);
          if(!R||d>body*1.6||d<body*.5)R=ideal;
          // El remolque tiende a su sitio sobre el trazado: poco en marcha —así se dobla—, mucho
          // detenido, para que un bus parado quede derecho en su carril y no cruzado sobre dos.
          else{const k=(b.speed||0)<.5?.35:.12;R=[R[0]+(ideal[0]-R[0])*k,R[1]+(ideal[1]-R[1])*k,R[2]+(ideal[2]-R[2])*k];}
          let dx=F[0]-R[0],dy=F[1]-R[1],dz=F[2]-R[2];const l=Math.hypot(dx,dy,dz)||1;dx/=l;dy/=l;dz/=l;
          R=[F[0]-dx*body,F[1]-dy*body,F[2]-dz*body];rears.push(R);
          const yaw=Math.atan2(dy,dx),pitch=Math.asin(Math.max(-1,Math.min(1,dz))),cx=F[0]-dx*body/2,cy=F[1]-dy*body/2,cz=F[2]-dz*body/2;
          this.object.rotation.order='ZYX';
          this.object.position.set(cx,cy,cz);this.object.rotation.set(0,-pitch,yaw);this.object.scale.set(body-(bodies.length>1?JOINT:0),width,height);this.object.updateMatrix();
          this.busMesh.setMatrixAt(i,this.object.matrix);this.busMesh.setColorAt(i,color);i++;
          if(k===0){this.object.position.set(F[0]-dx*.45,F[1]-dy*.45,F[2]-dz*.45+height*.35);this.object.scale.set(.8,width*1.01,height*.5);this.object.updateMatrix();this.busNose.setMatrixAt(nose++,this.object.matrix);}
          else{this.object.position.set(F[0]+dx*JOINT/2,F[1]+dy*JOINT/2,F[2]+.25);this.object.scale.set(JOINT+.5,width*.86,height*.82);this.object.updateMatrix();this.busJoint.setMatrixAt(joint++,this.object.matrix);}
          F=[R[0]-dx*JOINT,R[1]-dy*JOINT,R[2]-dz*JOINT];back+=body+JOINT;
        }
        this.object.rotation.order='XYZ';this.trailers.set(b.id,rears);seen.add(b.id);
        continue;
      }
      const body=bodies[0],pz=this.routeLinks?this.elevationAt(b.routeId,b.s):0;
      this.object.position.set(xy[0],xy[1],pz);this.object.rotation.set(0,0,b.angle);this.object.scale.set(body,width,height);this.object.updateMatrix();
      this.busMesh.setMatrixAt(i,this.object.matrix);this.busMesh.setColorAt(i,color);i++;
      this.object.position.set(xy[0]+Math.cos(b.angle)*(body/2-.45),xy[1]+Math.sin(b.angle)*(body/2-.45),pz+height*.35);this.object.scale.set(.8,width*1.01,height*.5);this.object.updateMatrix();this.busNose.setMatrixAt(nose++,this.object.matrix);
    }
    if(this.trailers.size>seen.size*2+200)for(const id of [...this.trailers.keys()])if(!seen.has(id))this.trailers.delete(id);
    if((forceClusters||!this.lastClusterTime||performance.now()-this.lastClusterTime>300)){this.lastClusterTime=performance.now();this.clusterLayer.replaceChildren();for(const c of clusters.filter(c=>c.count>5).sort((a,b)=>b.count-a.count).slice(0,32)){const el=document.createElement('div');el.className='cluster-label';el.textContent=c.count;el.style.left=c.screen[0]+5+'px';el.style.top=c.screen[1]-16+'px';this.clusterLayer.append(el);}}
    this.visibleBuses=this.busSamples.length;this.busMesh.count=i;this.busNose.count=nose;this.busJoint.count=joint;this.busMesh.instanceMatrix.needsUpdate=true;if(this.busMesh.instanceColor)this.busMesh.instanceColor.needsUpdate=true;this.busNose.instanceMatrix.needsUpdate=true;this.busJoint.instanceMatrix.needsUpdate=true;this.updateMarker();
  }
  follow(xy,dt){const [dx,dy]=this.focusShift(),blend=1-Math.exp(-Math.min(.1,Math.max(0,dt))*15);this.target[0]+=(xy[0]+dx-this.target[0])*blend;this.target[1]+=(xy[1]+dy-this.target[1])*blend;const now=performance.now();const labels=!this.lastFollowLabels||now-this.lastFollowLabels>150;if(labels)this.lastFollowLabels=now;this.updateCamera({labels});}
  // El semáforo es una estimación del modelo, no un dato: se puede apagar para leer el mapa.
  setSignals(enabled){this.signalsEnabled=enabled;if(this.signalMesh&&!enabled)this.signalMesh.visible=false;}
  updateSignals(time){
    if(!this.signalMesh)return;this.signalMesh.visible=this.signalsEnabled&&this.mpp<4;if(!this.signalMesh.visible)return;
    const color=new THREE.Color();let i=0;
    // Una intersección, una fase: los nodos de un mismo cruce comparten la del primero, igual que en el motor.
    const clusters=this.signalGroups||(this.signalGroups=signalClusters(this.data.busway_signals)),timing=this.signalTiming||SIGNAL_CYCLE,offsets=this.signalOffsets;
    const phase=id=>{const rep=clusters.get(id)||id;if(!offsets||offsets[rep]===undefined)return signalPhase(rep,time||0,timing).color;const p=(((time||0)+offsets[rep])%timing.cycle+timing.cycle)%timing.cycle;return p<timing.green?'green':p<timing.green+timing.amber?'amber':'red';};
    for(const s of this.data.busway_signals.signals){this.object.position.set(s.xy[0],s.xy[1],.1);this.object.rotation.set(0,0,0);this.object.scale.set(Math.max(1.6,this.mpp*3),Math.max(1.6,this.mpp*3),1);this.object.updateMatrix();this.signalMesh.setMatrixAt(i,this.object.matrix);color.set({green:'#269765',amber:'#e8a41b',red:'#e8394b'}[phase(s.id)]);this.signalMesh.setColorAt(i++,color);}
    this.signalMesh.instanceMatrix.needsUpdate=true;this.signalMesh.instanceColor.needsUpdate=true;
  }
  setTheme(theme){
    this.dark=theme==='dark';this.palette=PALETTE[this.dark?'dark':'light'];this.renderer.setClearColor(this.palette.clear);
    const recolor=o=>{const key=o.userData?.key;if(key&&o.material&&this.palette[key])o.material.color.set(this.palette[key]);};
    for(const mesh of this.contextMeshes||[])recolor(mesh);
    this.stopInner.material.color.set(this.palette.stopInner);
    this.stationGroup.traverse(recolor);this.stationRoofs.traverse(recolor);this.guidewayGroup?.traverse(recolor);this.buildingGroup?.traverse(recolor);this.depotGroup?.traverse(recolor);if(this.crowdMesh)recolor(this.crowdMesh);
    for(const mesh of (this.carriagewayGroup?.children||[]))mesh.material.color.set(mesh.userData.palette[this.dark?1:0]);
  }
  render(){this.renderer.render(this.scene,this.camera);}
}
