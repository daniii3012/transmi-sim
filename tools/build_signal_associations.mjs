/** Recompute the signal/route association audit with the engine's own matcher.
 *
 * The audit is derived, never authored: it must be regenerated whenever the route
 * set or the signal catalogue changes, or its counts silently describe an older
 * catalogue. Reusing matchSignals keeps one definition of what counts as a match.
 *
 * Usage: node tools/build_signal_associations.mjs [--out data/processed/signal_associations.json]
 */
import fs from 'node:fs';
import {matchSignals} from '../app/dist/signals.mjs';
import {MetricPath} from '../app/dist/simulation.mjs';

const root=new URL('../',import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const outIndex=process.argv.indexOf('--out');
const out=outIndex>0?process.argv[outIndex+1]:'data/processed/signal_associations.json';

const services=read('app/dist/services.json');
const catalogue=read('app/dist/busway_signals.json');
const ready=services.routes.filter(r=>r.ready);

const used=new Set();const routes=[];let pairs=0;
for(const r of ready){
 const matches=matchSignals(new MetricPath(r.points),catalogue);
 if(!matches.length)continue;
 for(const m of matches)used.add(m.id);
 pairs+=matches.length;
 routes.push({id:r.id,code:r.code,count:matches.length});
}
routes.sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));
const unmatched=catalogue.signals.map(s=>s.id).filter(id=>!used.has(id));

const payload={
 generated_at:new Date().toISOString(),
 services_source:'app/dist/services.json',
 services_revision:services.revision,
 signals_source:'app/dist/busway_signals.json',
 signals:catalogue.signals.length,
 matched:used.size,
 routeVariants:routes.length,
 routeSignalMatches:pairs,
 usableRoutes:ready.length,
 unmatched,
 routes,
};
fs.writeFileSync(new URL(out,root),JSON.stringify(payload,null,2)+'\n');
console.log(`${payload.signals} señales · ${payload.matched} asociadas · ${payload.routeVariants} variantes de ${payload.usableRoutes} utilizables · ${payload.routeSignalMatches} pares`);
if(unmatched.length)console.log(`sin asociar: ${unmatched.join(', ')}`);
