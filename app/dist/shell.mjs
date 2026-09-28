// Shared desktop/mobile chrome. The map always keeps the full viewport.
export function mountShell(){
 const body=document.body,sidebar=document.querySelector('#sidebar');
 const toggle=document.createElement('button');toggle.id='panel-toggle';toggle.type='button';toggle.setAttribute('aria-expanded','true');toggle.textContent='Red y rutas';sidebar.prepend(toggle);
 const more=document.createElement('details');more.id='more-menu';
 const summary=document.createElement('summary');summary.textContent='Más';summary.setAttribute('aria-label','Más opciones');more.append(summary);
 const menu=document.createElement('div');menu.className='more-options';more.append(menu);
 for(const button of document.querySelectorAll('[data-panel="depots"],[data-panel="settings"],[data-panel="data"],[data-panel="sources"]'))menu.append(button);
 document.querySelector('nav').append(more);
 // En un teléfono el reloj se reparte en tres filas: arriba el día, la hora y el salto al ahora —lo
 // que se lee—, en medio lo que mueve el tiempo y la velocidad —lo que se toca—, abajo la línea del
 // día. Antes la fecha y «Ahora» vivían escondidas tras el menú Más, que no era sitio para ellas.
 // En una pantalla ancha cada control vuelve a la fila única de siempre.
 const timeline=document.querySelector('#timeline'),timeMain=document.querySelector('.time-main');
 const timeInput=document.querySelector('#time'),nowButton=document.querySelector('#now');
 const dateControls=document.querySelector('.date-controls'),speeds=timeMain.querySelector('.speed-controls');
 // El chevron pliega las dos filas de mandos y deja la de arriba, que es la que dice qué momento se
 // está mirando.
 const clockToggle=document.createElement('button');clockToggle.id='timeline-toggle';clockToggle.type='button';
 const header=document.querySelector('header'),nav=document.querySelector('nav'),dateInput=document.querySelector('#date'),dayType=document.querySelector('#day-type');
 const pause=document.querySelector('#pause'),forward=document.querySelector('#forward'),theme=document.querySelector('#theme');
 const speedPill=document.createElement('button');speedPill.id='speed-pill';speedPill.type='button';
 const speedButtons=()=>[...speeds.querySelectorAll('button[data-speed]')];
 const syncSpeed=()=>{const on=speeds.querySelector('button.active')||speedButtons()[0];speedPill.textContent=on?.textContent||'1×';speedPill.setAttribute('aria-label','Velocidad del reloj '+speedPill.textContent+'; tocar para cambiarla');};
 speedPill.addEventListener('click',()=>{const list=speedButtons(),at=list.findIndex(b=>b.classList.contains('active'));list[(at+1)%list.length]?.click();});
 new MutationObserver(syncSpeed).observe(speeds,{attributes:true,subtree:true,attributeFilter:['class']});syncSpeed();
 // Tirador de la hoja: en el teléfono la hoja tiene tres alturas —asomada, media y completa— y se
 // cambia arrastrándolo o tocándolo. `data-sheet` sigue diciendo abierta o cerrada al resto.
 const grab=document.createElement('div');grab.className='sheet-grab';grab.setAttribute('role','button');grab.tabIndex=0;sidebar.prepend(grab);
 let clockOpen=true;
 const setClock=value=>{clockOpen=value;body.dataset.clock=value?'open':'closed';clockToggle.setAttribute('aria-expanded',String(value));clockToggle.setAttribute('aria-label',(value?'Ocultar':'Mostrar')+' los controles del reloj');};
 clockToggle.addEventListener('click',()=>setClock(!clockOpen));
 const estrechoReloj=matchMedia('(max-width:800px)');
 const colocarReloj=()=>{
  if(estrechoReloj.matches){
   // Píldora de arriba: hora, tipo de día, pausa y velocidad, siempre a la vista. Desplegada suma la
   // fecha, «Ahora», los saltos de quince minutos y la línea del día. La velocidad se cambia tocando
   // la píldora: la fila de cuatro botones no cabía junto a lo demás en un teléfono.
   timeline.insertBefore(dateControls,timeMain);dateControls.append(timeInput,dayType,pause,speedPill,clockToggle);
   timeMain.prepend(dateInput,nowButton);
   sidebar.insertBefore(nav,grab.nextSibling);
   document.querySelector('.map-actions').append(theme);
  }else{
   timeMain.insertBefore(dateControls,timeMain.firstChild);dateControls.prepend(dateInput);dateInput.after(dayType);dateControls.append(nowButton);
   forward.before(pause);timeMain.insertBefore(timeInput,speeds);clockToggle.remove();speedPill.remove();
   header.insertBefore(nav,header.querySelector('.header-right'));header.querySelector('.header-right').append(theme);
  }
 };
 estrechoReloj.addEventListener('change',colocarReloj);colocarReloj();setClock(!estrechoReloj.matches);
 let expanded=true;
 const sizes=['peek','half','full'];
 const setSize=size=>{body.dataset.sheetSize=size;expanded=size!=='peek';body.dataset.sheet=expanded?'open':'closed';toggle.setAttribute('aria-expanded',String(expanded));grab.setAttribute('aria-label','Panel '+({peek:'asomado',half:'a media altura',full:'completo'})[size]+'; tocar o arrastrar para cambiar su altura');};
 const setExpanded=value=>setSize(value?(body.dataset.panel==='planner'?'full':'half'):'peek');
 toggle.addEventListener('click',()=>setExpanded(!expanded));
 let drag=null;
 grab.addEventListener('pointerdown',e=>{drag={y:e.clientY,h:sidebar.getBoundingClientRect().height,moved:false};grab.setPointerCapture(e.pointerId);});
 grab.addEventListener('pointermove',e=>{if(!drag)return;const dy=e.clientY-drag.y;if(Math.abs(dy)>6)drag.moved=true;if(drag.moved)sidebar.style.height=Math.max(96,drag.h-dy)+'px';});
 const release=e=>{if(!drag)return;const dy=e.clientY-drag.y,at=sizes.indexOf(body.dataset.sheetSize||'half');sidebar.style.height='';
  setSize(!drag.moved?sizes[(at+1)%3]:dy<-50?sizes[Math.min(2,at+1+(dy<-260))]:dy>50?sizes[Math.max(0,at-1-(dy>260))]:sizes[at]);drag=null;};
 grab.addEventListener('pointerup',release);grab.addEventListener('pointercancel',release);
 grab.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const at=sizes.indexOf(body.dataset.sheetSize||'half');setSize(sizes[(at+1)%3]);}});
 // El detalle se pliega sin soltar lo que está en foco. Cerrarlo era la única salida y eso quita
 // la selección: al seguir un bus en el móvil no quedaba forma de ver el mapa sin dejar de seguirlo.
 const inspector=document.querySelector('#inspector'),selection=document.querySelector('#selection');
 const detail=document.createElement('button');detail.id='inspector-toggle';detail.type='button';
 const detailText=document.createElement('span');detail.append(detailText);inspector.prepend(detail);
 const heading=()=>selection.querySelector('h2')?.textContent?.trim()||'Detalle';
 let open=true;
 const setDetail=value=>{open=value;body.dataset.detail=value?'open':'closed';detail.setAttribute('aria-expanded',String(value));detailText.textContent=heading();detail.setAttribute('aria-label',(value?'Ocultar':'Mostrar')+' el detalle de '+heading());};
 detail.addEventListener('click',()=>setDetail(!open));
 new MutationObserver(()=>detailText.textContent=heading()).observe(selection,{childList:true});
 // Una selección nueva se muestra abierta; plegado no se vería nada de lo recién elegido.
 new MutationObserver(()=>{body.dataset.inspect=String(!inspector.hidden);if(!inspector.hidden&&!open)setDetail(true);}).observe(inspector,{attributes:true,attributeFilter:['hidden']});
 setDetail(true);
 document.addEventListener('click',e=>{if(!more.contains(e.target))more.open=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){more.open=false;if(!inspector.hidden&&open)setDetail(false);else if(!inspector.hidden)document.querySelector('#close-inspector')?.click();else setExpanded(false);}});
 // En el teléfono se arranca con el mapa a la vista y la hoja asomada.
 body.dataset.panel='routes';if(estrechoReloj.matches)setSize('peek');else setExpanded(true);
 return {show(name){body.dataset.panel=name;toggle.textContent=document.querySelector(`button[data-panel="${name}"]`)?.textContent||'Explorar';more.open=false;setExpanded(true);}};
}
