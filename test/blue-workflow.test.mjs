import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createServer} from '../server.mjs';
import {CSVSource} from '../lib/csv-source.mjs';
import {fixturePNG} from '../lib/adapters.mjs';
import {groupFiles,escapeHTML} from '../public/gallery.js';
const client=async app=>{
  const start=await fetch(app.origin),cookie=start.headers.get('set-cookie').split(';')[0];
  return async(path,body)=>fetch(app.origin+path,{headers:{cookie,'X-PhotoPort':'1','Content-Type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
};
async function settled(call,id){for(let i=0;i<300;i++){const j=await(await call(`/api/jobs/${id}`)).json();if(!j.busy)return j;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');}
test('真实图片预览受任务会话限制，缩略图不改变原文件或下载状态',async t=>{
  const app=await createServer({port:0,runtime:await mkdtemp(join(tmpdir(),'photoport-preview-'))});t.after(()=>app.close());
  const call=await client(app),other=await client(app),job=await(await call('/api/demo',{count:6,edgeCases:false})).json();
  const row=job.rows[0],url=`/api/jobs/${job.id}/preview?file=${encodeURIComponent(`${row.recordId}/${row.fieldId}/${row.attachmentId}`)}`;
  const response=await call(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');
  const image=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.ok(image.width<=480&&image.height<=360);
  assert.equal((await other(url)).status,404);
  assert.equal((await call(`/api/jobs/${job.id}/preview?file=../../server.mjs`)).status,404);
  const state=await(await call(`/api/jobs/${job.id}`)).json();assert.equal(state.success,0);assert.equal(state.pending,6);
});
test('同会话更新过期CSV后只补失败文件，不用重启且不重下成功文件',async t=>{
  const reads=[];
  const app=await createServer({port:0,runtime:await mkdtemp(join(tmpdir(),'photoport-refresh-')),csvSourceFactory:text=>new CSVSource(text,{fetcher:async address=>{
    const u=new URL(address);reads.push(u.pathname+u.search);return u.pathname==='/2'&&u.search==='?v=old'?new Response('expired',{status:403}):new Response(fixturePNG(Number(u.pathname.slice(1))));
  }})});t.after(()=>app.close());
  const call=await client(app),csv=v=>'名称,货号,附件\n'+[1,2].map(i=>`商品${i},A001,"原图.png (https://v5.airtableusercontent.com/${i}?v=${v})"`).join('\n');
  await call('/api/connect-csv',{text:csv('old')});let job=await(await call('/api/scan',{tableId:'tblCSV',fields:['csv2'],labelField:'csv0'})).json();
  await call(`/api/jobs/${job.id}/all`,{});job=await settled(call,job.id);assert.equal(job.success,1);assert.equal(job.failed,1);
  const first=job.rows.find(r=>r.status==='success');
  const refreshed=await(await call('/api/connect-csv',{text:csv('new')})).json();assert.deepEqual(refreshed.refreshedJobs,[job.id]);
  reads.length=0;await call(`/api/jobs/${job.id}/retry`,{});job=await settled(call,job.id);assert.equal(job.success,2);assert.deepEqual(reads,['/2?v=new']);assert.equal(job.rows.find(r=>r.attachmentId===first.attachmentId).sha256,first.sha256);
  const mismatch=await(await call('/api/connect-csv',{text:csv('new').replace('商品1','另一份资料')})).json();assert.deepEqual(mismatch.refreshedJobs,[]);
});
test('画廊同货号合并但保留所属记录，不把同名记录或不可信文字变为HTML',()=>{
  const rows=[{recordId:'a',label:'同名',filename:'a'},{recordId:'b',label:'同名',filename:'b'}],records=[{id:'a',display:{sku:'A001'}},{id:'b',display:{sku:'A001'}}];
  const sku=groupFiles(rows,records,{groupBy:['sku']});assert.equal(sku.length,1);assert.deepEqual(sku[0].recordIds,['a','b']);assert.equal(groupFiles(rows,records,{}).length,2);
  assert.equal(escapeHTML('<img src=x onerror="1">'),'&lt;img src=x onerror=&quot;1&quot;&gt;');
});
