import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from '../server.mjs';
import {Checkpoints,snapshotPlan} from '../lib/checkpoints.mjs';
import {buildPlan,LIMITS} from '../lib/core.mjs';
import {DemoSource} from '../lib/adapters.mjs';

async function client(origin){
  const first=await fetch(origin+'/');const cookie=first.headers.get('set-cookie').split(';')[0];
  return async(path,body)=>{
    const response=await fetch(origin+path,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1',Origin:origin},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json(),headers:response.headers};
  };
}
async function settled(call,id){for(let i=0;i<500;i++){const j=(await call(`/api/jobs/${id}`)).data;if(!j.busy)return j;await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');}

test('8张同时复制时杀死进程，重新连接能核对副本并续搬，已完成文件不覆盖',async t=>{
  const runtime=await mkdtemp(join(tmpdir(),'photoport-crash-'));
  const child=spawn(process.execPath,[new URL('./fixtures/crash-server.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),runtime],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let startup='';const origin=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{startup+=d;if(startup.includes('\n'))resolve(startup.trim().split('\n')[0]);});child.once('error',reject);});
  const call=await client(origin);
  const created=(await call('/api/demo',{count:200,edgeCases:false})).data;
  await call(`/api/jobs/${created.id}/all`,{});
  let before;
  const store=new Checkpoints(join(runtime,'jobs'));
  // HTTP progress can precede the atomic checkpoint rename. Wait for durable
  // progress before killing, rather than asserting memory progress was flushed.
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){before=(await call(`/api/jobs/${created.id}`)).data;const durable=await store.read(created.id);if(before.success>=6&&durable.job.success>=6)break;await new Promise(r=>setTimeout(r,10));}
  assert.ok(before.busy&&before.success>=6&&before.success<200,JSON.stringify({state:before.state,busy:before.busy,success:before.success,pending:before.pending,failed:before.failed,saveError:before.saveError,firstFailure:before.rows?.find(r=>r.status==='failed')?.error}));
  const exit=once(child,'exit');child.kill('SIGKILL');await exit;
  const saved=await store.read(created.id);
  assert.ok(saved.job.success>=6&&saved.job.success<200);
  const success=saved.job.rows.find(r=>r.status==='success');const file=join(runtime,'files',...new URL(success.url).pathname.slice('/demo-files/'.length).split('/'));
  const originalTime=(await stat(file)).mtimeMs;
  const raw=await readFile(join(runtime,'jobs',created.id+'.json'),'utf8');
  for(const forbidden of ['secretAccessKey','accessKeyId','Authorization','airtableusercontent.com','token'])assert.ok(!raw.includes(forbidden));
  const resumed=await createServer({runtime,port:0,concurrency:8});t.after(()=>resumed.close());
  const next=await client(resumed.origin);
  assert.ok((await next('/api/saved-jobs')).data.jobs.some(j=>j.id===created.id));
  const restored=await next('/api/restore',{id:created.id});assert.equal(restored.status,202);const ready=await settled(next,created.id);assert.equal(ready.success,saved.job.success);
  assert.equal(ready.success+ready.pending,200);
  await next(`/api/jobs/${created.id}/all`,{});const result=await settled(next,created.id);
  assert.equal(result.success,200);assert.equal(result.failed,0);
  assert.equal((await stat(file)).mtimeMs,originalTime);
  assert.equal((await readdir(join(runtime,'files','photoport-tests',created.id))).length,200);
});

test('长任务每次读取都续期原会话；未重新连接时不暴露真实账号任务',async t=>{
  const runtime=await mkdtemp(join(tmpdir(),'photoport-access-'));
  const app=await createServer({runtime,port:0});t.after(()=>app.close());const call=await client(app.origin);
  const one=await call('/api/status');const two=await call('/api/status');
  assert.equal(one.headers.get('set-cookie'),two.headers.get('set-cookie'));
  assert.match(two.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600/);
  const id='01010101-0101-4101-8101-010101010101';await mkdir(join(runtime,'jobs'),{recursive:true});
  await writeFile(join(runtime,'jobs',id+'.json'),JSON.stringify({version:1,refs:{source:{mode:'airtable',baseId:'appPrivate'},destination:{mode:'r2',accountId:'1'.repeat(32),bucket:'private-test'}},job:{id,rows:[],createdAt:new Date().toISOString()}}));
  assert.deepEqual((await call('/api/saved-jobs')).data.jobs,[]);
  assert.equal((await call('/api/restore',{id})).status,403);
});

test('恢复时损坏副本不会被当成成功；错误任务编号被拒绝',async t=>{
  const runtime=await mkdtemp(join(tmpdir(),'photoport-corrupt-'));let app=await createServer({runtime,port:0});const call=await client(app.origin);
  const j=(await call('/api/demo',{count:2,edgeCases:false})).data;await call(`/api/jobs/${j.id}/all`,{});const finished=await settled(call,j.id);
  const file=join(runtime,'files',...new URL(finished.rows[0].url).pathname.slice('/demo-files/'.length).split('/'));
  await writeFile(file,'corrupt');await app.close();
  app=await createServer({runtime,port:0});t.after(()=>app.close());const next=await client(app.origin);
  await next('/api/restore',{id:j.id});const restored=await settled(next,j.id);
  assert.equal(restored.success,1);assert.equal(restored.pending,1);
  assert.equal((await next('/api/restore',{id:'../../file'})).status,400);
});

test('恢复原批次时，来源后来新增的超数量附件不阻止续搬，也不被偷偷加入',()=>{
  const original=new DemoSource({count:2,edgeCases:false});const saved=buildPlan(original.records,['Photos','Details'],'Name');
  const grown=[...original.records,...Array.from({length:LIMITS.files+1},(_,i)=>({id:`recNew${i}`,fields:{Name:'new',Photos:[{id:`attNew${i}`,filename:'new.png',size:100,type:'image/png'}]}}))];
  assert.throws(()=>buildPlan(grown,['Photos','Details'],'Name'),/15000/);
  const resumed=snapshotPlan(grown,['Photos','Details'],'Name',saved.rows);
  assert.equal(resumed.rows.length,2);assert.deepEqual(resumed.rows.map(r=>r.identity),saved.rows.map(r=>r.identity));
});
