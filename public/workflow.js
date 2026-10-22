// Preferences contain field names and layout choices only, never record values or credentials.
export function presetOrganization(kind,fields){
  const available=fields.filter(f=>f.type!=='multipleAttachments');
  const sku=available.find(f=>/sku|货号|商品编号|product.?code/i.test(f.name));
  const customer=available.find(f=>/客户|用户|customer|client|user/i.test(f.name));
  if(kind==='product'&&!sku)return null;
  if(kind==='customer'&&!customer)return null;
  return {groupBy:kind==='record'?[]:kind==='product'?[sku.id]:[customer.id,...(sku?[sku.id]:[])],renameField:'',keepRecordFolder:false,separateFields:true};
}
export function rememberOrganization(organization,fields){
  const name=id=>fields.find(f=>f.id===id)?.name;
  return {version:1,groupBy:organization.groupBy.map(name),renameField:name(organization.renameField)||'',keepRecordFolder:organization.keepRecordFolder,separateFields:organization.separateFields};
}
export function recallOrganization(saved,fields){
  if(saved?.version!==1||!Array.isArray(saved.groupBy)||saved.groupBy.length>2)return null;
  const byName=name=>fields.filter(f=>f.type!=='multipleAttachments'&&f.name===name);
  const names=[...saved.groupBy,...(saved.renameField?[saved.renameField]:[])];
  if(names.some(name=>byName(name).length!==1))return null;
  const groupBy=saved.groupBy.map(name=>byName(name)[0].id);
  if(new Set(groupBy).size!==groupBy.length)return null;
  return {groupBy,renameField:saved.renameField?byName(saved.renameField)[0].id:'',keepRecordFolder:!!saved.keepRecordFolder,separateFields:saved.separateFields!==false};
}
