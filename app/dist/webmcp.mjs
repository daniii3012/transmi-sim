/** Optional browser integration; normal play never needs an agent or network. */
export function registerSimulationTools(context, actions) {
  if(!context?.registerTool)return null;
  const lifecycle=new AbortController();
  const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(error=>console.warn('WebMCP registration unavailable',error));}catch(error){console.warn('WebMCP unavailable',error);}};
  register({name:'read_transmi_simulation',title:'Leer simulación de Transmi',description:'Devuelve escenario, reloj, flota y selección actuales del simulador local. La operación usa parámetros estimados.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object');return actions.read();}});
  register({name:'control_transmi_clock',title:'Controlar reloj de Transmi',description:'Pausa, reanuda o cambia la velocidad de la simulación visible sin reiniciar los buses.',
    inputSchema:{type:'object',properties:{paused:{type:'boolean'},speed:{type:'integer',enum:[1,8,32,120]}},additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['paused','speed'].includes(k))||
         ('paused'in input&&typeof input.paused!=='boolean')||('speed'in input&&![1,8,32,120].includes(input.speed)))throw new Error('Invalid clock controls');
      actions.control(input);return actions.read();
    }});
  return ()=>lifecycle.abort();
}
