import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../server.mjs';
import { digest } from '../lib/core.mjs';

test('浏览器使用的HTTP接口：扫描、复制、下载、原图关闭后独立读取',async t=>{
  const app=await createServer({port:0,runtime:await mkdtemp(join(tmpdir(),'photoport-api-'))});t.after(()=>app.close());
  const initial=await fetch(app.origin+'/');assert.equal(initial.status,200);const cookie=initial.headers.get('set-cookie').split(';')[0];
  const call=async(path,body)=>{const r=await fetch(app.origin+path,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1',Origin:app.origin},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
  const created=await call('/api/demo',{count:10,edgeCases:false});assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await call(`/api/jobs/${id}/all`,{})).status,202);
  let state;for(let i=0;i<200;i++){state=(await call(`/api/jobs/${id}`)).data;if(!state.busy)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.success,10);assert.equal(state.failed,0);
  await call(`/api/jobs/${id}/source-off`,{});assert.equal((await call(`/api/jobs/${id}/verify`,{})).data.success,10);
  for(const row of state.rows){const r=await fetch(row.url);assert.equal(r.status,200);assert.equal(digest(Buffer.from(await r.arrayBuffer())),row.sha256);}
  const csv=await fetch(`${app.origin}/api/jobs/${id}/export?format=csv`,{headers:{cookie}});assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(await csv.text(),/record_id/);
  const out=(await call(`/api/jobs/${id}/export?format=json`)).data;assert.equal(out.rows.length,10);assert.ok(!JSON.stringify(out).includes('secretAccessKey'));
  const stranger=await fetch(`${app.origin}/api/jobs/${id}`);assert.equal(stranger.status,404);
  await call('/api/clear',{});assert.equal((await call(`/api/jobs/${id}`)).status,404);
});
test('本机接口拒绝其他网站的写入以及缺少专用请求头的请求',async t=>{
  const app=await createServer({port:0,runtime:await mkdtemp(join(tmpdir(),'photoport-origin-'))});t.after(()=>app.close());
  const headers={'Content-Type':'application/json','X-PhotoPort':'1',Origin:'https://other.example'};
  assert.equal((await fetch(app.origin+'/api/demo',{method:'POST',headers,body:'{}'})).status,403);
  assert.equal((await fetch(app.origin+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(app.origin+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json','X-PhotoPort':'1'},body:'not json'})).status,400);
});
test('真实表格没有授权时不能扫描，不把模拟数据当真实结果',async t=>{
  const app=await createServer({port:0,runtime:await mkdtemp(join(tmpdir(),'photoport-noauth-'))});t.after(()=>app.close());
  const r=await fetch(app.origin+'/api/scan',{method:'POST',headers:{'Content-Type':'application/json','X-PhotoPort':'1'},body:JSON.stringify({tableId:'tblTest',fields:['Photos'],destination:'r2'})});
  assert.equal(r.status,400);assert.match((await r.json()).error,/Airtable/);
});
