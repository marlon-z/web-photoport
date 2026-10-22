import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { AppError, LIMITS, digest, wait } from './core.mjs';
import { cellText } from './metadata.mjs';

const crcTable = Array.from({length:256},(_,i) => { let c=i; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; return c>>>0; });
function chunk(type,data) {
  const t=Buffer.from(type), out=Buffer.alloc(12+data.length); out.writeUInt32BE(data.length); t.copy(out,4); data.copy(out,8);
  let c=0xffffffff; for(const b of Buffer.concat([t,data])) c=crcTable[(c^b)&255]^(c>>>8);
  out.writeUInt32BE((c^0xffffffff)>>>0,8+data.length); return out;
}
export function fixturePNG(seed=1) {
  const w=120,h=90, raw=Buffer.alloc((w*3+1)*h), head=Buffer.alloc(13);
  head.writeUInt32BE(w); head.writeUInt32BE(h,4); head[8]=8; head[9]=2;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const o=y*(w*3+1)+1+x*3; const stripe=(x>24&&x<96&&y>18&&y<73)?45:0;
    raw[o]=(seed*47+stripe)%220+20; raw[o+1]=(seed*73+y+stripe)%220+20; raw[o+2]=(seed*31+x)%220+20;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export class DemoSource {
  mode='demo'; disabled=false; refreshes=0;
  constructor({count=30, edgeCases=true}={}) {
    this.files=new Map(); this.records=[];
    for(let i=0;i<count;i++) {
      const bytes=fixturePNG(i+1), id=`attDemo${String(i+1).padStart(5,'0')}`;
      this.files.set(id,bytes);
      const recordIndex=Math.floor(i/3); const recordId=`recDemo${String(recordIndex+1).padStart(5,'0')}`;
      let record=this.records.find(x=>x.id===recordId);
      if(!record) { record={id:recordId,fields:{Name:`示例商品 ${String(recordIndex+1).padStart(2,'0')}`,SKU:`A${String(Math.floor(recordIndex/2)+1).padStart(3,'0')}`,Customer:recordIndex%4<2?'张三':'李四',Owner:{id:recordIndex%2?'usrB':'usrA',name:recordIndex%2?'小王':'小李'},Price:99+recordIndex,Photos:[],Details:[]}}; this.records.push(record); }
      record.fields[i%3===2?'Details':'Photos'].push({id,filename:i===1?'=sample.png':i%4===0?'正面,样图.png':'photo.png',size:bytes.length,type:'image/png'});
    }
    if(edgeCases) {
      this.records.push({id:'recEmpty',fields:{Name:'没有照片的商品'}});
      this.records.push({id:'recUnsupported',fields:{Name:'不支持的文件',Photos:[{id:'attPdf',filename:'程序.exe',type:'application/x-msdownload',size:100}]}});
      this.records.push({id:'recTooLarge',fields:{Name:'超过大小限制',Photos:[{id:'attBig',filename:'big.png',type:'image/png',size:LIMITS.fileBytes+1}]}});
      this.files.delete('attDemo00007');
    }
  }
  async read(row,refresh) {
    await wait(35);
    if(this.disabled) throw new AppError('missing','示例原图已关闭。');
    if(row.attachmentId==='attDemo00004'&&!refresh) throw new AppError('source_expired','下载地址已过期。');
    if(refresh) this.refreshes++;
    const bytes=this.files.get(row.attachmentId);
    if(!bytes) throw new AppError('missing','来源找不到这张照片，请确认原图是否已删除。');
    return bytes;
  }
}
export class LocalDestination {
  mode='local';
  constructor(root,origin,{failOnce=false}={}) { this.root=root; this.origin=origin; this.failOnce=failOnce; this.failedOnce=false; this.writes=0; }
  async put(key,bytes) {
    if(this.failOnce&&!this.failedOnce) { this.failedOnce=true; throw new AppError('temporary','模拟一次上传中断，重试即可继续。'); }
    const path=join(this.root,...key.split('/')); await mkdir(join(path,'..'),{recursive:true});
    try { const old=await readFile(path); if(digest(old)!==digest(bytes)) throw new AppError('collision','目标已有不同内容，已阻止覆盖。'); return; }
    catch(e) { if(e.code!=='ENOENT') throw e; }
    // Never leave a partial file at its final key after a process is killed.
    // A hard link publishes the fully written file atomically without replacing
    // an existing key. Interrupted staging files remain outside the photo tree.
    const staging=join(this.root,'.staging');await mkdir(staging,{recursive:true});
    const temporary=join(staging,randomUUID());
    try{
      await writeFile(temporary,bytes,{flag:'wx'});
      try{await link(temporary,path);this.writes++;}
      catch(e){if(e.code!=='EEXIST')throw e;if(digest(await readFile(path))!==digest(bytes))throw new AppError('collision','目标已有不同内容，已阻止覆盖。');}
    }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async verify(key,sha) { return {valid:digest(await readFile(join(this.root,...key.split('/'))))===sha,method:'已核对本机副本内容'}; }
  async read(key) { return readFile(join(this.root,...key.split('/'))); }
  url(key) { return `${this.origin}/demo-files/${key}`; }
}
export function validateR2(input) {
  if(!/^[a-f0-9]{32}$/i.test(input.accountId??'')) throw new AppError('account','Cloudflare Account ID 应为32位编号。');
  if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket??'')) throw new AppError('bucket','仓库名应为3—63位小写字母、数字或短横线。');
  if(!input.accessKeyId||!input.secretAccessKey) throw new AppError('keys','请填写只用于测试仓库的访问密钥。');
  if(input.publicBase) {
    let u; try {u=new URL(input.publicBase);} catch {throw new AppError('public_url','图片公开地址格式不正确。');}
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||isIP(u.hostname)||u.hostname==='localhost'||u.hostname.endsWith('.local')) throw new AppError('public_url','图片地址应是没有密码或参数的公开 HTTPS 域名。');
  }
  return {...input,publicBase:(input.publicBase??'').replace(/\/+$/,'')};
}
function privateAddress(a) {
  if(a.includes(':')) return a==='::1'||a==='::'||a.startsWith('fc')||a.startsWith('fd')||a.startsWith('fe80:')||a.includes('::ffff:');
  const [x,y]=a.split('.').map(Number);
  return x===0||x===10||x===127||x===169&&y===254||x===172&&y>=16&&y<=31||x===192&&y===168||x>=224||x===100&&y>=64&&y<=127;
}
export async function readLimited(response, limit=LIMITS.fileBytes, {timeoutMs=120000}={}) {
  if(!response.ok) throw new AppError('download', '图片读取失败。');
  if(Number(response.headers.get('content-length'))>limit) {await response.body?.cancel();throw new AppError('size','实际文件超过允许大小。');}
  const reader=response.body.getReader(), chunks=[]; let size=0;
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new AppError('transfer_timeout','图片读取超时，可稍后重试。'));void reader.cancel().catch(()=>{});},timeoutMs);});
  const read=async()=>{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>limit)throw new AppError('size','实际文件超过允许大小。');chunks.push(Buffer.from(value));}return Buffer.concat(chunks,size);};
  try{return await Promise.race([read(),deadline]);}
  catch(e){void reader.cancel().catch(()=>{});throw e;}
  finally{clearTimeout(timer);}
}
export async function readPublic(url) {
  const u=new URL(url); if(u.protocol!=='https:')throw new AppError('public_url','公开图片必须使用HTTPS。');
  const addresses=await lookup(u.hostname,{all:true});
  if(!addresses.length||addresses.some(x=>privateAddress(x.address)))throw new AppError('public_url','公开图片地址不能指向本机或内网。');
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(120000)});
  return readLimited(r);
}
export class R2Destination {
  mode='r2';
  constructor(input,{client,publicReader=readPublic,requestTimeoutMs=120000}={}) {
    this.requestTimeoutMs=requestTimeoutMs;
    this.config=validateR2(input); this.bucket=this.config.bucket; this.publicReader=publicReader;
    this.client=client??new S3Client({region:'auto',endpoint:`https://${this.config.accountId}.r2.cloudflarestorage.com`,
      credentials:{accessKeyId:this.config.accessKeyId,secretAccessKey:this.config.secretAccessKey},maxAttempts:3,
      requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  }
  async probe() {
    try {await this.client.send(new ListObjectsV2Command({Bucket:this.bucket,Prefix:'photoport-tests/',MaxKeys:1}),{abortSignal:AbortSignal.timeout(Math.min(30000,this.requestTimeoutMs))});}
    catch {throw new AppError('r2_access','无法读取这个测试仓库。请检查仓库名和密钥权限。');}
  }
  async put(key,bytes,meta) {
    try {await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:bytes,ContentType:meta.type,
      Metadata:{sha256:meta.sha256},IfNoneMatch:'*'}),{abortSignal:AbortSignal.timeout(this.requestTimeoutMs)});}
    catch(e) {
      if(e.$metadata?.httpStatusCode===412) {
        const result=await this.verify(key,meta.sha256);if(result.valid)return;
        throw new AppError('collision','目标已有不同文件，已阻止覆盖。');
      }
      throw new AppError('r2_write','R2上传失败，请检查写入权限或网络后重试。');
    }
  }
  async read(key) {
    const object=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}),{abortSignal:AbortSignal.timeout(this.requestTimeoutMs)});
    return readLimited(new Response(object.Body.transformToWebStream(),{headers:{'content-length':String(object.ContentLength??0)}}),LIMITS.fileBytes,{timeoutMs:this.requestTimeoutMs});
  }
  async verify(key,sha) {
    const deadline=AbortSignal.timeout(this.requestTimeoutMs);
    try {
      const object=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}),{abortSignal:deadline});
      const bytes=await readLimited(new Response(object.Body.transformToWebStream(),{headers:{'content-length':String(object.ContentLength??0)}}),LIMITS.fileBytes,{timeoutMs:this.requestTimeoutMs});
      if(digest(bytes)!==sha) return {valid:false,method:'R2内容不一致'};
      if(this.config.publicBase) {
        const publiclyRead=await this.publicReader(this.url(key));
        return {valid:digest(publiclyRead)===sha,method:'已核对R2副本及公开图片地址'};
      }
      return {valid:true,method:'已核对R2副本；尚无公开地址'};
    } catch(e) {throw new AppError('r2_read',deadline.aborted||['AbortError','TimeoutError'].includes(e.name)||e.code==='transfer_timeout'?'R2副本或公开地址读取超时，未标记成功，可稍后重试。':'R2副本或公开地址无法读取，未标记成功。');}
  }
  url(key) {return this.config.publicBase?`${this.config.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`:'';}
  close() {this.client.destroy();this.config.accessKeyId='';this.config.secretAccessKey='';}
}
export class AirtableSource {
  mode='airtable';networkRetries=0;
  constructor(token,baseId,{fetcher=fetch,sleep=wait}={}) {
    if(!/^app[a-zA-Z0-9]+$/.test(baseId??''))throw new AppError('base','请填写以app开头的Airtable库编号。');
    if(!token||!['string','function'].includes(typeof token))throw new AppError('token','请填写这个测试库的只读授权。');
    this.token=token;this.baseId=baseId;this.fetcher=fetcher;this.sleep=sleep;this.urls=new Map();this.tableId=null;
  }
  async request(path,query={}) {
    const url=new URL(`https://api.airtable.com/v0/${path}`);
    for(const [k,v] of Object.entries(query))for(const part of Array.isArray(v)?v:[v])url.searchParams.append(k,String(part));
    for(let attempt=0;attempt<3;attempt++) {
      const access=typeof this.token==='function'?await this.token():this.token;
      let r=await this.fetcher(url,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(30000),redirect:'error'});
      if(r.status===401&&typeof this.token==='function')r=await this.fetcher(url,{headers:{Authorization:`Bearer ${await this.token(true,access)}`},signal:AbortSignal.timeout(30000),redirect:'error'});
      if(r.status===429&&attempt<2) {await this.sleep(Math.max(30,Number(r.headers.get('retry-after'))||30)*1000);continue;}
      if(!r.ok)throw new AppError('airtable_access','Airtable读取失败，请检查只读权限、库编号及每月调用额度。');
      return r.json();
    }
  }
  async tables() {const data=await this.request(`meta/bases/${this.baseId}/tables`);return data.tables.map(t=>({id:t.id,name:t.name,primaryFieldId:t.primaryFieldId,views:(t.views??[]).map(v=>({id:v.id,name:v.name,type:v.type})),fields:t.fields.map(f=>({id:f.id,name:f.name,type:f.type,...(f.options?{options:f.options}:{})}))}));}
  remember(record,fields) {for(const field of fields)for(const a of record.fields?.[field]??[])if(a?.id&&a?.url)this.urls.set(`${record.id}/${field}/${a.id}`,a.url);}
  async records(tableId,fields,labelField,viewId=null,{allFields=false}={}) {
    if(!/^tbl[a-zA-Z0-9]+$/.test(tableId??''))throw new AppError('table','请选择一张表。');
    this.tableId=tableId;this.fields=fields;const records=[];let offset;
    if(viewId&&!/^viw[a-zA-Z0-9]+$/.test(viewId))throw new AppError('view','视图编号不正确。');
    do { const data=await this.request(`${this.baseId}/${tableId}`,{pageSize:100,returnFieldsByFieldId:true,...(allFields?{}:{'fields[]':[...fields,...(labelField?[labelField]:[])]}),...(viewId?{view:viewId}:{}),...(offset?{offset}:{})});
      for(const r of data.records){this.remember(r,fields);records.push(r);}
      if(records.length>50000)throw new AppError('records_limit','测试版最多扫描50000条记录，请缩小表格。');
      offset=data.offset;if(offset)await this.sleep(220);
    }while(offset);
    return records;
  }
  async resolveNames(records,table,tables) {
    const warnings=[];
    for(const record of records)record.display=Object.fromEntries(table.fields.map(f=>[f.id,cellText(record.fields?.[f.id])]));
    const related=new Map();
    for(const field of table.fields.filter(f=>f.type==='multipleRecordLinks')){
      const target=tables.find(t=>t.id===field.options?.linkedTableId);
      if(!target){warnings.push(`${field.name}：关联表不可读，保留原记录编号。`);continue;}
      const ids=[...new Set(records.flatMap(r=>r.fields?.[field.id]??[]))];
      const names=related.get(target.id)??new Map();related.set(target.id,names);
      try{
        const missing=ids.filter(id=>!names.has(id));
        for(let i=0;i<missing.length;i+=50){
          const batch=missing.slice(i,i+50).filter(id=>/^rec[a-zA-Z0-9]+$/.test(id));if(!batch.length)continue;
          await this.sleep(220);
          const filterByFormula=`OR(${batch.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
          const data=await this.request(`${this.baseId}/${target.id}`,{returnFieldsByFieldId:true,'fields[]':[target.primaryFieldId],filterByFormula,pageSize:100});
          for(const r of data.records)names.set(r.id,cellText(r.fields?.[target.primaryFieldId])||r.id);
        }
      }catch{warnings.push(`${field.name}：部分关联名称读取失败，保留原记录编号。`);}
      for(const r of records)r.display[field.id]=(r.fields?.[field.id]??[]).map(id=>names.get(id)||id).join('、');
    }
    return warnings;
  }
  async read(row,refresh) {
    if(refresh) {const record=await this.request(`${this.baseId}/${this.tableId}/${row.recordId}`,{returnFieldsByFieldId:true});this.remember(record,this.fields);
      const current=record.fields?.[row.fieldId]?.find(a=>a.id===row.attachmentId);
      if(!current)throw new AppError('missing','这张原图已被删除或替换，请重新扫描。');
      if(current.size!==row.declaredBytes||current.type!==row.type)throw new AppError('source_changed','原图已变化，请重新扫描。');}
    const url=this.urls.get(row.identity), u=new URL(url);
    if(u.protocol!=='https:'||!(u.hostname==='airtableusercontent.com'||u.hostname.endsWith('.airtableusercontent.com'))||u.username||u.password)
      throw new AppError('source_url','下载地址不是Airtable官方附件域名，已拒绝读取。');
    for(let attempt=0;attempt<3;attempt++){
      try{
        const r=await this.fetcher(u,{signal:AbortSignal.timeout(120000),redirect:'error'});
        if([401,403].includes(r.status))throw new AppError('source_expired','照片地址已过期，正在重新获取。');
        if(r.status===404)throw new AppError('missing','Airtable找不到这张照片。');
        if(r.status===429||r.status>=500){await r.body?.cancel();throw new AppError('source_temporary','原图服务暂时繁忙。');}
        return await readLimited(r);
      }catch(e){
        const temporary=e instanceof TypeError||['AbortError','TimeoutError'].includes(e.name)||['source_temporary','transfer_timeout'].includes(e.code);
        if(!temporary)throw e;
        if(attempt===2)throw new AppError('source_network','原图下载连续三次遇到网络中断、超时或服务繁忙，可稍后单独重试。');
        this.networkRetries++;await this.sleep(1000*(attempt+1));
      }
    }
  }
  close() {this.token='';this.urls.clear();}
}
