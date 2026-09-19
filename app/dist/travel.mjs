/** Distance-domain speed envelope: actual metres, acceleration, braking and bend limits.
 *
 * `options.limitAt(posición absoluta)` permite que el techo cambie a lo largo del recorrido: es por
 * donde entra la velocidad medida de cada trecho de corredor. Las pasadas de aceleración y frenada
 * que ya existían se encargan de que el cambio de un trecho al siguiente sea progresivo, así que el
 * bus no salta de velocidad: acelera y frena hacia ella como haría contra una curva.
 */
export function travelProfile(path,from,to,limit,a=.8,b=1.1,options={}){
 const distance=Math.max(0,to-from),anchors=[...new Set([0,...(options.checkpoints||[]),...(options.stops||[]),distance].filter(x=>x>=0&&x<=distance))].sort((a,b)=>a-b),positions=[0];
 for(let j=1;j<anchors.length;j++){const span=anchors[j]-anchors[j-1],steps=Math.max(2,Math.ceil(span/18));for(let i=1;i<=steps;i++)positions.push(i===steps?anchors[j]:anchors[j-1]+span*i/steps);}
 if(positions.length===1)positions.push(0,0);
 const n=positions.length-1,s=Float64Array.from(positions),v=new Float64Array(n+1),times=new Float64Array(n+1),stops=new Set(options.stops||[]);
 for(let i=0;i<=n;i++){
  const pos=from+s[i],p=path.sample(Math.max(0,pos-12)).xy,q=path.sample(pos).xy,r=path.sample(Math.min(path.length,pos+12)).xy;
  const u=[q[0]-p[0],q[1]-p[1]],w=[r[0]-q[0],r[1]-q[1]],ul=Math.hypot(...u),wl=Math.hypot(...w);
  const angle=ul>1&&wl>1?Math.acos(Math.max(-1,Math.min(1,(u[0]*w[0]+u[1]*w[1])/ul/wl))):0;
  const radius=angle>.04?Math.min(ul,wl)/angle:Infinity;
  const local=options.limitAt?Math.min(limit,options.limitAt(pos)):limit;
  v[i]=stops.has(s[i])?0:Math.min(local,Math.max(3,Math.sqrt(1.15*radius)));
 }
 v[0]=0;v[n]=0;
 for(let i=1;i<=n;i++)v[i]=Math.min(v[i],Math.sqrt(v[i-1]**2+2*a*(s[i]-s[i-1])));
 for(let i=n-1;i>=0;i--)v[i]=Math.min(v[i],Math.sqrt(v[i+1]**2+2*b*(s[i+1]-s[i])));
 for(let i=1;i<=n;i++)times[i]=times[i-1]+2*(s[i]-s[i-1])/Math.max(.01,v[i]+v[i-1]);
 return {distance,duration:times[n],s,v,times};
}
export function travelTimeAtDistance(profile,distance){
 const s=Math.max(0,Math.min(profile.distance,distance));let lo=1,hi=profile.s.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(profile.s[mid]<s)lo=mid+1;else hi=mid;}
 const i=lo,ds=s-profile.s[i-1],span=profile.times[i]-profile.times[i-1],v=profile.v[i-1],a=span?(profile.v[i]-v)/span:0;
 const endSpeed=Math.sqrt(Math.max(0,v*v+2*a*ds)),dt=ds?2*ds/Math.max(1e-12,v+endSpeed):0;return profile.times[i-1]+Math.min(span,dt);
}
export function travelAt(profile,time){
 const t=Math.min(profile.duration,Math.max(0,time));let lo=1,hi=profile.times.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(profile.times[mid]<t)lo=mid+1;else hi=mid;}
 const i=lo,dt=t-profile.times[i-1],span=profile.times[i]-profile.times[i-1],a=span?(profile.v[i]-profile.v[i-1])/span:0;
 return {s:Math.min(profile.distance,profile.s[i-1]+profile.v[i-1]*dt+.5*a*dt*dt),speed:Math.max(0,profile.v[i-1]+a*dt)};
}
