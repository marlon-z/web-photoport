// Preserve a valid original filename. Only change characters that cannot safely
// be extracted on Windows, and number collisions within the same record/field.
export function safeName(value, fallback='unnamed', max=100) {
  let name=String(value??'').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu,'_').replace(/[. ]+$/u,'');
  name=Array.from(name).slice(0,max).join('');
  if(!name||name==='.'||name==='..')name=fallback;
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
  return name;
}
export function safeFilename(value,fallback,max=100){
  const full=safeName(value,fallback,500),dot=full.lastIndexOf('.');
  if(Array.from(full).length<=max||dot<1)return safeName(full,fallback,max);
  const ext=full.slice(dot);
  return ext.length<=13?safeName(full.slice(0,dot),fallback,max-ext.length)+ext:safeName(full,fallback,max);
}
export function normalizeOrganization(input={},fields=[]) {
  const ids=new Set(fields.filter(f=>f.type!=='multipleAttachments').map(f=>f.id));
  const groupBy=Array.isArray(input.groupBy)?input.groupBy.filter(Boolean):[];
  if(new Set(groupBy).size!==groupBy.length)throw new Error('两层文件夹请选择不同的列。');
  if(groupBy.length>2||groupBy.some(id=>typeof id!=='string'||!ids.has(id)))throw new Error('请选择有效的分文件夹列，最多两层。');
  const renameField=input.renameField||'';
  if(renameField&&!ids.has(renameField))throw new Error('请选择有效的文件命名列。');
  return {groupBy,renameField,keepRecordFolder:!!input.keepRecordFolder,separateFields:input.separateFields!==false};
}
export function archiveRows(rows,organization={},recordData=null) {
  const used=new Set();
  const records=new Map(recordData?.records?.map(r=>[r.id,r])??[]);
  const folders=new Map(),counters=new Map();
  // Case-insensitive filesystems must not merge two different category names.
  const segment=(parent,value)=>{
    const raw=String(value||'未填写').normalize('NFC');let name=safeName(raw,'未填写',44),n=1;
    while(folders.has(`${parent}/${name}`.toLowerCase())&&folders.get(`${parent}/${name}`.toLowerCase())!==raw)name=safeName(raw,'未填写',36)+` (${++n})`;
    folders.set(`${parent}/${name}`.toLowerCase(),raw);return name;
  };
  return rows.map(row=>{
    if(row.status!=='success')return {...row,downloadPath:''};
    const values=records.get(row.recordId)?.display??{};
    let folder='photos';
    if(organization.groupBy?.length){
      for(const id of organization.groupBy)folder+='/'+segment(folder,values[id]);
      if(organization.keepRecordFolder)folder+=`/${safeName(row.label||row.recordId,'record',44)}__${safeName(row.recordId,'record',40)}`;
    }else folder+=`/${safeName(row.label||row.recordId,'record',44)}__${safeName(row.recordId,'record',40)}`;
    const counterFolder=folder;
    if(organization.separateFields!==false)folder+='/'+segment(folder,row.fieldName||row.fieldId||'Photos');
    let original=row.filename;
    if(organization.renameField){
      const prefix=values[organization.renameField]||row.label||row.recordId;
      const key=`${counterFolder}/${organization.renameField}/${prefix}`,sequence=(counters.get(key)??0)+1;counters.set(key,sequence);
      const ext=/\.([a-zA-Z0-9]{1,12})$/.exec(row.filename)?.[1]||row.extension;
      original=`${prefix}-${String(sequence).padStart(2,'0')}.${ext}`;
    }
    const name=safeFilename(original,'file.'+row.extension,Math.max(24,Math.min(100,220-folder.length-1)));
    const dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
    let candidate=`${folder}/${name}`,n=1;
    while(used.has(candidate.toLowerCase()))candidate=`${folder}/${stem} (${++n})${ext}`;
    used.add(candidate.toLowerCase());return {...row,downloadPath:candidate,groupValues:(organization.groupBy??[]).map(id=>values[id]||'未填写')};
  });
}

export function layoutOverview(rows,organization={},recordData=null){
  const planned=archiveRows(rows.filter(r=>r.status!=='rejected').map(r=>({...r,status:'success'})),organization,recordData);
  const groups=new Map();
  for(const r of planned){
    const grouped=!!organization.groupBy?.length,key=grouped?JSON.stringify(r.groupValues):r.recordId;
    const entry=groups.get(key)??{name:(grouped?r.groupValues.join(' / '):r.label)||r.recordId,files:0};entry.files++;groups.set(key,entry);
  }
  const records=recordData?.records??[],groupBy=organization.groupBy??[],withFiles=new Set(planned.map(r=>r.recordId));
  const emptyRecords=records.filter(r=>withFiles.has(r.id)&&groupBy.some(id=>!r.display?.[id]?.trim())).length;
  return {files:planned.length,groups:groups.size,emptyRecords,preview:[...groups.values()].slice(0,6),paths:planned.slice(0,8).map(r=>r.downloadPath)};
}
