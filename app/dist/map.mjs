import {MetricPath} from './simulation.mjs?v=20260930.33';
import {signalPhase,signalClusters,SIGNAL_CYCLE} from './signals.mjs?v=20260930.33';
import * as THREE from './vendor/three.module.js';
import {pieceShape} from './wagons.mjs?v=20260930.33';

// Cámara en perspectiva sobre el plano de la ciudad, en metros, con z hacia arriba. Mirando recto
// hacia abajo se ve igual que el mapa 2D de siempre; inclinada, es la vista 3D. El estado de la
// cámara es el punto que mira, la distancia, la inclinación desde la vertical y el rumbo.
const FOV=35,TAN=Math.tan(FOV/2*Math.PI/180),TILT_3D=56*Math.PI/180,MAX_TILT=72*Math.PI/180;
// De metros del mapa (aeqd con origen en -74.136, 4.63027) a lon/lat, para consultar la fecha de la
// foto satelital. A escala de la ciudad basta la aproximación local: error de centímetros.
const ORIGIN=[-74.136,4.63027],aeqdToLonLat=(x,y)=>{const R=6378137,e2=.00669438,phi=ORIGIN[1]*Math.PI/180,s=Math.sin(phi),M=R*(1-e2)/(1-e2*s*s)**1.5,N=R/Math.sqrt(1-e2*s*s);return [ORIGIN[0]+x/(N*Math.cos(phi))*180/Math.PI,ORIGIN[1]+y/M*180/Math.PI];};
const LANE=3.4,BUS_WIDTH=2.55,BUS_HEIGHT=3.25,CELL_M=5;
// Cuerpos de cada tipo de bus, del frente hacia atrás: el articulado dobla en una rótula y el
// biarticulado en dos. Así los volúmenes siguen la curva en vez de atravesarla.
const BODIES={12:[12],18.5:[10.9,7.3],27.2:[9.8,8.4,8.4]};
const JOINT=.3;
const PALETTE={
 light:{crossing:'#a3afba',footbridge:'#b8c3cd',crowd:'#dc253b',depot:'#dfe4e9',parked:'#c7343f',clear:'#edf1f4',park:'#d4e3d8',water:'#c5dce8',road:'#ffffff',waterLine:'#b6d5e4',bridge:'#c1cbd5',trench:'#b4bfc9',deck:'#d3dae1',asphalt:'#c9d1d9',berth:'#bcc6cf',laneMark:'#ffffff',platform:'#f7f9fb',platformEdge:'#8a9dac',roof:'#9fb1c1',building:'#e1e5e9',buildingGlow:'#b3bcc5',stopInner:'#ffffff'},
 dark:{crossing:'#8397a9',footbridge:'#5d7182',crowd:'#ef3b52',depot:'#1c2835',parked:'#a8323c',clear:'#131d28',park:'#1d3530',water:'#1d3547',road:'#2b3947',waterLine:'#35596c',bridge:'#607383',trench:'#3b4b59',deck:'#33424f',asphalt:'#26333f',berth:'#2f3e4c',laneMark:'#51647a',platform:'#51667a',platformEdge:'#8aa1b5',roof:'#6f879c',building:'#223040',buildingGlow:'#141e29',stopInner:'#293746'},
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
// Redondea las esquinas de una polilínea con arcos: en cada vértice que gira se cambia la esquina
// por un arco tangente a los dos lados, con tangente de hasta `reach` metros y nunca más de 45 % de
// cada lado. Las calles de OSM traen pocos vértices en las curvas y la franja salía quebrada.
function fillet(P,reach=15){
  if(P.length<3)return P;
  const out=[P[0]];
  for(let i=1;i<P.length-1;i++){
    const a=P[i-1],b=P[i],c=P[i+1],l1=Math.hypot(b[0]-a[0],b[1]-a[1]),l2=Math.hypot(c[0]-b[0],c[1]-b[1]);
    if(!l1||!l2){out.push(b);continue;}
    const u=[(b[0]-a[0])/l1,(b[1]-a[1])/l1],w=[(c[0]-b[0])/l2,(c[1]-b[1])/l2],turn=Math.acos(Math.max(-1,Math.min(1,u[0]*w[0]+u[1]*w[1]))),bz=b.length>2?b[2]:undefined;
    if(turn<.04||turn>2.6){out.push(b);continue;}
    const t=Math.min(reach,.45*l1,.45*l2),n=Math.max(2,Math.ceil(turn/.12));
    const p0=[b[0]-u[0]*t,b[1]-u[1]*t],p2=[b[0]+w[0]*t,b[1]+w[1]*t];
    for(let k=0;k<=n;k++){const f=k/n,g=1-f,pt=[g*g*p0[0]+2*g*f*b[0]+f*f*p2[0],g*g*p0[1]+2*g*f*b[1]+f*f*p2[1]];if(bz!==undefined)pt.push(bz);out.push(pt);}
  }
  out.push(P.at(-1));
  return out;
}

// Estructura de un puente sobre una franja de calzada: losa con su cara de abajo y sus cantos,
// barandas New Jersey a los dos lados, columnas con viga cabezal cada `span` metros donde el tablero
// va alto y, donde va bajo (las rampas), muro de contención hasta el suelo. P son los puntos, N la
// normal a la derecha, L y R los bordes (metros sobre N) y Z la altura de la calzada en cada punto.
/** Corre y ajusta de lado un andén (centro, rumbo, largo, ancho) para que su borde quede al ras del
 *  costado de los buses que paran en él: a 5 m del carril de paso de cada parada que cae a lo largo. */
function snapPlatform(xy,angle,length,width,stops=[]){
  // Borde a 4,8 m del carril de paso: el bus acomodado (3,4 m más cerca, 1,28 m de medio ancho) queda
  // a 10 cm. Si los dos sentidos van tan juntos que no cabe la isla (en el motor van más juntos que en
  // la calle), se angosta hasta 3 m y el bus queda montado como mucho 75 cm.
  const E=4.8,u=[Math.cos(angle),Math.sin(angle)],v=[-u[1],u[0]];let pos=Infinity,neg=Infinity;
  for(const q of stops){const dx=q[0]-xy[0],dy=q[1]-xy[1],a=dx*u[0]+dy*u[1],b=dx*v[0]+dy*v[1];if(Math.abs(a)>length/2+5||Math.abs(b)>16)continue;if(b>=0)pos=Math.min(pos,b-E);else neg=Math.min(neg,-b-E);}
  let lo=-width/2,hi=width/2;
  if(Number.isFinite(pos)&&Number.isFinite(neg)){hi=pos;lo=-neg;if(hi-lo<3){const c=(lo+hi)/2;lo=c-1.5;hi=c+1.5;}}
  else if(Number.isFinite(pos)){hi=pos;lo=pos-width;}else if(Number.isFinite(neg)){lo=-neg;hi=-neg+width;}
  const c=(lo+hi)/2;return {xy:[xy[0]+v[0]*c,xy[1]+v[1]*c],width:hi-lo};
}
function bridgeParts(out,P,N,L,R,Z,{deck=1.1,parapet=.9,span=24}={}){
  const tri=(...v)=>out.push(...v);
  const quad=(a,b,c,d)=>tri(...a,...b,...c,...c,...b,...d);
  const at=(j,o,z)=>[P[j][0]+N[j][0]*o,P[j][1]+N[j][1]*o,z];
  let run=0;
  for(let j=1;j<P.length;j++){
    const za=Z[j-1],zb=Z[j],len=Math.hypot(P[j][0]-P[j-1][0],P[j][1]-P[j-1][1]);
    if(!(za>.3||zb>.3)||!len){run+=len;continue;}
    const ua=za-deck,ub=zb-deck,open=ua>1.2&&ub>1.2;
    const da=open?ua:0,db=open?ub:0;
    for(const [oa,ob] of [[L[j-1],L[j]],[R[j-1],R[j]]]){
      quad(at(j-1,oa,za),at(j,ob,zb),at(j-1,oa,Math.max(0,da)),at(j,ob,Math.max(0,db)));
      quad(at(j-1,oa,za+parapet),at(j,ob,zb+parapet),at(j-1,oa,za),at(j,ob,zb));
    }
    if(open)quad(at(j-1,L[j-1],ua),at(j,L[j],ub),at(j-1,R[j-1],ua),at(j,R[j],ub));
    // Columnas: una en el centro o, si el tablero es ancho, una cerca de cada borde.
    for(let s=(span-run%span)%span;s<=len;s+=span){
      const f=s/len,z=za+(zb-za)*f-deck;if(z<2)continue;
      const x=P[j-1][0]+(P[j][0]-P[j-1][0])*f,y=P[j-1][1]+(P[j][1]-P[j-1][1])*f,nx=N[j][0],ny=N[j][1],tx=ny,ty=-nx;
      const l=L[j-1]+(L[j]-L[j-1])*f,r=R[j-1]+(R[j]-R[j-1])*f,w=r-l;
      const box=(o0,o1,t,z0,z1)=>{const c=[[o0,-t],[o1,-t],[o1,t],[o0,t]].map(([o,q])=>[x+nx*o+tx*q,y+ny*o+ty*q]);
        for(let k=0;k<4;k++){const A=c[k],B=c[(k+1)%4];quad([...A,z1],[...B,z1],[...A,z0],[...B,z0]);}
        quad([...c[0],z0],[...c[1],z0],[...c[3],z0],[...c[2],z0]);};
      for(const o of w>9?[l+2,r-2]:[(l+r)/2])box(o-.55,o+.55,.55,0,z-.7);
      box(l+.4,r-.4,.6,z-.7,z);
    }
    run+=len;
  }
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
    // Los números de buses agrupados van justo encima de los nombres y debajo de los controles: al
    // final del contenedor quedaban sobre los botones del mapa.
    this.clusterLayer=document.createElement('div');this.clusterLayer.className='clusters';(labels||host).after(this.clusterLayer);this.clusterLayer.setAttribute('aria-hidden','true');this.clusterLayer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';
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
    // Abrir o cerrar la ficha de un bus o una estación no mueve el mapa: el encuadre se corría hacia
    // la izquierda y un bus elegido cerca de ese borde quedaba bajo el panel. Plegar o desplegar un
    // panel sí recentra. La ficha abre también su detalle en el mismo momento; ese cambio tampoco.
    new MutationObserver(records=>{
      const now=performance.now();
      if(records.some(r=>r.attributeName==='data-inspect')){this.inspectAt=now;clearTimeout(this.refocusTimer);this.refocusFrom=null;setTimeout(()=>this.insets({fresh:true}),300);return;}
      if(now-(this.inspectAt||0)<400)return;
      this.refocus();
    }).observe(document.body,{attributes:true,attributeFilter:['data-detail','data-inspect','data-sheet','data-sheet-size','data-panel']});
    this.resize();this.fitNetwork();this.bind();
  }

  // --- Cámara -----------------------------------------------------------------------------------
  get is3D(){return this.tilt>.02;}
  forward(){return [Math.sin(this.bearing),Math.cos(this.bearing)];}
  right(){return [Math.cos(this.bearing),-Math.sin(this.bearing)];}
  // Los paneles tapan parte del lienzo, así que el centro útil no es el geométrico. El mismo
  // cálculo sirve para encuadrar y para centrar o seguir: lo que se mira tiene que caer en el
  // hueco libre y no debajo de la hoja inferior, que en el móvil se lleva media pantalla.
  insets({fresh=false}={}){
    const now=performance.now();
    if(!fresh&&this.insetCache&&now-this.insetCache.at<250&&this.insetCache.w===this.w&&this.insetCache.h===this.h)return this.insetCache.value;
    const mobile=this.w<800,host=this.host.getBoundingClientRect();
    let left=mobile?18:60,right=60;const top=mobile?120:70;let bottom=mobile?40:235;
    // Se mide lo que de verdad tapa el lienzo: un panel alto pegado a un lado le quita ese lado; uno
    // ancho pegado abajo, la parte de abajo. Una ficha plegada —una franja con su título— no cuenta:
    // plegarla tiene que devolver el hueco al mapa y el encuadre se corre con ella.
    for(const panel of [document.querySelector('#sidebar'),document.querySelector('#inspector')]){
      if(!panel||panel.hidden||getComputedStyle(panel).visibility==='hidden')continue;
      const r=panel.getBoundingClientRect(),x0=r.left-host.left,x1=r.right-host.left,y0=r.top-host.top;
      if(!r.width||!r.height)continue;
      if(r.width>this.w*.6){if(y0>this.h*.25)bottom=Math.max(bottom,this.h-y0+20);continue;}
      if(r.height<this.h*.35)continue;
      if(x0<this.w*.3)left=Math.max(left,x1+10);else if(x1>this.w*.7)right=Math.max(right,this.w-x0+10);
    }
    const value={left,right,top,bottom};
    this.insetCache={at:now,w:this.w,h:this.h,value};
    return value;
  }
  // Cuánto hay que correr el punto mirado para que un lugar quede en medio del hueco libre. Se
  // recuerda unas décimas porque seguir un bus lo pregunta en cada fotograma.
  focusShift({fresh=false}={}){
    const now=performance.now();
    if(fresh||!this.shiftCache||now-this.shiftCache.at>200||this.shiftCache.mpp!==this.mpp||this.shiftCache.bearing!==this.bearing||this.shiftCache.tilt!==this.tilt){
      this.shiftCache={at:now,mpp:this.mpp,bearing:this.bearing,tilt:this.tilt,value:this.shiftFor(this.insets({fresh}))};
    }
    return this.shiftCache.value;
  }
  shiftFor({left,right,top,bottom}){
    const sx=-(left-right)/2*this.mpp,sy=(top-bottom)/2*this.mpp/Math.max(.35,Math.cos(this.tilt)),r=this.right(),f=this.forward();
    return [r[0]*sx+f[0]*sy,r[1]*sx+f[1]*sy];
  }
  // Al plegar o desplegar un panel el hueco libre cambia de sitio: lo que estaba en su centro se lleva
  // al centro del hueco nuevo, con un deslizamiento corto. Se mide cuando la transición del panel ya
  // terminó. Mientras se sigue un bus no hace falta: el seguimiento ya apunta al hueco en cada cuadro.
  refocus(){
    // «Antes» son los márgenes que quedaron medidos con el diseño anterior: cuando este observador
    // se entera, el panel ya cambió y medir ahora daría el hueco nuevo.
    const cache=this.insetCache;
    if(!cache||cache.w!==this.w||cache.h!==this.h)return;
    this.refocusFrom||=cache.value;
    clearTimeout(this.refocusTimer);
    this.refocusTimer=setTimeout(()=>{
      const from=this.refocusFrom;this.refocusFrom=null;
      if(performance.now()-(this.lastFollowAt||0)<300)return;
      const before=this.shiftFor(from),after=this.focusShift({fresh:true}),dx=after[0]-before[0],dy=after[1]-before[1];
      if(Math.hypot(dx,dy)<this.mpp*8)return;
      this.pan={start:performance.now(),from:this.target.slice(),to:[this.target[0]+dx,this.target[1]+dy],duration:380};
    },260);
  }
  stepPan(now){
    const p=this.pan;if(!p)return;const u=Math.min(1,(now-p.start)/p.duration),e=1-(1-u)**3;
    this.target=[p.from[0]+(p.to[0]-p.from[0])*e,p.from[1]+(p.to[1]-p.from[1])*e];if(u>=1)this.pan=null;this.updateCamera();
  }
  get center(){return this.target;}
  set center(v){this.target=v;}
  setDistanceFromMpp(mpp){this.distance=Math.max(25,Math.min(160000,mpp*this.h/(2*TAN)));}
  focusOn(xy,mpp){this.pan=null;if(mpp!==undefined)this.setDistanceFromMpp(mpp);this.updateMpp();const [dx,dy]=this.focusShift({fresh:true});this.target=[xy[0]+dx,xy[1]+dy];this.updateCamera();}
  fit(bounds){this.pan=null;const {left,right,top,bottom}=this.insets({fresh:true});const mpp=Math.max((bounds[2]-bounds[0])/Math.max(100,this.w-left-right),(bounds[3]-bounds[1])/Math.max(100,this.h-top-bottom),.3);this.setDistanceFromMpp(mpp);this.updateMpp();const [dx,dy]=this.focusShift({fresh:true});this.target=[(bounds[0]+bounds[2])/2+dx,(bounds[1]+bounds[3])/2+dy];this.updateCamera();}
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
    if(mode!=='3d'&&this.chase)this.setChase(false);
    const from={tilt:this.tilt,bearing:this.bearing},to=mode==='3d'?{tilt:TILT_3D,bearing:this.is3D?this.bearing:-25*Math.PI/180}:{tilt:0,bearing:0};
    let db=to.bearing-from.bearing;db=((db+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
    this.transition={start:performance.now(),from,db,to,duration:650};this.mode=mode;
  }
  resetNorth(){if(this.chase)this.setChase(false);const from={tilt:this.tilt,bearing:this.bearing};let db=-this.bearing;db=((db+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;this.transition={start:performance.now(),from,db,to:{tilt:this.tilt,bearing:0},duration:500};}
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
    if(this.roadBands)this.roadBands.visible=near<3&&!this.satelliteOn;
    if(this.crossingGroup)this.crossingGroup.visible=near<1.6;
    if(this.footbridgeGroup)this.footbridgeGroup.visible=near<4&&this.bridgesEnabled!==false;
    for(const m of this.structureMeshes||[])m.visible=this.bridgesEnabled!==false;
    if(this.carriagewayGroup)this.carriagewayGroup.visible=this.carriagewaysEnabled!==false&&near<6&&!this.guidewayGroup;
    // Con la calzada a la vista, la línea de la troncal sobra: se muestra una u otra, igual en 2D y en
    // 3D. El interruptor de la calzada manda en las dos vistas.
    if(this.guidewayGroup){this.guidewayGroup.visible=this.carriagewaysEnabled!==false&&near<5;if(this.laneMarks)this.laneMarks.visible=near<1.4;for(const {mesh} of this.paths)mesh.visible=!this.guidewayGroup.visible;}
    if(this.buildingGroup){this.buildingGroup.visible=this.buildingsEnabled!==false&&near<(this.is3D?14:6);this.updateBuildingTiles();}
    if(this.satelliteOn)this.updateSatellite();
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
    if(chosen.kind==='train')return (this.trainSamples||[]).find(s=>s.id===chosen.id)||null;
    return this.busSamples.find(b=>b.id===chosen.id)||null;
  }
  updateMarker(){const item=this.selectedItem();if(!item){this.marker.visible=false;return;}this.marker.visible=true;this.marker.position.set(item.xy[0],item.xy[1],item.xy[2]??.2);this.marker.scale.setScalar(Math.max(10,this.mpp*11));}

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
        this.transition=null;if(this.chase)this.setChase(false);this.bearing=gesture.bearing+(after[0]-before[0])*.006;this.tilt=Math.max(0,Math.min(MAX_TILT,gesture.tilt+(after[1]-before[1])*.005));
        this.mode=this.is3D?'3d':'2d';this.updateCamera();this.onView?.();gesture.moved=true;return;
      }
      if(values.length>1&&gesture.values.length>1){
        const dist=a=>Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]),ang=a=>Math.atan2(a[1][1]-a[0][1],a[1][0]-a[0][0]);
        this.distance=Math.max(25,Math.min(160000,gesture.distance*dist(gesture.values)/Math.max(1,dist(values))));
        // Dos dedos: girar el par cambia el rumbo; moverlos juntos en vertical inclina.
        let turn=ang(values)-ang(gesture.values);if(turn>Math.PI)turn-=2*Math.PI;if(turn<-Math.PI)turn+=2*Math.PI;
        const lift=after[1]-before[1],spread=Math.abs(dist(values)-dist(gesture.values));
        if(Math.abs(turn)>.08){if(this.chase)this.setChase(false);this.bearing=gesture.bearing-turn;}
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
    // Colocar un evento: el siguiente toque en el mapa da su punto en vez de seleccionar.
    if(this.pickHook){const hook=this.pickHook;this.pickHook=null;hook(this.screenToWorld(point));return;}
    const distanceTo=item=>{const p=this.worldToScreen(item.xy);return Math.hypot(point[0]-p[0],point[1]-p[1]);};
    let chosen=null,limit=14;
    for(const [kind,items] of [['train',this.trainSamples||[]],['bus',this.busSamples],['station',this.data.stations]])for(const item of items){const d=distanceTo(item);if(d<limit){chosen={kind,id:item.id};limit=d;}}
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
    // Tres pisos de dibujo: lo hundido va antes que las calles, que pasan por encima del deprimido; lo
    // elevado va después de los edificios, que ya no lo tapan desde atrás. Nada de esto escribe
    // profundidad, así que los buses se siguen viendo bajo un tablero.
    const tiers=[0,1,2].map(()=>({main:[],berth:[],marks:[],extra:[]})),tier=(za,zb)=>za>.3||zb>.3?tiers[2]:za<-.3||zb<-.3?tiers[0]:tiers[1];
    const walls=[],structure=[],STEP=5,TAPER=30,DECK=1.1;
    const quad=(t,a,b,na,nb,o1a,o2a,o1b,o2b,za,zb)=>{t.push(a[0]+na[0]*o1a,a[1]+na[1]*o1a,za,a[0]+na[0]*o2a,a[1]+na[1]*o2a,za,b[0]+nb[0]*o1b,b[1]+nb[1]*o1b,zb,b[0]+nb[0]*o1b,b[1]+nb[1]*o1b,zb,a[0]+na[0]*o2a,a[1]+na[1]*o2a,za,b[0]+nb[0]*o2b,b[1]+nb[1]*o2b,zb);};
    // Muros de un deprimido: solo la cara que mira a la trinchera. El mapa no tiene suelo que tape, y la
    // cara de afuera se veía atravesar el terreno y las calles como una cuña oscura.
    const wall=(a,b,na,nb,oa,ob,za,zb,ha,hb)=>{const A=[a[0]+na[0]*oa,a[1]+na[1]*oa],B=[b[0]+nb[0]*ob,b[1]+nb[1]*ob];
      if(oa+ob>0)walls.push(A[0],A[1],za,A[0],A[1],ha,B[0],B[1],zb,A[0],A[1],ha,B[0],B[1],hb,B[0],B[1],zb);
      else walls.push(A[0],A[1],za,B[0],B[1],zb,A[0],A[1],ha,A[0],A[1],ha,B[0],B[1],zb,B[0],B[1],hb);};
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
        const T=tier(za,zb);quad(T.main,a,b,na,nb,-LANE/2,LANE/2,-LANE/2,LANE/2,za,zb);
        const wa=W[j-1]*LANE,wb=W[j]*LANE;
        if(wa>.01||wb>.01){
          quad(T.berth,a,b,na,nb,side*LANE/2,side*(LANE/2+wa),side*LANE/2,side*(LANE/2+wb),za+.01,zb+.01);
          if(W[j-1]>.95&&W[j]>.95&&j%2){const o=side*LANE/2;T.marks.push(a[0]+na[0]*o,a[1]+na[1]*o,za+.02,b[0]+nb[0]*o,b[1]+nb[1]*o,zb+.02);}
        }
        // Deprimido: los muros hasta el nivel de la calle. Los puentes van enteros, más abajo.
        if(za<-.3||zb<-.3)for(const [oa,ob] of [[-side*LANE/2,-side*LANE/2],[side*(LANE/2+wa),side*(LANE/2+wb)]])wall(a,b,na,nb,oa,ob,za,zb,Math.max(0,za-DECK),Math.max(0,zb-DECK));
      }
      if(Z.some(z=>z>.3)){const E1=W.map(()=>-side*LANE/2),E2=W.map(w=>side*(LANE/2+w*LANE));bridgeParts(structure,P,N,E1.map((e,j)=>Math.min(e,E2[j])),E1.map((e,j)=>Math.max(e,E2[j])),Z,{deck:DECK});}
    }
    const add=(vertices,key,order,line=false)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const m=line?new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:this.palette[key],depthTest:true,depthWrite:false})):new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:this.palette[key],depthTest:true,depthWrite:false,side:THREE.DoubleSide}));m.renderOrder=order;m.userData.key=key;this.guidewayGroup.add(m);return m;};
    // Calzada de TransMilenio que ningún recorrido usa (busway_context.json): la media glorieta de
    // Banderas, vías internas de portales, accesos a patios. Un carril, sin buses.
    // Donde un trozo pasa por un puente de OSM (busway_structures.json) sube igual que la calzada del
    // motor, con rampas de 7 %: así se ve, por ejemplo, el conector de la Av. 68 a la Calle 26.
    const structs=(this.data.busway_structures?.structures||[]).filter(t=>t.kind==='bridge');
    const levelAt=(p,ang)=>{for(const t of structs)for(let i=1;i<t.points.length;i++){const a=t.points[i-1],b=t.points[i],ex=b[0]-a[0],ey=b[1]-a[1],l2=ex*ex+ey*ey;if(!l2)continue;const u=((p[0]-a[0])*ex+(p[1]-a[1])*ey)/l2;if(u<0||u>1)continue;if(Math.hypot(p[0]-a[0]-u*ex,p[1]-a[1]-u*ey)>6)continue;if(Math.abs(Math.cos(ang)*ex+Math.sin(ang)*ey)/Math.sqrt(l2)<.8)continue;return t.layer*5.5;}return 0;};
    for(const piece of this.data.busway_context?.pieces||[]){
      const P=piece.points,N=P.map((p,j)=>{const a=P[Math.max(0,j-1)],b=P[Math.min(P.length-1,j+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return [dy/l,-dx/l];});
      let Z=P.map((p,j)=>piece.bridge?levelAt(p,Math.atan2(-N[j][0],N[j][1])):0);
      if(Z.some(z=>z)){for(let j=1;j<Z.length;j++)Z[j]=Math.max(Z[j],Z[j-1]-.07*Math.hypot(P[j][0]-P[j-1][0],P[j][1]-P[j-1][1]));for(let j=Z.length-2;j>=0;j--)Z[j]=Math.max(Z[j],Z[j+1]-.07*Math.hypot(P[j][0]-P[j+1][0],P[j][1]-P[j+1][1]));}
      for(let j=1;j<P.length;j++)quad(tier(Z[j-1],Z[j]).extra,P[j-1],P[j],N[j-1],N[j],-LANE/2,LANE/2,-LANE/2,LANE/2,Z[j-1],Z[j]);
      if(Z.some(z=>z>.3))bridgeParts(structure,P,N,P.map(()=>-LANE/2),P.map(()=>LANE/2),Z,{deck:DECK});
    }
    const marks=[];
    [.05,.24,4.85].forEach((base,k)=>{const T=tiers[k];if(T.extra.length)add(T.extra,'asphalt',base);if(T.main.length)add(T.main,'asphalt',base+.01);if(T.berth.length)add(T.berth,'berth',base+.02);if(T.marks.length)marks.push(add(T.marks,'laneMark',base+.03,true));});
    this.laneMarks={set visible(v){for(const m of marks)m.visible=v;}};
    // Los muros van con lo hundido, antes que las calles: una calle que cruza el deprimido los tapa.
    // Color plano de concreto: con luz, la cara que mira a la trinchera quedaba en sombra, casi negra.
    if(walls.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(walls,3));g.computeVertexNormals();const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:this.palette.trench,side:THREE.FrontSide}));m.renderOrder=.09;m.userData.key='trench';this.guidewayGroup.add(m);}
    if(structure.length)this.guidewayGroup.add(this.structureMesh(structure));
    if(this.satelliteOn)this.fadeForSatellite();
    this.updateCamera();
  }
  /** Cierres de vía del escenario: un aro rojo con una barra en cada punto, del tamaño de la vía. */
  setEvents(events=[]){
    if(!this.eventGroup){this.eventGroup=new THREE.Group();this.eventGroup.renderOrder=9;this.scene.add(this.eventGroup);}
    for(const m of this.eventGroup.children)m.geometry.dispose();this.eventGroup.clear();
    const material=this.eventMaterial||=new THREE.MeshBasicMaterial({color:'#e23a3a',depthTest:false,transparent:true,opacity:.9,side:THREE.DoubleSide});
    for(const e of events){
      const ring=new THREE.Mesh(new THREE.RingGeometry(22,30,40),material);ring.position.set(e.xy[0],e.xy[1],1);ring.renderOrder=9;
      const bar=new THREE.Mesh(new THREE.PlaneGeometry(44,9),material);bar.position.set(e.xy[0],e.xy[1],1);bar.rotation.z=Math.PI/4;bar.renderOrder=9;
      this.eventGroup.add(ring,bar);
    }
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
      this.depotSlots.push({depot:d,slots:d.slots?.length?d.slots:slots});
    }
    if(fill.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(fill,3));const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:this.palette.depot,depthTest:true,depthWrite:false}));m.renderOrder=.15;m.userData.key='depot';m.visible=!this.satelliteOn;this.depotGroup.add(m);this.depotFill=m;}
    const capacity=this.depotSlots.reduce((s,d)=>s+d.slots.length,0),box=new THREE.BoxGeometry(1,1,1);box.translate(0,0,.5);
    this.depotBuses=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:this.palette.parked}),Math.max(1,capacity));this.depotBuses.count=0;this.depotBuses.frustumCulled=false;this.depotBuses.userData.key='parked';this.depotBuses.renderOrder=5;this.depotGroup.add(this.depotBuses);
    this.depotJoints=new THREE.InstancedMesh(box.clone(),new THREE.MeshLambertMaterial({color:'#2a3138'}),Math.max(1,capacity));this.depotJoints.count=0;this.depotJoints.frustumCulled=false;this.depotJoints.renderOrder=5;this.depotGroup.add(this.depotJoints);
    this.depotCapacity=capacity;
  }
  /** Pasajeros esperando: un disco en el suelo de cada estación, de área proporcional a la gente. */
  setCrowd(list){
    // Por encima de edificios y calzada, para leerlo desde lejos; el color de cada círculo va aparte.
    if(!this.crowdMesh){const g=new THREE.CircleGeometry(1,40);this.crowdMesh=new THREE.InstancedMesh(g,new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.62,depthTest:false,depthWrite:false}),400);this.crowdMesh.frustumCulled=false;this.crowdMesh.renderOrder=9;this.scene.add(this.crowdMesh);}
    this.crowdList=list;const byId=new Map(this.data.stations.map(s=>[s.id,s]));let i=0;
    const low=new THREE.Color(this.dark?'#8a3a48':'#f2a7b1'),high=new THREE.Color(this.dark?'#ff3b55':'#c8102e'),color=new THREE.Color();
    for(const [id,waiting] of list||[]){const s=byId.get(id);if(!s||waiting<5||i>=400)continue;
      // Más gente, más grande y más rojo: en pantalla, de 6 a 30 px de radio, lleno con 250 personas
      // esperando; de cerca nunca baja del área proporcional a la gente.
      const f=Math.min(1,(waiting/250)**.6),px=6+24*f,r=Math.max(Math.sqrt(waiting)*1.6,this.mpp*px);
      this.object.position.set(s.xy[0],s.xy[1],.1);this.object.rotation.set(0,0,0);this.object.scale.set(r,r,1);this.object.updateMatrix();this.crowdMesh.setMatrixAt(i,this.object.matrix);
      this.crowdMesh.setColorAt(i++,color.copy(low).lerp(high,Math.min(1,f*1.3)));}
    this.crowdMesh.count=i;this.crowdMesh.instanceMatrix.needsUpdate=true;if(this.crowdMesh.instanceColor)this.crowdMesh.instanceColor.needsUpdate=true;this.crowdMesh.visible=!!list;
  }
  /** Llena los patios con `idle` buses, repartidos según el área de cada uno. */
  updateDepotBuses(idle){
    if(!this.depotBuses||idle===this.depotParked)return;this.depotParked=idle;
    // Se reparten según los puestos de cada patio (sus zonas de parqueo), no por su área total.
    const total=this.depotSlots.reduce((s,d)=>s+d.slots.length,0)||1;let i=0;
    for(const {depot,slots} of this.depotSlots){
      const n=Math.min(slots.length,Math.round(idle*slots.length/total));
      // Articulado de 18,5 m con su fuelle a 10,9 m del frente.
      for(let k=0;k<n;k++){const [x,y,ang]=slots[k],c=Math.cos(ang),s=Math.sin(ang);this.object.position.set(x,y,0);this.object.rotation.set(0,0,ang);this.object.scale.set(18.5,2.55,3.1);this.object.updateMatrix();this.depotBuses.setMatrixAt(i,this.object.matrix);
        this.object.position.set(x+c*(9.25-10.9),y+s*(9.25-10.9),.25);this.object.scale.set(.8,2.3,2.7);this.object.updateMatrix();this.depotJoints.setMatrixAt(i,this.object.matrix);i++;}
    }
    this.depotBuses.count=i;this.depotBuses.instanceMatrix.needsUpdate=true;this.depotJoints.count=i;this.depotJoints.instanceMatrix.needsUpdate=true;
  }
  /** Andenes alineados con la calzada, desde el punto donde atiende cada servicio (worker). Los
   *  puntos de un mismo lado que se tocan o se separan menos de 15 m son un solo andén (San Façon, que
   *  salía en dos piezas corridas); un hueco mayor separa cuerpos. Dos lados que casi se tocan (< 5,5
   *  m) son una isla. Solo para estaciones sin andenes en OSM. En un separador ancho, cada sentido tiene sus andenes junto a su
   *  carril y van enfrentados de a pares (Mandalay: dos por lado con la plaza en medio); cada uno toma
   *  el rumbo de su carril, que en la estación se abre, y no se monta sobre él en un extremo. */
  setPlatforms(mods){
    if(!mods?.length)return;
    this.platformMods=mods;
    const byStation=new Map();for(const m of mods){if(!byStation.has(m.station))byStation.set(m.station,[]);byStation.get(m.station).push(m);}
    const out=[];
    for(const [station,list] of byStation){
      let c=0,sn=0,x=0,y=0;for(const m of list){c+=Math.cos(2*m.angle);sn+=Math.sin(2*m.angle);x+=m.xy[0];y+=m.xy[1];}
      const ang=Math.atan2(sn,c)/2,u=[Math.cos(ang),Math.sin(ang)],v=[-u[1],u[0]],o=[x/list.length,y/list.length];
      const items=list.map(m=>{const dx=m.xy[0]-o[0],dy=m.xy[1]-o[1],L=Math.max(28,Math.min(62,m.length||45));return {a:dx*u[0]+dy*u[1],b:dx*v[0]+dy*v[1],L,c:Math.cos(2*m.angle),s:Math.sin(2*m.angle)};}).sort((p,q)=>p.b-q.b);
      const sides=[];for(const it of items){const g=sides.at(-1);if(g&&it.b-g.at(-1).b<6)g.push(it);else sides.push([it]);}
      const bodies=side=>{const sorted=[...side].sort((p,q)=>p.a-q.a),res=[];for(const it of sorted){const r=res.at(-1),a0=it.a-it.L/2,a1=it.a+it.L/2;if(r&&a0-r.a1<15){r.a1=Math.max(r.a1,a1);r.bs.push(it.b);r.c+=it.c;r.s+=it.s;}else res.push({a0,a1,bs:[it.b],c:it.c,s:it.s});}
        return res.map(r=>({a0:r.a0,a1:r.a1,b:[...r.bs].sort((p,q)=>p-q)[r.bs.length>>1],angle:Math.atan2(r.s,r.c)/2}));};
      let parts=sides.map(bodies);
      // Dos lados cercanos: una isla. Va de un lado al otro y cubre lo de ambos a lo largo.
      if(parts.length===2){const b1=parts[0].reduce((s,r)=>s+r.b,0)/parts[0].length,b2=parts[1].reduce((s,r)=>s+r.b,0)/parts[1].length;
        if(Math.abs(b2-b1)<5.5){const all=bodies([...sides[0],...sides[1]].map(it=>({...it,b:(b1+b2)/2})));for(const r of all)out.push({station,r:{...r,angle:ang},width:Math.abs(b2-b1)+5});parts=[];}}
      // Un andén por sentido en un separador ancho: van enfrentados, como en Mandalay. Cada servicio
      // para donde le toca y eso los corría; se alinean al centro común con el largo del mayor.
      if(parts.length===2&&parts[0].length===parts[1].length)parts[0].forEach((p,k)=>{const q=parts[1][k],c=(p.a0+p.a1+q.a0+q.a1)/4,h=Math.max(p.a1-p.a0,q.a1-q.a0)/2;for(const r of [p,q]){r.a0=c-h;r.a1=c+h;}});
      for(const side of parts)for(const r of side)out.push({station,r,width:5});
      for(const p of out.filter(p=>p.station===station&&!p.xy)){const m=(p.r.a0+p.r.a1)/2;p.xy=[o[0]+u[0]*m+v[0]*p.r.b,o[1]+u[1]*m+v[1]*p.r.b];p.angle=p.r.angle??ang;p.length=p.r.a1-p.r.a0;delete p.r;}
    }
    // Estaciones trazadas sobre la foto (station_traces.json): el inicio y el fin de cada cubierta vienen
    // de ahí. El lado y el ancho siguen saliendo de donde paran los buses, salvo que el trazado los fije.
    const traces=this.data.station_traces?.stations||{};
    for(const [id,t] of Object.entries(traces)){
      if(t.status!=='trazada')continue;
      const mine=out.filter(p=>p.station===id);if(!mine.length)continue;
      const u=[Math.cos(t.ang),Math.sin(t.ang)],v=[-u[1],u[0]],rel=p=>[(p.xy[0]-t.c[0])*u[0]+(p.xy[1]-t.c[1])*u[1],(p.xy[0]-t.c[0])*v[0]+(p.xy[1]-t.c[1])*v[1]];
      // Por cuerpo trazado, los andenes del motor que se le solapan a lo largo dan sus lados: uno por cada
      // franja lateral ocupada (un hueco de más de 3 m separa los dos sentidos, como en Américas–Boyacá).
      const lane=this.platformMods?.filter(x=>x.station===id).map(x=>{const L=-(3.4*1.5+2.3),q=[x.xy[0]-Math.sin(x.angle)*L,x.xy[1]+Math.cos(x.angle)*L];return rel({xy:q});})||[];
      const fresh=[];
      for(const b of t.bodies){const [a0,a1]=b.a,mid=(a0+a1)/2,make=(lat,w)=>fresh.push({station:id,xy:[t.c[0]+u[0]*mid+v[0]*lat,t.c[1]+u[1]*mid+v[1]*lat],angle:t.ang,length:a1-a0,width:w,traced:true});
        if(b.b!=null){make(b.b,b.w||4);continue;}
        let over=mine.map(p=>{const [pa,pb]=rel(p);return {pa,pb,w:p.width,L:p.length};}).filter(q=>Math.abs(q.pa-mid)<(q.L+a1-a0)/2+5);
        if(!over.length)over=[mine.map(p=>{const [pa,pb]=rel(p);return {pa,pb,w:p.width,d:Math.abs(pa-mid)};}).sort((x,y)=>x.d-y.d)[0]];
        const bands=over.map(q=>[q.pb-q.w/2,q.pb+q.w/2]).sort((x,y)=>x[0]-y[0]),groups=[];
        for(const r of bands){const g=groups.at(-1);if(g&&r[0]-g[1]<3)g[1]=Math.max(g[1],r[1]);else groups.push([...r]);}
        for(const [lo,hi] of groups){
          make((lo+hi)/2,Math.max(2.5,hi-lo));}
      }
      for(const p of mine)out.splice(out.indexOf(p),1);out.push(...fresh);
    }
    // Cada andén al ras de los buses que paran en él. El punto de parada va sobre el carril que sigue de
    // largo; el bus se acomoda en el del andén, 3,4 m más cerca, y su costado queda a 1,3 m de su eje.
    // Así el borde que da a cada bus va a 5 m del carril de paso: ni montado sobre el bus ni lejos de
    // él. Una isla toma los dos bordes de sus dos carriles; un andén de un lado conserva su ancho.
    const stops=new Map();for(const x of mods){const L=-(3.4*1.5+2.3);if(!stops.has(x.station))stops.set(x.station,[]);stops.get(x.station).push([x.xy[0]-Math.sin(x.angle)*L,x.xy[1]+Math.cos(x.angle)*L]);}
    this.platformStops=stops;
    for(const p of out){const fit=snapPlatform(p.xy,p.angle,p.length,p.width,stops.get(p.station));p.xy=fit.xy;p.width=fit.width;}
    this.islandCache=null;
    // Andenes de OSM que no cubren todas las paradas (Paloquemao, Toberín, Terreros…): las que quedan
    // fuera conservan su andén estimado, dibujado junto a los de OSM.
    for(const L of this.data.station_layouts?.stations||[]){
      if(L.platforms.some(q=>q.closed))continue;const isl=this.islandAreas(L);if(!isl.length)continue;
      const inside=q=>isl.some(a=>{const P=a.points,c=[(P[0][0]+P[2][0])/2,(P[0][1]+P[2][1])/2],ux=P[1][0]-P[0][0],uy=P[1][1]-P[0][1],l=Math.hypot(ux,uy);return Math.abs(((q[0]-c[0])*ux+(q[1]-c[1])*uy)/l)<=l/2+5&&Math.abs((-(q[0]-c[0])*uy+(q[1]-c[1])*ux)/l)<16;});
      const loose=(stops.get(L.station_id)||[]).filter(q=>!inside(q));if(!loose.length)continue;
      for(const p of out.filter(p=>p.station===L.station_id)){const u=[Math.cos(p.angle),Math.sin(p.angle)];if(loose.some(q=>Math.abs((q[0]-p.xy[0])*u[0]+(q[1]-p.xy[1])*u[1])<=p.length/2+3))p.extra=true;}
    }
    this.alignedPlatforms=out;
    for(const o of [this.stationGroup,this.stationRoofs]){if(!o)continue;this.scene.remove(o);o.traverse(x=>{x.geometry?.dispose();x.material?.dispose?.();});}
    this.buildStationGeometry();
  }
  /** ¿Los andenes de OSM de la estación sirven tal cual? Polígonos cerrados de al menos 150 m², a menos
   *  de 250 m de la estación, con menos del 10 % de su superficie sobre la calzada del motor. */
  /** Sin andenes mapeados, las áreas largas y angostas de la estación en OSM son sus andenes: Marsella
   *  trae seis de 28–48 × 4,6 m, Mandalay cuatro de 46 × 3,8 m, Museo Nacional su isla de 167 × 8 m.
   *  Se dibujan con su forma, su largo y su rumbo; solo se corren de lado para quedar junto a la
   *  calzada del motor, cuyos recorridos van a 2–3 m de las vías de OSM. */
  islandAreas(layout){
    if(layout.platforms.some(p=>p.closed))return [];
    // Largo y angosto: un andén. Las cúpulas sobre los retornos en U de Museo Nacional (25 × 11 m) no.
    return layout.areas.filter(a=>a.closed&&a.role==='station_area'&&a.length_m>=20&&a.width_m>=1.5&&a.width_m<=12&&a.length_m>=3*a.width_m).map(a=>this.fitIsland({...a,stationId:layout.station_id})).filter(Boolean);
  }
  fitIsland(area){
    if(!this.guideLinks||!area.axis)return null;
    if(this.islandCache?.links!==this.guideLinks)this.islandCache={links:this.guideLinks,map:new Map()};
    if(!this.islandCache.map.has(area.id))this.islandCache.map.set(area.id,this.fitIslandNow(area));
    return this.islandCache.map.get(area.id);
  }
  /** Entre dos calzadas cercanas, el andén va centrado y con el ancho libre (una isla); junto a una
   *  sola, su borde toca el del carril del andén. Sin calzada a menos de 15 m, no es un andén troncal. */
  fitIslandNow(area){
    const [A,B]=area.axis,len=Math.hypot(B[0]-A[0],B[1]-A[1]);if(len<5)return null;
    const u=[(B[0]-A[0])/len,(B[1]-A[1])/len],v=[-u[1],u[0]],mid=[(A[0]+B[0])/2,(A[1]+B[1])/2],half=area.length_m/2,h0=area.width_m/2;
    const shifts=[],widths=[];
    for(let t=-half+4;t<=half-4+1e-6;t+=Math.max(4,(area.length_m-8)/6)){
      const p=[mid[0]+u[0]*t,mid[1]+u[1]*t];let left=Infinity,right=-Infinity;
      for(const l of this.guideLinks){if(l.street)continue;const P=l.points;let at=0;
        for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],ex=b[0]-a[0],ey=b[1]-a[1],L2=ex*ex+ey*ey,sl=Math.sqrt(L2);if(!L2)continue;
          if(Math.min(Math.hypot(a[0]-p[0],a[1]-p[1]),Math.hypot(b[0]-p[0],b[1]-p[1]))>sl+20){at+=sl;continue;}
          const w=Math.max(0,Math.min(1,((p[0]-a[0])*ex+(p[1]-a[1])*ey)/L2)),q=[a[0]+w*ex,a[1]+w*ey],d=(q[0]-p[0])*v[0]+(q[1]-p[1])*v[1],along=Math.abs((q[0]-p[0])*u[0]+(q[1]-p[1])*u[1]);
          if(along<3&&Math.abs(d)<15){const c=Math.min(l.lanes.length-1,Math.floor((at+w*sl)/CELL_M)),band=LANE/2+(l.lanes[c]===2?LANE:0);if(d>0)left=Math.min(left,d-band);else right=Math.max(right,d+band);}
          at+=sl;}}
      const hasL=Number.isFinite(left),hasR=Number.isFinite(right);
      if(hasL&&hasR&&left-right<area.width_m+6){shifts.push((left+right)/2);widths.push(Math.min(area.width_m,left-right-.4));}
      else if(hasL&&(!hasR||left<-right)){shifts.push(left-h0-.3);widths.push(area.width_m);}
      else if(hasR){shifts.push(right+h0+.3);widths.push(area.width_m);}
    }
    if(!shifts.length)return null;
    const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1],shift=med(shifts),width=med(widths);if(width<1.5||Math.abs(shift)>8)return null;
    const c=[mid[0]+v[0]*shift,mid[1]+v[1]*shift],h=width/2,corner=(su,sv)=>[c[0]+u[0]*half*su+v[0]*h*sv,c[1]+u[1]*half*su+v[1]*h*sv];
    let cc=c,ww=width;const st=this.platformStops?.get(area.stationId);if(st){const f=snapPlatform(c,Math.atan2(u[1],u[0]),area.length_m,width,st);cc=f.xy;ww=f.width;}
    const hh=ww/2,corner2=(su,sv)=>[cc[0]+u[0]*half*su+v[0]*hh*sv,cc[1]+u[1]*half*su+v[1]*hh*sv];
    return {...area,points:[corner2(-1,-1),corner2(1,-1),corner2(1,1),corner2(-1,1),corner2(-1,-1)],fitted:true,width_m:ww};
  }
  osmPlatformsFit(layout){
    const own=layout.platforms.filter(p=>p.closed&&p.points.length>3).map(p=>p.points),polys=own.length?own:this.islandAreas(layout).map(a=>a.points);if(!own.length&&polys.length)return true;if(!polys.length||!this.guideLinks)return false;
    const station=this.data.stations.find(s=>s.id===layout.station_id);if(!station)return false;
    const area=q=>Math.abs(q.reduce((a,p,i)=>{const n=q[(i+1)%q.length];return a+p[0]*n[1]-n[0]*p[1];},0))/2;
    if(polys.reduce((a,q)=>a+area(q),0)<150)return false;
    const cx=polys.flat().reduce((a,p)=>a+p[0],0)/polys.flat().length,cy=polys.flat().reduce((a,p)=>a+p[1],0)/polys.flat().length;
    if(Math.hypot(cx-station.xy[0],cy-station.xy[1])>250)return false;
    const segs=[];for(const l of this.guideLinks){if(l.street)continue;for(let i=1;i<l.points.length;i++){const a=l.points[i-1],b=l.points[i];if(Math.hypot(a[0]-cx,a[1]-cy)>400&&Math.hypot(b[0]-cx,b[1]-cy)>400)continue;segs.push([a,b,3.4*Math.max(1,l.lanes[0]||1)/2]);}}
    const inside=(x,y,q)=>{let c=false;for(let i=0,j=q.length-1;i<q.length;j=i++){const [xi,yi]=q[i],[xj,yj]=q[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
    const onLane=(x,y)=>segs.some(([a,b,w])=>{const ex=b[0]-a[0],ey=b[1]-a[1],l2=ex*ex+ey*ey;if(!l2)return false;const u=Math.max(0,Math.min(1,((x-a[0])*ex+(y-a[1])*ey)/l2));return Math.hypot(x-a[0]-u*ex,y-a[1]-u*ey)<w-.5;});
    let total=0,over=0;
    for(const q of polys){const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);for(let x=Math.min(...xs);x<=Math.max(...xs);x+=1.5)for(let y=Math.min(...ys);y<=Math.max(...ys);y+=1.5)if(inside(x,y,q)){total++;if(onLane(x,y))over++;}}
    return total>0&&over/total<.1;
  }
  /** Cota media de la calzada del motor a menos de 15 m de unos puntos; 0 sin calzada a la vista. */
  groundAt(points){
    if(!this.guideLinks||!points.length)return 0;let sum=0,n=0;
    const boxes=this.linkBoxes?.links===this.guideLinks?this.linkBoxes.boxes:(this.linkBoxes={links:this.guideLinks,boxes:this.guideLinks.map(l=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of l.points){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}return [x0,y0,x1,y1];})}).boxes;
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),bx=[Math.min(...xs)-15,Math.min(...ys)-15,Math.max(...xs)+15,Math.max(...ys)+15];
    for(const [k,l] of this.guideLinks.entries()){const b=boxes[k];if(!l.z||b[2]<bx[0]||b[0]>bx[2]||b[3]<bx[1]||b[1]>bx[3])continue;const P=l.points;
      let at=0;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
        for(let t=0;t<len;t+=5){const x=a[0]+(b[0]-a[0])*t/len,y=a[1]+(b[1]-a[1])*t/len;if(points.some(p=>Math.hypot(p[0]-x,p[1]-y)<15)){sum+=l.z[Math.min(l.z.length-1,Math.floor((at+t)/5))];n++;}}at+=len;}}
    return n?sum/n:0;
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
      // Con vagones alineados, la geometría de OSM queda en los portales y donde sus andenes son buenos:
      // polígonos de andén de verdad, junto a la estación y casi sin pisar la calzada (Banderas, con sus
      // andenes en diagonal). El contorno del recinto solo, que siempre abarca los carriles, no basta.
      if(aligned.has(layout.station_id)&&!/^portal/i.test(layout.name||'')&&!this.osmPlatformsFit(layout))continue;
      const islands=aligned.has(layout.station_id)?this.islandAreas(layout):[];
      const areas=islands.length?islands:layout.areas.filter(a=>a.closed&&a.role==='station_area'),platforms=layout.platforms.filter(p=>p.points.length>1);
      if(!areas.length&&!platforms.length)continue;
      this.layoutIds.add(layout.station_id);
      // A la cota de la calzada vecina: una estación subterránea queda abajo, sin cubierta en la calle.
      const z=this.groundAt([...areas,...platforms].flatMap(a=>a.points)),under=z<-1;
      if(!under)for(const area of areas)solid(area.points,.35,z+4.2,'roof',.28);
      // Sin andenes mapeados aparte, el contorno de la estación es el andén: la estructura con su cubierta.
      if(!platforms.some(p=>p.closed&&p.role==='platform_trunk'))for(const area of areas)solid(area.points,.9,z,'platform');
      for(const p of platforms){if(p.closed)solid(p.points,.9,z,'platform');else line(p.points,'platformEdge',3.6);}
    }
    // Vagones esquemáticos donde no hay geometría: un andén de 58 m por vagón a lo largo del eje.
    const wagons=[];
    // Sin geometría de OSM, los vagones van donde el GTFS pone sus paradas: cada letra en su lugar, en
    // una o dos filas según las puertas de cada lado. Si tampoco hay eso, módulos cada 64 m.
    const gtfs=this.data.wagon_stops?.stations||{};
    for(const p of this.alignedPlatforms||[]){if(this.layoutIds.has(p.station)&&!p.extra)continue;wagons.push({xy:p.xy,angle:p.angle,length:p.length,width:p.width});}
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
    wagons.forEach((w,i)=>{this.object.position.set(w.xy[0],w.xy[1],0);this.object.rotation.set(0,0,w.angle);this.object.scale.set(w.length||58,w.width||5,.9);this.object.updateMatrix();this.wagonMesh.setMatrixAt(i,this.object.matrix);this.object.position.z=4.2;this.object.scale.set((w.length||58)+4,(w.width||5)+2,.35);this.object.updateMatrix();this.wagonRoof.setMatrixAt(i,this.object.matrix);});
    this.wagonMesh.count=this.wagonRoof.count=wagons.length;this.wagonMesh.renderOrder=4.6;this.wagonRoof.renderOrder=8;this.stationGroup.add(this.wagonMesh);this.stationRoofs.add(this.wagonRoof);
    if(this.satelliteOn)this.fadeForSatellite();
  }
  /** Volúmenes de la ciudad, por tesela, solo en la vista inclinada. */
  // Edificios de Catastro por teselas de 1 km (tools/build_buildings.py): todos a 350 m de las
  // troncales y una muestra del resto de la ciudad. Se piden de cerca, las más próximas primero y de
  // a dos; las lejanas se sueltan.
  async loadBuildings(base){
    try{
      const r=await fetch(base+'index.json');if(!r.ok)return;const index=await r.json();
      this.buildingIndex={base,size:index.method.tile_m,floor:index.method.floor_height_m||3,coverage:index.coverage,source:index.source,tiles:index.tiles.map(([x,y,count])=>({key:x+'_'+y,x,y,count}))};
      this.buildingTiles=new Map();this.buildingLoading=0;this.small=matchMedia('(max-width:800px)').matches;
      this.buildingGroup=new THREE.Group();this.buildingGroup.visible=false;this.scene.add(this.buildingGroup);
      // Tono claro y con brillo propio: las caras en sombra se acercan a las iluminadas y los edificios
      // acompañan el mapa sin quitarle protagonismo a los buses. Opacos: translúcidos, con tantos
      // superpuestos, se enturbiaban y costaban el doble de dibujar.
      this.buildingMaterial=new THREE.MeshLambertMaterial({color:this.palette.building,emissive:this.palette.buildingGlow,emissiveIntensity:.42});
      this.updateBuildingTiles();
    }catch{}
  }
  /** Vista híbrida, como en las apps de mapas: la foto satelital (Esri World Imagery, pedida en la
   *  misma proyección del mapa, así cae en sus metros sin reproyectar) bajo la calzada de TransMilenio,
   *  con las calles como líneas finas encima y los nombres. Se apagan los rellenos de calles, parques y
   *  agua, y los edificios (vuelven como estaban al quitarla). */
  setSatellite(on){
    on=!!on;const was=this.satelliteOn;this.satelliteOn=on;this.satGroup||=(()=>{const g=new THREE.Group();this.scene.add(g);return g;})();
    this.satGroup.visible=on;
    if(on&&!was){this.buildingsBefore=this.buildingsEnabled!==false;this.buildingsEnabled=false;}
    if(!on&&was)this.buildingsEnabled=this.buildingsBefore??true;
    for(const m of this.contextMeshes||[]){const k=m.userData.key;
      if(['park','water','deck'].includes(k)||(k==='road'&&m.isMesh))m.visible=!on;
      // Las calles como líneas claras sobre la foto: van después de ella.
      if(m.isLineSegments&&(k==='road'||k==='waterLine')){m.renderOrder=on?.04:0;m.material.opacity=on?.45:(k==='road'?.75:.85);m.material.color.set(on?'#ffffff':this.palette[k]);}}
    if(this.depotFill)this.depotFill.visible=!on;
    this.fadeForSatellite();
    if(on)this.updateSatellite();this.updateCamera?.();this.onSatellite?.(on);
  }
  /** Con la foto, la calzada de TransMilenio y los andenes se atenúan para ver lo que hay debajo. */
  fadeForSatellite(){
    for(const g of [this.guidewayGroup,this.stationGroup,this.stationRoofs])g?.traverse(o=>{const m=o.material;if(!m||o.isInstancedMesh&&o!==this.wagonMesh&&o!==this.wagonRoof)return;
      if(!m.userData.base)m.userData.base={transparent:m.transparent,opacity:m.opacity};const b=m.userData.base;
      m.transparent=this.satelliteOn||b.transparent;m.opacity=this.satelliteOn?b.opacity*.55:b.opacity;m.needsUpdate=true;});
  }
  updateSatellite(){
    const side=Math.max(64,2**Math.round(Math.log2(Math.max(64,this.mpp*600)))),cx=this.target[0],cy=this.target[1],reach=Math.ceil(Math.max(this.w,this.h)*this.mpp/side/(this.is3D?1:2))+1;
    this.satTiles||=new Map();this.satLoader||=new THREE.TextureLoader();this.satLoader.crossOrigin='anonymous';
    const wkt=JSON.stringify({wkt:'PROJCS["Bogota_AEQD",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Azimuthal_Equidistant"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-74.136],PARAMETER["Latitude_Of_Origin",4.63027],UNIT["Meter",1.0]]'});
    const px=Math.min(1024,Math.round(side/.3)),keep=new Set();
    for(let i=Math.floor(cx/side)-reach;i<=Math.floor(cx/side)+reach;i++)for(let j=Math.floor(cy/side)-reach;j<=Math.floor(cy/side)+reach;j++){
      const key=side+':'+i+':'+j;keep.add(key);if(this.satTiles.has(key))continue;
      const box=[i*side,j*side,(i+1)*side,(j+1)*side],url='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?'+new URLSearchParams({bbox:box.join(','),bboxSR:wkt,imageSR:wkt,size:px+','+px,format:'jpg',f:'image'});
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(side,side),new THREE.MeshBasicMaterial({color:'#ffffff',depthWrite:false}));
      mesh.position.set(box[0]+side/2,box[1]+side/2,0);mesh.renderOrder=.01+(14-Math.log2(side))*.002;mesh.visible=false;this.satGroup.add(mesh);this.satTiles.set(key,mesh);
      this.satLoader.load(url,t=>{t.colorSpace=THREE.SRGBColorSpace;mesh.material.map=t;mesh.visible=true;mesh.material.needsUpdate=true;});
    }
    // La fecha de captura de la foto en el centro de la vista: puede ser anterior a los datos de OSM e
    // IDECA, y entonces lo nuevo (una troncal, una obra) no sale en ella.
    const [cx0,cy0]=this.target;if(!this.satDateAt||Math.hypot(cx0-this.satDateAt[0],cy0-this.satDateAt[1])>400){this.satDateAt=[cx0,cy0];const ll=aeqdToLonLat(cx0,cy0);
      fetch('https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify?'+new URLSearchParams({geometry:ll.join(','),geometryType:'esriGeometryPoint',sr:'4326',layers:'all',tolerance:'1',mapExtent:[ll[0]-.01,ll[1]-.01,ll[0]+.01,ll[1]+.01].join(','),imageDisplay:'400,400,96',returnGeometry:'false',f:'json'}))
        .then(r=>r.json()).then(d=>{const v=(d.results||[]).map(r=>r.attributes?.['DATE (YYYYMMDD)']||r.attributes?.SRC_DATE).find(x=>/^\d{8}$/.test(x||''));this.satDate=v?`${v.slice(6)}/${v.slice(4,6)}/${v.slice(0,4)}`:null;this.onSatellite?.(this.satelliteOn);}).catch(()=>{});}
    if(this.satTiles.size>160)for(const [key,mesh] of this.satTiles)if(!keep.has(key)){this.satGroup.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();this.satTiles.delete(key);}
  }
  updateBuildingTiles(){
    const idx=this.buildingIndex;if(!idx||this.buildingsEnabled===false||this.mpp>=(this.is3D?14:6))return;
    const size=idx.size,[cx,cy]=this.target,reach=Math.min(this.small?2500:5000,Math.max(900,this.distance*1.6)),want=[];
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
    // Más de 72 teselas en memoria (40 en un teléfono): fuera las más lejanas.
    const loaded=[...this.buildingTiles.values()].filter(Boolean),keep=this.small?40:72;
    if(loaded.length>keep){
      loaded.sort((a,b)=>Math.hypot(cx-(b.userData.tile.x+.5)*size,cy-(b.userData.tile.y+.5)*size)-Math.hypot(cx-(a.userData.tile.x+.5)*size,cy-(a.userData.tile.y+.5)*size));
      for(const mesh of loaded.slice(0,loaded.length-keep)){this.buildingGroup.remove(mesh);mesh.geometry.dispose();this.buildingTiles.delete(mesh.userData.tile.key);}
    }
  }
  setContext(data,streets=[]){
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
    // Las calles de cross_streets.json solo van como franja: de lejos serían ruido.
    const bands=[],high=[],decks=[];
    // Un puente vial corto que solo cruza agua —el paso de una calle sobre un caño— va a nivel, como
    // la calzada de TransMilenio en busway_structures.json: OSM marca la estructura, la vía no sube.
    const box=pts=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of pts){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}return [x0,y0,x1,y1];};
    const touch=(a,b)=>!(a[2]+5<b[0]||b[2]+5<a[0]||a[3]+5<b[1]||b[3]+5<a[1]);
    const side=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const crosses=(P,Q,closed)=>{const n=Q.length-(closed?0:1);for(let i=1;i<P.length;i++)for(let j=0;j<n;j++){const c=Q[j],d=Q[(j+1)%Q.length];if(side(P[i-1],P[i],c)*side(P[i-1],P[i],d)<0&&side(c,d,P[i-1])*side(c,d,P[i])<0)return true;}return false;};
    const waterBoxes=data.features.filter(f=>f.kind==='water').map(f=>[f,box(f.points)]);
    const groundRoads=data.features.filter(f=>f.kind==='road'&&!f.bridge&&!f.tunnel).map(f=>[f,box(f.points)]);
    const atGrade=f=>{let L=0;for(let i=1;i<f.points.length;i++)L+=Math.hypot(f.points[i][0]-f.points[i-1][0],f.points[i][1]-f.points[i-1][1]);if(L>60||(Number(f.layer)||1)>1)return false;
      const b=box(f.points);if(groundRoads.some(([g,gb])=>g!==f&&touch(b,gb)&&crosses(f.points,g.points,false)))return false;
      return waterBoxes.some(([w,wb])=>touch(b,wb)&&crosses(f.points,w.points,w.closed));};
    // Una calle a nivel que cruza sobre un deprimido de la calzada es un puente corto: losa de 1,1 m y
    // pretiles sobre el hueco, para que no quede en el aire ni se vea cortada por los muros de abajo.
    const sunken=(this.data.busway_structures?.structures||[]).filter(t=>t.kind==='tunnel').map(t=>[t,box(t.points)]);
    const slab=(out,a,b,W)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)return;const nx=-(b[1]-a[1])/len,ny=(b[0]-a[0])/len;
      for(const o of [-W,W]){const A=[a[0]+nx*o,a[1]+ny*o],B=[b[0]+nx*o,b[1]+ny*o];
        out.push(A[0],A[1],.9,B[0],B[1],.9,A[0],A[1],-1.1,A[0],A[1],-1.1,B[0],B[1],.9,B[0],B[1],-1.1);}};
    const overSunken=(P,W,out)=>{const b=box(P);for(const [t,tb] of sunken){if(!touch(b,tb))continue;const T=t.points;
      for(let i=1;i<P.length;i++)for(let j=1;j<T.length;j++){const a0=P[i-1],a1=P[i],c=T[j-1],d=T[j],s1=side(a0,a1,c),s2=side(a0,a1,d);
        if(!(s1*s2<0&&side(c,d,a0)*side(c,d,a1)<0))continue;
        const u=s1/(s1-s2),x=[c[0]+(d[0]-c[0])*u,c[1]+(d[1]-c[1])*u],len=Math.hypot(a1[0]-a0[0],a1[1]-a0[1]),ex=(a1[0]-a0[0])/len,ey=(a1[1]-a0[1])/len,h=9;
        slab(out,[x[0]-ex*h,x[1]-ey*h],[x[0]+ex*h,x[1]+ey*h],W);}}};
    // Un puente vial pegado y paralelo a uno de la troncal es la misma estructura (la Calle 9 sobre la
    // Av. 68: un solo puente con el carril de TransMilenio separado). OSM a veces pone las calzadas en
    // otra capa para que no se crucen en el dibujo; aquí van a la altura del puente de la troncal.
    const tmBridges=(this.data.busway_structures?.structures||[]).filter(t=>t.kind==='bridge').map(t=>[t,box(t.points)]);
    const near=(p,T)=>{let best=Infinity,ang=0;for(let i=1;i<T.length;i++){const a=T[i-1],b=T[i],ex=b[0]-a[0],ey=b[1]-a[1],l2=ex*ex+ey*ey;if(!l2)continue;const u=Math.max(0,Math.min(1,((p[0]-a[0])*ex+(p[1]-a[1])*ey)/l2)),d=Math.hypot(p[0]-a[0]-u*ex,p[1]-a[1]-u*ey);if(d<best){best=d;ang=Math.atan2(ey,ex);}}return [best,ang];};
    const sharedWith=(P,skip)=>{const b=box(P);
      for(const [t,tb] of tmBridges){if(t===skip||!touch(b,tb))continue;let ok=0,n=0;
        for(let i=1;i<P.length;i++){const a=P[i-1],c=P[i],m=[(a[0]+c[0])/2,(a[1]+c[1])/2],[d,ang]=near(m,t.points);n++;
          if(d<20&&Math.abs(Math.cos(Math.atan2(c[1]-a[1],c[0]-a[0])-ang))>.95)ok++;}
        if(n&&ok/n>=.7)return t;}
      return null;};
    const sharedLevel=f=>sharedWith(f.points)?.level??null;
    // El hueco entre dos tableros de la misma estructura se tapa con tablero: de cada punto de una
    // calzada al eje de la vecina, a la altura de la primera. Encima va la calzada de la troncal.
    const bridgeGap=(P0,z0,cum0,other,edge)=>{const P=[],cum=[];for(let i=1;i<P0.length;i++){const a=P0[i-1],b=P0[i],l=cum0[i]-cum0[i-1],n=Math.max(1,Math.ceil(l/5));for(let k=i===1?0:1;k<=n;k++){P.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);cum.push(cum0[i-1]+l*k/n);}}const z=z0;const close=p=>{let best=null,bd=Infinity;for(let i=1;i<other.length;i++){const a=other[i-1],b=other[i],ex=b[0]-a[0],ey=b[1]-a[1],l2=ex*ex+ey*ey;if(!l2)continue;const u=Math.max(0,Math.min(1,((p[0]-a[0])*ex+(p[1]-a[1])*ey)/l2)),q=[a[0]+u*ex,a[1]+u*ey],d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<bd){bd=d;best=q;}}return bd<20?best:null;};
      for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],qa=close(a),qb=close(b),za=z(cum[i-1]),zb=z(cum[i]);if(!qa||!qb||za<.3&&zb<.3)continue;
        const ea=edge(a,a,b,qa),eb=edge(b,a,b,qb);high.push(ea[0],ea[1],za,qa[0],qa[1],za,eb[0],eb[1],zb,eb[0],eb[1],zb,qa[0],qa[1],za,qb[0],qb[1],zb);}};
    const edgeToward=W=>(p,a,b,q)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/len,ny=(b[0]-a[0])/len,side=Math.sign((q[0]-p[0])*nx+(q[1]-p[1])*ny)||1;return [p[0]+nx*W*side,p[1]+ny*W*side];};
    for(const [t] of tmBridges){const o=sharedWith(t.points,t);if(!o||t.osm_way_id>o.osm_way_id)continue;
      const P=t.points,cum=[0];for(let i=1;i<P.length;i++)cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
      const L=cum.at(-1),H=t.level*5.5,ramp=Math.min(H/.07,L/3);bridgeGap(P,s=>H*Math.min(1,s/ramp,(L-s)/ramp),cum,o.points,edgeToward(0));}
    for(const f of [...data.features,...streets]){
      if(f.kind!=='road'||f.closed||f.tunnel||f.points.length<2)continue;
      // La calzada de TransMilenio ya la dibuja el motor con sus carriles y sus puentes; las calles
      // vecinas la traen de OSM y la volvían a poner encima, como calle y como puente con rampas propias.
      if(f.name==='TransMilenio'||f.highway==='busway')continue;
      const W=(f.width||7.2)/2;
      const P=fillet(f.points),cum=[0];for(let i=1;i<P.length;i++)cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
      const L=cum.at(-1),H=f.bridge&&!atGrade(f)?(sharedLevel(f)??Math.max(1,Number(f.layer)||1))*5.5:0,ramp=Math.min(H/.07,L/3),z=s=>H?H*Math.min(1,s/ramp,(L-s)/ramp):0;
      for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],len=cum[i]-cum[i-1];if(!len)continue;const nx=-(b[1]-a[1])/len*W,ny=(b[0]-a[0])/len*W,za=z(cum[i-1]),zb=z(cum[i]);
        (za>.3||zb>.3?high:bands).push(a[0]+nx,a[1]+ny,za,a[0]-nx,a[1]-ny,za,b[0]+nx,b[1]+ny,zb,b[0]+nx,b[1]+ny,zb,a[0]-nx,a[1]-ny,za,b[0]-nx,b[1]-ny,zb);
      }
      if(H){const t=sharedWith(f.points);if(t)bridgeGap(P,z,cum,t.points,edgeToward(W));}
      if(H){const N=P.map((p,j)=>{const a=P[Math.max(0,j-1)],b=P[Math.min(P.length-1,j+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return [-dy/l,dx/l];});bridgeParts(decks,P,N,P.map(()=>-W),P.map(()=>W),cum.map(z));}
      else if(sunken.length&&f.name!=='TransMilenio')overSunken(P,W,decks);
    }
    this.roadBands=new THREE.Group();this.contextGroup.add(this.roadBands);this.roadBands.visible=false;
    const bandGeometry=new THREE.BufferGeometry();bandGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bands,3));const bandMesh=new THREE.Mesh(bandGeometry,new THREE.MeshBasicMaterial({color:this.palette.road,depthTest:true,depthWrite:false,side:THREE.DoubleSide}));bandMesh.renderOrder=.12;bandMesh.userData.key='road';this.roadBands.add(bandMesh);
    // El tablero de un puente vial va después de los edificios y de la calzada de abajo: antes la
    // troncal que pasa por debajo se pintaba encima y el puente se veía cortado. Con su propio gris:
    // blanco como la calle se confundía con el suelo y solo se leían los pretiles.
    if(high.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(high,3));const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:this.palette.deck,depthTest:true,depthWrite:false,side:THREE.DoubleSide}));m.renderOrder=4.8;m.userData.key='deck';this.roadBands.add(m);}
    if(decks.length)this.roadBands.add(this.structureMesh(decks));
    this.contextMeshes=[...(this.contextMeshes||[]),...this.roadBands.children];
    if(this.satelliteOn)this.setSatellite(true);
  }
  /** Estructura de los puentes (costados, fondo, vigas y pilas), semitransparente y encima de la
   *  calzada: deja ver lo que pasa debajo, que es la regla del proyecto. Más tenue que antes para que
   *  un cruce de varios niveles no se vuelva una mancha. «Puentes» la quita del todo. */
  structureMesh(vertices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();
    const m=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:this.palette.bridge,transparent:true,opacity:.38,depthWrite:false,side:THREE.DoubleSide}));
    m.renderOrder=8.2;m.userData.key='bridge';m.visible=this.bridgesEnabled!==false;(this.structureMeshes||=[]).push(m);return m;
  }
  /** Cruces peatonales en cebra y puentes peatonales con sus rampas (tools/build_cross_streets.py). */
  setCrossings(data){
    const bars=[];
    for(const c of data.crossings||[]){
      const [a,b]=c.points.length>2?[c.points[0],c.points.at(-1)]:c.points,L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<2)continue;
      const ux=(b[0]-a[0])/L,uy=(b[1]-a[1])/L,hw=(c.width||3)/2,nx=-uy*hw,ny=ux*hw,z=.06;
      // Franjas de 50 cm cada metro, a lo ancho del paso.
      for(let s=.5;s+.5<=L;s+=1){const x0=a[0]+ux*s,y0=a[1]+uy*s,x1=x0+ux*.5,y1=y0+uy*.5;
        bars.push(x0+nx,y0+ny,z,x0-nx,y0-ny,z,x1+nx,y1+ny,z,x1+nx,y1+ny,z,x0-nx,y0-ny,z,x1-nx,y1-ny,z);}
    }
    const solid=[],rails=[];
    for(const f of data.footbridges||[]){
      const P=f.points,hw=f.kind==='deck'?1.5:1.1;let run=0;
      for(let i=1;i<P.length;i++){
        const a=P[i-1],b=P[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;
        const nx=-(b[1]-a[1])/len*hw,ny=(b[0]-a[0])/len*hw,za=a[2],zb=b[2];
        solid.push(a[0]+nx,a[1]+ny,za,a[0]-nx,a[1]-ny,za,b[0]+nx,b[1]+ny,zb,b[0]+nx,b[1]+ny,zb,a[0]-nx,a[1]-ny,za,b[0]-nx,b[1]-ny,zb);
        // Canto del tablero, de 80 cm, y baranda a 1,1 m.
        for(const sd of [1,-1]){const ax=a[0]+nx*sd,ay=a[1]+ny*sd,bx=b[0]+nx*sd,by=b[1]+ny*sd,da=Math.max(0,za-.8),db=Math.max(0,zb-.8);
          solid.push(ax,ay,za,bx,by,zb,ax,ay,da,ax,ay,da,bx,by,zb,bx,by,db);rails.push(ax,ay,za+1.1,bx,by,zb+1.1);}
        // Columnas cada 18 m donde el tablero va alto.
        for(let s=(18-run%18)%18;s<=len;s+=18){const t=s/len,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,z=za+(zb-za)*t-.8;if(z<1)continue;
          const px=nx*.25/hw,py=ny*.25/hw,qx=(b[0]-a[0])/len*.25,qy=(b[1]-a[1])/len*.25;
          for(const [dx,dy] of [[px,py],[qx,qy]])solid.push(x-dx,y-dy,0,x+dx,y+dy,0,x+dx,y+dy,z,x-dx,y-dy,0,x+dx,y+dy,z,x-dx,y-dy,z);}
        run+=len;
      }
    }
    this.crossingGroup?.removeFromParent();this.crossingGroup=new THREE.Group();this.crossingGroup.visible=this.mpp<1.6;this.contextGroup.add(this.crossingGroup);
    this.footbridgeGroup?.removeFromParent();this.footbridgeGroup=new THREE.Group();this.footbridgeGroup.visible=this.mpp<4;this.contextGroup.add(this.footbridgeGroup);
    if(bars.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(bars,3));const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:this.palette.crossing,depthTest:true,depthWrite:false,side:THREE.DoubleSide}));m.renderOrder=.3;m.userData.key='crossing';this.crossingGroup.add(m);}
    // Misma estructura semitransparente que los puentes viales: deja ver lo que pasa debajo.
    if(solid.length){this.footbridgeGroup.add(this.structureMesh(solid));
      const r=new THREE.BufferGeometry();r.setAttribute('position',new THREE.Float32BufferAttribute(rails,3));const l=new THREE.LineSegments(r,new THREE.LineBasicMaterial({color:'#7d8d9b',transparent:true,opacity:.8}));l.renderOrder=4.6;this.footbridgeGroup.add(l);}
    this.contextMeshes=[...(this.contextMeshes||[]),...this.crossingGroup.children,...this.footbridgeGroup.children];
  }

  // --- Buses ------------------------------------------------------------------------------------
  acceptSimulation(simulation,animate=false){
    this.previousVisual=new Map((animate?this.visualBuses||[]:[]).map(b=>[b.id,b]));this.targetSimulation=simulation;this.visualSettled=false;this.visualStart=performance.now();this.visualBuses=simulation.buses;if(!animate)this.updateBuses(simulation);
  }
  animateBuses(now){
    this.stepTransition(now);this.stepPan(now);
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
      if(this.routeBusesOnly&&b.routeId!==this.routeBusesOnly)continue;
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
  // Seguir un bus. Con `chase` la vista además gira con él, como una cámara que va detrás: el rumbo
  // se suaviza (constante de ~1,2 s) para que las curvas no mareen, y no se mueve con el bus quieto,
  // cuyo ángulo en una terminal o un giro cerrado salta.
  follow(xy,dt,angle){
    const step=Math.min(.1,Math.max(0,dt)),now=performance.now();this.lastFollowAt=now;this.pan=null;
    if(this.chase&&Number.isFinite(angle)){
      const moved=this.lastChaseXY?Math.hypot(xy[0]-this.lastChaseXY[0],xy[1]-this.lastChaseXY[1]):0;this.lastChaseXY=xy.slice();
      if(moved>.05){const want=Math.PI/2-angle;let d=want-this.bearing;d=((d+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
        this.bearing=((this.bearing+d*(1-Math.exp(-step/1.2)))%(2*Math.PI)+2*Math.PI)%(2*Math.PI);this.updateCompass?.();}
    }
    const [dx,dy]=this.focusShift(),blend=1-Math.exp(-step*15);this.target[0]+=(xy[0]+dx-this.target[0])*blend;this.target[1]+=(xy[1]+dy-this.target[1])*blend;
    const labels=!this.lastFollowLabels||now-this.lastFollowLabels>150;if(labels)this.lastFollowLabels=now;this.updateCamera({labels});
  }
  setChase(on){this.chase=!!on;this.lastChaseXY=null;if(this.chase&&!this.is3D)this.setView('3d');this.onChase?.(this.chase);}
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
    this.stationGroup.traverse(recolor);this.stationRoofs.traverse(recolor);this.guidewayGroup?.traverse(recolor);this.buildingGroup?.traverse(recolor);this.depotGroup?.traverse(recolor);if(this.crowdMesh)this.setCrowd(this.crowdList);if(this.buildingMaterial)this.buildingMaterial.emissive.set(this.palette.buildingGlow);
    for(const mesh of (this.carriagewayGroup?.children||[]))mesh.material.color.set(mesh.userData.palette[this.dark?1:0]);
  }
  render(){this.renderer.render(this.scene,this.camera);}
}
