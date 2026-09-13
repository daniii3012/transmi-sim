// Shared desktop/mobile chrome. The map always keeps the full viewport.
export function mountShell(){
 const body=document.body,sidebar=document.querySelector('#sidebar');
 const toggle=document.createElement('button');toggle.id='panel-toggle';toggle.type='button';toggle.setAttribute('aria-expanded','true');toggle.textContent='Red y rutas';sidebar.prepend(toggle);
 const more=document.createElement('details');more.id='more-menu';
 const summary=document.createElement('summary');summary.textContent='Más';summary.setAttribute('aria-label','Más opciones');more.append(summary);
 const menu=document.createElement('div');menu.className='more-options';more.append(menu);
 for(const button of document.querySelectorAll('[data-panel="depots"],[data-panel="settings"],[data-panel="data"],[data-panel="sources"]'))menu.append(button);
 document.querySelector('nav').append(more);
 // La hora y el salto al ahora bajan a la fila de la línea del día en un teléfono, donde el reloj
 // se reparte en dos filas por uso; en una pantalla ancha vuelven a la suya. Antes la fecha y
 // «Ahora» vivían escondidas tras el menú Más, que no era sitio para ellas.
 const timeMain=document.querySelector('.time-main'),scrubRow=document.querySelector('.scrub-row');
 const timeInput=document.querySelector('#time'),nowButton=document.querySelector('#now');
 const dateControls=document.querySelector('.date-controls'),speeds=timeMain.querySelector('.speed-controls');
 const estrechoReloj=matchMedia('(max-width:800px)');
 const colocarReloj=()=>{
  if(estrechoReloj.matches)scrubRow.append(timeInput,nowButton);
  else{timeMain.insertBefore(timeInput,speeds);dateControls.append(nowButton);}
 };
 estrechoReloj.addEventListener('change',colocarReloj);colocarReloj();
 let expanded=true;
 const setExpanded=value=>{expanded=value;body.dataset.sheet=value?'open':'closed';toggle.setAttribute('aria-expanded',String(value));};
 toggle.addEventListener('click',()=>setExpanded(!expanded));
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
 setExpanded(true);body.dataset.panel='routes';
 return {show(name){body.dataset.panel=name;toggle.textContent=document.querySelector(`button[data-panel="${name}"]`)?.textContent||'Explorar';more.open=false;setExpanded(true);}};
}
