import sharp from 'sharp';
import {AppError,objectKey} from './core.mjs';
import {readPublic} from './adapters.mjs';

// Small, bounded previews only. Original bytes and transfer state are untouched.
export function createPreviews(){
  let active=0;const waiting=[];
  async function bounded(fn){
    if(active>=2)await new Promise(resolve=>waiting.push(resolve));else active++;
    try{return await fn();}finally{const next=waiting.shift();if(next)next();else active--;}
  }
  return async function preview(job,identity){
    const row=(job.allRows??job.rows).find(r=>`${r.recordId}/${r.fieldId}/${r.attachmentId}`===identity);
    if(!row||row.status==='rejected'||!/^image\/(png|jpeg|webp|gif|tiff|avif)$/.test(row.type))throw new AppError('preview','这个文件没有图片预览。',404);
    job.previews??=new Map();
    if(!job.previews.has(identity)){
      if(job.previews.size>=48)job.previews.delete(job.previews.keys().next().value);
      const task=bounded(async()=>{
        let bytes;
        if(row.status==='success')bytes=job.imported?await readPublic(row.url):await job.destination.read(objectKey(job.id,row));
        else {try{bytes=await job.source.read(row,false);}catch(e){if(e.code!=='source_expired')throw e;bytes=await job.source.read(row,true);}}
        return sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize(480,360,{fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
      }).catch(()=>{job.previews.delete(identity);throw new AppError('preview','暂时无法预览；下载时会核对原文件并列出问题。',404);});
      job.previews.set(identity,task);
    }
    return job.previews.get(identity);
  };
}
