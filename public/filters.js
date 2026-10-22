export function matchesCondition(record,{field='',operator='contains',value=''}={}){
  if(!field)return true;
  const raw=record.display?.[field]??'',s=String(raw).trim(),v=String(value).trim();
  if(operator==='empty')return s==='';
  if(operator==='notempty')return s!=='';
  if(operator==='equals')return s.toLocaleLowerCase()===v.toLocaleLowerCase();
  if(operator==='contains')return s.toLocaleLowerCase().includes(v.toLocaleLowerCase());
  if(!s||!v)return false;
  if(operator==='gt'||operator==='lt'){
    const a=Number(s.replaceAll(',','')),b=Number(v.replaceAll(',',''));
    return Number.isFinite(a)&&Number.isFinite(b)&&(operator==='gt'?a>b:a<b);
  }
  if(operator==='before'||operator==='after'){
    const a=Date.parse(s),b=Date.parse(v);
    return Number.isFinite(a)&&Number.isFinite(b)&&(operator==='before'?a<b:a>b);
  }
  return false;
}
