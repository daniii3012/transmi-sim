import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {Simulation} from '../dist/simulation.mjs';
const data=JSON.parse(readFileSync(new URL('../dist/network.json',import.meta.url)));
const results=[];
for(const fleet of [100,1000,3000]){
 const sim=new Simulation(data,{scenario:'load',fleet});const times=[];
 for(let batch=0;batch<100;batch++){
  const start=performance.now();for(let i=0;i<30;i++)sim.step(.1);times.push((performance.now()-start)/30);
 }
 times.sort((a,b)=>a-b);results.push({fleet,simulated_s:300,mean_step_ms:times.reduce((s,t)=>s+t,0)/times.length,p95_batch_mean_step_ms:times[94],stats:sim.stats()});
}
console.log(JSON.stringify({scope:'CPU logical core only. Node.js, no browser, GPU or FPS measurement.',runtime:process.version,platform:process.platform,arch:process.arch,step_s:.1,results},null,2));
