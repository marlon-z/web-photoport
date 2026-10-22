export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fileIdentity=row=>`${row.recordId}/${row.fieldId}/${row.attachmentId}`;
export function groupFiles(rows,records,organization={}){
  const byId=new Map(records.map(r=>[r.id,r])),groups=new Map();
  for(const row of rows){
    const record=byId.get(row.recordId),values=(organization.groupBy??[]).map(id=>record?.display?.[id]||'未填写');
    const key=values.length?JSON.stringify(values):row.recordId;
    if(!groups.has(key))groups.set(key,{key,name:values.length?values.join(' / '):row.label||row.recordId,rows:[],recordIds:[]});
    const group=groups.get(key);group.rows.push(row);if(!group.recordIds.includes(row.recordId))group.recordIds.push(row.recordId);
  }
  return [...groups.values()];
}
export const previewURL=(jobId,row)=>`/api/jobs/${encodeURIComponent(jobId)}/preview?file=${encodeURIComponent(fileIdentity(row))}`;
