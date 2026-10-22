import http from 'node:http';
import { readFile, mkdir,stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,randomUUID } from 'node:crypto';
import { AppError, TransferJob, buildPlan, csv, LIMITS,objectKey } from './lib/core.mjs';
import { DemoSource, LocalDestination, R2Destination, AirtableSource,readPublic } from './lib/adapters.mjs';
import { Checkpoints, recoverRows, snapshotPlan } from './lib/checkpoints.mjs';
import { buildArchive,validateExport,archiveStream } from './lib/archive.mjs';
import { archiveRows,normalizeOrganization,layoutOverview } from './lib/names.mjs';
import { snapshotRecords,recordsCSV } from './lib/metadata.mjs';
import { CSVSource } from './lib/csv-source.mjs';
import { FILE_TYPES } from './lib/file-types.mjs';
import { createPreviews } from './lib/previews.mjs';
import { demoSource } from './lib/demo.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
// The same UI can still run in the original localhost-only edition.
const staticFiles={'/':['index.html','text/html; charset=utf-8'],'/app':['app.html','text/html; charset=utf-8'],'/app/':['app.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/gallery.js':['gallery.js','text/javascript; charset=utf-8'],'/filters.js':['filters.js','text/javascript; charset=utf-8'],'/workflow.js':['workflow.js','text/javascript; charset=utf-8'],'/blue.css':['blue.css','text/css; charset=utf-8'],'/live.css':['live.css','text/css; charset=utf-8'],'/assets/products.png':['assets/products.png','image/png'],'/favicon.svg':['favicon.svg','image/svg+xml']};
export async function createServer({runtime=join(ROOT,'.runtime'),port=4180,concurrency=2,sourceFactory=(token,baseId)=>new AirtableSource(token,baseId),csvSourceFactory=text=>new CSVSource(text),publicOrigin=null,internalSecret=null,listAllSaved=false,checkpointStore=null,durable=false,destinationFactory=(root,origin,options)=>new LocalDestination(root,origin,options)}={}) {
  if(durable||publicOrigin||internalSecret||checkpointStore)throw new Error('This release supports localhost-only operation.');
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('PHOTOPORT_CONCURRENCY must be an integer from 1 to 8.');
  await mkdir(runtime,{recursive:true});
  const checkpoints=checkpointStore??new Checkpoints(join(runtime,'jobs'));
  const sessions=new Map(),archives=new Map(); let origin='';
  const preview=createPreviews();
  const describe=job=>{
    const summary=job.summary(),layout=layoutOverview(summary.rows,summary.organization,summary.recordData);
    return {...summary,imported:!!job.imported,folderPreview:layout.paths,layoutOverview:layout,warnings:job.warnings??[],archive:archives.get(job.id)?.info??null};
  };
  const visible=(saved,session)=>(saved.refs.source.mode==='demo'||saved.refs.source.mode==='csv'&&session.csvSource?.fingerprint===saved.refs.source.fingerprint||saved.refs.source.mode==='airtable'&&session.sourceAuth?.baseId===saved.refs.source.baseId)&&
    (saved.refs.destination.mode==='local'||session.r2?.accountId===saved.refs.destination.accountId&&session.r2?.bucket===saved.refs.destination.bucket);
  function track(job){
    let savedAt=0;
    job.onState=async()=>{
      // Large batches coalesce progress snapshots. The deterministic object key
      // prevents an already-written file being overwritten after a crash.
      if(job.busy&&job.rows.length>1000&&Date.now()-savedAt<750)return;
      savedAt=Date.now();
      try{await checkpoints.save(job);if(!job.cancelled)job.saveError='';}catch{job.saveError='任务进度保存失败，已暂停。请检查数据库或磁盘后重试。';job.pause();}
    };
  }
  async function hydrate(id,session) {
    if(session.jobs.has(id))return session.jobs.get(id);
    const saved=await checkpoints.read(id),refs=saved.refs;
    await checkpoints.claim?.(id);
    let source;
    if(refs.source.mode==='demo')source=await demoSource(refs.source);
    else if(refs.source.mode==='csv'){
      if(refs.source.csvText)source=csvSourceFactory(refs.source.csvText);
      else if(session.csvSource?.fingerprint===refs.source.fingerprint)source=session.csvSource;
      else throw new AppError('csv_expired','请重新导入原来的CSV，已保存的结果会继续保留。',409);
    } else {source=sourceFactory('managed-oauth',refs.source.baseId);source.tableId=refs.source.tableId;}
    const rows=saved.job.rows.map(r=>({...r,identity:`${r.recordId}/${r.fieldId}/${r.attachmentId}`,status:r.status==='copying'?'pending':r.status}));
    const destination=destinationFactory(join(runtime,'files'),origin);
    const job=new TransferJob({rows,records:saved.job.records,plannedBytes:saved.job.plannedBytes},source,destination,{concurrency});
    Object.assign(job,{id,refs,createdAt:saved.job.createdAt,startedAt:saved.job.startedAt,finishedAt:saved.job.finishedAt,recordData:saved.job.recordData,organization:saved.job.organization,layoutVersion:saved.job.layoutVersion,state:rows.some(r=>r.status==='pending')?'paused':saved.job.state,metrics:saved.job.metrics,cloudArchive:saved.archive??null});
    track(job);session.jobs.set(id,job);
    if(saved.archive)archives.set(id,{result:saved.archive,info:saved.archive.info});
    return job;
  }
  function cleanup(session) {
    for(const job of session.jobs.values()){job.source.close?.();job.destination.close?.();}
    session.csvSource?.close();session.csvSource=null;session.sourceAuth=null;session.r2=null;session.jobs.clear();
  }
  const timer=setInterval(()=>{for(const [id,s] of sessions)if(Date.now()-s.lastSeen>60*60*1000&&!Array.from(s.jobs.values()).some(j=>j.busy||j.archiving)){cleanup(s);sessions.delete(id);}},60000).unref();
  const heartbeat=durable?setInterval(()=>{for(const s of sessions.values())for(const j of s.jobs.values())if(j.busy||j.archiving)void j.onState();},20000).unref():null;
  const server=http.createServer(async(req,res)=>{
    const baseHeaders={ 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'" };
    for(const [key,value] of Object.entries(baseHeaders))res.setHeader(key,value);
    const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
    try {
      if(internalSecret&&req.headers['x-photoport-internal']!==internalSecret)throw new AppError('internal','页面不存在。',404);
      const allowedHosts=new Set([new URL(origin).host,`localhost:${server.address().port}`,`127.0.0.1:${server.address().port}`]);
      if(!allowedHosts.has(req.headers.host))throw new AppError('host','本机版只接受本机访问。',403);
      const url=new URL(req.url,origin), path=url.pathname;
      const cookieName=`photoport_${server.address().port}`,cookiePrefix=cookieName+'=';
      const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookiePrefix))?.slice(cookiePrefix.length);
      let session=sessions.get(cookie);
      if(!session){const id=randomBytes(24).toString('hex');session={id,lastSeen:Date.now(),jobs:new Map(),r2:null,sourceAuth:null};sessions.set(id,session);}
      // Sliding expiry: an actively viewed long job must not lose its session at 1h.
      res.setHeader('Set-Cookie',`${cookieName}=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
      session.lastSeen=Date.now();
      if(req.method==='GET'&&staticFiles[path]){const [file,type]=staticFiles[path];return send(200,await readFile(join(ROOT,'public',file)),type);}
      if(req.method==='GET'&&/^\/demo-files\/photoport-tests\/[a-f0-9-]{36}\/[a-f0-9]{32}\.[a-z0-9]{1,12}$/.test(path)){
        if(durable){const key=path.slice('/demo-files/'.length),job=await hydrate(key.split('/')[1],session);await checkpoints.read(job.id);const stream=await job.destination.stream(key);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment');stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);}
        const file=await readFile(join(runtime,'files',...path.slice('/demo-files/'.length).split('/')));
        const extension=path.split('.').pop(),type=Object.entries(FILE_TYPES).find(([,e])=>e===extension)?.[0]||'application/octet-stream';
        if(!type.startsWith('image/'))res.setHeader('Content-Disposition','attachment');
        return send(200,file,type);
      }
      if(req.method==='GET'&&path==='/api/status')return send(200,{name:'PhotoPort',localOnly:true,paymentsEnabled:false,
        sourceConnected:!!session.sourceAuth,csvConnected:!!session.csvSource,tables:session.csvSource?[session.csvSource.table]:session.sourceAuth?.tables??[],r2:session.r2?{bucket:session.r2.bucket,publicBase:session.r2.publicBase}:null,limits:LIMITS});
      if(req.method==='GET'&&path==='/api/saved-jobs'){
        const saved=(await checkpoints.list()).filter(s=>listAllSaved||visible(s,session));
        return send(200,{jobs:saved.map(s=>({id:s.job.id,createdAt:s.job.createdAt,total:s.job.total,success:s.job.success,state:s.job.state,tableName:s.job.recordData?.table?.name||'',sourceMode:s.refs.source.mode,groups:(s.job.organization?.groupBy??[]).map(id=>s.job.recordData?.fields.find(f=>f.id===id)?.name||id)}))});
      }
      let body={};
      if(req.method==='POST'){
        if(req.headers['x-photoport']!=='1'||!['application/json','application/json; charset=utf-8'].includes(req.headers['content-type']))throw new AppError('csrf','请求来源不正确，请刷新本机页面。',403);
        if(req.headers.origin&&!allowedHosts.has(new URL(req.headers.origin).host))throw new AppError('csrf','不接受其他网站发起的请求。',403);
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw new AppError('body','请求超过64MB，请缩小导出范围。',413);chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('json','输入格式不正确。');}
      }
      if(req.method==='POST'&&path==='/api/connect-airtable'){
        let baseId=body.baseId,tableId=null,viewId=null;
        if(body.sourceUrl){
          let u;try{u=new URL(body.sourceUrl);}catch{throw new AppError('source','请粘贴浏览器里Airtable表格的完整地址。');}
          if(u.protocol!=='https:'||!['airtable.com','www.airtable.com'].includes(u.hostname))throw new AppError('source','请粘贴airtable.com下的表格地址。');
          const pieces=u.pathname.split('/');baseId=pieces.find(p=>/^app[a-zA-Z0-9]+$/.test(p));tableId=pieces.find(p=>/^tbl[a-zA-Z0-9]+$/.test(p));viewId=pieces.find(p=>/^viw[a-zA-Z0-9]+$/.test(p));
          if(!baseId)throw new AppError('source','请复制打开表格时浏览器里的完整地址；分享页面地址暂不支持。');
        }
        const source=sourceFactory(body.token,baseId);const tables=await source.tables();source.close();
        session.csvSource=null;session.sourceAuth={token:body.token,baseId,tables};return send(200,{tables,baseId,tableId,viewId});
      }
      if(req.method==='POST'&&path==='/api/connect-csv'){
        if(typeof body.text!=='string'||Buffer.byteLength(body.text)>32*1024*1024)throw new AppError('csv','CSV最大32MB。');
        const source=csvSourceFactory(body.text);session.csvSource=source;session.csvText=durable?body.text:undefined;
        const refreshedJobs=[];
        for(const job of session.jobs.values())if(job.refs?.source.mode==='csv'&&job.refs.source.fingerprint===source.fingerprint&&!job.busy&&!job.archiving){job.source=source;job.previews?.clear();refreshedJobs.push(job.id);}
        return send(200,{tables:[source.table],tableId:source.table.id,refreshedJobs});
      }
      if(req.method==='POST'&&path==='/api/connect-r2'){
        throw new AppError('local_only','开源本机版只保存到本机，不连接云存储。',400);
        const destination=new R2Destination(body);try{await destination.probe();session.r2={...body,publicBase:destination.config.publicBase};}
        finally{destination.close();}
        return send(200,{connected:true,bucket:body.bucket,publicBase:session.r2.publicBase});
      }
      if(req.method==='POST'&&path==='/api/restore'){
        if(durable){const job=await hydrate(body.id,session);return send(202,describe(job));}
        if(Array.from(session.jobs.values()).some(j=>j.busy))throw new AppError('busy','请先等待当前任务完成。',409);
        const saved=await checkpoints.read(body.id);
        if(!visible(saved,session))throw new AppError('restore_access','请重新连接原来的Airtable库与R2仓库。',403);
        if(saved.refs.destination.mode!=='local')throw new AppError('local_only','请使用本机导出任务。',400);
        if(saved.refs.source.mode==='airtable'&&saved.refs.destination.mode==='r2'&&body.confirmPublic!==true)throw new AppError('public_confirm','请确认这批图片允许按所填的公开地址展示。');
        if(session.jobs.has(body.id))return send(200,describe(session.jobs.get(body.id)));
        if(session.jobs.size>=5)throw new AppError('jobs_limit','请先清除连接后再恢复任务。');
        const refs=saved.refs;let source,records,fields,labelField,destination;
        if(refs.source.mode==='demo'){
          source=await demoSource(refs.source);records=source.records;fields=['Photos','Details'];labelField='Name';
          destination=refs.destination.mode==='r2'?new R2Destination(session.r2):destinationFactory(join(runtime,'files'),origin);
        }else if(refs.source.mode==='csv'){
          source=session.csvSource;records=source.records;fields=refs.source.fields;labelField=refs.source.labelField;
          destination=destinationFactory(join(runtime,'files'),origin);
        }else{
          source=sourceFactory(session.sourceAuth.token,session.sourceAuth.baseId);
          fields=refs.source.fields;labelField=refs.source.labelField;
          records=await source.records(refs.source.tableId,fields,labelField,refs.source.viewId);destination=refs.destination.mode==='r2'?new R2Destination(session.r2):destinationFactory(join(runtime,'files'),origin);
        }
        const job=new TransferJob(snapshotPlan(records,fields,labelField,saved.job.rows),source,destination,{concurrency});job.refs=refs;
        job.recordData=saved.job.recordData??null;job.organization=saved.job.organization??{};job.layoutVersion=saved.job.layoutVersion??0;
        track(job);job.id=saved.job.id;session.jobs.set(job.id,job);
        recoverRows(job,saved.job).then(()=>job.onState()).catch(()=>{job.busy=false;job.state='error';job.saveError='恢复时读取失败，请检查连接后重新恢复。';});
        return send(202,job.summary());
      }
      if(req.method==='POST'&&(path==='/api/demo'||path==='/api/scan')){
        if(Array.from(session.jobs.values()).some(j=>j.busy||j.archiving))throw new AppError('busy','请先等待当前任务完成或暂停。',409);
        if(session.jobs.size>=5)throw new AppError('jobs_limit','每个会话保留最多5个任务，先清除连接后再开始。');
        let source,records,fields,labelField,table,warnings=[];
        if(path==='/api/demo'){
          const count=Number(body.count??30);if(!Number.isInteger(count)||count<1||count>LIMITS.files)throw new AppError('count','示例照片数量应为1—5000。');
          source=await demoSource({count,edgeCases:body.edgeCases!==false,visual:body.visual===true});records=source.records;fields=['Photos','Details'];labelField='Name';
          table={id:'tblDemo',name:'商品整理示例',primaryFieldId:'Name',fields:[{id:'Name',name:'商品名称',type:'singleLineText'},{id:'SKU',name:'商品货号',type:'singleLineText'},{id:'Customer',name:'客户',type:'singleLineText'},{id:'Owner',name:'负责人',type:'singleCollaborator'},{id:'Price',name:'价格',type:'number'},{id:'Photos',name:'商品照片',type:'multipleAttachments'},{id:'Details',name:'细节照片',type:'multipleAttachments'}]};
        }else{
          if(!session.sourceAuth&&!session.csvSource)throw new AppError('source','请先连接Airtable表格或导入CSV。');
          table=(session.csvSource?[session.csvSource.table]:session.sourceAuth.tables).find(t=>t.id===body.tableId);
          if(!table)throw new AppError('table','表格不在当前授权范围内。');
          fields=body.fields;
          if(!Array.isArray(fields)||!fields.length||fields.some(id=>!table.fields.some(f=>f.id===id&&f.type==='multipleAttachments')))throw new AppError('fields','请选择有效的照片附件列。');
          labelField=body.labelField||null;if(labelField&&!table.fields.some(f=>f.id===labelField))throw new AppError('label','商品名称列无效。');
          if(session.csvSource){source=session.csvSource;records=source.records;warnings.push('CSV行号作为记录编号；原表记录编号只有在CSV本来包含该列时才能保留。临时链接过期后需重新导出CSV。文件大小在下载时核对。');}
          else{source=sourceFactory(session.sourceAuth.token,session.sourceAuth.baseId);records=await source.records(body.tableId,fields,labelField,body.viewId,{allFields:true});if(source.resolveNames)warnings=await source.resolveNames(records,table,session.sourceAuth.tables);}
        }
        const plan=buildPlan(records,fields,labelField,{previewOnly:true});
        if(plan.plannedBytes>LIMITS.totalBytes)warnings.push('整张表超过单批10 GiB上限。可以先预览，再选择部分记录下载。');
        for(const row of plan.rows)row.fieldName=table?.fields.find(f=>f.id===row.fieldId)?.name??row.fieldId;
        let destination;
        if(body.destination==='r2'){
          throw new AppError('local_only','开源本机版只保存到本机。',400);
          if(source.mode==='csv'||plan.rows.some(r=>r.status!=='rejected'&&!['image/png','image/jpeg','image/webp'].includes(r.type)))throw new AppError('destination','本轮云端测试权限仅覆盖JPG、PNG、WebP；其他附件请选择下载到本机。');
          if(!session.r2)throw new AppError('destination','请先连接R2测试仓库。');
          if(path==='/api/scan'&&body.confirmPublic!==true)throw new AppError('public_confirm','请确认这批图片允许按所填的公开地址展示。');
          destination=new R2Destination(session.r2);
        }else{
          destination=destinationFactory(join(runtime,'files'),origin,{failOnce:!!body.failOnce});
        }
        const job=new TransferJob(plan,source,destination,{concurrency});
        job.recordData=snapshotRecords(records,table);job.warnings=warnings;job.organization={};
        job.refs={source:path==='/api/demo'?{mode:'demo',count:Number(body.count??30),edgeCases:body.edgeCases!==false,visual:body.visual===true}:source.mode==='csv'?{mode:'csv',fingerprint:source.fingerprint,fields,labelField}:{mode:'airtable',baseId:session.sourceAuth.baseId,tableId:body.tableId,viewId:body.viewId||null,fields,labelField},
          destination:body.destination==='r2'?{mode:'r2',accountId:session.r2.accountId,bucket:session.r2.bucket}:{mode:'local'}};
        if(durable&&source.mode==='csv')job.refs.source.csvText=session.csvText;
        track(job);await checkpoints.save(job);session.jobs.set(job.id,job);return send(201,describe(job));
      }
      if(req.method==='POST'&&path==='/api/import-result'){
        if(session.jobs.size>=5)throw new AppError('jobs_limit','请先清除连接再打开其他结果。');
        const rows=validateExport(body.result),id=randomUUID();
        const count=s=>rows.filter(r=>r.status===s).length;
        let recordData=null;
        if(body.result.recordData){
          const d=body.result.recordData;
          if(!Array.isArray(d.fields)||!Array.isArray(d.records)||d.records.length>50000||d.fields.some(f=>typeof f.id!=='string'||typeof f.name!=='string')||new Set(d.fields.map(f=>f.id)).size!==d.fields.length||new Set(d.records.map(r=>r.id)).size!==d.records.length)throw new AppError('manifest','原表信息不完整。');
          recordData=snapshotRecords(d.records.map(r=>({id:r.id,fields:r.values,display:r.display})),{...d.table,fields:d.fields});
          if(rows.some(r=>!recordData.records.some(x=>x.id===r.recordId)))throw new AppError('manifest','附件找不到所属的原表记录。');
        }
        const job={id,rows,busy:false,imported:true,recordData,organization:body.result.organization??{},layoutVersion:0,source:{mode:'saved'},destination:{mode:'public'},createdAt:new Date().toISOString(),summary(){
          const count=s=>this.rows.filter(r=>r.status===s).length;
          return {id:this.id,rows:this.rows,recordData:this.recordData,organization:this.organization,layoutVersion:this.layoutVersion,busy:false,imported:true,sourceMode:'saved',destinationMode:'public',state:count('failed')||count('rejected')?'completed_with_errors':'completed',createdAt:this.createdAt,total:this.rows.length,records:this.recordData?.records.length??new Set(this.rows.map(r=>r.recordId)).size,success:count('success'),failed:count('failed'),pending:count('pending'),rejected:count('rejected'),copying:0,copiedBytes:this.rows.reduce((n,r)=>n+(r.status==='success'?r.bytes:0),0),attempts:0};
        }};
        try{job.organization=normalizeOrganization(job.organization,recordData?.fields??[]);}catch(e){throw new AppError('organization',e.message);}
        session.jobs.set(id,job);return send(201,describe(job));
      }
      const match=path.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(sample|all|retry|pause|verify|source-off|export|archive|catalog|organize|preview))?$/);
      if(match){
        const job=session.jobs.get(match[1])??(durable?await hydrate(match[1],session):null);if(!job)throw new AppError('job','任务不存在或本机会话已结束，请重新扫描。',404);
        if(durable&&Date.parse(job.createdAt)+7*86400000<=Date.now())throw new AppError('expired','这份临时结果已过期，请重新导出。',410);
        const action=match[2];
        if(req.method==='GET'&&action==='preview')return send(200,await preview(job,url.searchParams.get('file')),'image/webp');
        if(req.method==='GET'&&!action)return send(200,describe(job));
        if(req.method==='POST'&&action==='organize'){
          if(job.busy||job.archiving)throw new AppError('busy','请先暂停处理或等待打包完成，再调整整理方式。',409);
          let normalized;try{normalized=normalizeOrganization(body.organization,job.recordData?.fields??[]);}catch(e){throw new AppError('organization',e.message);}
          if(body.recordIds!==undefined){
            job.allRows??=job.rows;job.allRecordData??=job.recordData;
            const available=new Set(job.allRecordData?.records.map(r=>r.id)??job.allRows.map(r=>r.recordId));
            if(!Array.isArray(body.recordIds)||!body.recordIds.length||body.recordIds.some(id=>!available.has(id)))throw new AppError('selection','请至少选择一条有效记录。');
            const selected=new Set(body.recordIds);job.rows=job.allRows.filter(r=>selected.has(r.recordId));
            if(job.allRecordData)job.recordData={...job.allRecordData,records:job.allRecordData.records.filter(r=>selected.has(r.id))};
            job.records=selected.size;job.plannedBytes=job.rows.filter(r=>r.status!=='rejected').reduce((n,r)=>n+r.declaredBytes,0);
          }
          job.organization=normalized;
          if(!job.imported)job.state=job.rows.some(r=>r.status==='pending')?'ready':job.rows.some(r=>['failed','rejected'].includes(r.status))?'completed_with_errors':'completed';
          job.layoutVersion=(job.layoutVersion??0)+1;archives.delete(job.id);job.cloudArchive=null;if(!job.imported)await checkpoints.save(job);
          return send(200,describe(job));
        }
        if(req.method==='GET'&&action==='catalog'){
          const archive=archives.get(job.id);
          if(archive?.info.state!=='ready')throw new AppError('archive_pending','请先准备照片包，Excel目录会一并生成。',409);
          res.setHeader('Content-Disposition',`attachment; filename="photoport-catalog-${job.id}.xlsx"`);
          if(archive.result.remote){res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');const stream=await job.destination.stream(archive.result.catalogKey);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);}
          return send(200,await readFile(archive.result.catalogPath),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        }
        if(action==='archive'){
          const prior=archives.get(job.id);
          if(req.method==='POST'){
            if(prior&&['preparing','packing','ready'].includes(prior.info.state))return send(202,describe(job));
            if(job.busy||job.rows.some(r=>r.status==='copying')||(!body.allowPartial&&job.rows.some(r=>['pending','failed'].includes(r.status))))throw new AppError('archive_unfinished','请先完成处理，或暂停后选择只下载已成功的文件。',409);
            const task={info:{state:'preparing',prepared:0,total:job.rows.filter(r=>r.status==='success').length}};archives.set(job.id,task);job.archiving=true;
            buildArchive(job.summary(),{root:join(runtime,'archives'),destination:job.destination,allowPartial:body.allowPartial===true,read:row=>job.imported?readPublic(row.url):job.destination.read(objectKey(job.id,row)),onProgress:info=>{task.info=info;}})
              .then(async result=>{if(result.remote){job.cloudArchive=result;await checkpoints.save(job);}task.result=result;task.info=result.info;}).catch(()=>{task.info={...task.info,state:'failed',error:'照片包准备失败，没有提供不完整下载。可重试；已核对的文件保留。'};}).finally(()=>{job.archiving=false;});
            return send(202,describe(job));
          }
          if(['GET','HEAD'].includes(req.method)){
            if(prior?.info.state!=='ready'||!prior.result)throw new AppError('archive_pending','照片包还没准备好，请稍候。',409);
            const path=prior.result.path,total=prior.result.remote?prior.result.info.zipBytes:(await stat(path)).size;let start=0,end=total-1;
            if(req.headers.range){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!range)throw new AppError('range','下载范围不正确。',416);start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end||start>=total)throw new AppError('range','下载范围超出文件。',416);}
            res.writeHead(req.headers.range?206:200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="photoport-${job.id}.zip"`,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(req.headers.range?{'Content-Range':`bytes ${start}-${end}/${total}`}:{})});
            if(req.method==='HEAD')return res.end();
            const stream=prior.result.remote?await job.destination.stream(prior.result.key,{start,end}):archiveStream(path,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
          }
        }
        if(req.method==='GET'&&action==='export'){
          const data=job.summary();res.setHeader('Content-Disposition',`attachment; filename="photoport-${job.id}.${url.searchParams.get('format')==='json'?'json':'csv'}"`);
          if(url.searchParams.get('format')==='records')return send(200,recordsCSV(job.recordData,archiveRows(job.rows,job.organization,job.recordData)),'text/csv; charset=utf-8');
          data.rows=archiveRows(data.rows,job.organization,job.recordData);
          if(url.searchParams.get('format')==='json')return send(200,data);
          return send(200,csv(job.rows,job.organization,job.recordData),'text/csv; charset=utf-8');
        }
        if(job.imported&&req.method==='POST')throw new AppError('saved_result','已完成结果可重新打包；若要重新复制，请连接原表。');
        if(req.method==='POST'&&['sample','all','retry'].includes(action)){
          if(job.plannedBytes>LIMITS.totalBytes)throw new AppError('total_limit','这批附件超过单批上限，请先在预览中选择部分记录。');
          if(job.busy||job.archiving)throw new AppError('busy','任务还在处理或打包，请稍候。',409);
          if(action!=='retry'&&!job.rows.some(r=>r.status==='pending'))throw new AppError('nothing','没有待处理的照片。');
          if(action==='retry'&&!job.rows.some(r=>r.status==='failed'))throw new AppError('nothing','没有需要重试的照片。');
          job.layoutVersion=(job.layoutVersion??0)+1;archives.delete(job.id);job.cloudArchive=null;
          job.run(action).catch(()=>{job.busy=false;job.state='error';});return send(202,job.summary());
        }
        if(req.method==='POST'&&action==='pause'){job.pause();await checkpoints.save(job);return send(200,job.summary());}
        if(req.method==='POST'&&action==='verify'){
          if(job.busy||job.archiving)throw new AppError('busy','请等待处理或打包完成再核对。',409);
          job.layoutVersion=(job.layoutVersion??0)+1;archives.delete(job.id);job.cloudArchive=null;
          return send(200,await job.verifyAll());
        }
        if(req.method==='POST'&&action==='source-off'&&job.source.mode==='demo'){job.source.disabled=true;return send(200,{disabled:true});}
      }
      if(req.method==='POST'&&path==='/api/clear'){
        if(Array.from(session.jobs.values()).some(j=>j.busy||j.archiving))throw new AppError('busy','请先等待照片复制或打包完成，再清除连接。',409);
        cleanup(session);return send(200,{cleared:true});
      }
      throw new AppError('route','页面或操作不存在。',404);
    }catch(e){
      if(res.headersSent){res.end();return;}
      // Do not log request bodies, tokens, signed source URLs or provider error payloads.
      send(e instanceof AppError?e.status:e.code==='ENOENT'?404:500,{error:e instanceof AppError?e.message:e.code==='ENOENT'?'图片不存在。':'操作失败，请检查网络与输入后重试。',code:e instanceof AppError?e.code:'internal'});
    }
  });
  server.on('close',()=>{clearInterval(timer);clearInterval(heartbeat);for(const s of sessions.values())cleanup(s);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=publicOrigin??`http://127.0.0.1:${server.address().port}`;
  return {server,origin,runtime,activity:()=>[...sessions.values()].flatMap(s=>[...s.jobs.values()]).filter(j=>j.busy||j.archiving).length,close:async()=>{for(const s of sessions.values())for(const j of s.jobs.values())j.pause();while([...sessions.values()].some(s=>[...s.jobs.values()].some(j=>j.busy||j.archiving)))await new Promise(r=>setTimeout(r,50));await checkpoints.flush();await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});await checkpoints.close?.();}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const app=await createServer({port:Number(process.env.PORT??4180),concurrency:Number(process.env.PHOTOPORT_CONCURRENCY??2)});
  console.log(`PhotoPort Local: ${app.origin}`);
  console.log('Open-source local edition. Open the URL above in your browser.');
  console.log('Files stay in .runtime on this computer. No hosted account or payment required.');
  process.on('SIGINT',async()=>{await app.close();process.exit(0);});
  process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
}
