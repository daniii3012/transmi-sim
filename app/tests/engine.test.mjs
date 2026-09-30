import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fingerprint} from '../../tools/engine_fingerprint.mjs';

const dist=new URL('../dist/',import.meta.url);

test('engine.json coincide con el motor y los datos que simula', ()=>{
 const stored=JSON.parse(fs.readFileSync(new URL('engine.json',dist))).engine;
 assert.equal(stored,fingerprint(dist),'Correr node tools/engine_fingerprint.mjs tras tocar el motor o sus datos');
});

test('la huella del motor no cambia con la cadena ?v=', ()=>{
 const tmp=fs.mkdtempSync(new URL(`file://${process.env.TMPDIR||'/tmp'}/huella-`).pathname)+'/';
 for(const f of fs.readdirSync(dist))if(/\.(mjs|json)$/.test(f))fs.copyFileSync(new URL(f,dist),tmp+f);
 const before=fingerprint(new URL(`file://${tmp}`));
 const p=tmp+'traffic.mjs';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/\?v=[0-9.]+/g,'?v=99999999.1'));
 assert.equal(fingerprint(new URL(`file://${tmp}`)),before);
 fs.writeFileSync(p,fs.readFileSync(p,'utf8')+'\n// cambio del motor\n');
 assert.notEqual(fingerprint(new URL(`file://${tmp}`)),before);
 fs.rmSync(tmp,{recursive:true,force:true});
});
