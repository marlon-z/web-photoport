import { AppError,digest,wait } from './core.mjs';
import { FILE_TYPES } from './file-types.mjs';
import { readLimited } from './adapters.mjs';

export function parseCSV(text) {
  text=String(text).replace(/^\ufeff/,'');const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
    else if(c==='"'&&cell==='')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new AppError('csv','CSV引号没有闭合，请重新从Airtable导出。');
  if(cell||row.length){row.push(cell);if(row.some(Boolean))rows.push(row);}
  if(rows.length<2)throw new AppError('csv','CSV里没有数据记录。');
  if(rows[0].some(x=>!x)||new Set(rows[0]).size!==rows[0].length)throw new AppError('csv','CSV列名有空白或重复，请先改成不同的列名。');
  if(rows.length>50001)throw new AppError('csv','最多导入50000条记录。');
  if(rows.some(r=>r.length!==rows[0].length))throw new AppError('csv','CSV各行列数不同，请重新导出原始文件。');
  return rows;
}
const extTypes=Object.fromEntries(Object.entries(FILE_TYPES).map(([type,ext])=>[ext,type]));
Object.assign(extTypes,{jpeg:'image/jpeg',tiff:'image/tiff'});
export class CSVSource {
  mode='csv';networkRetries=0;
  constructor(text,{fetcher=fetch,sleep=wait}={}){
    this.fetcher=fetcher;this.sleep=sleep;this.urls=new Map();
    const [headers,...data]=parseCSV(text);
    const fields=headers.map((name,i)=>({id:`csv${i}`,name,type:'singleLineText'}));
    this.records=data.map((cells,index)=>({id:`csvRow${index+2}`,fields:Object.fromEntries(cells.map((value,i)=>[fields[i].id,value]))}));
    let count=0;
    for(const record of this.records)for(const field of fields){
      const value=record.fields[field.id],matches=[...value.matchAll(/(?:^|,\s*)(.*?)\s*\((https:\/\/[^\s)]+)\)(?=,\s*|$)/gs)].filter(m=>{
        let u;try{u=new URL(m[2]);}catch{return false;}
        if(u.hostname.includes('airtableusercontent.com')&&!officialURL(u))throw new AppError('csv_url','附件域名或链接凭证格式不正确。');
        return officialURL(u);
      });
      if(!matches.length)continue;
      const files=[];
      for(const [index,m] of matches.entries()){
        const u=new URL(m[2]);
        if(!officialURL(u))throw new AppError('csv_url','附件链接须来自Airtable官方附件域名。');
        const filename=m[1].trim()||`file-${index+1}`,ext=filename.split('.').pop().toLowerCase();
        const id='attCSV'+digest(Buffer.from(`${record.id}/${field.id}/${index}`)).slice(0,16);
        files.push({id,filename,type:extTypes[ext]||'application/octet-stream',size:0,metadataUnknown:true});
        this.urls.set(`${record.id}/${field.id}/${id}`,u.toString());count++;
      }
      record.fields[field.id]=files;field.type='multipleAttachments';
    }
    if(!count)throw new AppError('csv','没有识别到Airtable附件链接。请从包含附件的视图下载新的CSV；普通分享页面地址不适用。');
    // Empty cells in an attachment column represent an empty list.
    for(const r of this.records)for(const f of fields.filter(f=>f.type==='multipleAttachments'))if(!Array.isArray(r.fields[f.id]))r.fields[f.id]=[];
    this.fingerprint=digest(Buffer.from(JSON.stringify({fields,records:this.records})));
    this.table={id:'tblCSV',name:'导入的CSV',primaryFieldId:fields.find(f=>f.type!=='multipleAttachments')?.id,fields};
  }
  async read(row){
    const url=this.urls.get(row.identity);if(!url||!officialURL(new URL(url)))throw new AppError('csv_expired','请重新导入刚从Airtable下载的CSV。');
    for(let attempt=0;attempt<3;attempt++){
      try{
        const r=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(120000)});
        if([401,403].includes(r.status))throw new AppError('csv_expired','CSV里的临时链接已过期。请从原视图重新下载CSV，再导入；已下载的文件仍保留。');
        if(r.status===404)throw new AppError('missing','来源已找不到这个附件。');
        if(r.status===429||r.status>=500){await r.body?.cancel();throw new TypeError('temporary');}
        return await readLimited(r);
      }catch(e){
        if(!(e instanceof TypeError||['AbortError','TimeoutError'].includes(e.name)||e.code==='transfer_timeout'))throw e;
        if(attempt===2)throw new AppError('source_network','附件下载连续失败，可稍后重试。');
        this.networkRetries++;await this.sleep(1000*(attempt+1));
      }
    }
  }
  close(){this.urls.clear();}
}
function officialURL(u){return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='airtableusercontent.com'||u.hostname.endsWith('.airtableusercontent.com'));}
