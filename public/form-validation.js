// Keep in-page validation in the selected product language, independently of
// the browser's native validation bubble language. Server checks still apply.
const messages={
  en:{required:'Please fill in this field.',check:'Please check this box to continue.',email:'Enter a valid email address.',url:'Enter a complete URL, such as https://airtable.com/app…',format:'Check the format of this value.',length:'This value is too long.',short:'This value is too short.',number:'Enter a number within the allowed range.',invalid:'Check this field and try again.'},
  'zh-CN':{required:'请填写这一项。',check:'请勾选这一项后继续。',email:'请输入有效的邮箱地址。',url:'请输入完整网址，例如 https://airtable.com/app…',format:'请检查这一项的格式。',length:'输入的内容过长。',short:'输入的内容过短。',number:'请输入允许范围内的数字。',invalid:'请检查这一项后重试。'}
};
export function validationMessage(field,language='en'){
  const t=messages[language]??messages.en,v=field.validity;
  if(v.valid)return '';
  if(v.valueMissing)return field.type==='checkbox'?t.check:t.required;
  if(v.typeMismatch)return field.type==='email'?t.email:field.type==='url'?t.url:t.format;
  if(v.tooLong)return t.length;
  if(v.tooShort)return t.short;
  if(v.rangeUnderflow||v.rangeOverflow||v.stepMismatch||v.badInput)return t.number;
  return v.patternMismatch?t.format:t.invalid;
}
export function installFormValidation(form,getLanguage=()=> 'en'){
  const error=document.createElement('p');error.id=(form.id||'form')+'-validation';
  error.className='form-error';error.setAttribute('role','alert');error.hidden=true;form.append(error);
  let invalid=null;
  const clear=()=>{
    if(invalid){invalid.removeAttribute('aria-invalid');const ids=(invalid.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==error.id);if(ids.length)invalid.setAttribute('aria-describedby',ids.join(' '));else invalid.removeAttribute('aria-describedby');}
    invalid=null;error.hidden=true;error.textContent='';
  };
  const refresh=()=>{if(invalid)error.textContent=validationMessage(invalid,getLanguage());};
  form.noValidate=true;
  form.addEventListener('submit',event=>{
    clear();
    invalid=[...form.elements].find(field=>field.willValidate&&!field.validity.valid);
    if(!invalid)return;
    event.preventDefault();event.stopImmediatePropagation();
    invalid.setAttribute('aria-invalid','true');
    invalid.setAttribute('aria-describedby',((invalid.getAttribute('aria-describedby')||'')+' '+error.id).trim());
    refresh();error.hidden=false;invalid.focus();
  },true);
  form.addEventListener('input',clear);
  form.addEventListener('reset',clear);
  return {refresh};
}
