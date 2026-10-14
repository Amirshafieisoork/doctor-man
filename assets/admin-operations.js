let operations = null, operationsLoading = null, currentUserAction = null, currentOperation = null, currentLicense = null;
const operationNames = {task:'پیگیری',order:'درخواست تشخیصی',episode:'موضوع سلامت',care_plan:'برنامه سلامت'};
const statusNames = {open:'باز',done:'تکمیل‌شده',dismissed:'لغوشده',ordered:'ثبت‌شده',scheduled:'برنامه‌ریزی‌شده',in_progress:'در حال انجام',completed:'تکمیل‌شده',cancelled:'لغوشده',monitoring:'در حال پیگیری',resolved:'حل‌شده',archived:'بایگانی‌شده',active:'فعال',superseded:'جایگزین‌شده',routine:'عادی',soon:'به‌زودی',urgent:'فوری'};
function adminModal(id, title, content) {
  let modal = $(id);
  if (!modal) { modal=document.createElement('div');modal.id=id;modal.className='modal';document.body.append(modal); }
  modal.innerHTML=`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="${id}Title"><div class="title"><h2 id="${id}Title">${esc(title)}</h2><button type="button" onclick="closeModal('${id}')" aria-label="بستن">×</button></div>${content}</div>`;
  modal.classList.add('open');
  modal.querySelector('input:not([type="hidden"]),textarea,select,button')?.focus();
  return modal;
}
function feedback(id,message,bad=true){const node=$(id);if(node){node.textContent=message;node.className=bad?'danger':'success';node.setAttribute('role',bad?'alert':'status')}}

function openUserPlanModal(userId, select) {
  const user=(D.users||[]).find(item=>item.id===userId);if(!user)return;
  const planId=select?.value||user.plan_id||'';
  if(select)select.value=user.plan_id||'';
  currentUserAction={userId,planId};
  adminModal('userPlanModal','تغییر پلن کاربر',`<p>${esc(user.name||user.phone)} · ${esc(user.phone)}</p><form id="userPlanForm"><div class="form"><label class="full">پلن جدید<select id="userPlanChoice" aria-label="پلن جدید" required>${(D.plans||[]).filter(plan=>plan.active).map(plan=>`<option value="${esc(plan.id)}" ${plan.id===planId?'selected':''}>${esc(plan.name)} · ${money(plan.price)}</option>`).join('')}</select></label><label class="full">دلیل تغییر پلن<textarea id="userPlanReason" maxlength="500" required placeholder="مثلاً: تست یا جبران"></textarea></label><p class="full muted">دلیل در گزارش مدیریت ثبت می‌شود. هر دلیل غیرخالی پذیرفته می‌شود.</p><div id="userPlanFeedback" class="full" role="alert"></div><button id="userPlanSave" class="primary full" type="submit">ثبت تغییر پلن</button></div></form>`);
  $('userPlanForm').addEventListener('submit',saveUserPlan);
}
async function saveUserPlan(event){
  event.preventDefault();const reason=$('userPlanReason').value.trim();if(!reason){feedback('userPlanFeedback','دلیل تغییر پلن لازم است');return}
  const button=$('userPlanSave');button.disabled=true;
  try{await jf('/api/admin-action',{method:'POST',body:JSON.stringify({action:'set-plan',id:currentUserAction.userId,plan_id:$('userPlanChoice').value,reason})});closeModal('userPlanModal');toast('پلن کاربر تغییر کرد');await load()}
  catch(error){feedback('userPlanFeedback',error.message)}finally{button.disabled=false}
}

async function deleteUserAccount(userId){
  const user=(D.users||[]).find(item=>item.id===userId);if(!user)return;
  currentUserAction={userId};
  adminModal('deleteUserModal','حذف حساب و آزاد کردن شماره',`<p><b>${esc(user.name||'کاربر')}</b> · <span dir="ltr">${esc(user.phone)}</span></p><p class="warning">فایل‌ها و داده‌های پزشکی این حساب پاک می‌شوند. سوابق مالی ضروری با حساب ناشناس باقی می‌مانند. کاربر می‌تواند با همین شماره دوباره ثبت‌نام کند؛ نشست‌های حساب قبلی به حساب جدید دسترسی ندارند.</p><form id="deleteUserForm"><div class="form"><label class="full">دلیل حذف<textarea id="deleteUserReason" maxlength="500" required></textarea></label><label class="full">شماره موبایل حساب را برای تأیید وارد کنید<input id="deleteUserPhone" autocomplete="off" dir="ltr" required></label><div id="deleteUserFeedback" class="full" role="alert"></div><button id="deleteUserSubmit" type="submit" class="danger full">حذف دائمی همین حساب</button></div></form>`);
  $('deleteUserForm').addEventListener('submit',async event=>{
    event.preventDefault();const reason=$('deleteUserReason').value.trim(),confirmPhone=$('deleteUserPhone').value.trim();
    if(!reason||confirmPhone!==user.phone){feedback('deleteUserFeedback','دلیل و شماره موبایل دقیق همین حساب لازم است');return}
    const button=$('deleteUserSubmit');button.disabled=true;
    try{await jf('/api/admin-action',{method:'POST',body:JSON.stringify({action:'delete-user',id:userId,reason,confirm_phone:confirmPhone})});closeModal('deleteUserModal');toast('حساب حذف شد؛ شماره برای ثبت‌نام دوباره آزاد است');await load()}
    catch(error){feedback('deleteUserFeedback',error.message+' اگر پاک‌سازی متوقف شده، درخواست «در حال پردازش» را در بخش حذف و حریم خصوصی دوباره پردازش کنید.')}finally{button.disabled=false}
  });
}

async function issuePasswordReset(userId){
  const user=(D.users||[]).find(item=>item.id===userId);if(!user)return;
  adminModal('resetUserModal','بازیابی رمز کاربر',`<p>${esc(user.name||user.phone)} · ${esc(user.phone)}</p><p class="muted">پس از تأیید هویت کاربر، لینک یک‌بارمصرف را به خود او بدهید. با صدور لینک جدید، لینک قبلی باطل می‌شود؛ پس از تغییر رمز، نشست‌های قبلی کاربر باطل می‌شوند.</p><button id="createResetLink" class="primary" type="button">صدور لینک بازیابی</button><div id="resetUserFeedback" role="alert"></div><div id="resetUserResult"></div>`);
  $('createResetLink').addEventListener('click',async()=>{
    $('createResetLink').disabled=true;
    try{const data=await jf('/api/admin-password-reset',{method:'POST',body:JSON.stringify({user_id:userId})});const url=new URL(data.reset_url);if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1')throw Error('لینک بازیابی معتبر نیست');
      $('resetUserResult').innerHTML=`<p>اعتبار تا ${dt(data.expires_at)}</p><label>لینک یک‌بارمصرف<input id="resetUserLink" readonly dir="ltr" style="width:100%"></label><button id="copyResetLink" type="button">کپی لینک</button>`;$('resetUserLink').value=data.reset_url;
      $('copyResetLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(data.reset_url);feedback('resetUserFeedback','لینک کپی شد',false)}catch{$('resetUserLink').select();feedback('resetUserFeedback','لینک را از کادر انتخاب‌شده کپی کنید',false)}});
    }catch(error){feedback('resetUserFeedback',error.message)}finally{$('createResetLink').disabled=false}
  });
}
async function loadResetRequests(){
  $('resetRequestsBody').textContent='در حال دریافت…';
  try{const data=await jf('/api/admin-password-reset');$('resetRequestsBody').innerHTML=(data.requests||[]).map(request=>`<article class="body"><b>${esc(request.users?.name||request.users?.phone||'کاربر')}</b> · ${esc(request.users?.phone||'')} <small>${dt(request.requested_at)}</small> <button type="button" onclick="issuePasswordReset('${request.user_id}')">بازیابی پس از تأیید هویت</button></article>`).join('')||'<p>درخواست بازیابی در انتظار نیست.</p>'}
  catch(error){$('resetRequestsBody').textContent=error.message;$('resetRequestsBody').setAttribute('role','alert')}
}

async function openUserContact(userId){
  adminModal('userContactModal','یادداشت مدیریت و پیام کاربر','<p role="status">در حال دریافت…</p>');
  try{const data=await jf('/api/admin-user-contact?user_id='+encodeURIComponent(userId));
    adminModal('userContactModal','یادداشت مدیریت و پیام کاربر',`<p>${esc(data.user.name||data.user.phone)} · ${esc(data.user.phone)}</p><div class="grid2"><form id="userNoteForm"><h3>یادداشت خصوصی مدیریت</h3><label>برچسب‌ها (با ویرگول جدا کنید)<input id="userLabels" style="width:100%"></label><label>یادداشت داخلی<textarea id="userNote" style="width:100%"></textarea></label><label>دلیل ثبت<input id="userNoteReason" required style="width:100%"></label><button type="submit">ذخیره یادداشت</button></form><form id="userMessageForm"><h3>پیام به کاربر</h3><label>عنوان<input id="userMessageTitle" required maxlength="160" style="width:100%"></label><label>متن پیام<textarea id="userMessageText" required maxlength="3000" style="width:100%"></textarea></label><label>دلیل ارسال<input id="userMessageReason" required style="width:100%"></label><button type="submit" class="primary">ارسال به اعلان‌های کاربر</button></form></div><div id="userContactFeedback" role="alert"></div><h3>پیام‌های ارسال‌شده</h3><div id="userContactHistory"></div>`);
    $('userLabels').value=(data.labels||[]).join('، ');$('userNote').value=data.note||'';renderContactHistory(data.messages);
    $('userNoteForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await jf('/api/admin-user-contact',{method:'PUT',body:JSON.stringify({user_id:userId,labels:$('userLabels').value.split(/[,،]/),note:$('userNote').value,reason:$('userNoteReason').value})});feedback('userContactFeedback','یادداشت فقط برای مدیریت ذخیره شد',false)}catch(error){feedback('userContactFeedback',error.message)}finally{button.disabled=false}});
    $('userMessageForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await jf('/api/admin-user-contact',{method:'POST',body:JSON.stringify({user_id:userId,title:$('userMessageTitle').value,message:$('userMessageText').value,reason:$('userMessageReason').value})});$('userMessageText').value='';feedback('userContactFeedback','پیام در اعلان‌های پرونده سلامت کاربر ثبت شد',false);const refresh=await jf('/api/admin-user-contact?user_id='+encodeURIComponent(userId));renderContactHistory(refresh.messages)}catch(error){feedback('userContactFeedback',error.message)}finally{button.disabled=false}});
  }catch(error){$('userContactModal').querySelector('.dialog').innerHTML=`<h2>پیام کاربر</h2><p class="danger" role="alert">${esc(error.message)}</p><button onclick="closeModal('userContactModal')">بستن</button>`}
}
function renderContactHistory(messages){$('userContactHistory').innerHTML=(messages||[]).map(message=>`<article class="card body"><b>${esc(message.title)}</b><p style="white-space:pre-wrap">${esc(message.body)}</p><small>${dt(message.created_at)} · ${message.read_at?'خوانده‌شده':'خوانده‌نشده'}</small></article>`).join('')||'<p class="muted">پیامی ارسال نشده است.</p>'}

async function loadOperations(){
  if(operationsLoading)return operationsLoading;
  feedback('operationsFeedback','در حال دریافت جزئیات عملیات…',false);
  operationsLoading=(async()=>{try{operations=await jf('/api/admin-operations');renderAdminOperations();feedback('operationsFeedback','جزئیات عملیات به‌روز است',false)}catch(error){feedback('operationsFeedback',error.message)}finally{operationsLoading=null}})();
  return operationsLoading;
}
function renderAdminOperations(){
  const data=operations||D||{},patientId=$('operationsPatient')?.value||'';
  const filtered=list=>(list||[]).filter(item=>!patientId||item.patient_id===patientId);
  $('tasksBody').innerHTML=filtered(data.tasks).map(item=>`<tr><td>${esc(item.patients?.display_name||item.patient_id)}</td><td>${esc(item.title)}</td><td>${esc(item.type)}</td><td>${dt(item.due_at)}</td><td>${esc(statusNames[item.status]||item.status)}</td><td><button onclick="openOperation('task','${item.id}')">بررسی و ویرایش</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">پیگیری‌ای ثبت نشده است.</td></tr>';
  $('ordersBody').innerHTML=filtered(data.orders).map(item=>`<tr><td>${esc(item.patients?.display_name||item.patient_id)}</td><td>${esc(item.order_type)} · ${esc((item.items||[]).join('، '))}</td><td>${esc(statusNames[item.priority]||item.priority)}</td><td>${dt(item.ordered_at)}</td><td>${esc(statusNames[item.status]||item.status)}</td><td><button onclick="openOperation('order','${item.id}')">بررسی و ویرایش</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">درخواستی ثبت نشده است.</td></tr>';
  $('episodesBody').innerHTML=filtered(data.episodes).map(item=>`<tr><td>${esc(item.patients?.display_name||item.patient_id)}</td><td>${esc(item.title)}</td><td>${esc(statusNames[item.urgency]||item.urgency)}</td><td>${esc(statusNames[item.status]||item.status)}</td><td>${dt(item.updated_at)}</td><td><button onclick="openOperation('episode','${item.id}')">بررسی و ویرایش</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">موضوع سلامتی ثبت نشده است.</td></tr>';
  $('carePlansBody').innerHTML=filtered(data.care_plans).map(item=>`<tr><td>${esc(item.patients?.display_name||item.patient_id)}</td><td>${dt(item.generated_at)}</td><td>${dt(item.valid_until)}</td><td>${esc(statusNames[item.status]||item.status)}</td><td><button onclick="openOperation('care_plan','${item.id}')">مشاهده و وضعیت</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">برنامه‌ای ثبت نشده است.</td></tr>';
  $('testsBody').innerHTML=filtered(D.tests).map(item=>{const patient=(D.patients||[]).find(patient=>patient.id===item.patient_id),user=(D.users||[]).find(user=>user.id===item.user_id);return `<tr><td>${dt(item.created_at)}</td><td>${esc(patient?.display_name||user?.name||item.patient_id||'—')}</td><td>${esc(item.reason||'—')}</td><td>${esc(item.status||'—')}${item.status_reason?`<div class="danger">${esc(item.status_reason)}</div>`:''}</td><td><button onclick="openMedicalArchive('${item.user_id}','${item.patient_id||''}')">فایل‌های اصلی پرونده</button></td></tr>`}).join('')||'<tr><td colspan="5" class="empty">آزمایشی ثبت نشده است.</td></tr>';
}
function operationField(key,label,value,type='text',options=[]){if(type==='select')return `<label>${label}<select id="operation_${key}" aria-label="${esc(label)}">${options.map(option=>`<option value="${option}" ${value===option?'selected':''}>${esc(statusNames[option]||option)}</option>`).join('')}</select></label>`;if(type==='textarea')return `<label class="full">${label}<textarea id="operation_${key}" aria-label="${esc(label)}">${esc(value||'')}</textarea></label>`;return `<label>${label}<input id="operation_${key}" aria-label="${esc(label)}" type="${type}" value="${esc(value||'')}"></label>`}
async function openOperation(kind,id){
  if(!operations){await loadOperations();if(!operations)return}
  const list=({task:operations.tasks,order:operations.orders,episode:operations.episodes,care_plan:operations.care_plans})[kind];
  const item=(list||[]).find(item=>item.id===id);if(!item)return;
  currentOperation={kind,id};let fields=[];
  if(kind==='task')fields=[operationField('title','عنوان',item.title),operationField('due_at','موعد',item.due_at?new Date(Date.parse(item.due_at)-new Date(item.due_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'','datetime-local'),operationField('status','وضعیت',item.status,'select',['open','done','dismissed']),operationField('priority','اولویت',item.priority,'select',['routine','soon','urgent']),operationField('details','جزئیات',item.details,'textarea')];
  if(kind==='order')fields=[operationField('status','وضعیت',item.status,'select',['ordered','scheduled','in_progress','completed','cancelled']),operationField('priority','اولویت',item.priority,'select',['routine','urgent']),operationField('items','موارد درخواست (هر خط یک مورد)',(item.items||[]).join('\n'),'textarea'),operationField('clinical_note','یادداشت درخواست',item.clinical_note,'textarea')];
  if(kind==='episode')fields=[operationField('title','عنوان',item.title),operationField('preferred_specialty','تخصص پیشنهادی',item.preferred_specialty),operationField('status','وضعیت',item.status,'select',['open','monitoring','resolved','archived']),operationField('urgency','اولویت',item.urgency,'select',['routine','soon','urgent']),operationField('summary','شرح',item.summary,'textarea'),operationField('goal','هدف پیگیری',item.goal,'textarea')];
  if(kind==='care_plan')fields=[`<pre class="full" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(item.plan||{},null,2))}</pre>`,operationField('status','وضعیت',item.status,'select',['active','superseded','archived'])];
  adminModal('operationModal',operationNames[kind]+' · '+(item.patients?.display_name||''),`<form id="operationForm"><div class="form">${fields.join('')}<label class="full">دلیل تغییر<textarea id="operationReason" maxlength="500" required></textarea></label><p class="full muted">تغییر و دلیل آن هم‌زمان در گزارش مدیریت ثبت می‌شود.</p><div id="operationFeedback" class="full" role="alert"></div><button id="operationSave" type="submit" class="primary full">ذخیره تغییرات</button></div></form>`);
  $('operationForm').addEventListener('submit',async event=>{
    event.preventDefault();const reason=$('operationReason').value.trim();if(!reason){feedback('operationFeedback','دلیل تغییر لازم است');return}
    const patch={};document.querySelectorAll('#operationForm [id^="operation_"]').forEach(node=>{const key=node.id.slice(10);patch[key]=key==='items'?node.value.split('\n').map(item=>item.trim()).filter(Boolean):key==='due_at'?(node.value?new Date(node.value).toISOString():null):node.value});
    const button=$('operationSave');button.disabled=true;
    try{await jf('/api/admin-operations',{method:'PATCH',body:JSON.stringify({kind,id,patch,reason})});closeModal('operationModal');await loadOperations();toast('عملیات و گزارش تغییر ثبت شد')}
    catch(error){feedback('operationFeedback',error.message)}finally{button.disabled=false}
  });
}

async function appointmentStatus(id,status){if(!status)return;const reason=prompt('دلیل تغییر وضعیت نوبت را بنویسید:','');if(!reason?.trim()){toast('تغییر لغو شد؛ دلیل لازم است',true);renderAppointments();return}await act('appointment-status',id,{status,reason:reason.trim()})}

async function openMedicalArchive(userId,patientId=''){
  adminModal('medicalArchiveModal','فایل‌های اصلی پرونده سلامت','<p role="status">در حال دریافت فایل‌ها…</p>');
  const query='/api/admin-medical-archive?user_id='+encodeURIComponent(userId)+(patientId?'&patient_id='+encodeURIComponent(patientId):'');
  try{const data=await jf(query);
    adminModal('medicalArchiveModal','فایل‌های اصلی پرونده سلامت',`<div id="medicalArchiveFiles"></div><button id="medicalArchiveMore" type="button" hidden>فایل‌های قدیمی‌تر</button><div id="medicalArchiveFeedback" role="alert"></div><div id="medicalArchiveViewer"></div>`);
    const seen=new Set();
    const appendFiles=files=>(files||[]).forEach(file=>{const key=file.source+':'+file.id+':'+(file.page_index||0);if(seen.has(key))return;seen.add(key);const row=document.createElement('article');row.className='card body';const title=document.createElement('b');title.textContent=file.title||file.filename||'فایل پزشکی';const meta=document.createElement('p');meta.className='muted';meta.textContent=(file.patient_name||'')+' · '+dt(file.created_at)+' · '+(file.document_type||file.source);row.append(title,meta);
      for(const [download,label]of[[false,'مشاهده فایل'],[true,'دانلود فایل']]){const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>openMedicalArchiveFile(file,download,button));row.append(button)}$('medicalArchiveFiles').append(row)});
    appendFiles(data.files);let nextOffset=data.next_offset;const more=$('medicalArchiveMore');more.hidden=!Number.isInteger(nextOffset);
    more.addEventListener('click',async()=>{more.disabled=true;try{const older=await jf(query+'&offset='+encodeURIComponent(nextOffset));appendFiles(older.files);nextOffset=older.next_offset;more.hidden=!Number.isInteger(nextOffset);feedback('medicalArchiveFeedback','فایل‌های قدیمی‌تر دریافت شدند',false)}catch(error){feedback('medicalArchiveFeedback',error.message)}finally{more.disabled=false}});
    if(!(data.files||[]).length)$('medicalArchiveFiles').innerHTML='<p class="muted">فایلی در این پرونده ثبت نشده است.</p>';
  }catch(error){$('medicalArchiveModal').querySelector('.dialog').innerHTML=`<h2>پرونده سلامت</h2><p class="danger" role="alert">${esc(error.message)}</p><button onclick="closeModal('medicalArchiveModal')">بستن</button>`}
}
async function openMedicalArchiveFile(file,download,button){
  button.disabled=true;
  try{const params=new URLSearchParams({source:file.source,id:file.source==='lab'?(file.result_id||file.id):file.id});if(file.source==='lab')params.set('page',file.page_index||0);if(download)params.set('download','true');const data=await jf('/api/admin-medical-archive?'+params);const url=new URL(data.url);if(url.protocol!=='https:')throw Error('نشانی فایل معتبر نیست');
    const viewer=$('medicalArchiveViewer');viewer.replaceChildren();
    const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.className='btn';link.textContent=download?'دانلود / باز کردن فایل':'باز کردن فایل در پنجره جدید';if(download)link.download=data.filename||file.filename||'medical-document';viewer.append(link);
    if(!download&&String(data.mime_type||file.mime_type).startsWith('image/')){const img=document.createElement('img');img.src=url.href;img.alt=data.title||file.title||'فایل پزشکی';img.style.cssText='display:block;width:100%;height:auto;margin-top:12px';viewer.append(img)}
    else if(!download&&data.mime_type==='application/pdf'){const frame=document.createElement('iframe');frame.src=url.href;frame.title=data.title||'مدرک پزشکی';frame.style.cssText='width:100%;height:60vh;border:0;margin-top:12px';viewer.append(frame)}
    feedback('medicalArchiveFeedback','دسترسی فایل خصوصی و کوتاه‌مدت است؛ در صورت انقضا دوباره روی مشاهده بزنید.',false);
  }catch(error){feedback('medicalArchiveFeedback',error.message)}finally{button.disabled=false}
}

async function openDoctorLicense(id){
  currentLicense=null;adminModal('doctorLicenseModal','بررسی مجوز پزشک','<p role="status">در حال دریافت مجوز و بررسی اولیه…</p>');
  try{const data=await jf('/api/doctor-license?id='+encodeURIComponent(id));currentLicense=data;const report=data.ai_report||{};
    adminModal('doctorLicenseModal','بررسی مجوز پزشک',`<p class="warning">بررسی هوش مصنوعی اولیه است. هویت و اعتبار مجوز باید با استعلام مستقل تطبیق داده شود.</p>${data.document?`<img id="doctorLicenseImage" src="/api/doctor-license?id=${encodeURIComponent(id)}&image=1" alt="تصویر خصوصی مجوز پزشک" style="width:100%;height:auto;border-radius:10px">`:'<p class="danger">تصویر مجوز بارگذاری نشده است؛ تأیید ممکن نیست.</p>'}<div class="card body"><h3>گزارش بررسی اولیه هوش مصنوعی</h3><p>${esc(report.summary||'گزارش آماده نیست')}</p><p>نام استخراج‌شده: ${esc(report.extracted_name||'—')} · شماره مجوز: ${esc(report.license_number||'—')} · وضعیت: ${esc(report.status||data.status||'—')}</p><ul>${(report.flags||[]).map(flag=>`<li>${esc(flag)}</li>`).join('')}</ul></div>${data.review?`<p>تصمیم قبلی: ${esc(data.review.decision)} · ${esc(data.review.reason)}</p>`:''}<p><a id="doctorRegistryLink" class="btn" href="https://membersearch.irimc.org/" target="_blank" rel="noopener noreferrer">استعلام مستقل نظام پزشکی</a></p><form id="doctorLicenseForm"><div class="form"><label class="full check"><input id="doctorRegistryChecked" type="checkbox">هویت، شماره و اعتبار مجوز را با منبع رسمی تطبیق دادم.</label><label class="full">دلیل تصمیم<textarea id="doctorLicenseReason" required minlength="5" maxlength="2000"></textarea></label><div id="doctorLicenseFeedback" class="full" role="alert"></div><button type="submit" id="verifyDoctorLicense" class="primary" ${data.document?'':'disabled'}>تأیید پزشک</button><button type="button" id="rejectDoctorLicense" class="danger">رد مجوز</button></div></form>`);
    const submit=async decision=>{const reason=$('doctorLicenseReason').value.trim();if(reason.length<5){feedback('doctorLicenseFeedback','دلیل تصمیم را حداقل در ۵ حرف بنویسید');return}if(decision==='verified'&&!$('doctorRegistryChecked').checked){feedback('doctorLicenseFeedback','ابتدا مجوز را مستقل استعلام و گزینه تطبیق را انتخاب کنید');return}
      if(!data.document){feedback('doctorLicenseFeedback','ابتدا پزشک باید تصویر مجوز را بارگذاری کند');return}
      $('verifyDoctorLicense').disabled=true;$('rejectDoctorLicense').disabled=true;
      try{await jf('/api/admin-doctor-review',{method:'POST',body:JSON.stringify({id,decision,reason,registry_checked:$('doctorRegistryChecked').checked,document_id:data.document?.id,document_updated_at:data.document?.updated_at})});closeModal('doctorLicenseModal');toast('نتیجه بررسی ثبت شد');await load()}
      catch(error){feedback('doctorLicenseFeedback',error.message)}finally{$('verifyDoctorLicense').disabled=!data.document;$('rejectDoctorLicense').disabled=false}};
    $('doctorLicenseForm').addEventListener('submit',event=>{event.preventDefault();submit('verified')});$('rejectDoctorLicense').addEventListener('click',()=>submit('rejected'));
  }catch(error){$('doctorLicenseModal').querySelector('.dialog').innerHTML=`<h2>مجوز پزشک</h2><p class="danger" role="alert">${esc(error.message)}</p><button onclick="closeModal('doctorLicenseModal')">بستن</button>`}
}

document.addEventListener('click',event=>{if(event.target.closest('[data-page="operations"]'))loadOperations()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.modal.open').forEach(modal=>modal.classList.remove('open'))});
