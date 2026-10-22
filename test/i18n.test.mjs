import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ExcelJS from 'exceljs';
import english from '../public/messages.en.js';
import {translate,templateKey,normalizeLanguage} from '../public/i18n.js';
import {archiveRows,layoutOverview} from '../lib/names.mjs';
import {groupFiles} from '../public/gallery.js';
import {buildArchive} from '../lib/archive.mjs';
import {digest} from '../lib/core.mjs';
import {fixturePNG} from '../lib/adapters.mjs';
import {createServer} from '../server.mjs';
const execFileAsync=promisify(execFile);

test('translations keep every placeholder, cover static UI and support dynamic errors',async()=>{
  const placeholders=s=>[...s.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
  for(const [source,target] of Object.entries(english)){
    assert.ok(target,source);
    assert.deepEqual(placeholders(target),placeholders(source),source);
    assert.doesNotMatch(target,/[\u3400-\u9fff]/u,source);
  }
  for(const file of ['app.html','index.html']){
    const html=await readFile(new URL('../public/'+file,import.meta.url),'utf8');
    const texts=[...html.matchAll(/>([^<>]+)</g)].map(m=>m[1].trim());
    const attrs=[...html.matchAll(/(?:placeholder|aria-label|title|content)="([^"]*)"/g)].map(m=>m[1]);
    for(const source of [...texts,...attrs].filter(s=>/[\u3400-\u9fff]/u.test(s)&&!['中文','语言'].includes(s)))assert.ok(Object.hasOwn(english,source),source);
  }
  assert.equal(normalizeLanguage('en-GB'),'en');
  assert.equal(normalizeLanguage('zh-TW'),'zh-CN');
  assert.equal(translate('请先连接Airtable表格或导入CSV。','en'),'Connect to Airtable or import a CSV first.');
  assert.equal(translate('客户表：关联表不可读，保留原记录编号。','en'),'客户表: linked table unavailable; original record IDs kept.');
  assert.equal(translate(templateKey(['共','个附件。']),'en',[18]),'18 attachments in total.');
  assert.equal(translate('Your files are ready','zh-CN'),'资料已准备好');
});

const bytes=fixturePNG(91);
const row={status:'success',recordId:'recA',fieldId:'Photos',fieldName:'商品照片',attachmentId:'attA',label:'已核对',filename:'正面原图.png',type:'image/png',extension:'png',bytes:bytes.length,declaredBytes:bytes.length,sha256:digest(bytes),url:'https://images.example.com/photo.png',verification:'已核对本机副本内容'};
const recordData={table:{id:'tblA',name:'客户原表'},fields:[{id:'SKU',name:'商品货号',type:'singleLineText'},{id:'Customer',name:'客户',type:'singleLineText'},{id:'Photos',name:'商品照片',type:'multipleAttachments'}],records:[{id:'recA',values:{SKU:'A001',Customer:''},display:{SKU:'A001',Customer:''}},{id:'recB',values:{SKU:'A002',Customer:'未填写'},display:{SKU:'A002',Customer:'未填写'}}]};

test('English paths translate empty groups, never original values or names',()=>{
  const rows=[row,{...row,recordId:'recB',attachmentId:'attB'}],organization={groupBy:['Customer']};
  const translated=archiveRows(rows,organization,recordData,'en');
  assert.match(translated[0].downloadPath,/\/Unspecified\//);
  assert.match(translated[1].downloadPath,/\/未填写\//);
  assert.equal(translated[0].filename,'正面原图.png');
  assert.equal(translated[0].label,'已核对');
  assert.deepEqual(groupFiles(rows,recordData.records,organization,'en').map(g=>g.name),['Unspecified','未填写']);
  assert.deepEqual(layoutOverview(rows,organization,recordData,'en').paths,translated.map(r=>r.downloadPath));
});

test('English ZIP, Excel, gallery and CSV remain usable offline and preserve Chinese source data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'photoport-i18n-'));
  const failed={...row,recordId:'recB',attachmentId:'attB',filename:'失败原图.png',status:'failed',error:'下载地址已过期。'};
  const summary={id:'bilingual',layoutVersion:1,rows:[row,failed],organization:{groupBy:['Customer']},recordData};
  let reads=0;
  const en=await buildArchive(summary,{root,read:async()=>{reads++;return bytes;},allowPartial:true,locale:'en'});
  const zh=await buildArchive(summary,{root,read:async()=>{reads++;return bytes;},allowPartial:true,locale:'zh-CN'});
  assert.equal(reads,1,'second language reuses verified cached files');
  assert.notEqual(en.path,zh.path);
  assert.equal(en.info.locale,'en');
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(en.catalogPath);
  assert.deepEqual(book.worksheets.map(s=>s.name),['Photo catalog','Source records']);
  assert.equal(book.worksheets[0].getCell('A1').value,'Source record');
  assert.equal(book.worksheets[0].getCell('A2').value,'已核对','record label must not be translated');
  assert.equal(book.worksheets[0].getCell('C2').value,'正面原图.png');
  assert.equal(book.worksheets[0].getCell('E2').value,'Verified');
  assert.equal(book.worksheets[0].getCell('E3').value,'The download URL has expired.');
  assert.equal(book.worksheets[1].getCell('B1').value,'商品货号');
  assert.equal(book.worksheets[1].getCell('C3').value,'未填写');
  const result=await execFileAsync('python',['-X','utf8','-c',[
    'import zipfile,json,csv,io,hashlib,sys',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    " assert {'photo-catalog.xlsx','attachments.csv','missing-files.csv','source-records.csv','source-data.json','index.html','README.txt','manifest.json'}.issubset(set(z.namelist()))",
    " m=json.loads(z.read('manifest.json')); assert m['exportLocale']=='en'",
    " r=m['rows'][0]; assert r['filename']=='正面原图.png' and r['label']=='已核对'",
    " assert hashlib.sha256(z.read(r['downloadPath'])).hexdigest()==r['sha256']",
    " html=z.read('index.html').decode(); assert 'lang=\"en\"' in html and 'Source record / group' in html and '正面原图.png' in html",
    " readme=z.read('README.txt').decode(); assert 'open index.html' in readme and '{0}' not in readme",
    " c=list(csv.DictReader(io.StringIO(z.read('missing-files.csv').decode('utf-8-sig')))); assert c[0]['error']=='The download URL has expired.'",
    " source=list(csv.reader(io.StringIO(z.read('source-records.csv').decode('utf-8-sig')))); assert source[0][0]=='Record ID' and source[0][1]=='商品货号' and len(source)==3",
    " assert z.testzip() is None",
    " print('English ZIP verified')"
  ].join('\n'),en.path],{encoding:'utf8'});
  assert.match(result.stdout,/English ZIP verified/);
});

test('HTTP language changes keep task identity, localize errors and never serve the wrong archive',async t=>{
  const runtime=await mkdtemp(join(tmpdir(),'photoport-i18n-api-')),app=await createServer({port:0,runtime});
  t.after(()=>app.close());
  const cookie=(await fetch(app.origin)).headers.get('set-cookie').split(';')[0];
  const request=(path,body,lang='en')=>fetch(app.origin+path+(path.includes('?')?'&':'?')+'lang='+lang,{headers:{cookie,'Content-Type':'application/json','X-PhotoPort':'1'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  assert.equal((await(await request('/api/scan',{})).json()).error,'Connect to Airtable or import a CSV first.');
  assert.equal((await(await request('/api/scan',{},'zh-CN')).json()).error,'请先连接Airtable表格或导入CSV。');
  for(const path of ['/locale.js','/i18n.js','/messages.en.js','/home.js','/names.js'])assert.equal((await request(path)).status,200);
  let state=await(await request('/api/demo',{count:3,edgeCases:false,visual:true})).json();
  const path='/api/jobs/'+state.id,id=state.id;
  assert.equal(state.recordData.table.name,'Product sample');
  assert.equal(state.recordData.fields[0].name,'Product name');
  assert.doesNotMatch(state.rows[0].label,/[\u3400-\u9fff]/u);
  await request(path+'/all',{});
  async function waitFor(done){
    for(let i=0;i<500;i++){state=await(await request(path)).json();if(done(state))return;await new Promise(r=>setTimeout(r,10));}
    assert.fail('task timed out');
  }
  await waitFor(s=>!s.busy);assert.equal(state.success,3);
  await request(path+'/archive',{});await waitFor(s=>s.archive?.state==='ready');assert.equal(state.archive.locale,'en');
  assert.equal((await request(path+'/archive')).status,200);
  assert.equal((await request(path+'/archive',undefined,'zh-CN')).status,409);
  await request(path+'/archive',{},'zh-CN');await waitFor(s=>s.archive?.state==='ready');
  assert.equal(state.archive.locale,'zh-CN');assert.equal(state.id,id);assert.equal(state.success,3);
  assert.equal((await request(path+'/catalog',undefined,'en')).status,409);
  assert.equal((await request(path+'/catalog',undefined,'zh-CN')).status,200);
  const enCSV=await(await request(path+'/export?format=records')).text();assert.match(enCSV,/"Record ID"/);assert.match(enCSV,/"Product name"/);
  await request('/api/clear',{});
  await request('/api/restore',{id});
  await waitFor(s=>!s.busy);
  assert.equal(state.success,3);assert.equal(state.recordData.table.name,'Product sample','restoring keeps the generated source language');
});
