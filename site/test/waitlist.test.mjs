import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSignup,handleRemoval} from '../lib/waitlist.mjs';
function setup(t){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));t.after(()=>sql.close());
 const prepare=query=>({bind:(...args)=>({run:async()=>{const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},execute:()=>{const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}})});
 const WAITLIST={prepare,batch:async statements=>{sql.exec('BEGIN');try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,env:{WAITLIST,SIGNUPS_OPEN:'true'}};
}
const body={email:'tester@example.com',scenario:'products',batch:'1-10',price:'maybe',need:'One folder per SKU',consent:true,website:''};
const req=(data,extra={})=>new Request('https://photoport-local.pages.dev/api/waitlist',{method:'POST',headers:{origin:'https://photoport-local.pages.dev','Content-Type':'application/json','X-PhotoPort-Form':'1','CF-Connecting-IP':'192.0.2.20',...extra},body:JSON.stringify(data)});
test('signup saves only consented data in SQLite; raw IP and removal token are not stored; private removal works',async t=>{
 const {sql,env}=setup(t),r=await handleSignup(req(body),env);assert.equal(r.status,201);const receipt=await r.json();assert.match(receipt.removeToken,/^[a-f0-9]{64}$/);
 const row=sql.prepare('SELECT * FROM waitlist').get();assert.equal(row.email,body.email);assert.notEqual(row.delete_hash,receipt.removeToken);assert.ok(!JSON.stringify(row).includes('192.0.2.20'));
 const snapshot=JSON.stringify(sql.prepare('SELECT * FROM limits').all());assert.ok(!snapshot.includes('192.0.2.20'));
 assert.equal((await handleRemoval(req({token:'0'.repeat(64)}),env)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n,1);
 assert.equal((await handleRemoval(req({token:receipt.removeToken}),env)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n,0);
 assert.equal((await handleRemoval(req({token:receipt.removeToken}),env)).status,200);
});
test('missing consent, invalid input, foreign origins and oversized bodies never reach storage',async t=>{
 const {sql,env}=setup(t);
 for(const bad of [{...body,consent:false},{...body,email:'bad'},{...body,scenario:'injected'},{...body,need:'x'.repeat(501)}])assert.equal((await handleSignup(req(bad),env)).status,400);
 assert.equal((await handleSignup(req(body,{origin:'https://other.example'}),env)).status,403);
 assert.equal((await handleSignup(req({...body,need:'x'.repeat(5000)}),env)).status,413);
 assert.equal((await handleSignup(req(body,{'Content-Type':'text/plain'}),env)).status,415);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n,0);
});
test('free pilot is capped; the sixth submission from an IP in an hour is refused',async t=>{
 const {sql,env}=setup(t),now=Date.UTC(2026,9,22,0,0,0);
 for(let i=0;i<5;i++)assert.equal((await handleSignup(req(body),env,{now})).status,201);
 assert.equal((await handleSignup(req(body),env,{now})).status,429);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n,5);
});
test('global and daily attempt budgets hold across different clients; closed or unavailable service never pretends success',async t=>{
 const {sql,env}=setup(t),now=Date.UTC(2026,9,22),day=Math.floor(now/86400000);
 sql.prepare('INSERT INTO limits VALUES(?,?,?)').run('day:'+day,100,253402300799);
 assert.equal((await handleSignup(req(body),env,{now})).status,429);
 sql.prepare('DELETE FROM limits').run();sql.prepare('INSERT INTO limits VALUES(?,?,?)').run('total',1000,253402300799);
 assert.equal((await handleSignup(req(body),env,{now})).status,429);
 assert.equal((await handleSignup(req(body),{...env,SIGNUPS_OPEN:'false'})).status,503);
 assert.equal((await handleSignup(req(body),{})).status,503);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n,0);
});
test('bots in the honeypot do not create entries; provider failures do not leak private details',async t=>{
 const {sql,env}=setup(t);assert.equal((await handleSignup(req({...body,website:'spam'}),env)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n,0);
 const broken={SIGNUPS_OPEN:'true',WAITLIST:{prepare(){throw Error('secret-provider-detail')}}};const r=await handleSignup(req(body),broken);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('secret-provider-detail'));
});

