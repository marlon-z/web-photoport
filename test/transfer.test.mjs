import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPlan, TransferJob, LIMITS, digest, csv, objectKey } from '../lib/core.mjs';
import { DemoSource, LocalDestination, fixturePNG, readLimited, validateR2 } from '../lib/adapters.mjs';

test('完整复制：多照片列、同名文件、20张试搬、失败重试和独立副本',async()=>{
  const source=new DemoSource({count:30});const destination=new LocalDestination(await mkdtemp(join(tmpdir(),'photoport-test-')),'http://localhost',{failOnce:true});
  const plan=buildPlan(source.records,['Photos','Details'],'Name');assert.equal(plan.rows.length,32);assert.equal(plan.rows.filter(r=>r.status==='rejected').length,2);
  const job=new TransferJob(plan,source,destination);await job.run('sample');
  assert.equal(job.summary().success,18);assert.equal(job.summary().pending,10);assert.equal(job.summary().failed,2);
  await job.run('all');await job.run('retry');
  assert.equal(job.summary().success,29);assert.equal(job.summary().failed,1);assert.equal(job.summary().rejected,2);
  assert.equal(source.refreshes,1);assert.equal(destination.writes,29);
  const successes=job.rows.filter(r=>r.status==='success');
  assert.equal(new Set(successes.map(r=>r.url)).size,29);
  for(const row of successes)assert.equal(digest(await readFile(join(destination.root,...objectKey(job.id,row).split('/')))),row.sha256);
  const urls=new Map(successes.map(r=>[r.attachmentId,r.url]));source.records.reverse();
  for(const record of source.records)for(const field of ['Photos','Details'])record.fields[field]?.reverse();
  await job.run('retry');assert.equal(destination.writes,29);
  for(const row of successes)assert.equal(row.url,urls.get(row.attachmentId));
  source.disabled=true;await job.verifyAll();assert.equal(job.summary().success,29);
  for(const row of job.rows.filter(r=>r.status!=='success'))assert.equal(row.url,'');
  assert.ok(!JSON.stringify(job.summary()).includes('source_expired'));
});
test('目标图片被改动时核对失败，不继续给出成功地址',async()=>{
  const source=new DemoSource({count:1,edgeCases:false}),dst=new LocalDestination(await mkdtemp(join(tmpdir(),'photoport-corrupt-')),'http://localhost');
  const job=new TransferJob(buildPlan(source.records,['Photos','Details'],'Name'),source,dst);await job.run('all');assert.equal(job.summary().success,1);
  await writeFile(join(dst.root,...objectKey(job.id,job.rows[0]).split('/')),Buffer.from('corrupted'));
  await job.verifyAll();assert.equal(job.summary().failed,1);assert.equal(job.summary().rows[0].url,'');
});
test('暂停完成进行中的照片，继续时不重传已完成照片',async()=>{
  const source=new DemoSource({count:30,edgeCases:false}),dst=new LocalDestination(await mkdtemp(join(tmpdir(),'photoport-pause-')),'http://localhost');
  const job=new TransferJob(buildPlan(source.records,['Photos','Details'],'Name'),source,dst);
  const running=job.run('all');job.pause();await running;assert.equal(job.state,'paused');assert.ok(job.summary().success<=2);
  await job.run('all');assert.equal(job.summary().success,30);assert.equal(dst.writes,30);
});
test('同一个任务不能同时启动两次',async()=>{
  const source=new DemoSource({count:3,edgeCases:false}),dst=new LocalDestination(await mkdtemp(join(tmpdir(),'photoport-busy-')),'http://localhost');
  const job=new TransferJob(buildPlan(source.records,['Photos','Details'],'Name'),source,dst);
  const running=job.run('all');await assert.rejects(job.run('all'),e=>e.code==='busy');await running;
});
test('超数量、总大小和单文件限制在复制前识别',()=>{
  const a={id:'att',filename:'x.png',size:20*1024*1024,type:'image/png'};
  const records=Array.from({length:LIMITS.files+1},(_,i)=>({id:`rec${i}`,fields:{Photos:[a]}}));
  assert.throws(()=>buildPlan(records,['Photos']),e=>e.code==='file_limit');
  assert.throws(()=>buildPlan(records.slice(0,513),['Photos']),e=>e.code==='total_limit');
  const plan=buildPlan([{id:'rec1',fields:{Photos:[{...a,size:LIMITS.fileBytes+1}]}}],['Photos']);assert.equal(plan.rows[0].status,'rejected');
});
test('空字段、重复附件和不支持文件不造成多余写入',()=>{
  const a={id:'att',filename:'x.png',size:100,type:'image/png'};
  const plan=buildPlan([{id:'rec0',fields:{}},{id:'rec1',fields:{Photos:[a,a]}},{id:'rec2',fields:{Photos:[{...a,type:'image/svg+xml'}]}}],['Photos']);
  assert.equal(plan.rows.length,2);assert.equal(plan.rows[1].status,'rejected');
});
test('文件头不符或扫描后大小变化，不上传也不报成功',async()=>{
  const source=new DemoSource({count:2,edgeCases:false});source.files.set('attDemo00001',Buffer.from('not an image'));
  source.files.set('attDemo00002',Buffer.concat([fixturePNG(2),Buffer.from([0])]));
  const dst={mode:'test',put(){throw Error('should never upload');},verify(){throw Error('should never verify');}};
  const job=new TransferJob(buildPlan(source.records,['Photos','Details'],'Name'),source,dst);await job.run('all');assert.equal(job.summary().failed,2);
  assert.ok(job.rows.every(r=>!r.url));
});
test('下载响应未声明大小时仍执行流量上限并取消读取',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(64));},cancel(){cancelled=true;}});
  await assert.rejects(readLimited(new Response(stream),100),e=>e.code==='size');assert.equal(cancelled,true);
});
test('CSV防公式、引号和换行，JSON仍保留原始名字',()=>{
  const row={status:'failed',recordId:'rec1',label:' \t=HYPERLINK("x")',fieldId:'Photos',attachmentId:'att1',filename:'=danger,"a"\n.png',url:'https://should-not-appear',sha256:'',bytes:0,error:'missing'};
  const out=csv([row]);assert.ok(out.startsWith('\ufeff'));assert.ok(out.includes('"\'=danger,""a""\n.png"'));
  assert.ok(!out.includes('https://should-not-appear'));assert.equal(JSON.parse(JSON.stringify(row)).filename,row.filename);
});
test('R2只允许官方账号构造端点，拒绝本机/带凭证的图片地址',()=>{
  const config={accountId:'a'.repeat(32),bucket:'example-bucket',accessKeyId:'test',secretAccessKey:'test'};
  assert.throws(()=>validateR2({...config,accountId:'http://127.0.0.1'}));
  for(const publicBase of ['http://example.com','https://localhost','https://127.0.0.1','https://user:pass@example.com','https://example.com?q=x'])assert.throws(()=>validateR2({...config,publicBase}));
  assert.equal(validateR2({...config,publicBase:'https://images.example.com/'}).publicBase,'https://images.example.com');
});
