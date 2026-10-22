import { mkdir,readFile,writeFile,rename,stat } from 'node:fs/promises';
import { createReadStream,createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { AppError,digest,LIMITS,csv } from './core.mjs';
import { FILE_TYPES,matchesFile } from './file-types.mjs';
import { archiveRows } from './names.mjs';
import { writeCatalog } from './catalog.mjs';
import { recordsCSV } from './metadata.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateExport(input) {
  if(!input||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>LIMITS.files)throw new AppError('manifest','请选择本工具导出的完整JSON结果。');
  const seen=new Set();let bytes=0;
  const rows=input.rows.map(r=>{
    if(!['success','rejected','failed','pending'].includes(r.status)||!r.recordId||!r.fieldId||!r.attachmentId||!r.filename)throw new AppError('manifest','结果清单的记录或照片信息不完整。');
    const identity=`${r.recordId}/${r.fieldId}/${r.attachmentId}`;
    if(seen.has(identity))throw new AppError('manifest','清单里有重复的附件编号。');seen.add(identity);
    if(r.status==='success'){
      let u;try{u=new URL(r.url);}catch{throw new AppError('manifest','成功照片缺少可读取的公开地址。');}
      if(u.protocol!=='https:'||u.username||u.password||!/^([a-f0-9]{64})$/.test(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>LIMITS.fileBytes||!FILE_TYPES[r.type])throw new AppError('manifest','附件地址、大小或内容指纹不正确。');
      bytes+=r.bytes;
    }
    return {recordId:String(r.recordId),fieldId:String(r.fieldId),fieldName:String(r.fieldName||r.fieldId),attachmentId:String(r.attachmentId),label:String(r.label||r.recordId),filename:String(r.filename),declaredBytes:r.declaredBytes??r.bytes,type:r.type,extension:FILE_TYPES[r.type]||'bin',status:r.status,error:String(r.error||''),bytes:r.bytes||0,sha256:r.sha256||'',url:r.status==='success'?r.url:'',attempts:r.attempts||0,verification:r.verification||''};
  });
  if(bytes>LIMITS.totalBytes)throw new AppError('total_limit','这个结果超过当前10GB范围。');
  return rows;
}
export function gallery(rows) {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>资料目录</title><style>body{font:15px/1.7 system-ui;margin:32px;background:#f5f7fb;color:#171b26}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:12px;border:1px solid #e5e8ef}img{width:100px;height:75px;object-fit:contain}small{display:block;color:#667085}a{color:#2856f6}</style><h1>资料已整理好</h1><p>先完整解压ZIP，再打开这个文件。文件不需要联网；原名、所属记录和文件位置都保存在清单中。原表记录.csv 每条记录一行，包含没有附件的记录。</p><table><tr><th>所属记录 / 分组</th><th>原文件名</th><th>文件</th></tr>'+rows.filter(r=>r.status==='success').map(r=>`<tr><td>${esc(r.label)}<small>${esc(r.recordId)} · ${esc(r.fieldName||r.fieldId)}<br>${esc((r.groupValues??[]).join(' / '))}</small></td><td>${esc(r.filename)}<small>${esc(r.downloadPath)}</small></td><td><a href="${r.downloadPath.split('/').map(encodeURIComponent).join('/')}">${r.type?.startsWith('image/')&&r.bytes<=1024*1024?`<img loading="lazy" alt="${esc(r.filename)}" src="${r.downloadPath.split('/').map(encodeURIComponent).join('/')}">`:'打开原文件'}</a></td></tr>`).join('')+'</table></html>';
}
export async function buildArchive(summary,{root,read,onProgress=()=>{},allowPartial=false}) {
  if(summary.busy||summary.rows.some(r=>r.status==='copying')||(!allowPartial&&summary.rows.some(r=>['pending','failed'].includes(r.status))))throw new AppError('archive_unfinished','请先完成处理并重试失败文件，或暂停后选择只下载已成功的文件。');
  const rows=archiveRows(summary.rows,summary.organization,summary.recordData),successful=rows.filter(r=>r.status==='success');
  const missing=rows.filter(r=>r.status!=='success'),partial=missing.length>0;
  if(!successful.length)throw new AppError('archive_empty','还没有成功照片可下载。');
  const cache=join(root,'cache'),dir=join(root,summary.id,String(summary.layoutVersion??0));await mkdir(cache,{recursive:true});await mkdir(dir,{recursive:true});
  const prepared=[];let bytes=0,downloads=0;
  // A disk cache reuses byte-identical photos, while each record still gets its
  // own ZIP entry. Never retain the entire archive or all images in RAM.
  for(const row of successful){
    if(!/^[a-f0-9]{64}$/.test(row.sha256))throw new AppError('archive_hash','成功照片缺少内容指纹，请重新核对。');
    const path=join(cache,row.sha256);let data;
    try{data=await readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!data||data.length!==row.bytes||digest(data)!==row.sha256){
      data=await read(row);downloads++;
      if(data.length!==row.bytes||digest(data)!==row.sha256||!matchesFile(data,row.type))throw new AppError('archive_changed','有附件无法读取或内容变化，未生成不完整的资料包。');
      await writeFile(path+'.part',data);await rename(path+'.part',path);
    }
    prepared.push({row,path});bytes+=data.length;onProgress({state:'preparing',prepared:prepared.length,total:successful.length,bytes,downloads});
  }
  const output=join(dir,'photos.zip'),partialPath=output+'.part';
  const catalogPath=join(dir,'照片目录.xlsx');
  const catalog=await writeCatalog(rows,sha=>join(cache,sha),catalogPath,summary.recordData);
  const zip=new yazl.ZipFile();
  const completion=pipeline(zip.outputStream,createWriteStream(partialPath));
  // Also handle the ZipFile error emitter, including file reads/size mismatch.
  zip.on('error',e=>zip.outputStream.destroy(e));
  zip.addBuffer(Buffer.from(csv(summary.rows,summary.organization,summary.recordData),'utf8'),'照片清单.csv',{compress:false});
  if(missing.length)zip.addBuffer(Buffer.from(csv(missing,summary.organization,summary.recordData),'utf8'),'未下载文件清单.csv',{compress:false});
  if(summary.recordData){
    zip.addBuffer(Buffer.from(recordsCSV(summary.recordData,rows)),'原表记录.csv',{compress:false});
    zip.addBuffer(Buffer.from(JSON.stringify(summary.recordData,null,2)),'原表数据.json',{compress:false});
  }
  zip.addBuffer(Buffer.from(JSON.stringify({...summary,rows,delivery:{partial,included:successful.length,missing:missing.length}},null,2)),'manifest.json',{compress:false});
  zip.addBuffer(Buffer.from(gallery(rows)),'打开照片目录.html',{compress:false});
  zip.addFile(catalogPath,'照片目录.xlsx',{compress:false});
  zip.addBuffer(Buffer.from(`PhotoPort 资料包\r\n成功文件 ${successful.length} 个，未加入 ${rows.length-successful.length} 个。\r\n请完整解压后打开“打开照片目录.html”。\r\n整理规则：${JSON.stringify(summary.organization??{})}；实际位置见照片清单.csv。\r\n同组值的多条记录合并在同一个文件夹；可选保留每条记录的子文件夹。多值列使用组合名称，不会擅自丢掉任一名字。\r\n同一目录重名时加 (2)、(3)，系统不允许的字符改为下划线；原始名称完整保留在manifest.json和CSV。\r\n照片目录.xlsx：照片目录每个附件一行；原表记录每条记录一行。原表数据.json保留原值和字段信息，附件临时地址不保留。\r\n这是所选记录的一次性导出，不能还原完整Airtable库的视图、权限或历史版本。\r\n本机地址仅在本机服务运行时可用；长期公开地址取决于保留云文件及域名。\r\n`),'使用说明.txt',{compress:false});
  for(const {row,path} of prepared)zip.addFile(path,row.downloadPath,{compress:false});
  onProgress({state:'packing',prepared:prepared.length,total:successful.length,bytes,downloads});
  zip.end({forceZip64Format:true});await completion;await rename(partialPath,output);
  const info={state:'ready',partial,missing:missing.length,prepared:successful.length,total:successful.length,photoBytes:bytes,zipBytes:(await stat(output)).size,catalogBytes:(await stat(catalogPath)).size,catalog,downloads,finishedAt:new Date().toISOString()};
  await writeFile(join(dir,'result.json'),JSON.stringify(info));onProgress(info);
  return {path:output,catalogPath,info,rows};
}

export function archiveStream(path,{start=0,end}={}){return createReadStream(path,{start,...(end===undefined?{}:{end})});}
