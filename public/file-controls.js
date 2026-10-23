import {tr,getLanguage} from './locale.js';
import {installFormValidation} from './form-validation.js';

export function updateFilePickers(){
  for(const input of document.querySelectorAll('input[type=file][data-file-picker]')){
    const button=document.getElementById(input.id+'-button'),status=document.getElementById(input.id+'-filename');
    const label=tr(input.accept.includes('json')?'选择 JSON 文件':'选择 CSV 文件');
    button.textContent=label;
    // Render filenames as text, never as HTML or translation keys.
    status.textContent=input.files[0]?.name||tr('未选择文件');
    input.title=label;
  }
}
export function initFileControls(){
  for(const input of document.querySelectorAll('input[type=file][data-file-picker]'))input.addEventListener('change',updateFilePickers);
  const validations=[...document.forms].map(form=>installFormValidation(form,getLanguage));
  document.addEventListener('photoport:language',()=>{updateFilePickers();validations.forEach(v=>v.refresh());});
  updateFilePickers();
}
