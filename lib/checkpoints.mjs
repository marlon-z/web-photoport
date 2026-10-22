import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, LIMITS, objectKey, buildPlan } from './core.mjs';

const validId = id => /^[a-f0-9-]{36}$/.test(id ?? '');
export function snapshotPlan(records,fields,labelField,savedRows){
  const identities=new Set(savedRows.map(r=>`${r.recordId}/${r.fieldId}/${r.attachmentId}`));
  const recordIds=new Set(savedRows.map(r=>r.recordId));
  const selected=records.filter(r=>recordIds.has(r.id)).map(r=>({id:r.id,fields:{...r.fields,
    ...Object.fromEntries(fields.map(field=>[field,(r.fields?.[field]??[]).filter(a=>identities.has(`${r.id}/${field}/${a.id}`))]))}}));
  return buildPlan(selected,fields,labelField);
}
export class Checkpoints {
  constructor(root) { this.root=root; this.pending=new Map(); }
  async save(job) {
    if (!validId(job.id) || !job.refs) throw new AppError('checkpoint','任务无法保存。');
    // summary() excludes Airtable download URLs, source objects and all credentials.
    const data=JSON.stringify({version:1,refs:job.refs,job:job.summary()});
    const prior=this.pending.get(job.id)??Promise.resolve();
    const next=prior.catch(()=>{}).then(async()=>{
      await mkdir(this.root,{recursive:true});
      const path=join(this.root,job.id+'.json');
      await writeFile(path+'.tmp',data,{mode:0o600});await rename(path+'.tmp',path);
    });
    this.pending.set(job.id,next);await next;
    if(this.pending.get(job.id)===next)this.pending.delete(job.id);
  }
  async read(id) {
    if(!validId(id))throw new AppError('checkpoint','保存的任务编号不正确。');
    let saved;
    try{saved=JSON.parse(await readFile(join(this.root,id+'.json'),'utf8'));}
    catch{throw new AppError('checkpoint','保存的任务不存在或无法读取。',404);}
    if(saved.version!==1||saved.job?.id!==id||!saved.refs||!Array.isArray(saved.job.rows)||saved.job.rows.length>LIMITS.files)
      throw new AppError('checkpoint','任务清单格式不正确。');
    return saved;
  }
  async list() {
    let names;try{names=await readdir(this.root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const items=[];
    for(const name of names.filter(n=>n.endsWith('.json'))){try{items.push(await this.read(name.slice(0,-5)));}catch{}}
    return items.sort((a,b)=>b.job.createdAt.localeCompare(a.job.createdAt));
  }
  async flush(){await Promise.allSettled([...this.pending.values()]);}
}

export async function recoverRows(job,saved) {
  const fresh=new Map(job.rows.map(r=>[r.identity,r]));
  job.id=saved.id;job.createdAt=saved.createdAt;job.startedAt=saved.startedAt;
  // Resume the original snapshot. Newly added source photos require a new scan.
  const items=saved.rows.map(old=>{
    const identity=`${old.recordId}/${old.fieldId}/${old.attachmentId}`;
    const current=fresh.get(identity);
    if(current)current.fieldName=old.fieldName??current.fieldName??current.fieldId;
    const row=current??{...old,identity,status:'failed',url:'',error:'原图已不存在，无法继续复制。'};
    row.attempts=old.attempts??0;
    return {row,old,current};
  });
  job.rows=items.map(x=>x.row);job.busy=true;job.state='restoring';
  let next=0;
  const worker=async()=>{while(next<items.length){
    const item=items[next++];
    const {row,old,current}=item;
    const unchanged=!current||(current.type===old.type&&(current.metadataUnknown||current.declaredBytes===old.declaredBytes)&&current.filename===old.filename);
    if(old.status==='success'&&unchanged&&/^[a-f0-9]{64}$/.test(old.sha256??'')){
      try{
        const result=await (job.destination.recover?.(objectKey(job.id,row),old)??job.destination.verify(objectKey(job.id,row),old.sha256));
        if(!result.valid)throw new Error('Different copy');
        Object.assign(row,{status:'success',error:'',sha256:old.sha256,bytes:old.bytes,declaredBytes:old.bytes,metadataUnknown:false,url:job.destination.url(objectKey(job.id,row)),verification:result.method});
      }catch{row.status=current?'pending':'failed';row.url='';row.error=current?'':'原图与副本均无法读取。';}
    }else if(current&&current.status!=='rejected'){
      row.status='pending';row.url='';row.error='';row.bytes=0;row.sha256='';
    }
  }};
  await Promise.all(Array.from({length:job.concurrency},()=>worker()));
  job.plannedBytes=job.rows.filter(r=>r.status!=='rejected').reduce((n,r)=>n+r.declaredBytes,0);
  job.state=job.rows.some(r=>r.status==='pending')?'paused':job.rows.some(r=>['failed','rejected'].includes(r.status))?'completed_with_errors':'completed';
  job.finishedAt=saved.finishedAt;job.metrics=saved.metrics??job.metrics;
  job.busy=false;
  return job;
}
