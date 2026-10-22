import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../server.mjs';
import { AirtableSource,fixturePNG } from '../lib/adapters.mjs';

test('新版两输入流程：识别表/视图，用真实适配器的模拟官方响应直存本机，不需R2或公开许可',async t=>{
  const bytes=fixturePNG(17),requests=[];
  const fetcher=async(input,init)=>{
    const url=new URL(input);requests.push({url:url.toString(),method:init?.method||'GET'});
    if(url.hostname.endsWith('.airtableusercontent.com'))return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
    assert.equal(init.headers.Authorization,'Bearer fake-read-only-test');
    if(url.pathname.endsWith('/tables'))return Response.json({tables:[{id:'tblProducts',name:'Products',primaryFieldId:'fldName',fields:[{id:'fldName',name:'Name',type:'singleLineText'},{id:'fldPhotos',name:'Photos',type:'multipleAttachments'}]}]});
    assert.equal(url.searchParams.get('view'),'viwSelected');
    return Response.json({records:[{id:'recChair',fields:{fldName:'椅子A',fldPhotos:[{id:'attPhoto',filename:'正面.png',size:bytes.length,type:'image/png',url:'https://v5.airtableusercontent.com/test-photo'}]}}]});
  };
  const app=await createServer({port:0,runtime:await mkdtemp(join(tmpdir(),'photoport-local-source-')),sourceFactory:(token,base)=>new AirtableSource(token,base,{fetcher,sleep:async()=>{}})});t.after(()=>app.close());
  const initial=await fetch(app.origin),cookie=initial.headers.get('set-cookie').split(';')[0];
  const call=async(path,body)=>{const r=await fetch(app.origin+path,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
  const connected=await call('/api/connect-airtable',{sourceUrl:'https://airtable.com/appTestBase/tblProducts/viwSelected',token:'fake-read-only-test'});
  assert.equal(connected.status,200);assert.equal(connected.data.tableId,'tblProducts');assert.equal(connected.data.viewId,'viwSelected');
  const scan=await call('/api/scan',{tableId:connected.data.tableId,viewId:connected.data.viewId,fields:['fldPhotos'],labelField:'fldName',destination:'local'});
  assert.equal(scan.status,201);assert.equal(scan.data.destinationMode,'local');
  const id=scan.data.id;await call(`/api/jobs/${id}/all`,{});
  let state;for(let i=0;i<100;i++){state=(await call(`/api/jobs/${id}`)).data;if(!state.busy)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.success,1);assert.equal(state.rows[0].label,'椅子A');assert.equal(state.rows[0].filename,'正面.png');assert.equal(state.rows[0].fieldName,'Photos');
  assert.equal((await call(`/api/jobs/${id}/archive`,{})).status,202);
  for(let i=0;i<300;i++){state=(await call(`/api/jobs/${id}`)).data;if(['ready','failed'].includes(state.archive?.state))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.archive.state,'ready');assert.equal(state.archive.catalog.embeddedPreviews,1);
  assert.ok(requests.every(r=>r.method==='GET'));assert.ok(!(await call('/api/status')).data.r2);
});
