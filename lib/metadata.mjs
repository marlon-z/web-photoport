import {translate,templateKey} from '../public/i18n.js';
// Human-readable cells plus a credential-free snapshot of the selected table.
export function cellText(value) {
  if(value==null)return '';
  if(Array.isArray(value))return value.map(cellText).filter(Boolean).join('、');
  if(typeof value==='object') {
    if(value.name!=null)return String(value.name);
    if(value.email!=null)return String(value.email);
    if(value.filename!=null)return String(value.filename);
    if(value.error!=null)return `错误：${value.error}`;
    if(value.id!=null)return String(value.id);
    return JSON.stringify(value);
  }
  return String(value);
}
export function snapshotRecords(records,table={}) {
  const fields=table.fields??Object.keys(records[0]?.fields??{}).map(id=>({id,name:id,type:'singleLineText'}));
  return {table:{id:table.id??'',name:table.name??'原表记录'},fields,
    records:records.map(r=>({id:r.id,values:Object.fromEntries(fields.map(f=>{
      const v=r.fields?.[f.id]??null;
      return [f.id,f.type==='multipleAttachments'&&Array.isArray(v)?v.map(a=>({id:a.id,filename:a.filename,size:a.size,type:a.type})):v];
    })),display:Object.fromEntries(fields.map(f=>[f.id,r.display?.[f.id]??cellText(r.fields?.[f.id])]))}))};
}
export function rowValues(recordData,recordId) {
  return recordData?.records.find(r=>r.id===recordId)?.display??{};
}
export function quoteCSV(value) {
  let s=cellText(value);
  if(/^[\s]*[=+\-@]/u.test(s)||/^[\t\r\n]/u.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function recordsCSV(recordData,rows,locale="zh-CN") {
  const tr=text=>translate(text,locale),msg=(parts,...values)=>translate(templateKey(parts),locale,values);
  const fields=recordData?.fields??[],records=recordData?.records??[];
  const byRecord=new Map();for(const row of rows){if(!byRecord.has(row.recordId))byRecord.set(row.recordId,[]);byRecord.get(row.recordId).push(row);}
  const data=[[tr('记录编号'),...fields.map(f=>f.name),tr('下载文件位置'),tr('附件处理结果')],...records.map(r=>{
    const files=byRecord.get(r.id)??[];
    return [r.id,...fields.map(f=>r.display[f.id]??''),files.filter(f=>f.downloadPath).map(f=>f.downloadPath).join('\n'),files.map(f=>`${f.filename}：${f.status==='success'?tr('已核对'):tr(f.error||f.status)}`).join('\n')];
  })];
  return '\ufeff'+data.map(r=>r.map(quoteCSV).join(',')).join('\r\n');
}
