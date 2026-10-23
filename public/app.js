import {initFileControls,updateFilePickers} from '/file-controls.js';
import {layoutOverview} from '/names.js';
import {tr,msg,getLanguage,localizedURL,initLanguage} from '/locale.js';
initLanguage();
initFileControls();
const account=null;
const connectAccountUI=async()=>{};
const activeKey='photoport.active'+(account?'.'+account.user.id:'');
import {groupFiles,previewURL} from '/gallery.js';
import {matchesCondition} from '/filters.js';
import {presetOrganization,rememberOrganization,recallOrganization} from '/workflow.js';
const $=id=>document.getElementById(id);
let job=null,tables=[],settings={r2:null},working=false,demo=false,csvMode=false,allRecords=[],selectedIds=new Set();
let step=1,allRows=[],galleryLimit=24,galleryKey="";

const preferenceKey='photoport.layout.v1'+(account?'.'+account.user.id:'');
function readPreference(){try{return JSON.parse(localStorage.getItem(preferenceKey));}catch{return null;}}
function setStep(next,scroll=true){
  step=job?next:1;
  for(const panel of document.querySelectorAll('[data-panel]'))panel.classList.toggle('hidden',Number(panel.dataset.panel)!==step);
  for(const button of document.querySelectorAll('[data-step]')){button.disabled=!job&&button.dataset.step!=='1';if(Number(button.dataset.step)===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
  if(job){try{sessionStorage.setItem(activeKey,JSON.stringify({id:job.id,step}));}catch{}}
  updateHeading();
  if(scroll)$('workspace').scrollIntoView({behavior:'smooth',block:'start'});
}
for(const b of document.querySelectorAll('[data-step],[data-goto]'))b.onclick=()=>setStep(Number(b.dataset.step||b.dataset.goto));
$('hero-demo').onclick=()=>$('demo').click();
$('new-export').onclick=()=>setStep(1);
$('open-history').onclick=()=>{$('history-panel').open=true;$('history-panel').scrollIntoView({behavior:'smooth'});};
function writePreference(){try{if($('remember-layout').checked)localStorage.setItem(preferenceKey,JSON.stringify(rememberOrganization(organization(),job.recordData?.fields??[])));else localStorage.removeItem(preferenceKey);}catch{toast(tr('浏览器未允许保存设置；本次整理不受影响。'));}}
$('remember-layout').onchange=writePreference;
function applyOrganization(o){$('layout').value=o.groupBy.length===2?'two':o.groupBy.length===1?'one':'record';if(o.groupBy[0])$('group1').value=o.groupBy[0];if(o.groupBy[1])$('group2').value=o.groupBy[1];$('rename').value=o.renameField||'';$('keep-record').checked=!!o.keepRecordFolder;$('separate-fields').checked=o.separateFields!==false;organizerVisibility();}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=n=>n>=1e9?`${(n/1e9).toFixed(2)} GB`:n>=1e6?`${(n/1e6).toFixed(2)} MB`:`${((n||0)/1000).toFixed(1)} KB`;
function toast(t,error=false){$('toast').textContent=t;$('toast').className='toast'+(error?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.add('hidden'),9000);}
async function api(path,body){const r=await fetch(localizedURL(path),body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-PhotoPort':'1'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok){if(account&&r.status===401&&data.code==='login_required')location.replace('/login');throw new Error(data.error||tr('操作未完成。'));}return data;}
const guard=fn=>async e=>{e?.preventDefault();try{await fn(e);}catch(error){toast(tr(error.message),true);if(step===3&&job){$('archive-status').textContent=tr(error.message);$('archive-status').classList.add('notice');}}};
function entry(mode){$('csv-entry').classList.toggle('hidden',mode!=='csv');$('source-form').classList.toggle('hidden',mode!=='api');$('use-csv').classList.toggle('active',mode==='csv');}
$('use-csv').onclick=()=>entry('csv');$('use-api').onclick=()=>entry('api');
function selection(){const t=tables.find(t=>t.id===$('table').value);if(!t)return;$('selection').classList.remove('hidden');$('selection').textContent=`${t.name} · ${[...document.querySelectorAll('[name=fields]:checked')].map(f=>t.fields.find(x=>x.id===f.value)?.name).join('、')}${$('view').value?tr(' · 仅当前视图'):''}`;}
function fields(){const t=tables.find(t=>t.id===$('table').value);if(!t)return;if(account&&$('view').tagName==='SELECT'){const previous=$('view').value;$('view').innerHTML=tr('<option value="">整张表</option>')+(t.views??[]).map(v=>'<option value="'+esc(v.id)+'">'+esc(v.name)+'</option>').join('');if((t.views??[]).some(v=>v.id===previous))$('view').value=previous;}$('fields').innerHTML=tr('<legend>附件列</legend>')+t.fields.filter(f=>f.type==='multipleAttachments').map(f=>`<label class="check"><input type="checkbox" name="fields" value="${esc(f.id)}" checked>${esc(f.name)}</label>`).join('');$('label').innerHTML=tr('<option value="">只用记录编号</option>')+t.fields.filter(f=>f.type!=='multipleAttachments').map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');if([...$('label').options].some(o=>o.value===t.primaryFieldId))$('label').value=t.primaryFieldId;selection();}
function setTables(list,selected){tables=list;$('table').innerHTML=list.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');if(list.some(t=>t.id===selected))$('table').value=selected;$('scope').classList.remove('hidden');fields();}
async function saved(){const previous=$('saved').value;const r=await api('/api/saved-jobs');$('saved').innerHTML=r.jobs.length?r.jobs.map(j=>msg`<option value="${esc(j.id)}">${esc(j.tableName||tr('资料整理'))} · ${j.success}/${j.total}个 · ${esc(j.groups?.join(' → ')||tr('按记录'))} · ${new Date(j.createdAt).toLocaleString(getLanguage())}</option>`).join(''):tr('<option value="">暂无任务</option>');if([...$('saved').options].some(o=>o.value===previous))$('saved').value=previous;}
function setupJob(){
  $('preset-note').textContent=tr('默认保留原文件名。缺少货号或客户列时，可以展开自定义设置，选择你自己的列。');const f=job.recordData?.fields.filter(f=>f.type!=='multipleAttachments')??[],o=job.organization??{};
  const options=f.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  $('filter-field').innerHTML=tr('<option value="">不加条件</option>')+options;$('filter-value').value='';
  $('group1').innerHTML=options;$('group2').innerHTML=options;$('rename').innerHTML=tr('<option value="">保留原文件名</option>')+f.map(x=>msg`<option value="${esc(x.id)}">按“${esc(x.name)}”命名并加序号</option>`).join('');
  const sku=f.find(x=>/sku|货号|商品编号/i.test(x.name))?.id||f[0]?.id||'',customer=f.find(x=>/客户|用户|customer|client|user/i.test(x.name))?.id||f.find(x=>x.id!==sku)?.id||sku;
  $('layout').value=o.groupBy?.length===2?'two':o.groupBy?.length===1?'one':'record';$('group1').value=o.groupBy?.[0]||sku;$('group2').value=o.groupBy?.[1]||customer;$('rename').value=o.renameField||'';$('keep-record').checked=!!o.keepRecordFolder;$('separate-fields').checked=o.separateFields!==false;$('layout').disabled=!f.length;
  allRecords=job.recordData?.records??[];allRows=job.rows;galleryKey='';galleryLimit=24;selectedIds=new Set(allRecords.map(r=>r.id));$('record-search').value='';recordList();organizerVisibility();render();setStep(2);
  for(const b of document.querySelectorAll('[data-preset]'))b.disabled=!presetOrganization(b.dataset.preset,f);
  $('remember-layout').checked=!!readPreference();
}
function organizerVisibility(){const two=$('layout').value==='two',grouped=$('layout').value!=='record';$('group1-label').classList.toggle('hidden',!grouped);$('group2-label').classList.toggle('hidden',!two);$('keep-record-label').classList.toggle('hidden',!grouped);}
function organization(){return {groupBy:$('layout').value==='record'?[]:$('layout').value==='two'?[$('group1').value,$('group2').value]:[$('group1').value],renameField:$('rename').value,keepRecordFolder:$('keep-record').checked,separateFields:$('separate-fields').checked};}
async function organize(includeSelection=false){if(!job)return;const body={organization:organization()};if(includeSelection)body.recordIds=[...selectedIds];working=true;render();try{job=await api(`/api/jobs/${job.id}/organize`,body);writePreference();if(includeSelection)$('record-count').textContent=msg`当前已使用 ${selectedIds.size}/${allRecords.length} 条记录。`;}finally{working=false;render();}}
for(const b of document.querySelectorAll('[data-preset]'))b.onclick=guard(async()=>{const o=presetOrganization(b.dataset.preset,job.recordData?.fields??[]);if(!o)throw new Error(tr('原表没有对应列，请展开自定义设置选择。'));applyOrganization(o);await organize();$('preset-note').textContent=b.dataset.preset==='customer'?tr('客户相同的记录合并；有货号列时，再按货号分一层。'):b.dataset.preset==='product'?tr('同一货号的多条记录会合并，原名和所属记录仍保留在清单中。'):tr('保持原表记录之间的区分，每条记录单独一个文件夹。');});
function matchingRecords(){const q=$('record-search').value.trim().toLowerCase();return allRecords.filter(r=>(!q||Object.values(r.display).join(' ').toLowerCase().includes(q)||r.id.toLowerCase().includes(q))&&matchesCondition(r,{field:$('filter-field').value,operator:$('filter-op').value,value:$('filter-value').value}));}
function recordList(){const records=matchingRecords();$('record-list').innerHTML=records.slice(0,50).map(r=>`<label class="check"><input type="checkbox" name="record" value="${esc(r.id)}" ${selectedIds.has(r.id)?'checked':''}><span>${esc(Object.values(r.display).filter(Boolean).slice(0,4).join(' · ')||r.id)}<small>${esc(r.id)}</small></span></label>`).join('');$('record-count').textContent=msg`已选 ${selectedIds.size}/${allRecords.length} 条；搜索到 ${records.length} 条${records.length>50?tr('，显示前50条；批量选择适用于全部搜索结果'):''}。`;for(const input of document.querySelectorAll('[name=record]'))input.onchange=()=>{if(input.checked)selectedIds.add(input.value);else selectedIds.delete(input.value);$('record-count').textContent=msg`已选 ${selectedIds.size}/${allRecords.length} 条，点击“使用选中的记录”生效。`;galleryKey='';renderGallery();};}
$('record-search').oninput=recordList;for(const id of ['filter-field','filter-op','filter-value'])$(id).oninput=recordList;$('select-matching').onclick=guard(async()=>{const records=matchingRecords();if(!records.length)throw new Error(tr('没有符合条件的记录，请调整搜索或条件。'));selectedIds=new Set(records.map(r=>r.id));await organize(true);recordList();toast(tr('已只保留搜索和筛选结果。'));});$('unselect-matching').onclick=()=>{matchingRecords().forEach(r=>selectedIds.delete(r.id));recordList();};$('select-all').onclick=()=>{selectedIds=new Set(allRecords.map(r=>r.id));recordList();};$('apply-selection').onclick=guard(async()=>{await organize(true);toast(tr('已按选中的记录更新资料范围。'));});
for(const id of ['layout','group1','group2','rename','keep-record','separate-fields'])$(id).onchange=guard(async()=>{if(id==='layout'&&$('layout').value==='two'){const f=job.recordData?.fields??[],customer=f.find(x=>/客户|用户|customer|client|user/i.test(x.name)),sku=f.find(x=>/sku|货号|商品编号/i.test(x.name));if(customer)$('group1').value=customer.id;if(sku)$('group2').value=sku.id;}organizerVisibility();await organize();});
function render(){if(!job)return;updateHeading();renderGallery();$('job-source').classList.remove('hidden');$('job-source').textContent=job.sourceMode==='demo'?tr('当前为生成的商品示例，不是你的真实资料。'):msg`当前资料：${job.recordData?.table?.name||tr('已保存结果')}${job.sourceMode==='csv'?tr(' · CSV导入'):''}`;$('empty').classList.add('hidden');$('result').classList.remove('hidden');$('total').textContent=job.total;$('success').textContent=job.success;$('pending').textContent=job.pending+job.copying;$('issues').textContent=job.failed+job.rejected;$('selected-count').textContent=msg`${job.records}条记录 · ${job.total}个附件`;
  const labels={ready:tr('可以开始'),running:tr('正在准备资料'),restoring:tr('正在恢复'),sampled:tr('还有文件待处理'),completed:tr('资料已准备好'),completed_with_errors:tr('处理结束，请留意说明'),paused:tr('已暂停'),error:tr('任务中断')};$('state').textContent=labels[job.state]||job.state;$('progress').textContent=msg`${job.success}个已核对，${job.pending+job.copying}个待处理，${job.failed}个失败，${job.rejected}个未加入。`;
  const pct=job.total?Math.round((job.success+job.failed+job.rejected)/job.total*100):0;$('fill').style.width=pct+'%';document.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(pct));$('size').textContent=tr('附件合计 ')+size(job.copiedBytes||job.plannedBytes)+(job.rows.some(r=>r.metadataUnknown)?tr('（部分大小待核对）'):'');
  $('destination-note').textContent=account?tr('资料保存在你的账号中。图片和资料包下载地址需要登录；下载后的 ZIP 可离线使用。'):job.imported?tr('重新取得之前的公开副本，按新的整理方式打包。'):job.destinationMode==='r2'?tr('目标：你自己的R2。公开地址依赖继续保留文件和域名。'):tr('下载到这台电脑，不需要R2；清单中的本机地址不能当长期公开地址。');
  const a=job.archive?.locale&&job.archive.locale!==getLanguage()&&job.archive.state==='ready'?null:job.archive,packing=a&&['preparing','packing'].includes(a.state),locked=working||job.busy||packing;$('download-all').disabled=locked||!job.total;$('review-download').disabled=locked||!job.total;$('new-export').disabled=locked;$('refresh-csv').disabled=locked;$('clear').disabled=locked;$('retry').disabled=locked;$('verify').disabled=locked||!job.success;$('restore').disabled=locked;$('rescan').disabled=locked;$('demo').disabled=locked;$('connect').disabled=locked;$('source-csv').disabled=locked;$('organize-controls').disabled=locked;for(const el of $('record-picker').querySelectorAll('input,button,select'))el.disabled=locked;
  $('retry').classList.toggle('hidden',!job.failed||job.imported);$('pause').classList.toggle('hidden',!job.busy);$('verify').classList.toggle('hidden',!!job.imported);$('download-partial').classList.toggle('hidden',!job.success||!(job.failed||job.pending));$('download-partial').disabled=locked;$('download-all').textContent=job.busy?tr('正在准备资料…'):packing?tr('正在打包资料…'):job.state==='paused'&&job.pending?tr('继续准备并下载 ZIP'):job.failed?tr('重试失败文件并下载完整包'):tr('一键下载整理好的资料 ZIP');$('archive-status').textContent=a?.state==='ready'?msg`已打包 ${a.total} 个文件，ZIP ${size(a.zipBytes)}。${a.partial?msg`另有 ${a.missing} 个未下载，详见包内“未下载文件清单.csv”。这是部分资料包。`:tr('全部文件均已核对；含原表记录和离线目录。')}`:a?.state==='failed'?tr(a.error):packing?msg`正在${a.state==='packing'?tr('打包'):tr('核对文件')}：${a.prepared}/${a.total}个，请保持程序运行。`:tr('点击一次，自动准备、核对并打包。未加入项会写进清单。');
  $('zip').textContent=a?.partial?tr('重新下载部分资料包'):tr('重新下载资料包');$('fill').classList.toggle('has-issues',!!(job.failed||job.rejected));$('archive-status').classList.toggle('notice',!!a?.partial);if(a?.partial)$('state').textContent=tr('资料未齐 · 已生成部分包');
  $('zip').classList.toggle('hidden',a?.state!=='ready');$('zip').href=localizedURL(`/api/jobs/${job.id}/archive`);$('catalog').classList.toggle('hidden',a?.state!=='ready');$('catalog').href=localizedURL(`/api/jobs/${job.id}/catalog`);$('csv').href=localizedURL(`/api/jobs/${job.id}/export?format=csv`);$('records-csv').href=localizedURL(`/api/jobs/${job.id}/export?format=records`);$('records-csv').classList.toggle('hidden',!job.recordData);$('json').href=localizedURL(`/api/jobs/${job.id}/export?format=json`);
  const localizedLayout=layoutOverview(job.rows,job.organization,job.recordData,getLanguage());$('folder-preview').textContent=localizedLayout.paths?.join('\n')||tr('当前范围没有可下载附件。');$('warnings').textContent=(job.warnings??[]).join('\n');$('organization-note').textContent=job.recordData?tr('相同分组值归到同一个文件夹；空值放“未填写”，多值使用组合名称。重名加编号，所属记录仍在清单中。'):tr('旧结果没有原表业务列，不能凭空按货号或客户分组。重新读取原表后可用。');
  const overview=localizedLayout;if(overview)$('folder-overview').innerHTML=msg`<div class="folder-summary">预计 ${overview.files} 个文件，分成 ${overview.groups} 组${overview.groups>6?tr('；以下显示前 6 组'):''}</div>`+overview.preview.map(g=>msg`<div class="folder-group"><span>▸ ${esc(g.name)}</span><small>${g.files} 个文件</small></div>`).join('');
  const notices=[...(job.warnings??[])].filter(message=>!message.startsWith('整张表超过单批')||job.plannedBytes>10*1024**3);if(overview?.emptyRecords)notices.push(msg`${overview.emptyRecords} 条记录的分组列未填写，会放入“未填写”文件夹，请确认是否符合预期。`);if(job.rejected)notices.push(msg`${job.rejected} 个附件超出支持范围，不会加入资料包。单文件上限约 20.97MB；请在下载页查看具体原因。`);$('warnings').textContent=notices.map(tr).join('\n');$('warnings').classList.toggle('hidden',!notices.length);
  for(const b of document.querySelectorAll('[data-preset]')){const o=presetOrganization(b.dataset.preset,job.recordData?.fields??[]);b.disabled=locked||!o;b.setAttribute('aria-pressed',String(!!o&&JSON.stringify(o)===JSON.stringify({groupBy:[],renameField:'',keepRecordFolder:false,separateFields:true,...job.organization})));}
  const names={success:tr('已核对'),pending:tr('等待处理'),copying:tr('处理中'),failed:tr('失败'),rejected:tr('未加入')};$('rows').innerHTML=job.rows.slice(0,100).map(r=>`<tr><td>${esc(r.filename)}<small>${r.metadataUnknown?tr('大小待核对'):size(r.declaredBytes)}</small></td><td>${esc(r.label)}<small>${esc(r.recordId)}</small></td><td class="${esc(r.status)}">${names[r.status]}${r.error?`<small>${esc(tr(r.error))}</small>`:''}${r.status==='success'&&r.url?msg`<small><a href="${esc(r.url)}" target="_blank" rel="noreferrer">打开文件 ↗</a></small>`:''}</td></tr>`).join('');$('table-count').textContent=job.total>100?tr('显示前100个；下载包和清单包含全部结果。'):msg`共${job.total}个附件。`;
}
async function poll(){while(job?.busy||['preparing','packing'].includes(job?.archive?.state)){await new Promise(r=>setTimeout(r,900));job=await api(`/api/jobs/${job.id}`);render();}}
async function prepareArchive(allowPartial){
  // A language change during packing takes effect after the active ZIP finishes.
  // Never offer a previously generated ZIP in the wrong language.
  while(job.archive?.state!=='ready'||job.archive.locale!==getLanguage()){
    job=await api(`/api/jobs/${job.id}/archive`,{allowPartial});render();await poll();
    if(job.archive?.state==='failed')throw new Error(tr(job.archive.error));
  }
}
async function scan(){job=demo?await api('/api/demo',{count:30,edgeCases:false,visual:true,destination:$('want-r2').checked?'r2':'local'}):await api('/api/scan',{tableId:$('table').value,fields:[...document.querySelectorAll('[name=fields]:checked')].map(f=>f.value),labelField:$('label').value,viewId:csvMode?null:$('view').value.trim()||null,destination:$('want-r2').checked?'r2':'local',confirmPublic:$('public-confirm').checked});setupJob();const defaultOrg=presetOrganization('product',job.recordData?.fields??[])||presetOrganization('record',job.recordData?.fields??[]);applyOrganization(defaultOrg);await organize();const remembered=readPreference();if(remembered){const o=recallOrganization(remembered,job.recordData?.fields??[]);if(o){applyOrganization(o);await organize();toast(tr('已使用上次的整理方式，请核对文件夹预览。'));}else{$('preset-note').textContent=tr('这份表格的列名与上次不同，未套用旧设置。请选择整理方式。');}}selection();await saved();}
$('source-form').onsubmit=guard(async()=>{$('connect').disabled=true;try{const data=await api('/api/connect-airtable',{sourceUrl:$('source-url').value.trim(),token:$('token').value.trim()});$('token').value='';demo=false;csvMode=false;$('view-label').classList.remove('hidden');$('view').value=data.viewId||'';setTables(data.tables,data.tableId);$('source-status').textContent=tr('已选择附件列，并保留原表全部列。可先预览文件夹，再下载。');await scan();}finally{$('connect').disabled=false;}});
$('source-csv').onchange=guard(async()=>{const file=$('source-csv').files[0];if(!file)return;if(file.size>32*1024*1024)throw new Error(tr('CSV超过32MB，请缩小范围。'));$('source-status').textContent=tr('正在读取CSV…');const data=await api('/api/connect-csv',{text:await file.text()});demo=false;csvMode=true;$('want-r2').checked=false;$('r2-form').classList.add('hidden');$('view').value='';$('view-label').classList.add('hidden');setTables(data.tables,data.tableId);await scan();$('source-status').textContent=tr('CSV已读入，不需要访问凭证。请选择整理方式后下载。');});
$('demo').onclick=guard(async()=>{demo=true;csvMode=false;$('want-r2').checked=false;$('r2-form').classList.add('hidden');await scan();toast(tr('示例包含同货号的多条记录，可试按货号或客户分文件夹。'));});$('table').onchange=fields;$('rescan').onclick=guard(async()=>{const button=$('rescan');button.disabled=true;button.textContent=tr('正在读取记录…');try{await scan();}finally{button.disabled=false;button.textContent=account?tr('预览这张表'):tr('重新读取表格范围');}});$('cloud').hidden=true;
$('want-r2').onchange=()=>{$('r2-form').classList.toggle('hidden',!$('want-r2').checked);if(job)toast(tr('更换目标后点击重新读取表格范围。'));};
$('r2-form').onsubmit=guard(async()=>{const data=await api('/api/connect-r2',{accountId:$('account-id').value.trim(),bucket:$('bucket').value.trim(),accessKeyId:$('r2-key').value.trim(),secretAccessKey:$('r2-secret').value.trim(),publicBase:$('public-base').value.trim()});$('r2-key').value='';$('r2-secret').value='';settings.r2=data;$('r2-status').textContent=tr('已连接 ')+data.bucket;await saved();toast(tr('仓库已连接，重新读取范围后使用。'));});
$('download-all').onclick=guard(async()=>{setStep(3);working=true;render();try{if(job.pending){job=await api(`/api/jobs/${job.id}/all`,{});render();await poll();}if(job.failed&&!job.imported){job=await api(`/api/jobs/${job.id}/retry`,{});render();await poll();}if(job.failed)throw new Error(tr('仍有文件无法读取，可先下载成功文件；缺失原因会放进清单。'));if(job.pending||job.copying)throw new Error(tr('任务已暂停，可继续准备资料。'));await prepareArchive(false);if(job.archive?.state!=='ready'||job.archive?.locale!==getLanguage())throw new Error(job.archive?.error||tr('资料包未就绪。'));$('zip').click();toast(tr('资料包开始下载。完整解压后打开照片目录或Excel目录即可。'));}finally{working=false;render();}});
$('retry').onclick=guard(async()=>{job=await api(`/api/jobs/${job.id}/retry`,{});render();await poll();toast(job.failed?tr('仍有失败项，请查看说明。'):tr('重试完成，可以下载资料包。'));});$('pause').onclick=guard(async()=>{await api(`/api/jobs/${job.id}/pause`,{});toast(tr('完成正在处理的文件后暂停。'));});$('verify').onclick=guard(async()=>{job=await api(`/api/jobs/${job.id}/verify`,{});render();toast(tr('副本核对完成。'));});$('clear').onclick=guard(async()=>{await api('/api/clear',{});location.reload();});
$('download-partial').onclick=guard(async()=>{setStep(3);working=true;render();try{await prepareArchive(true);if(job.archive?.state!=='ready'||job.archive?.locale!==getLanguage())throw new Error(job.archive?.error||tr('资料包未准备好。'));$('zip').click();toast(msg`已下载 ${job.archive.total} 个成功文件；另有 ${job.archive.missing} 个未下载，清单已放入 ZIP。`);}finally{working=false;render();}});
$('restore').onclick=guard(async()=>{if(!$('saved').value)throw new Error(tr('请先连接原表或导入同一份CSV；云端任务还需连接原仓库。'));job=await api('/api/restore',{id:$('saved').value,confirmPublic:$('public-confirm').checked});await poll();setupJob();$('restore-note').textContent=tr('已恢复，成功文件保持原地址。');});
$('import').onchange=guard(async()=>{const file=$('import').files[0];if(!file)return;if(file.size>32*1024*1024)throw new Error(tr('结果文件超过32MB。'));job=await api('/api/import-result',{result:JSON.parse(await file.text())});setupJob();toast(tr('已打开结果，可按保存的信息重新整理打包。'));});

function updateHeading(){
  const name=job?.recordData?.table?.name||tr('已保存资料');
  $('workspace-title').textContent=step===1?tr('从你的表格开始。'):step===2?name:job?.archive?.state==='ready'?(job.archive.partial?tr('资料未齐，成功文件已打包。'):tr('这一批，已经整理完成。')):job?.busy?tr('正在准备你的资料。'):job?.failed?tr('还有文件需要处理。'):job?.state==='paused'?tr('已暂停，随时可以继续。'):tr('准备好，把资料带走。');
  $('breadcrumb-title').textContent=step===1?tr('新建导出'):name;
  $('workspace-subtitle').textContent=step===1?tr('照片、文件夹和带图表格，一次带走。'):(job?job.records+tr(' 条记录 · ')+job.total+tr(' 个附件 · ')+(job.sourceMode==='demo'?tr('程序生成示例'):job.sourceMode==='csv'?tr('CSV 导入'):tr('已读取的原表资料')):'');
  $('refresh-source').classList.toggle('hidden',job?.sourceMode!=='csv'||!(job.failed||job.pending));
  $('job-source').classList.toggle('hidden',step===1||!job);
}
function galleryGroups(){return groupFiles(allRows,allRecords,job?.organization,getLanguage());}
function renderGallery(){
  if(!job)return;
  const q=$('folder-search').value.trim().toLowerCase();
  const key=JSON.stringify([getLanguage(),job.id,job.organization,[...selectedIds],q,galleryLimit,job.busy,working]);
  if(key===galleryKey)return;galleryKey=key;
  const groups=galleryGroups(),filtered=groups.filter(g=>g.name.toLowerCase().includes(q)).sort((a,b)=>Number(b.recordIds.some(id=>selectedIds.has(id)))-Number(a.recordIds.some(id=>selectedIds.has(id))));
  const locked=working||job.busy||['preparing','packing'].includes(job.archive?.state);
  $('gallery-count').textContent=groups.length;
  $('gallery-note').textContent=tr('图片取自这份资料；无法预览的文件仍会在下载时核对。预览图不替代原文件。');
  $('asset-grid').innerHTML=filtered.slice(0,galleryLimit).map(g=>{
    const index=groups.indexOf(g),selected=g.recordIds.every(id=>selectedIds.has(id)),partial=!selected&&g.recordIds.some(id=>selectedIds.has(id));
    const image=g.rows.find(r=>r.type?.startsWith('image/')&&r.status!=='rejected');
    return '<article class="asset-card '+(selected||partial?'selected':'')+'"><div class="asset-cover"><div class="file-placeholder"><b>▧</b><span>'+esc(g.rows[0].filename)+'</span></div>'+(image?'<img class="real-image" loading="lazy" src="'+previewURL(job.id,image)+'" alt="'+esc(g.name)+tr(' 的文件预览">'):'')+'<label class="asset-select"><input type="checkbox" data-folder="'+index+'" '+(selected?'checked':'')+' '+(locked?'disabled':'')+tr(' aria-label="选择 ')+esc(g.name)+'"></label><span class="asset-count">'+g.rows.length+tr(' 个附件</span></div><div class="asset-info"><div><h3>')+esc(g.name)+'</h3><p>'+g.recordIds.length+tr(' 条记录 · ')+(partial?tr('部分已选择'):selected?tr('已选择'):tr('未选择'))+'</p></div><button data-folder-preview="'+index+tr('" aria-label="查看 ')+esc(g.name)+tr(' 的文件">查看 ↗</button></div></article>');
  }).join('')||tr('<div class="empty-search">没有找到对应文件夹。请调整搜索；无附件记录仍保留在原表 CSV 中。</div>');
  document.querySelectorAll('.real-image').forEach(img=>img.onerror=()=>{img.hidden=true;});
  document.querySelectorAll('[data-folder]').forEach(input=>{const g=groups[Number(input.dataset.folder)];input.indeterminate=g.recordIds.some(id=>selectedIds.has(id))&&!g.recordIds.every(id=>selectedIds.has(id));input.onchange=guard(async()=>{
    const before=new Set(selectedIds);g.recordIds.forEach(id=>input.checked?selectedIds.add(id):selectedIds.delete(id));
    if(!selectedIds.size){selectedIds=before;galleryKey='';renderGallery();throw new Error(tr('请至少保留一条记录。'));}
    try{await organize(true);recordList();}catch(e){selectedIds=before;galleryKey='';renderGallery();throw e;}
  });});
  document.querySelectorAll('[data-folder-preview]').forEach(b=>b.onclick=()=>showFolder(groups[Number(b.dataset.folderPreview)]));
  $('gallery-summary').textContent=tr('已选 ')+selectedIds.size+' / '+allRecords.length+tr(' 条记录；当前显示 ')+Math.min(galleryLimit,filtered.length)+' / '+filtered.length+tr(' 个文件夹');
  $('gallery-more').classList.toggle('hidden',filtered.length<=galleryLimit);$('gallery-all').disabled=locked;
}
function showFolder(g){
  const d=document.createElement('dialog');d.className='live-dialog';const image=g.rows.find(r=>r.type?.startsWith('image/')&&r.status!=='rejected');
  d.innerHTML='<header><h2>'+esc(g.name)+tr('</h2><button class="text-btn" autofocus>关闭 ✕</button></header><div class="dialog-content">')+(image?'<img src="'+previewURL(job.id,image)+'" alt="'+esc(image.filename)+'">':'')+'<p>'+g.rows.length+tr(' 个附件，来自 ')+g.recordIds.length+tr(' 条记录。文件名相同时自动加序号，原名与所属记录仍完整记录在清单中。</p><ul>')+g.rows.slice(0,100).map(r=>'<li>'+esc(r.filename)+' · '+esc(r.label)+' <small>('+esc(r.recordId)+')</small></li>').join('')+'</ul>'+(g.rows.length>100?tr('<p>仅显示前 100 个；下载清单包含全部文件。</p>'):'')+'</div>';
  document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.onclose=()=>d.remove();d.querySelector('img')?.addEventListener('error',e=>{e.target.hidden=true;});d.showModal();
}
$('folder-search').oninput=renderGallery;
$('gallery-more').onclick=()=>{galleryLimit+=24;renderGallery();};
$('gallery-all').onclick=guard(async()=>{selectedIds=new Set(allRecords.map(r=>r.id));await organize(true);recordList();});
$('review-download').onclick=()=>{setStep(3);$('download-all').click();};
$('refresh-csv').onchange=guard(async()=>{const file=$('refresh-csv').files[0];if(!file)return;if(file.size>32*1024*1024)throw new Error(tr('CSV 超过 32MB。'));const data=await api('/api/connect-csv',{text:await file.text()});if(!data.refreshedJobs.includes(job.id))throw new Error(tr('这份 CSV 的列或记录与原任务不同。请导出相同视图、保持原行顺序，再更新链接。'));$('refresh-csv').value='';updateFilePickers();galleryKey='';toast(tr('图片链接已更新。点击“重试失败文件”即可接着下载，成功文件保留。'));render();});
const drop=document.querySelector('.file-drop');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');if(e.dataTransfer.files.length===1){$('source-csv').files=e.dataTransfer.files;$('source-csv').dispatchEvent(new Event('change'));}else toast(tr('请一次导入一份 CSV。'),true);});

guard(async()=>{await connectAccountUI({account,api,guard,setTables,toast,startSource:()=>{demo=false;csvMode=false;$('view').value='';$('view-label').classList.remove('hidden');}});settings=await api('/api/status');csvMode=!!settings.csvConnected;if(settings.sourceConnected||csvMode)setTables(settings.tables);if(settings.r2)$('r2-status').textContent=tr('已连接 ')+settings.r2.bucket;await saved();let active;try{active=JSON.parse(sessionStorage.getItem(activeKey));}catch{}const params=new URLSearchParams(location.search);if(params.has('demo')){await $('demo').onclick();history.replaceState(null,'','/app');return;}if(params.has('new')){history.replaceState(null,'','/app');return;}if(active?.id){try{job=await api(`/api/jobs/${active.id}`);setupJob();setStep(Number(active.step)||2,false);if(job.busy||['preparing','packing'].includes(job.archive?.state))await poll();}catch{sessionStorage.removeItem(activeKey);toast(tr('服务已重新启动，可在“继续上次任务”中恢复。'));}}})();

document.addEventListener('photoport:language',()=>{
  // Repaint labels in place, without resetting inputs, selected records or jobs.
  galleryKey='';
  for(const id of ['source-status','preset-note','restore-note','toast']){
    const element=$(id);element.textContent=tr(element.textContent);
  }
  const label=$('label').querySelector('option[value=""]');if(label)label.textContent=tr('只用记录编号');
  const legend=$('fields').querySelector('legend');if(legend)legend.textContent=tr('附件列');
  const filter=$('filter-field').querySelector('option[value=""]');if(filter)filter.textContent=tr('不加条件');
  const renameValue=$('rename').value;
  const renameFields=job?.recordData?.fields.filter(f=>f.type!=='multipleAttachments')??[];
  $('rename').innerHTML='<option value="">'+tr('保留原文件名')+'</option>'+renameFields.map(f=>'<option value="'+esc(f.id)+'">'+esc(msg(['按“','”命名并加序号'],f.name))+'</option>').join('');
  $('rename').value=renameValue;
  for(const dialog of document.querySelectorAll('dialog'))dialog.close();
  if(job){recordList();render();}else updateHeading();
  selection();saved().catch(error=>toast(tr(error.message),true));
});
