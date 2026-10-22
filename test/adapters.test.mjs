import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { AirtableSource, R2Destination, fixturePNG, readLimited } from '../lib/adapters.mjs';
import { TransferJob, buildPlan, digest } from '../lib/core.mjs';

test('Airtable真实适配器的分页、限速等待、刷新过期地址和只读请求',async()=>{
  const png=fixturePNG(1),calls=[],sleeps=[];let throttled=false,expired=false;
  const attachment=(id,url)=>({id,filename:'same.png',size:png.length,type:'image/png',url});
  const record1={id:'rec1',fields:{fldPhotos:[attachment('att1','https://v5.airtableusercontent.com/expired')],fldName:'First'}};
  const record2={id:'rec2',fields:{fldPhotos:[attachment('att2','https://v5.airtableusercontent.com/fresh')],fldName:'Second'}};
  const source=new AirtableSource('patFakeOnlyForTest','appTest',{sleep:async ms=>sleeps.push(ms),fetcher:async(raw,options)=>{
    const url=new URL(raw);calls.push({url,options});
    if(url.host==='api.airtable.com'){
      assert.equal(options.headers.Authorization,'Bearer patFakeOnlyForTest');assert.equal(options.method,undefined);
      if(url.pathname.endsWith('/rec1'))return Response.json({...record1,fields:{...record1.fields,fldPhotos:[attachment('att1','https://v5.airtableusercontent.com/refreshed')]}});
      if(!throttled){throttled=true;return new Response('',{status:429,headers:{'retry-after':'1'}});}
      if(url.searchParams.get('offset')==='page2')return Response.json({records:[record2]});
      assert.deepEqual(url.searchParams.getAll('fields[]'),['fldPhotos','fldName']);return Response.json({records:[record1],offset:'page2'});
    }
    assert.equal(options.headers,undefined,'不将Airtable授权转发给附件地址');
    if(url.pathname==='/expired'&&!expired){expired=true;return new Response('',{status:403});}
    return new Response(png);
  }});
  const records=await source.records('tblTest',['fldPhotos'],'fldName');assert.equal(records.length,2);assert.ok(sleeps.includes(30000));assert.ok(sleeps.includes(220));
  const stored=new Map(),destination={mode:'test',put:async(k,b)=>stored.set(k,b),verify:async(k,sha)=>({valid:digest(stored.get(k))===sha,method:'test'}),url:k=>'https://example.com/'+k};
  const job=new TransferJob(buildPlan(records,['fldPhotos'],'fldName'),source,destination);await job.run('all');
  assert.equal(job.summary().success,2);assert.ok(calls.some(x=>x.url.pathname.endsWith('/rec1')));source.close();assert.equal(source.token,'');
});
test('Airtable附件不能指向内网或非官方域名',async()=>{
  const source=new AirtableSource('fake','appTest');source.urls.set('rec/fld/att','http://127.0.0.1/private');
  await assert.rejects(source.read({identity:'rec/fld/att'},false),e=>e.code==='source_url');
});

test('大图读取短暂断线或超时可恢复；永久缺失不重试，连续网络错误有明确上限',async()=>{
  const png=fixturePNG(2),row={identity:'rec/fld/att'};let calls=0;
  const source=new AirtableSource('fake','appTest',{sleep:async()=>{},fetcher:async()=>{
    calls++;if(calls===1)throw new DOMException('test timeout','TimeoutError');
    if(calls===2)throw new TypeError('test disconnected');return new Response(png);
  }});source.urls.set(row.identity,'https://v5.airtableusercontent.com/test');
  assert.deepEqual(await source.read(row,false),png);assert.equal(calls,3);assert.equal(source.networkRetries,2);
  calls=0;source.fetcher=async()=>{calls++;return new Response('',{status:404});};
  await assert.rejects(source.read(row,false),e=>e.code==='missing');assert.equal(calls,1);
  calls=0;source.fetcher=async()=>{calls++;throw new TypeError('test disconnected');};
  await assert.rejects(source.read(row,false),e=>e.code==='source_network');assert.equal(calls,3);
});

test('响应已经开始但不再传数据时，读取会超时并取消，不会一直卡住',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled=true;}}));
  const start=performance.now();
  await assert.rejects(readLimited(response,100,{timeoutMs:50}),e=>e.code==='transfer_timeout');
  assert.ok(cancelled);assert.ok(performance.now()-start<1000);
});
test('R2真实SDK适配器通过本地S3协议服务器核对上传、签名、读取、冲突和公开校验',async t=>{
  const objects=new Map();let signed=0;const server=http.createServer(async(req,res)=>{
    assert.match(req.headers.authorization??'',/^AWS4-HMAC-SHA256 /);signed++;
    const url=new URL(req.url,'http://localhost'),key=decodeURIComponent(url.pathname);
    if(req.method==='GET'&&key.endsWith('/hanging.png')){res.writeHead(200,{'Content-Length':100});res.write(Buffer.from([1,2,3]));return;}
    if(req.method==='GET'&&url.searchParams.has('list-type')){res.setHeader('Content-Type','application/xml');res.end('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>test-bucket</Name><KeyCount>0</KeyCount></ListBucketResult>');return;}
    if(req.method==='PUT'){
      if(objects.has(key)&&req.headers['if-none-match']==='*'){res.writeHead(412,{'Content-Type':'application/xml'});res.end('<Error><Code>PreconditionFailed</Code></Error>');return;}
      const chunks=[];for await(const c of req)chunks.push(c);const data=Buffer.concat(chunks);objects.set(key,data);res.writeHead(200,{ETag:'"test"'});res.end();return;
    }
    const data=objects.get(key);if(!data){res.writeHead(404,{'Content-Type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code></Error>');return;}
    res.writeHead(200,{'Content-Type':'image/png','Content-Length':data.length});res.end(data);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const client=new S3Client({endpoint:`http://127.0.0.1:${server.address().port}`,region:'auto',forcePathStyle:true,
    credentials:{accessKeyId:'fake-access-id',secretAccessKey:'fake-secret-for-test'},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const png=fixturePNG(9),sha=digest(png);
  const destination=new R2Destination({accountId:'a'.repeat(32),bucket:'test-bucket',accessKeyId:'fake',secretAccessKey:'fake',publicBase:'https://images.example.com'},
    {client,publicReader:async url=>{assert.ok(url.endsWith('/sample.png'));return png;}});
  await destination.probe();await destination.put('sample.png',png,{type:'image/png',sha256:sha});
  const impatient=new R2Destination(destination.config,{client,requestTimeoutMs:100});
  const hangStart=performance.now();await assert.rejects(impatient.verify('hanging.png',sha),e=>e.code==='r2_read'&&e.message.includes('超时'));
  assert.ok(performance.now()-hangStart<1500);
  assert.equal((await destination.verify('sample.png',sha)).valid,true);
  await destination.put('sample.png',png,{type:'image/png',sha256:sha});assert.equal(objects.size,1);
  await assert.rejects(destination.put('sample.png',fixturePNG(10),{type:'image/png',sha256:digest(fixturePNG(10))}),e=>e.code==='collision');
  assert.ok(signed>=6);destination.close();assert.equal(destination.config.secretAccessKey,'');
});
