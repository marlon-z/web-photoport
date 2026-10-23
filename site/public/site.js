import {installFormValidation} from './form-validation.js';
const form=document.querySelector('#waitlist-form');
const zh=document.documentElement.lang.startsWith('zh');
if(form){
  installFormValidation(form,()=>zh?'zh-CN':'en');
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type=submit]'),status=document.querySelector('#status'),receipt=document.querySelector('#receipt');
    button.disabled=true;status.textContent=zh?'正在保存报名…':'Saving your request…';
    const fields=new FormData(form);
    try{
      const response=await fetch('/api/waitlist',{method:'POST',headers:{'Content-Type':'application/json','X-PhotoPort-Form':'1'},body:JSON.stringify({email:fields.get('email'),scenario:fields.get('scenario'),batch:fields.get('batch'),price:fields.get('price'),need:fields.get('need')||'',website:fields.get('website')||'',consent:fields.get('consent')==='on'})});
      const data=await response.json();
      if(!response.ok)throw new Error(response.status===429?(zh?'报名暂满或提交过于频繁，请稍后再试。':'Registration is paused or too many requests were made. Please try later.'):(zh?'报名未保存，请检查输入或稍后重试。':'Your request was not saved. Check the form or try again later.'));
      status.textContent=zh?'报名已保存。没有扣费，也没有发送邮件。':'Your interest is saved. No charge or email has been sent.';
      if(data.removeToken){
        const link=new URL(zh?'/zh/remove':'/remove',location.origin);link.hash=data.removeToken;
        receipt.replaceChildren();const p=document.createElement('p');p.textContent=zh?'请保存下面的链接，可随时删除这次报名。链接只显示这一次，请勿分享。':'Save this private link to remove this submission later. It is shown only once; do not share it.';
        const a=document.createElement('a');a.href=link.href;a.textContent=zh?'删除本次报名的专属链接':'Your private removal link';receipt.append(p,a);receipt.hidden=false;
      }
      form.reset();button.textContent=zh?'报名已保存':'Saved';
    }catch(error){status.textContent=error instanceof TypeError?(zh?'报名未保存，请检查网络后重试。':'Your request was not saved. Check your connection and try again.'):error.message;button.disabled=false;}
  });
}
const removeButton=document.querySelector('#remove-button');
if(removeButton){
  const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  const languageLink=document.querySelector('nav a[lang]');if(languageLink&&/^[a-f0-9]{64}$/.test(token))languageLink.href=(zh?'/remove':'/zh/remove')+'#'+token;
  const status=document.querySelector('#status');
  if(!/^[a-f0-9]{64}$/.test(token)){removeButton.disabled=true;status.textContent=zh?'请使用报名成功时保存的完整删除链接。':'Open the complete private removal link saved after signup.';}
  removeButton.addEventListener('click',async()=>{
    removeButton.disabled=true;status.textContent=zh?'正在删除…':'Removing…';
    try{const r=await fetch('/api/remove',{method:'POST',headers:{'Content-Type':'application/json','X-PhotoPort-Form':'1'},body:JSON.stringify({token})});if(!r.ok)throw Error();status.textContent=zh?'本次报名已删除（或此前已删除）。':'This entry has been removed, or was already removed.';}
    catch{status.textContent=zh?'操作未完成，请重试。':'Could not complete the request. Please try again.';removeButton.disabled=false;}
  });
}

