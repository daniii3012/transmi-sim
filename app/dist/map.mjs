import {MetricPath} from './simulation.mjs?v=20260913.7';
import {signalPhase} from './signals.mjs?v=20260913.7';
import * as THREE from './vendor/three.module.js';

export class NetworkMap {
  constructor(host, labels, data, onSelect) {
    this.host=host; this.labels=labels;this.labelEntries=new Map(); this.data=data; this.onSelect=onSelect;
    this.routeId=null;this.routeSet=new Set(data.routes.filter(r=>r.ready).map(r=>r.id));this.metricPaths=new Map(data.routes.filter(r=>r.ready).map(r=>[r.id,new MetricPath(r.points)]));this.contextGroup=new THREE.Group();this.center=[0,0]; this.mpp=30; this.selected=null; this.busSamples=[];
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setClearColor('#edf1f4'); host.append(this.renderer.domElement);
    this.scene=new THREE.Scene();
    this.camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100); this.camera.position.z=20;
    this.scene.add(this.contextGroup);this.paths=[];
    this.streetGroup=new THREE.Group();this.scene.add(this.streetGroup);
    for(const points of data.street_context||[]){const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p,0)));const line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#8d9aa5',dashSize:18,gapSize:12,transparent:true,opacity:.65,depthTest:false}));line.computeLineDistances();line.renderOrder=.8;this.streetGroup.add(line);}

    this.routeGroup=new THREE.Group();this.scene.add(this.routeGroup);
    this.highlight=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:'#dc253b',depthTest:false,transparent:true,opacity:.95}));this.highlight.renderOrder=2;this.scene.add(this.highlight);
    this.clusterLayer=document.createElement('div');this.clusterLayer.className='clusters';host.parentElement.append(this.clusterLayer);this.clusterLayer.setAttribute('aria-hidden','true');this.clusterLayer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';
    for(const c of data.corridors.filter(c=>c.kind!=='street')){
      const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:c.color,transparent:true,opacity:c.zone==='Z'?.25:.88,depthTest:false}));
      mesh.renderOrder=1; this.scene.add(mesh); this.paths.push({c,mesh});
    }
    this.stopOuter=new THREE.InstancedMesh(new THREE.CircleGeometry(1,16),new THREE.MeshBasicMaterial({color:'#6c7c8a',depthTest:false}),data.stations.length);
    this.stopInner=new THREE.InstancedMesh(new THREE.CircleGeometry(1,16),new THREE.MeshBasicMaterial({color:'#ffffff',depthTest:false}),data.stations.length);
    this.stopOuter.renderOrder=2;this.stopInner.renderOrder=3;
    this.stopOuter.frustumCulled=false;this.stopInner.frustumCulled=false;
    this.scene.add(this.stopOuter,this.stopInner);
    this.marker=new THREE.Mesh(new THREE.RingGeometry(.7,1,24),new THREE.MeshBasicMaterial({color:'#dc253b',depthTest:false}));
    this.marker.renderOrder=7;this.marker.visible=false;this.scene.add(this.marker);
    this.wagonBorder=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:'#97a8b7',depthTest:false}),3000);this.wagonBorder.renderOrder=3.5;this.wagonBorder.frustumCulled=false;this.scene.add(this.wagonBorder);
    this.wagonMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:'#f9fafb',depthTest:false}),3000);this.wagonMesh.renderOrder=4;this.wagonMesh.frustumCulled=false;this.scene.add(this.wagonMesh);
    this.axes=new Map();for(const r of data.routes.filter(r=>r.ready)){const path=new MetricPath(r.points);for(const st of r.stops){const angle=path.sample(st.at_m).angle,sum=this.axes.get(st.station_id)||[0,0];sum[0]+=Math.cos(2*angle);sum[1]+=Math.sin(2*angle);this.axes.set(st.station_id,sum);}}
    this.buildCarriageways();
    this.buildStationGeometry();
    this.signalsEnabled=true;const signalCount=data.busway_signals?.signals.length||0;
    if(signalCount){this.signalMesh=new THREE.InstancedMesh(new THREE.CircleGeometry(1,12),new THREE.MeshBasicMaterial({depthTest:false}),signalCount);this.signalMesh.frustumCulled=false;this.signalMesh.renderOrder=4.5;this.scene.add(this.signalMesh);}
    this.object=new THREE.Object3D(); this.w=1;this.h=1;
    this.resizeObserver=new ResizeObserver(()=>{this.resize();});this.resizeObserver.observe(host);
    this.resize(); this.fitNetwork(); this.bind();
  }
  // Los paneles tapan parte del lienzo, así que el centro útil no es el geométrico. El mismo
  // cálculo sirve para encuadrar y para centrar o seguir: lo que se mira tiene que caer en el
  // hueco libre y no debajo de la hoja inferior, que en el móvil se lleva media pantalla.
  insets(){
    const mobile=this.w<800,left=mobile?18:350;
    const inspector=document.querySelector('#inspector');
    const right=!mobile&&this.w>1100&&!inspector.hidden?400:60;
    const top=mobile?120:70;
    // Qué panel tapa abajo se decide por lo que se ve ahora mismo, no por la marca del cuerpo: esa
    // la pone un observador y llega un instante tarde. Al saltar de una estación a su servicio en
    // vivo la ficha ya estaba oculta y la marca todavía decía que no, así que se medía un
    // rectángulo de altura cero y el encuadre salía disparado hacia arriba.
    const panel=inspector.hidden?document.querySelector('#sidebar'):inspector;
    const rect=panel?.getBoundingClientRect();
    const bottom=mobile&&rect?.height?Math.max(40,this.host.getBoundingClientRect().bottom-rect.top+20):document.body.dataset.panel==='live'?100:235;
    return {left,right,top,bottom};
  }
  // Cuánto hay que correr el centro para que un punto quede en medio del hueco. Se recuerda unas
  // décimas porque seguir un bus lo pregunta en cada fotograma y medir los paneles obliga al
  // navegador a recalcular la página.
  focusShift({fresh=false}={}){
    const now=performance.now();
    if(fresh||!this.shiftCache||now-this.shiftCache.at>200||this.shiftCache.mpp!==this.mpp){
      const {left,right,top,bottom}=this.insets();
      this.shiftCache={at:now,mpp:this.mpp,value:[-(left-right)/2*this.mpp,(top-bottom)/2*this.mpp]};
    }
    return this.shiftCache.value;
  }
  focusOn(xy,mpp){if(mpp!==undefined)this.mpp=mpp;const [dx,dy]=this.focusShift({fresh:true});this.center=[xy[0]+dx,xy[1]+dy];this.updateCamera();}
  fit(bounds){const {left,right,top,bottom}=this.insets();this.mpp=Math.max((bounds[2]-bounds[0])/Math.max(100,this.w-left-right),(bounds[3]-bounds[1])/Math.max(100,this.h-top-bottom),.3);this.center=[(bounds[0]+bounds[2])/2-(left-right)/2*this.mpp,(bounds[1]+bounds[3])/2+(top-bottom)/2*this.mpp];this.updateCamera();}
  fitNetwork(){this.fit(this.data.bounds);}
  fitPilot(){this.fitNetwork();}
  focusStation(station){const layout=this.data.station_layouts?.stations.find(s=>s.station_id===station.id);const points=layout?[...layout.platforms,...layout.areas].flatMap(p=>p.points):[];if(points.length){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);this.fit([Math.min(...xs)-45,Math.min(...ys)-45,Math.max(...xs)+45,Math.max(...ys)+45]);}else this.focusOn(station.xy,.8);}
  fitPoints(points){this.fit([Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))-80,Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))+80]);}
  resize(){this.w=this.host.clientWidth;this.h=this.host.clientHeight;if(!this.w||!this.h)return;this.renderer.setSize(this.w,this.h);this.updateCamera();}
  worldToScreen(p){return [(p[0]-this.center[0])/this.mpp+this.w/2, (this.center[1]-p[1])/this.mpp+this.h/2];}
  screenToWorld(p){return [this.center[0]+(p[0]-this.w/2)*this.mpp,this.center[1]-(p[1]-this.h/2)*this.mpp];}
  zoom(factor, anchor=[this.w/2,this.h/2]){const before=this.screenToWorld(anchor);this.mpp=Math.max(.12,Math.min(160,this.mpp*factor));const after=this.screenToWorld(anchor);this.center[0]+=before[0]-after[0];this.center[1]+=before[1]-after[1];this.updateCamera();}
  updateCamera({labels=true}={}){
    Object.assign(this.camera,{left:-this.w*this.mpp/2,right:this.w*this.mpp/2,top:this.h*this.mpp/2,bottom:-this.h*this.mpp/2});
    this.camera.position.set(this.center[0],this.center[1],20);this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
    if(this.builtMpp!==this.mpp){
    this.builtMpp=this.mpp;for(const line of this.streetGroup.children){line.material.dashSize=Math.max(12,this.mpp*5);line.material.gapSize=Math.max(8,this.mpp*3);}
    for(const {c,mesh} of this.paths){
      const vertices=[];const width=Math.max(9,this.mpp*3.2);
      for(const line of c.components)for(let i=1;i<line.length;i++){
        const [x,y]=line[i-1],[a,b]=line[i],len=Math.hypot(a-x,b-y);if(len<1e-6)continue;
        const dx=-(b-y)/len*width/2,dy=(a-x)/len*width/2;
        vertices.push(x+dx,y+dy,0,x-dx,y-dy,0,a+dx,b+dy,0,a+dx,b+dy,0,x-dx,y-dy,0,a-dx,b-dy,0);
      }
      mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    }
    this.data.stations.forEach((s,i)=>{
      const radius=Math.max(3,this.mpp*(this.mpp<5?4.5:2.7));this.object.position.set(...s.xy,1);this.object.rotation.z=0;
      this.object.scale.set(radius,radius,1);this.object.updateMatrix();this.stopOuter.setMatrixAt(i,this.object.matrix);
      this.object.scale.set(radius*.62,radius*.62,1);this.object.updateMatrix();this.stopInner.setMatrixAt(i,this.object.matrix);
    });
    this.rebuildHighlight();this.updateWagons();this.stopOuter.instanceMatrix.needsUpdate=true;this.stopInner.instanceMatrix.needsUpdate=true;
    }
    if(labels)this.updateLabels();this.positionLabels();this.updateMarker();this.updateScale();if(this.stationGroup)this.stationGroup.visible=this.mpp<3;
    if(this.infrastructureGroup)this.infrastructureGroup.visible=this.mpp<8;
    if(this.carriagewayGroup)this.carriagewayGroup.visible=this.carriagewaysEnabled!==false&&this.mpp<6;
    if(this.lastSimulation)this.updateBuses(this.lastSimulation,'all',true);
    if(this.liveVisual?.length)this.updateLive();
    if(this.networkVehicles?.length)this.updateNetwork();
  }
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
  updateScale(){const approx=this.mpp*100;const power=10**Math.floor(Math.log10(approx));const step=[1,2,5,10].find(n=>n*power>=approx)*power;const el=document.querySelector('#scale');el.textContent=step>=1000?(step/1000)+' km':step+' m';el.style.width=step/this.mpp+'px';}
  select(kind,id,label){this.selected={kind,id,label};this.updateMarker();this.updateLabels();}
  // Un bus real se busca en las dos capas: la lectura GPS de un servicio y la instantánea de la
  // red. Comparten el identificador de viaje, así que el que esté a la vista responde.
  // Las dos fuentes numeran distinto: el id del alimentador es interno y el de la lectura por
  // servicio es otro, pero las dos rotulan el bus con su número de flota. Buscar también por ese
  // número hace que una selección siga al mismo bus al cambiar de vista, en vez de perderlo —o,
  // peor, de engancharse a otro que casualmente comparta el id.
  realBus(id,label){const igual=b=>b.id===id||(!!label&&b.label===label);return (this.liveVisual||[]).find(igual)||(this.networkVehicles||[]).find(igual)||null;}
  selectedItem(){
    const chosen=this.selected;if(!chosen)return null;
    if(chosen.kind==='station')return this.data.stations.find(s=>s.id===chosen.id)||null;
    if(chosen.kind==='realbus')return this.realBus(chosen.id,chosen.label);
    return this.busSamples.find(b=>b.id===chosen.id)||null;
  }
  updateMarker(){const item=this.selectedItem();if(!item){this.marker.visible=false;return;}this.marker.visible=true;this.marker.position.set(...item.xy,4);this.marker.scale.setScalar(Math.max(10,this.mpp*11));}
  bind(){
    const pointers=new Map();let gesture=null;
    const startGesture=()=>{
      const values=[...pointers.values()];
      gesture={center:[...this.center],mpp:this.mpp,values,moved:false};
    };
    this.host.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      this.host.focus({preventScroll:true});this.host.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId,[e.clientX,e.clientY]);startGesture();
    });
    this.host.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId)||!gesture)return;
      pointers.set(e.pointerId,[e.clientX,e.clientY]);const values=[...pointers.values()];
      const midpoint=a=>a.length>1?[(a[0][0]+a[1][0])/2,(a[0][1]+a[1][1])/2]:a[0];
      const before=midpoint(gesture.values),after=midpoint(values),r=this.host.getBoundingClientRect();
      if(values.length>1&&gesture.values.length>1){
        const distance=a=>Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]);
        this.mpp=Math.max(.15,Math.min(100,gesture.mpp*distance(gesture.values)/Math.max(1,distance(values))));
      }
      const x=before[0]-r.left-r.width/2,y=before[1]-r.top-r.height/2;
      this.center=[gesture.center[0]+x*gesture.mpp-(after[0]-r.left-r.width/2)*this.mpp,gesture.center[1]-y*gesture.mpp+(after[1]-r.top-r.height/2)*this.mpp];
      gesture.moved ||= values.length>1||Math.hypot(after[0]-before[0],after[1]-before[1])>5;
      this.onPan?.();this.updateCamera();
    });
    const end=e=>{
      if(!pointers.has(e.pointerId))return;
      const click=e.type==='pointerup'&&pointers.size===1&&!gesture?.moved;
      pointers.delete(e.pointerId);if(pointers.size){startGesture();gesture.moved=true;}else gesture=null;
      if(click){const r=this.host.getBoundingClientRect();this.pick([e.clientX-r.left,e.clientY-r.top]);}
    };
    this.host.addEventListener('pointerup',end);this.host.addEventListener('pointercancel',end);
    this.host.addEventListener('wheel',e=>{e.preventDefault();const r=this.host.getBoundingClientRect();this.zoom(Math.exp(Math.max(-1,Math.min(1,e.deltaY*(e.ctrlKey?.018:.004)))),[e.clientX-r.left,e.clientY-r.top]);},{passive:false});
    this.host.addEventListener('keydown',e=>{const offsets={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,80],ArrowDown:[0,-80]};if(offsets[e.key]){e.preventDefault();this.center[0]+=offsets[e.key][0]*this.mpp;this.center[1]+=offsets[e.key][1]*this.mpp;this.onPan?.();this.updateCamera();}else if(['+','=','-'].includes(e.key)){e.preventDefault();this.zoom(e.key==='-'?1.3:1/1.3);}});
  }
  pick(point){
    const distanceTo=item=>{const p=this.worldToScreen(item.xy);return Math.hypot(point[0]-p[0],point[1]-p[1]);};
    const nearest=items=>{let best=null,limit=globalThis.matchMedia?.('(pointer:coarse)').matches?24:12;for(const item of items||[]){const d=distanceTo(item);if(d<limit){best=item;limit=d;}}return best;};
    let chosen=null;
    if(this.simulationVisible===false){
      // Con la simulación oculta —la pestaña En vivo— se eligen los buses reales, pero las dos
      // capas no se comportan igual frente a una estación. La lectura GPS cae donde está el bus,
      // casi siempre entre paradas, y se lleva un margen de 4 px por ir dibujada encima. La
      // instantánea, en cambio, ancla cada vehículo a su parada: ahí el margen dejaría sin abrir
      // toda estación con un bus encima, que a estas horas son casi todas, así que manda la
      // distancia y cada cosa se alcanza apuntándole.
      const station=this.data.stations, gps=nearest(this.liveVisual);
      const cerca=nearest(station), snapshot=nearest(this.networkVehicles);
      if(gps&&(!cerca||distanceTo(gps)-4<=distanceTo(cerca)))chosen={kind:'realbus',id:gps.id,label:gps.label||''};
      else if(snapshot&&(!cerca||distanceTo(snapshot)<distanceTo(cerca)))chosen={kind:'realbus',id:snapshot.id,label:snapshot.label||''};
      else if(cerca)chosen={kind:'station',id:cerca.id};
    }else{
      let limit=12;
      for(const [kind,items] of [['bus',this.busSamples],['station',this.data.stations]])for(const item of items){const d=distanceTo(item);if(d<limit){chosen={kind,id:item.id};limit=d;}}
    }
    if(chosen){this.select(chosen.kind,chosen.id,chosen.label);this.onSelect(chosen);}
  }
  // Acepta un identificador o varios: los servicios numerados tienen un registro por sentido y se
  // resaltan juntos.
  setRoute(id,{subtle=false}={}){this.journey=null;this.routeId=id;this.subtleRoute=subtle;this.rebuildHighlight();}
  setJourney(legs){this.routeId=null;this.subtleRoute=false;this.journey=legs;this.rebuildHighlight();}
  rebuildHighlight(){
    const ids=this.routeId==null?[]:[this.routeId].flat();
    const routes=this.journey||this.data.routes.filter(r=>ids.includes(r.id)&&r.ready),focused=!!ids.length||!!this.journey?.length;
    const vertices=[],colors=[];for(const r of routes){const color=new THREE.Color(r.color),width=Math.max(4,this.mpp*(focused?5:2.1));for(let i=1;i<r.points.length;i++){const [x,y]=r.points[i-1],[a,b]=r.points[i],len=Math.hypot(a-x,b-y);if(!len)continue;const dx=-(b-y)/len*width/2,dy=(a-x)/len*width/2;vertices.push(x+dx,y+dy,0,x-dx,y-dy,0,a+dx,b+dy,0,a+dx,b+dy,0,x-dx,y-dy,0,a-dx,b-dy,0);for(let j=0;j<6;j++)colors.push(color.r,color.g,color.b);}}
    this.highlight.geometry.dispose();this.highlight.geometry=new THREE.BufferGeometry();this.highlight.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.highlight.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));this.highlight.material.vertexColors=true;this.highlight.material.color.set('#ffffff');this.highlight.material.needsUpdate=true;
    this.highlight.material.opacity=this.subtleRoute?.62:.98;for(const {mesh} of this.paths)mesh.material.opacity=this.corridorsFaded?.07:focused?(this.subtleRoute?.24:.3):.86;
    for(const line of this.streetGroup.children)line.material.opacity=this.corridorsFaded?.08:.65;
  }
  // Las troncales casi apagadas: sirven de referencia pero dejan ver la ciudad y la estación.
  setCorridorsFaded(faded){this.corridorsFaded=faded;this.rebuildHighlight();}
  buildCarriageways(){
    // Actual OSM carriageway, drawn as context under the coloured corridors. Width follows the
    // published lanes tag where OSM has one; ways without it get a single lane so nothing is
    // invented. The buses keep following the published route polyline, not this geometry.
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
    // Opaque on purpose: a transparent material would be drawn in Three's transparent pass,
    // after every opaque layer, and would cover the stations, signals and buses no matter what
    // renderOrder it carried. Subtlety comes from a colour close to the ground, not from alpha.
    for(const [vertices,palette] of [[exclusive,['#dfe5ea','#222e3b']],[shared,['#e6eaee','#1d2733']]]){
      if(!vertices.length)continue;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:palette[0],depthTest:false}));
      mesh.renderOrder=.2;mesh.userData.palette=palette;this.carriagewayGroup.add(mesh);
    }
  }
  buildStationGeometry(){
    this.stationGroup=new THREE.Group();this.scene.add(this.stationGroup);this.layoutIds=new Set();
    const add=(points,palette,order,closed=false)=>{
      const geometry=new THREE.BufferGeometry();let object;
      if(closed){const contour=points.slice(0,-1).map(p=>new THREE.Vector2(...p)),vertices=[];for(const tri of THREE.ShapeUtils.triangulateShape(contour,[]))for(const i of tri)vertices.push(contour[i].x,contour[i].y,0);geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));object=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:palette[0],side:THREE.DoubleSide,depthTest:false}));}
      else {geometry.setFromPoints(points.map(p=>new THREE.Vector3(...p,0)));object=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:palette[0],depthTest:false}));}
      object.renderOrder=order;object.userData.palette=palette;this.stationGroup.add(object);
    };
    for(const layout of this.data.station_layouts?.stations||[]){
      this.layoutIds.add(layout.station_id);
      for(const line of layout.internal_lines)add(line.points,['#c8d2db','#4d6274'],.6);
      for(const area of layout.areas.filter(a=>a.closed)){add(area.points,['#dbe1e6','#425565'],2.3,true);add(area.points,['#9aaab7','#879cae'],2.4);}
      for(const p of layout.platforms.filter(p=>p.points.length>1)){if(p.closed)add(p.points,['#f8fafb','#607689'],3.5,true);add(p.points,['#879dac','#a5bbce'],3.6);}
      for(const p of layout.platforms.filter(p=>p.role==='trunk_stop_position'&&p.points.length===1)){const dot=new THREE.Mesh(new THREE.CircleGeometry(2.4,12),new THREE.MeshBasicMaterial({color:'#6c8798',depthTest:false}));dot.position.set(...p.points[0],0);dot.renderOrder=3.7;dot.userData.palette=['#6c8798','#bad0df'];this.stationGroup.add(dot);}
    }
  }
  updateWagons(){
    this.wagonBorder.visible=this.wagonMesh.visible=this.mpp<2.2;let i=0;if(this.wagonMesh.visible)for(const s of this.data.stations){if(s.kind==='street'||s.status==='En obras'||this.layoutIds.has(s.id))continue;const sum=this.axes.get(s.id)||[1,0],angle=Math.atan2(sum[1],sum[0])/2,n=s.wagons||2;for(let w=1;w<=n;w++){const offset=(w-(n+1)/2)*64;this.object.position.set(s.xy[0]+Math.cos(angle)*offset,s.xy[1]+Math.sin(angle)*offset,2);this.object.rotation.z=angle;this.object.scale.set(60,7,1);this.object.updateMatrix();this.wagonBorder.setMatrixAt(i,this.object.matrix);this.object.scale.set(58,5,1);this.object.updateMatrix();this.wagonMesh.setMatrixAt(i++,this.object.matrix);}}
    this.wagonMesh.count=this.wagonBorder.count=i;this.wagonMesh.instanceMatrix.needsUpdate=this.wagonBorder.instanceMatrix.needsUpdate=true;
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
    const add=(points,color,line=false,opacity=1)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const mesh=line?new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity})):new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,depthTest:false,side:THREE.DoubleSide}));mesh.renderOrder=0;this.contextGroup.add(mesh);(this.contextMeshes||=[]).push(mesh);};
    this.infrastructureGroup=new THREE.Group();this.contextGroup.add(this.infrastructureGroup);this.infrastructureGroup.visible=this.mpp<8;
    const rails=[];for(const f of data.features.filter(f=>f.bridge&&!f.tunnel))for(let i=1;i<f.points.length;i++){
      const a=f.points[i-1],b=f.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;
      const nx=-(b[1]-a[1])/len*6,ny=(b[0]-a[0])/len*6;
      for(const side of [-1,1])rails.push(a[0]+nx*side,a[1]+ny*side,0,b[0]+nx*side,b[1]+ny*side,0);
    }
    const railGeometry=new THREE.BufferGeometry();railGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rails,3));const railMesh=new THREE.LineSegments(railGeometry,new THREE.LineBasicMaterial({color:'#8394a3',depthTest:false,transparent:true,opacity:.8}));railMesh.renderOrder=3;this.infrastructureGroup.add(railMesh);
    // Only explicit OSM tunnel tags get a dashed context line; no inferred grade or turns.
    for(const f of data.features.filter(f=>f.tunnel)){const geometry=new THREE.BufferGeometry().setFromPoints(f.points.map(p=>new THREE.Vector3(...p,0)));const line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#7f93a3',dashSize:12,gapSize:9,depthTest:false,transparent:true,opacity:.7}));line.computeLineDistances();line.renderOrder=.5;this.infrastructureGroup.add(line);}
    add(parks,'#d4e3d8');add(water,'#c5dce8');add(roads,'#ffffff',true,.75);add(waterLines,'#b6d5e4',true,.85);add(bridges,'#c1cbd5',true,.75);
  }
  acceptSimulation(simulation,animate=false){
    this.previousVisual=new Map((animate?this.visualBuses||[]:[]).map(b=>[b.id,b]));this.targetSimulation=simulation;this.visualSettled=false;this.visualStart=performance.now();this.visualBuses=simulation.buses;if(!animate)this.updateBuses(simulation);
  }
  animateBuses(now){
    if(!this.targetSimulation||this.visualSettled)return;
    const blend=Math.min(1,(now-this.visualStart)/60);
    this.visualBuses=this.targetSimulation.buses.map(b=>{const a=this.previousVisual.get(b.id);if(!a||blend>=1||a.state!==b.state||a.routeId!==b.routeId||b.s<a.s)return b;const s=a.s+(b.s-a.s)*blend,pose=this.metricPaths.get(b.routeId).sample(s);return {...b,s,xy:pose.xy,angle:pose.angle};});
    this.updateBuses({...this.targetSimulation,buses:this.visualBuses});this.visualSettled=blend>=1;
  }
  updateBuses(simulation,filter='all',forceClusters=false){
    this.lastSimulation=simulation;const buses=simulation.buses;this.updateSignals(simulation.time);
    if(!this.busMesh||this.busCapacity<buses.length){
      if(this.busMesh){for(const m of [this.busMesh,this.busNose]){this.scene.remove(m);m.dispose();m.geometry.dispose();m.material.dispose();}}
      this.busCapacity=Math.max(2048,buses.length*2);
      this.busMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({depthTest:false}),this.busCapacity);
      this.busNose=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:'#ffffff',depthTest:false}),this.busCapacity);
      this.busMesh.renderOrder=5;this.busNose.renderOrder=6;for(const m of [this.busMesh,this.busNose]){m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.visible=this.simulationVisible!==false;this.scene.add(m);}
    }
    this.busSamples=[];let i=0;const color=new THREE.Color(),cells=new Map(),clusters=[];
    for(const b of buses){
      if(filter!=='all'&&filter!==b.routeId)continue;
      const travelling=b.state==='moving'||b.state==='signal'||b.state==='traffic',side=Math.max(travelling?7:3,this.mpp*(travelling?2.5:1)),xy=[b.xy[0]+Math.sin(b.angle)*side,b.xy[1]-Math.cos(b.angle)*side];
      if(b.state==='dwell'&&!b.street){const offset=b.slot?14.5:-14.5;xy[0]+=Math.cos(b.angle)*offset;xy[1]+=Math.sin(b.angle)*offset;}
      if(b.state==='queue'){xy[0]-=Math.cos(b.angle)*24;xy[1]-=Math.sin(b.angle)*24;}
      const screen=this.worldToScreen(xy);if(screen[0]<-20||screen[0]>this.w+20||screen[1]<-20||screen[1]>this.h+20)continue;
      if(this.mpp>10&&b.id!==this.selected?.id){const key=Math.floor(screen[0]/28)+':'+Math.floor(screen[1]/28),cell=cells.get(key);if(cell){cell.count++;continue;}const c={count:1,xy,screen};cells.set(key,c);clusters.push(c);}
      this.busSamples.push({id:b.id,xy});
      const length=Math.max(b.length_m||this.data.vehicle.length_m,this.mpp*8),width=Math.max(this.data.vehicle.width_m,this.mpp*3.4);
      this.object.position.set(...xy,3);this.object.rotation.z=b.angle;this.object.scale.set(length,width,1);this.object.updateMatrix();this.busMesh.setMatrixAt(i,this.object.matrix);color.set(b.color);this.busMesh.setColorAt(i,color);
      this.object.position.set(xy[0]+Math.cos(b.angle)*length*.25,xy[1]+Math.sin(b.angle)*length*.25,3.1);this.object.scale.set(length*.16,width*.7,1);this.object.updateMatrix();this.busNose.setMatrixAt(i,this.object.matrix);i++;
    }
    if(this.simulationVisible!==false&&(forceClusters||!this.lastClusterTime||performance.now()-this.lastClusterTime>300)){this.lastClusterTime=performance.now();this.clusterLayer.replaceChildren();for(const c of clusters.filter(c=>c.count>5).sort((a,b)=>b.count-a.count).slice(0,32)){const el=document.createElement('div');el.className='cluster-label';el.textContent=c.count;el.style.left=c.screen[0]+5+'px';el.style.top=c.screen[1]-16+'px';this.clusterLayer.append(el);}}
    this.visibleBuses=i;this.busMesh.count=i;this.busNose.count=i;this.busMesh.instanceMatrix.needsUpdate=true;if(this.busMesh.instanceColor)this.busMesh.instanceColor.needsUpdate=true;this.busNose.instanceMatrix.needsUpdate=true;this.updateMarker();
  }
  // Instantánea de toda la red. Es otra fuente que la capa de un servicio —posición calculada por
  // el planificador, no la lectura GPS del bus—, así que se dibuja más pequeña y sin número, y se
  // atenúa cuando hay un servicio en foco para que no compita con él.
  setNetworkBuses(vehicles,{dimmed=false}={}){
    // El 97% de los vehículos conserva su identificador entre lecturas, así que se unen las dos
    // posiciones observadas en vez de saltar. No se extrapola más allá de la última.
    const previous=new Map((this.networkVehicles||[]).map(v=>[v.id,v.xy]));
    this.networkDimmed=dimmed;this.networkTarget=vehicles;this.networkStart=performance.now();
    this.networkSettled=!vehicles.length;this.networkPrevious=previous;
    this.networkVehicles=vehicles.map(v=>({...v,xy:previous.get(v.id)||v.xy}));
    this.updateNetwork();
  }
  // Cambiar solo la atenuación no es una lectura nueva: reaplicar la lista entera congelaría a
  // mitad de camino cualquier interpolación en curso.
  setNetworkDimmed(dimmed){if(dimmed===this.networkDimmed)return;this.networkDimmed=dimmed;this.updateNetwork();}
  animateNetwork(now){
    if(!this.networkTarget||this.networkSettled)return;
    const blend=Math.min(1,(now-this.networkStart)/1200),ease=blend*(2-blend);
    this.networkVehicles=this.networkTarget.map(v=>{const from=this.networkPrevious.get(v.id);return from?{...v,xy:[from[0]+(v.xy[0]-from[0])*ease,from[1]+(v.xy[1]-from[1])*ease]}:v;});
    this.networkSettled=blend>=1;this.updateNetwork();
  }
  updateNetwork(){
    const vehicles=this.networkVehicles||[];
    if(!vehicles.length&&!this.networkHalo)return;
    if(!this.networkHalo){
      // Mismo contorno que la capa de un servicio, sin la flecha de rumbo: el planificador no
      // publica rumbo, y un punto plano se confunde con el color de la troncal que tiene debajo.
      this.networkHalo=new THREE.InstancedMesh(new THREE.CircleGeometry(1,14),new THREE.MeshBasicMaterial({depthTest:false,transparent:true}),4096);
      this.networkDot=new THREE.InstancedMesh(new THREE.CircleGeometry(1,14),new THREE.MeshBasicMaterial({depthTest:false,transparent:true}),4096);
      for(const [mesh,order] of [[this.networkHalo,7.4],[this.networkDot,7.5]]){mesh.renderOrder=order;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(mesh);}
    }
    // Con un servicio en foco la instantánea pierde el contorno y baja de opacidad: el anillo
    // blanco es la marca de la lectura GPS, y dos contornos iguales compiten por la atención.
    const opacity=this.networkDimmed?.55:1;
    this.networkHalo.visible=!this.networkDimmed;
    this.networkHalo.material.color.set(this.dark?'#e8eef6':'#ffffff');this.networkHalo.material.opacity=opacity;
    this.networkDot.material.color.set('#ffffff');this.networkDot.material.opacity=opacity;
    const tint=new THREE.Color();let i=0;
    for(const vehicle of vehicles){
      if(i>=4096)break;
      const screen=this.worldToScreen(vehicle.xy);
      if(screen[0]<-30||screen[0]>this.w+30||screen[1]<-30||screen[1]>this.h+30)continue;
      // El radio se fija en píxeles y no en metros: alejado, un punto de 2 px no se ve.
      const radius=Math.max(this.networkDimmed?5.5:6.5,this.mpp*(this.networkDimmed?3.2:4));
      this.object.rotation.z=0;this.object.position.set(vehicle.xy[0],vehicle.xy[1],5.4);this.object.scale.setScalar(radius);this.object.updateMatrix();
      this.networkHalo.setMatrixAt(i,this.object.matrix);
      this.object.position.set(vehicle.xy[0],vehicle.xy[1],5.5);this.object.scale.setScalar(radius*.58);this.object.updateMatrix();
      this.networkDot.setMatrixAt(i,this.object.matrix);tint.set(vehicle.color||'#8b98a8');this.networkDot.setColorAt(i,tint);i++;
    }
    for(const mesh of [this.networkHalo,this.networkDot]){mesh.count=i;mesh.instanceMatrix.needsUpdate=true;}
    if(this.networkDot.instanceColor)this.networkDot.instanceColor.needsUpdate=true;
  }
  // Buses reales del servicio en vivo. Se dibujan como marca redonda encima del escenario para
  // que nunca se confundan con los buses del modelo, que son rectángulos. Entre dos lecturas se
  // interpola 1,2 s por continuidad visual; no se extrapola más allá de la última posición real.
  // La pestaña En vivo esconde la flota simulada: dos flotas encima de la misma troncal no se
  // distinguen, y la pregunta ahí es dónde están los buses de verdad. Los semáforos se van con
  // ella: su fase la inventa el modelo, y siendo también puntos de color se leen antes que los
  // buses reales, que son el motivo de la pestaña.
  setSimulationVisible(visible){
    this.simulationVisible=visible;
    if(this.busMesh)this.busMesh.visible=this.busNose.visible=visible;
    if(this.signalMesh)this.signalMesh.visible=false;
    if(!visible)this.clusterLayer.replaceChildren();
  }
  setLiveBuses(buses,color='#dc253b'){
    const previous=new Map((this.liveVisual||[]).map(b=>[b.id,b.xy]));
    this.liveColor=color;this.liveTarget=buses;this.liveStart=performance.now();this.liveSettled=!buses.length;
    this.livePrevious=previous;this.liveVisual=buses.map(b=>({...b,xy:previous.get(b.id)||b.xy}));
    this.updateLive();
  }
  animateLive(now){
    if(!this.liveTarget||this.liveSettled)return;
    const blend=Math.min(1,(now-this.liveStart)/1200),ease=blend*(2-blend);
    this.liveVisual=this.liveTarget.map(b=>{const from=this.livePrevious.get(b.id);return from?{...b,xy:[from[0]+(b.xy[0]-from[0])*ease,from[1]+(b.xy[1]-from[1])*ease]}:b;});
    this.liveSettled=blend>=1;this.updateLive();
  }
  updateLive(){
    const buses=this.liveVisual||[];
    if(!buses.length&&!this.liveHalo)return;// Quien nunca abre la pestaña no paga ni una malla.
    if(!this.liveHalo){
      // Transparentes a propósito aunque se dibujen opacas: Three pinta todo lo opaco antes que lo
      // transparente, y el trazado resaltado es transparente. Siendo opacas quedaban debajo de la
      // línea por mucho renderOrder que llevaran.
      this.liveHalo=new THREE.InstancedMesh(new THREE.CircleGeometry(1,20),new THREE.MeshBasicMaterial({depthTest:false,transparent:true}),256);
      this.liveDot=new THREE.InstancedMesh(new THREE.CircleGeometry(1,20),new THREE.MeshBasicMaterial({depthTest:false,transparent:true}),256);
      this.liveNose=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({depthTest:false,transparent:true}),256);
      for(const [mesh,order] of [[this.liveHalo,8],[this.liveNose,8.1],[this.liveDot,8.2]]){mesh.renderOrder=order;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(mesh);}
    }
    const halo=this.dark?'#e8eef6':'#ffffff';
    this.liveHalo.material.color.set(halo);this.liveNose.material.color.set(halo);this.liveDot.material.color.set('#ffffff');
    const tint=new THREE.Color();let i=0;
    for(const bus of buses.slice(0,256)){
      const radius=Math.max(11,this.mpp*6),angle=Math.PI/2-bus.heading*Math.PI/180;
      this.object.rotation.z=0;this.object.position.set(bus.xy[0],bus.xy[1],6);this.object.scale.setScalar(radius);this.object.updateMatrix();this.liveHalo.setMatrixAt(i,this.object.matrix);
      this.object.scale.setScalar(radius*.58);this.object.updateMatrix();this.liveDot.setMatrixAt(i,this.object.matrix);tint.set(bus.color||this.liveColor||'#dc253b');this.liveDot.setColorAt(i,tint);
      this.object.position.set(bus.xy[0]+Math.cos(angle)*radius*1.15,bus.xy[1]+Math.sin(angle)*radius*1.15,6.1);this.object.rotation.z=angle;this.object.scale.set(radius*.9,radius*.5,1);this.object.updateMatrix();this.liveNose.setMatrixAt(i,this.object.matrix);
      i++;
    }
    for(const mesh of [this.liveHalo,this.liveDot,this.liveNose]){mesh.count=i;mesh.instanceMatrix.needsUpdate=true;}
    if(this.liveDot.instanceColor)this.liveDot.instanceColor.needsUpdate=true;
    this.liveLabels||=new Map();
    const withLabels=this.mpp<3?buses:[];
    for(const bus of withLabels){
      let label=this.liveLabels.get(bus.id);
      if(!label){label=document.createElement('div');label.className='live-label';label.textContent=bus.label||bus.id;this.labels.append(label);this.liveLabels.set(bus.id,label);}
      const [x,y]=this.worldToScreen(bus.xy);label.style.transform=`translate3d(${x+12}px,${y+6}px,0)`;
    }
    const keep=new Set(withLabels.map(b=>b.id));
    for(const [id,label] of this.liveLabels)if(!keep.has(id)){label.remove();this.liveLabels.delete(id);}
  }
  follow(xy,dt){const [dx,dy]=this.focusShift(),blend=1-Math.exp(-Math.min(.1,Math.max(0,dt))*15);this.center[0]+=(xy[0]+dx-this.center[0])*blend;this.center[1]+=(xy[1]+dy-this.center[1])*blend;const now=performance.now();const labels=!this.lastFollowLabels||now-this.lastFollowLabels>150;if(labels)this.lastFollowLabels=now;this.updateCamera({labels});}
  // El semáforo es una estimación del modelo, no un dato: se puede apagar para leer el mapa. La
  // pestaña En vivo los esconde por su cuenta, y este interruptor no los devuelve allí.
  setSignals(enabled){this.signalsEnabled=enabled;if(this.signalMesh&&!enabled)this.signalMesh.visible=false;}
  updateSignals(time){
    if(!this.signalMesh)return;this.signalMesh.visible=this.signalsEnabled&&this.simulationVisible!==false&&this.mpp<4;if(!this.signalMesh.visible)return;
    const color=new THREE.Color();let i=0;
    for(const s of this.data.busway_signals.signals){this.object.position.set(...s.xy,0);this.object.rotation.z=0;this.object.scale.setScalar(Math.max(2,this.mpp*3));this.object.updateMatrix();this.signalMesh.setMatrixAt(i,this.object.matrix);color.set({green:'#269765',amber:'#e8a41b',red:'#e8394b'}[signalPhase(s.id,time||0).color]);this.signalMesh.setColorAt(i++,color);}
    this.signalMesh.instanceMatrix.needsUpdate=true;this.signalMesh.instanceColor.needsUpdate=true;
  }
  setTheme(theme){this.dark=theme==='dark';this.renderer.setClearColor(this.dark?'#18212b':'#edf1f4');const colors=this.dark?['#233b35','#233d50','#2b3947','#35596c','#607383']:['#d4e3d8','#c5dce8','#ffffff','#b6d5e4','#c1cbd5'];for(const [i,mesh] of (this.contextMeshes||[]).entries())mesh.material.color.set(colors[i]);this.stopInner.material.color.set(this.dark?'#293746':'#ffffff');this.wagonMesh.material.color.set(this.dark?'#637383':'#f9fafb');for(const mesh of this.stationGroup.children)mesh.material.color.set(mesh.userData.palette[this.dark?1:0]);for(const mesh of (this.carriagewayGroup?.children||[]))mesh.material.color.set(mesh.userData.palette[this.dark?1:0]);if(this.liveVisual?.length)this.updateLive();if(this.networkVehicles?.length)this.updateNetwork();}
  render(){this.renderer.render(this.scene,this.camera);}

}
