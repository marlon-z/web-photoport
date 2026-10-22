import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createServer} from '../server.mjs';
import {CSVSource} from '../lib/csv-source.mjs';
import {fixturePNG} from '../lib/adapters.mjs';

test('失败不阻断成功资料：部分ZIP明确标注并有缺失清单，重试后生成新完整包',async t=>{
  const runtime=await mkdtemp(join(tmpdir(),'photoport-partial-'));let fail=true;
  const app=await createServer({runtime,port:0,csvSourceFactory:text=>new CSVSource(text,{fetcher:async url=>new URL(url).pathname==='/missing'&&fail?new Response('missing',{status:404}):new Response(fixturePNG(6))})});t.after(()=>app.close());
  const cookie=(await fetch(app.origin)).headers.get('set-cookie').split(';')[0];
  const req=(path,body)=>fetch(app.origin+path,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  const csv='名称,附件\n商品一,"正面.png (https://v5.airtableusercontent.com/a)"\n商品二,"细节.png (https://v5.airtableusercontent.com/b)"\n商品三,"缺失.png (https://v5.airtableusercontent.com/missing)"';
  await req('/api/connect-csv',{text:csv});const job=await(await req('/api/scan',{tableId:'tblCSV',fields:['csv1'],labelField:'csv0'})).json(),path=`/api/jobs/${job.id}`;
  const idle=async archive=>{for(let i=0;i<500;i++){const s=await(await req(path)).json();if(archive?['ready','failed'].includes(s.archive?.state):!s.busy)return s;await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');};
  await req(path+'/all',{});let s=await idle();assert.equal(s.success,2);assert.equal(s.failed,1);
  assert.equal((await req(path+'/archive',{})).status,409);
  assert.equal((await req(path+'/archive',{allowPartial:true})).status,202);s=await idle(true);assert.equal(s.archive.partial,true);assert.equal(s.archive.missing,1);
  const zip=join(runtime,'partial.zip');await writeFile(zip,Buffer.from(await(await req(path+'/archive')).arrayBuffer()));
  const verification=JSON.parse(execFileSync('python',['-X','utf8','-c',`import zipfile,json,csv,io,sys,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('manifest.json')); assert m['delivery']=={'partial':True,'included':2,'missing':1}
 assert len([n for n in z.namelist() if n.startswith('photos/')])==2
 assert all(hashlib.sha256(z.read(r['downloadPath'])).hexdigest()==r['sha256'] for r in m['rows'] if r['status']=='success')
 missing=list(csv.DictReader(io.StringIO(z.read('未下载文件清单.csv').decode('utf-8-sig')))); assert len(missing)==1
 assert len(list(csv.reader(io.StringIO(z.read('原表记录.csv').decode('utf-8-sig')))))==4
 print(json.dumps({'crc':z.testzip() is None,'included':2,'missing':1}))`,zip],{encoding:'utf8'}));assert.deepEqual(verification,{crc:true,included:2,missing:1});
  const version=s.layoutVersion;fail=false;await req(path+'/retry',{});s=await idle();assert.equal(s.success,3);assert.equal(s.failed,0);assert.equal(s.archive,null);assert.ok(s.layoutVersion>version);
  await req(path+'/archive',{});s=await idle(true);assert.equal(s.archive.partial,false);assert.equal(s.archive.total,3);
});
