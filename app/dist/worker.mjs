import {Operation} from './operation.mjs?v=20260913.3';
import {JourneyPlanner} from './planner.mjs?v=20260913.3';
let engine=null,generation=0,planner=null;
self.onmessage=({data:m})=>{
 try{
  if(m.type==='init'){
   generation=m.generation;engine=null;planner=null;
   const start=performance.now();engine=new Operation(m.data,m.config);engine.seek(m.time);
   self.postMessage({type:'ready',generation,buildMs:performance.now()-start,windows:engine.routeWindows,routeIds:[...engine.routes.keys()]});
  }
  if(m.generation!==generation||!engine)return;
  if(m.type==='plan'){planner ||= new JourneyPlanner(engine.data,engine.params);self.postMessage({type:'plan',generation,requestId:m.requestId,result:planner.plan(m.query)});return;}
  if(m.type==='sample'||m.type==='init'){
   engine.seek(m.time);self.postMessage({type:'state',generation,time:m.time,requestId:m.requestId||0,buses:engine.buses,stats:engine.stats()});
  }else if(m.type==='station')self.postMessage({type:'station',generation,id:m.id,...engine.stationStats(m.id)});
  else if(m.type==='depots')self.postMessage({type:'depots',generation,depots:engine.depotStats()});
  else if(m.type==='overview')self.postMessage({type:'overview',generation,time:engine.time,pressure:engine.pressure(6),zones:engine.zoneLoad()});
 }catch(error){self.postMessage({type:m.type==='plan'?'plan-error':'error',generation,requestId:m.requestId,message:error.message});}
};
