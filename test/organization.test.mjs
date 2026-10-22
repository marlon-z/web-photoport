import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
import {archiveRows,normalizeOrganization,safeFilename} from '../lib/names.mjs';
import {snapshotRecords,cellText} from '../lib/metadata.mjs';
import {CSVSource,parseCSV} from '../lib/csv-source.mjs';
import {AirtableSource,fixturePNG} from '../lib/adapters.mjs';
import {createServer} from '../server.mjs';
import {digest} from '../lib/core.mjs';
import {matchesCondition} from '../public/filters.js';
import {matchesFile} from '../lib/file-types.mjs';

test('无需预建视图：精确状态、价格阈值、日期和空值筛选正确，空金额不会当零',()=>{
  const r={display:{state:'待发布',price:'0',date:'2026-10-21',blank:''}};
  assert.ok(matchesCondition(r,{field:'state',operator:'equals',value:'待发布'}));
  assert.ok(!matchesCondition(r,{field:'state',operator:'equals',value:'已发布'}));
  assert.ok(matchesCondition(r,{field:'price',operator:'lt',value:'1'}));
  assert.ok(!matchesCondition(r,{field:'blank',operator:'lt',value:'1'}));
  assert.ok(matchesCondition(r,{field:'date',operator:'before',value:'2026-10-22'}));
  assert.ok(matchesCondition(r,{field:'blank',operator:'empty'}));
});

const fields=[{id:'Name',name:'名称',type:'singleLineText'},{id:'SKU',name:'货号',type:'singleLineText'},{id:'User',name:'用户',type:'singleCollaborator'},{id:'Price',name:'价格',type:'number'},{id:'Photos',name:'照片',type:'multipleAttachments'}];
const records=[{id:'recA',fields:{Name:'商品一',SKU:'001',User:{id:'usrA',name:'张三'},Price:0}},{id:'recB',fields:{Name:'商品二',SKU:'001',User:{id:'usrA',name:'张三'},Price:19.5}},{id:'recC',fields:{Name:'空货号',User:{id:'usrB',name:'李四'}}},{id:'recD',fields:{Name:'没有附件'}}];
const data=snapshotRecords(records,{id:'tblTest',fields});
const row=(recordId,filename='正面.jpg')=>({recordId,status:'success',label:recordId,fieldId:'Photos',fieldName:'照片',attachmentId:'att'+recordId,filename,extension:'jpg'});
test('同货号跨记录真正归并；两层用户/货号、空值、多值、原归属及重名均保留',()=>{
  const rows=[row('recA'),row('recB'),row('recC')];
  const one=archiveRows(rows,{groupBy:['SKU'],separateFields:false},data);
  assert.equal(one[0].downloadPath,'photos/001/正面.jpg');assert.equal(one[1].downloadPath,'photos/001/正面 (2).jpg');assert.equal(one[1].recordId,'recB');assert.equal(one[2].downloadPath,'photos/未填写/正面.jpg');
  const two=archiveRows(rows,{groupBy:['User','SKU'],separateFields:false},data);assert.equal(two[0].downloadPath,'photos/张三/001/正面.jpg');assert.equal(two[1].downloadPath,'photos/张三/001/正面 (2).jpg');
  assert.ok(archiveRows(rows,{groupBy:['SKU'],keepRecordFolder:true},data)[1].downloadPath.includes('__recB/'));
  const numbered=archiveRows(rows,{groupBy:['SKU'],renameField:'SKU',separateFields:false},data);assert.ok(numbered[0].downloadPath.endsWith('/001-01.jpg'));assert.ok(numbered[1].downloadPath.endsWith('/001-02.jpg'));
  assert.equal(cellText([{name:'小李'},{name:'小王'}]),'小李、小王');assert.equal(cellText(0),'0');assert.equal(cellText(false),'false');
});
test('分组名清洗或大小写碰撞不会误并；重命名跨列连续编号，不能穿越路径',()=>{
  const collision=snapshotRecords([{id:'recA',fields:{SKU:'A/B'}},{id:'recB',fields:{SKU:'A:B'}},{id:'recC',fields:{SKU:'a_b'}}],{fields});
  const result=archiveRows([row('recA'),row('recB'),row('recC')],{groupBy:['SKU'],separateFields:false},collision);
  assert.equal(new Set(result.map(r=>r.downloadPath.toLowerCase())).size,3);assert.equal(new Set(result.map(r=>r.downloadPath.split('/')[1].toLowerCase())).size,3);
  const renamed=archiveRows([row('recA','x.jpg'),{...row('recA','../../x.png'),fieldId:'Other',extension:'png'}],{groupBy:['SKU'],renameField:'SKU'},data);
  assert.ok(renamed[0].downloadPath.endsWith('/001-01.jpg'));assert.ok(renamed[1].downloadPath.endsWith('/001-02.png'));assert.equal(renamed[1].filename,'../../x.png');
  assert.throws(()=>normalizeOrganization({groupBy:['bad']},fields));
  assert.ok(safeFilename('很长的文件名称'.repeat(40)+'.xlsx','file').endsWith('.xlsx'));
});
test('CSV保留逗号、换行、多附件原名，不保存临时URL；拒绝伪装域名和损坏引号',async()=>{
  const png=fixturePNG(4),csv='名称,货号,附件,备注\r\n"商品,一",001,"正面,样图.png (https://v5.airtableusercontent.com/a), side.png (https://v5.airtableusercontent.com/b)","第一行\n第二行"\r\n';
  const source=new CSVSource(csv,{fetcher:async()=>new Response(png)});
  assert.equal(source.records[0].fields.csv2.length,2);assert.equal(source.records[0].fields.csv2[0].filename,'正面,样图.png');
  assert.equal(parseCSV(csv)[1][3],'第一行\n第二行');
  const snapshot=snapshotRecords(source.records,source.table);assert.ok(!JSON.stringify(snapshot).includes('airtableusercontent.com'));assert.equal(snapshot.records[0].values.csv1,'001');
  assert.throws(()=>new CSVSource(csv.replaceAll('v5.airtableusercontent.com','airtableusercontent.com.evil.test')));
  assert.throws(()=>parseCSV('a,b\n"broken,x'));
  const normalLink=new CSVSource(csv.replace('第一行\n第二行','参考 (https://docs.google.com/example)'));assert.equal(normalLink.records[0].fields.csv3,'参考 (https://docs.google.com/example)');
  source.fetcher=async()=>new Response('',{status:403});await assert.rejects(source.read({identity:[...source.urls.keys()][0]}),/过期/);
});
test('关联客户保留原编号并读取人名；失败时有明确提示，所有请求只读',async()=>{
  const table={id:'tblProducts',fields:[{id:'Client',name:'客户',type:'multipleRecordLinks',options:{linkedTableId:'tblClients'}}]},other={id:'tblClients',primaryFieldId:'fldName'};
  let calls=0;const source=new AirtableSource('test','appTest',{sleep:async()=>{},fetcher:async(u,options)=>{calls++;assert.equal(options.method,undefined);assert.ok(String(u).includes('filterByFormula'));return Response.json({records:[{id:'recClient',fields:{fldName:'客户张三'}}]});}});
  const rs=[{id:'recProduct',fields:{Client:['recClient']}}];assert.deepEqual(await source.resolveNames(rs,table,[table,other]),[]);assert.equal(rs[0].display.Client,'客户张三');assert.deepEqual(rs[0].fields.Client,['recClient']);assert.equal(calls,1);
  const warnings=await source.resolveNames(rs,table,[table]);assert.match(warnings[0],/不可读/);
});
test('实际CSV到本机资料包：选择记录、货号/用户合并、PDF和TXT、完整原表和Excel双页签可独立读取',async t=>{
  const png=fixturePNG(8),pdf=Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\n%%EOF'),txt=Buffer.from('中文说明，原内容不变。');
  const bodies=new Map([['/front',png],['/side',png],['/contract',pdf],['/notes',txt]]);
  const csv='名称,货号,客户,价格,附件\n商品一,001,张三,0,"正面.png (https://v5.airtableusercontent.com/front), 合同.pdf (https://v5.airtableusercontent.com/contract)"\n商品二,001,张三,19.5,"正面.png (https://v5.airtableusercontent.com/side), 说明.txt (https://v5.airtableusercontent.com/notes)"\n不选,002,李四,1,\n没有附件,003,张三,5,\n';
  const runtime=await mkdtemp(join(tmpdir(),'photoport-organize-'));
  const app=await createServer({runtime,port:0,csvSourceFactory:text=>new CSVSource(text,{fetcher:async url=>new Response(bodies.get(new URL(url).pathname))})});t.after(()=>app.close());
  const first=await fetch(app.origin),cookie=first.headers.get('set-cookie').split(';')[0];
  const request=(path,body)=>fetch(app.origin+path,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  assert.equal((await request('/api/connect-csv',{text:csv})).status,200);
  const job=await(await request('/api/scan',{tableId:'tblCSV',fields:['csv4'],labelField:'csv0'})).json(),path=`/api/jobs/${job.id}`;
  assert.equal(job.total,4);assert.equal(job.records,4);assert.equal(job.recordData.fields.length,5);
  assert.equal((await request(path+'/organize',{organization:{groupBy:['csv2','csv1'],separateFields:false},recordIds:['csvRow2','csvRow3','csvRow5']})).status,200);
  await request(path+'/all',{});let state;
  for(let i=0;i<300;i++){state=await(await request(path)).json();if(!state.busy)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.success,4);assert.equal(state.failed,0);assert.equal(state.records,3);assert.equal(state.copiedBytes,png.length*2+pdf.length+txt.length);
  assert.equal((await request(path+'/archive',{})).status,202);
  for(let i=0;i<600;i++){state=await(await request(path)).json();if(['ready','failed'].includes(state.archive?.state))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.archive.state,'ready');assert.equal(state.archive.catalog.embeddedPreviews,2);
  const zip=join(runtime,'archives',job.id,String(state.layoutVersion),'photos.zip');
  const result=JSON.parse((await execFileAsync('python',['-X','utf8','-c',`import zipfile,json,csv,io,sys,hashlib,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('manifest.json')); rows=m['rows']; assert len(rows)==4
 assert all(r['downloadPath'].startswith('photos/张三/001/') for r in rows)
 assert len(set(r['downloadPath'].lower() for r in rows))==4
 assert all(hashlib.sha256(z.read(r['downloadPath'])).hexdigest()==r['sha256'] for r in rows)
 assert z.testzip() is None
 c=list(csv.reader(io.StringIO(z.read('原表记录.csv').decode('utf-8-sig')))); assert len(c)==4; assert c[0][2]=='货号'; assert c[1][2]=='001'
 d=json.loads(z.read('原表数据.json')); assert len(d['records'])==3; assert 'airtableusercontent.com' not in json.dumps(d)
 with zipfile.ZipFile(io.BytesIO(z.read('照片目录.xlsx'))) as x:
  ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  assert len(E.fromstring(x.read('xl/workbook.xml')).find('s:sheets',ns))==2
 print(json.dumps({'files':4,'records':3,'two_sheets':True,'hashes_ok':True}))`,zip],{encoding:'utf8'})).stdout);assert.equal(result.hashes_ok,true);
  // Reorganizing only repacks; no source downloads or duplicate transfers.
  const attempts=state.attempts;await request(path+'/organize',{organization:{groupBy:['csv1'],renameField:'csv1',separateFields:false}});state=await(await request(path)).json();assert.equal(state.archive,null);assert.equal(state.attempts,attempts);assert.equal(state.success,4);
  const saved=JSON.parse(await readFile(join(runtime,'jobs',job.id+'.json'),'utf8'));assert.ok(!JSON.stringify(saved).includes('airtableusercontent.com'));assert.equal(saved.job.organization.renameField,'csv1');
});

test('CSV任务重启并换新临时链接：保留20个成功文件和整理规则，仅下载剩下5个',async t=>{
  const png=fixturePNG(90),runtime=await mkdtemp(join(tmpdir(),'photoport-csv-resume-'));
  const csv=version=>'名称,货号,附件\n'+Array.from({length:25},(_,i)=>`商品${i},001,"front.png (https://v5.airtableusercontent.com/photo${i}?v=${version})"`).join('\n');
  let reads=0,app=await createServer({runtime,port:0,csvSourceFactory:text=>new CSVSource(text,{fetcher:async()=>{reads++;return new Response(png);}})});
  const client=async origin=>{const first=await fetch(origin),cookie=first.headers.get('set-cookie').split(';')[0];return async(path,body)=>{const r=await fetch(origin+path,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;};};
  const settled=async(call,id)=>{for(let i=0;i<300;i++){const state=await call(`/api/jobs/${id}`);if(!state.busy)return state;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
  let call=await client(app.origin);await call('/api/connect-csv',{text:csv(1)});let job=await call('/api/scan',{tableId:'tblCSV',fields:['csv2'],labelField:'csv0'});
  await call(`/api/jobs/${job.id}/organize`,{organization:{groupBy:['csv1'],renameField:'csv1'}});await call(`/api/jobs/${job.id}/sample`,{});job=await settled(call,job.id);assert.equal(job.success,20);
  const savedPath=join(runtime,'files',...new URL(job.rows[0].url).pathname.slice('/demo-files/'.length).split('/')),mtime=(await stat(savedPath)).mtimeMs;
  await app.close();reads=0;
  app=await createServer({runtime,port:0,csvSourceFactory:text=>new CSVSource(text,{fetcher:async()=>{reads++;return new Response(png);}})});t.after(()=>app.close());
  call=await client(app.origin);await call('/api/connect-csv',{text:csv(2)});assert.ok((await call('/api/saved-jobs')).jobs.some(j=>j.id===job.id));
  await call('/api/restore',{id:job.id});job=await settled(call,job.id);assert.equal(job.success,20);assert.equal(job.pending,5);assert.equal(reads,0);assert.deepEqual(job.organization.groupBy,['csv1']);
  await call(`/api/jobs/${job.id}/all`,{});job=await settled(call,job.id);assert.equal(job.success,25);assert.equal(reads,5);assert.equal((await stat(savedPath)).mtimeMs,mtime);
});
test('常见文档、音视频和新图片格式按文件头核对，网页或伪装格式不接受',()=>{
  for(const type of ['application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'])assert.ok(matchesFile(Buffer.from('PK\x03\x04rest'),type));
  assert.ok(matchesFile(Buffer.from('%PDF-1.4\n%%EOF'),'application/pdf'));
  assert.ok(matchesFile(Buffer.from('GIF89a'),'image/gif'));assert.ok(matchesFile(Buffer.from('49492a00','hex'),'image/tiff'));
  for(const type of ['image/avif','image/heic','video/mp4','video/quicktime'])assert.ok(matchesFile(Buffer.from('\0\0\0\x18ftypisom'),type));
  assert.ok(matchesFile(Buffer.from('RIFFxxxxWAVE'),'audio/wav'));assert.ok(matchesFile(Buffer.from('ID3rest'),'audio/mpeg'));
  assert.ok(!matchesFile(Buffer.from('<html>not a document</html>'),'application/pdf'));assert.ok(!matchesFile(Buffer.from('plain'),'text/html'));
});
