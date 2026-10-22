import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { archiveRows,safeName } from '../lib/names.mjs';
import { buildArchive,validateExport } from '../lib/archive.mjs';
import { digest } from '../lib/core.mjs';
import { fixturePNG } from '../lib/adapters.mjs';
import { createServer } from '../server.mjs';

test('下载文件保留中文原名，按记录和照片列分开；同目录重名、大小写和危险路径不会覆盖',()=>{
  const base={status:'success',label:'椅子 / A',recordId:'recA',fieldId:'Photos',filename:'正面.png',extension:'png'};
  const rows=archiveRows([base,{...base},{...base,filename:'正面.PNG'},{...base,recordId:'recB'},{...base,filename:'../../escape.png'}]);
  assert.ok(rows[0].downloadPath.endsWith('/正面.png'));assert.ok(rows[1].downloadPath.endsWith('/正面 (2).png'));assert.ok(rows[2].downloadPath.endsWith('/正面 (3).PNG'));
  assert.ok(rows[3].downloadPath.includes('__recB/'));assert.equal(new Set(rows.map(r=>r.downloadPath.toLowerCase())).size,5);
  assert.ok(rows.every(r=>!r.downloadPath.split('/').includes('..')));assert.equal(safeName('CON.png'),'_CON.png');assert.equal(rows[4].filename,'../../escape.png');
});
test('真实ZIP可独立解压：完整照片、原名对应、离线目录、内容指纹与ZIP64尾部',async()=>{
  const root=await mkdtemp(join(tmpdir(),'photoport-zip-')),data=fixturePNG(91);
  const base={status:'success',recordId:'recA',fieldId:'Photos',attachmentId:'att1',label:'中文商品',filename:'正面.png',type:'image/png',extension:'png',bytes:data.length,declaredBytes:data.length,sha256:digest(data),url:'https://images.example.com/a.png'};
  const summary={id:'12345678-1234-1234-1234-123456789abc',busy:false,rows:[base,{...base,attachmentId:'att2'},{...base,recordId:'recB',attachmentId:'att3'}]};let reads=0;
  const result=await buildArchive(summary,{root,read:async()=>{reads++;return data;}});assert.equal(reads,1);assert.equal(result.info.total,3);
  const b=await readFile(result.path);assert.ok(b.includes(Buffer.from([0x50,0x4b,0x06,0x06])));
  const output=JSON.parse(execFileSync('python',['-X','utf8','-c',`import zipfile,json,csv,io,hashlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('manifest.json')); rows=m['rows']; files=[n for n in z.namelist() if n.startswith('photos/')]
 assert len(files)==3
 assert all(hashlib.sha256(z.read(r['downloadPath'])).hexdigest()==r['sha256'] for r in rows)
 assert '打开照片目录.html' in z.namelist()
 assert '照片目录.xlsx' in z.namelist()
 with zipfile.ZipFile(io.BytesIO(z.read('照片目录.xlsx'))) as x:
  import xml.etree.ElementTree as E
  assert len([n for n in x.namelist() if n.startswith('xl/media/') and not n.endswith('/')])==1
  drawing=E.fromstring(x.read('xl/drawings/drawing1.xml'))
  assert sum(el.tag.endswith('}pic') for el in drawing.iter())==3
 c=list(csv.DictReader(io.StringIO(z.read('照片清单.csv').decode('utf-8-sig'))))
 assert [r['original_filename'] for r in c]==['正面.png']*3
 assert len(set(r['download_path'].lower() for r in c))==3
 print(json.dumps({'files':len(files),'crc_ok':z.testzip() is None}))`,result.path],{encoding:'utf8'}));assert.deepEqual(output,{files:3,crc_ok:true});
  await assert.rejects(buildArchive({...summary,rows:[{...base,status:'failed'}]},{root,read:async()=>data}),/重试/);
});
test('照片内容不一致时不提供成功包；导入清单不接受缺少指纹、重复身份和非HTTPS',async()=>{
  const data=fixturePNG(2),row={status:'success',recordId:'rec1',fieldId:'Photos',attachmentId:'att1',filename:'a.png',label:'A',type:'image/png',extension:'png',bytes:data.length,sha256:digest(data),url:'https://images.example.com/a.png'};
  const root=await mkdtemp(join(tmpdir(),'photoport-zip-bad-'));
  await assert.rejects(buildArchive({id:'bad',rows:[row]},{root,read:async()=>fixturePNG(9)}),/内容变化/);
  assert.equal(validateExport({rows:[row]}).length,1);
  for(const rows of [[{...row,sha256:''}],[row,row],[{...row,url:'http://localhost/a.png'}]])assert.throws(()=>validateExport({rows}));
});
test('HTTP一键下载流程：未完成阻止、照片包、断点范围下载和会话隔离',async t=>{
  const runtime=await mkdtemp(join(tmpdir(),'photoport-zip-api-')),app=await createServer({port:0,runtime});t.after(()=>app.close());
  const initial=await fetch(app.origin),cookie=initial.headers.get('set-cookie').split(';')[0];
  const request=(path,body)=>fetch(app.origin+path,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1',Origin:app.origin},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  const job=await(await request('/api/demo',{count:10,edgeCases:false})).json(),path=`/api/jobs/${job.id}`;
  assert.equal((await request(path+'/archive',{})).status,409);await request(path+'/all',{});
  let state;for(let i=0;i<500;i++){state=await(await request(path)).json();if(!state.busy)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.success,10);assert.equal((await request(path+'/archive',{})).status,202);
  for(let i=0;i<500;i++){state=await(await request(path)).json();if(['ready','failed'].includes(state.archive?.state))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.archive.state,'ready');const archive=await request(path+'/archive');const bytes=Buffer.from(await archive.arrayBuffer());assert.equal(bytes.length,state.archive.zipBytes);
  const partial=await fetch(app.origin+path+'/archive',{headers:{cookie,Range:'bytes=0-3'}});assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),Buffer.from('PK\x03\x04'));
  const head=await fetch(app.origin+path+'/archive',{method:'HEAD',headers:{cookie}});assert.equal(Number(head.headers.get('content-length')),bytes.length);
  assert.equal((await fetch(app.origin+path+'/archive')).status,404);
});
