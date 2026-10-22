import {translate,templateKey} from '../public/i18n.js';
// Product export code: embedded thumbnails work without a cloud image account.
// Original photos are kept untouched in the ZIP; only catalog previews resize.
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

export async function writeCatalog(rows,cachePath,output,recordData=null,locale="zh-CN"){
  const tr=text=>translate(text,locale),msg=(parts,...values)=>translate(templateKey(parts),locale,values);
  const book=new ExcelJS.Workbook();book.creator='PhotoPort';
  const sheet=book.addWorksheet(tr('照片目录'),{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=[{header:tr('所属记录'),key:'label',width:30},{header:tr('记录编号'),key:'record',width:24},{header:tr('原文件名'),key:'file',width:30},{header:tr('照片列'),key:'field',width:22},{header:tr('结果'),key:'status',width:14},{header:tr('文件位置'),key:'path',width:60},{header:tr('图片地址'),key:'url',width:60},{header:tr('图片预览'),key:'preview',width:23}];
  const fields=recordData?.fields.filter(f=>f.type!=='multipleAttachments')??[],records=new Map(recordData?.records.map(r=>[r.id,r])??[]);
  sheet.columns=[...sheet.columns.map(c=>({header:c.header,key:c.key,width:c.width})),...fields.map(f=>({header:msg`原表：${f.name}`,key:`source:${f.id}`,width:23}))];
  for(const index of [2,4,5,6,7])sheet.getColumn(index).hidden=true;
  for(const index of [1,3,8])sheet.getColumn(index).width=22;
  sheet.getRow(1).font={bold:true,size:11};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F0F0'}};sheet.getRow(1).height=25;
  const images=new Map();let embeddedPreviews=0;
  for(const row of rows){
    const line=sheet.addRow({label:row.label,record:row.recordId,file:row.filename,field:row.fieldName||row.fieldId,status:row.status==='success'?tr('已核对'):tr(row.error||row.status),path:row.downloadPath||'',url:row.url||'',...Object.fromEntries(fields.map(f=>[`source:${f.id}`,records.get(row.recordId)?.display[f.id]??'']))});
    line.alignment={vertical:'middle',wrapText:false};
    if(row.status!=='success')continue;
    if(!row.type?.startsWith('image/')){line.getCell('preview').value=tr('附件原文件在资料包内');continue;}
    let image=images.get(row.sha256);
    if(image===undefined){
      try{
        const input=await cachePath(row.sha256,row);
        const bytes=Buffer.isBuffer(input)?input:await readFile(input);
        const thumbnail=await sharp(bytes,{limitInputPixels:60000000}).resize({width:160,height:120,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
        image={id:book.addImage({buffer:thumbnail.data,extension:'png'}),width:thumbnail.info.width,height:thumbnail.info.height};
      }catch{image={error:true};}
      images.set(row.sha256,image);
    }
    line.height=95;
    if(image.error)line.getCell('preview').value=tr('预览不可用，请打开原文件');
    else{sheet.addImage(image.id,{tl:{col:7.1,row:line.number-1+.05},ext:{width:image.width,height:image.height},editAs:'oneCell'});embeddedPreviews++;}
  }
  sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:sheet.columnCount}};
  if(recordData){
    const source=book.addWorksheet(tr('原表记录'),{views:[{state:'frozen',ySplit:1}]});
    source.columns=[{header:tr('记录编号'),key:'id',width:25},...recordData.fields.map(f=>({header:f.name,key:f.id,width:25})),{header:tr('下载文件位置'),key:'paths',width:70}];
    const paths=new Map();for(const r of rows.filter(r=>r.downloadPath)){if(!paths.has(r.recordId))paths.set(r.recordId,[]);paths.get(r.recordId).push(r.downloadPath);}
    for(const r of recordData.records)source.addRow({id:r.id,...Object.fromEntries(recordData.fields.map(f=>{
      const v=r.values[f.id];return [f.id,typeof v==='number'||typeof v==='boolean'?v:r.display[f.id]??''];
    })),paths:(paths.get(r.id)??[]).join('\n')});
    source.getRow(1).font={bold:true};source.getRow(1).height=25;
    source.autoFilter={from:{row:1,column:1},to:{row:recordData.records.length+1,column:source.columnCount}};
  }
  await book.xlsx.writeFile(output);
  return {rows:rows.length,embeddedPreviews,uniquePreviewImages:[...images.values()].filter(i=>!i.error).length};
}
