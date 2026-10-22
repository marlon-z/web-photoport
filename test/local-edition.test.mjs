import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../server.mjs';
test('public local release cannot enable hosted mode or cloud uploads',async t=>{
 await assert.rejects(()=>createServer({port:0,durable:true}),/localhost-only/);
 const app=await createServer({port:0,runtime:await mkdtemp(join(tmpdir(),'photoport-local-release-'))});t.after(()=>app.close());
 assert.equal(app.server.address().address,'127.0.0.1');
 const r=await fetch(app.origin+'/api/connect-r2',{method:'POST',headers:{'Content-Type':'application/json','X-PhotoPort':'1'},body:'{}'});assert.equal(r.status,400);assert.equal((await r.json()).code,'local_only');
 for(const path of ['/api/account','/auth/login','/api/payments/checkout','/.env','/.runtime/jobs','/site/schema.sql'])assert.equal((await fetch(app.origin+path)).status,404);
});

