/* Uses the health page's existing API/session and in-memory record. */
let editingEntry = null;
const entryLists = {
  medications:['medication','medications'],conditions:['condition','conditions'],allergies:['allergy','allergies'],
  vitals:['vital','vitals'],vaccinations:['vaccination','vaccinations'],procedures:['procedure','procedures'],
  familyHistory:['family_history','family_history'],screenings:['screening','screenings'],insurances:['insurance','insurances'],tasks:['task','tasks']
};
function feedback(message, error=false) {
  const box = document.getElementById('healthFeedback');
  box.textContent = message;
  box.className = 'health-feedback ' + (error?'danger':'success');
  box.hidden = false;
  const dialog = document.querySelector('.modal.open .dialog');
  if (dialog) {
    let alert = dialog.querySelector('.dialog-feedback');
    if (!alert) { alert=document.createElement('div');alert.className='dialog-feedback';alert.setAttribute('role','alert');dialog.querySelector('h2')?.after(alert); }
    alert.textContent=error?message:'';alert.hidden=!error;
  }
}
const originalRender = render;
render = function() {
  originalRender();
  for (const [container,[type,key]] of Object.entries(entryLists)) {
    let entries=record?.[key]||[];
    if(type==='medication') entries=entries.filter(x=>x.status==='active');
    if(type==='task') entries=entries.filter(x=>x.status==='open');
    if(type==='vital') entries=entries.slice(0,8);
    document.querySelectorAll('#'+container+' > .item').forEach((item,index)=>{
      const entry=entries[index],patientId=currentPatient; if(!entry)return;
      const actions=document.createElement('div');actions.className='entry-actions';
      for(const [label,action] of [['ویرایش',()=>editEntry(type,entry)],['حذف',()=>deleteEntry(type,entry)]]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.setAttribute('aria-label',label+' '+(entry.name||entry.title||entry.allergen||'اطلاعات سلامت'));
        button.addEventListener('click',()=>{if(recordReady()&&patientId===currentPatient)action()});actions.append(button);
      }
      item.append(actions);
    });
  }
  document.querySelectorAll('#appointments > .item').forEach((item,index)=>{
    const appointment=record?.appointments?.[index];if(!appointment)return;
    const actions=document.createElement('div');actions.className='entry-actions';
    if(['requested','confirmed'].includes(appointment.status)&&new Date(appointment.starts_at)>new Date()){
      const button=document.createElement('button');button.textContent='لغو نوبت';button.className='danger';
      button.onclick=()=>cancelAppointment(appointment);actions.append(button);
      const intake=document.createElement('a');intake.className='btn';intake.href='/visit-intake?appointment_id='+encodeURIComponent(appointment.id);intake.textContent='آماده‌سازی ویزیت';actions.append(intake);
    }
    item.append(actions);
    for(const link of item.querySelectorAll('a[target="_blank"]')){
      try{if(new URL(link.href).protocol!=='https:'){link.remove();continue;}link.rel='noopener noreferrer';}catch{link.remove();}
    }
  });
};
const originalOpenAdd = openAdd;
openAdd = function(type) {
  if(!recordReady())return;
  $('addModal').dataset.patientId=currentPatient;
  $('addModal').querySelector('button.primary').disabled=false;
  editingEntry=null;
  $('addModal').querySelector('.dialog-feedback')?.remove();
  $('entryType').disabled=false;
  $('addModal').querySelector('h2').textContent='افزودن اطلاعات سلامت';
  originalOpenAdd(type);
};
function editEntry(type,entry) {
  openAdd(type);editingEntry={id:entry.id,patientId:currentPatient};$('entryType').disabled=true;
  $('addModal').querySelector('h2').textContent='ویرایش اطلاعات سلامت';
  for(const input of $('dynamicFields').querySelectorAll('[name]')){
    const key=input.name==='task_type'?'type':input.name;
    let value=entry[key]??'';
    if(input.type==='datetime-local'&&value){const date=new Date(value);value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    input.value=value;
  }
}
saveEntry = async function() {
  const box=$('dynamicFields');
  for(const input of box.querySelectorAll('input,select,textarea'))if(!input.reportValidity())return;
  if(!recordReady())return feedback('ابتدا پرونده انتخاب‌شده را بارگذاری کنید.',true);
  if($('addModal').dataset.patientId!==currentPatient)return feedback('پرونده تغییر کرده؛ فرم را دوباره باز کنید.',true);
  const patientId=currentPatient,version=recordLoadVersion, body={type:$('entryType').value,patient_id:patientId};
  if(editingEntry){if(editingEntry.patientId!==patientId)return feedback('پرونده تغییر کرده؛ فرم را دوباره باز کنید',true);body.id=editingEntry.id;}
  box.querySelectorAll('[name]').forEach(input=>body[input.name]=input.type==='datetime-local'&&input.value?new Date(input.value).toISOString():input.value);
  const button=$('addModal').querySelector('button.primary');button.disabled=true;
  try {
    await api('/api/health-entry',{method:editingEntry?'PATCH':'POST',body:JSON.stringify(body)});
    if(!selectedRecordIs(patientId,version))return;
    closeModal('addModal');editingEntry=null;await loadRecord();if(patientId===currentPatient)feedback('اطلاعات سلامت ذخیره شد.');
  }catch(error){if(selectedRecordIs(patientId,version))feedback(error.message,true);}finally{if($('addModal').dataset.patientId===patientId)button.disabled=false;}
};
async function deleteEntry(type,entry) {
  if(!recordReady())return;
  const patientId=currentPatient,version=recordLoadVersion;
  if(!confirm('این اطلاعات از پرونده حذف شود؟ حذف را نمی‌توان برگرداند.'))return;
  try{await api('/api/health-entry',{method:'DELETE',body:JSON.stringify({type,patient_id:patientId,id:entry.id})});if(!selectedRecordIs(patientId,version))return;await loadRecord();if(patientId===currentPatient)feedback('اطلاعات حذف شد.');}catch(error){if(selectedRecordIs(patientId,version))feedback(error.message,true);}
}
async function cancelAppointment(appointment) {
  if(!recordReady())return;
  const patientId=currentPatient,version=recordLoadVersion;
  if(!confirm('نوبت با '+(appointment.doctor_profiles?.full_name||'پزشک')+' لغو شود؟'))return;
  try{await api('/api/appointments',{method:'PATCH',body:JSON.stringify({id:appointment.id,action:'cancel'})});if(!selectedRecordIs(patientId,version))return;await loadRecord();if(patientId===currentPatient)feedback('نوبت لغو شد.');}catch(error){if(selectedRecordIs(patientId,version))feedback(error.message,true);}
}

// Shared theme.js owns keyboard behavior for all product dialogs.
if(record)render();

uploadDoc = async function() {
 if(!recordReady())return feedback('ابتدا پرونده انتخاب‌شده را بارگذاری کنید.',true);
 if($('docModal').dataset.patientId!==currentPatient)return feedback('پرونده تغییر کرده؛ فرم را دوباره باز کنید.',true);
 const file=$('docFile').files[0];
 if(!file)return feedback('فایل پزشکی را انتخاب کنید.',true);
 if(file.size>4*1024*1024)return feedback('حجم فایل باید حداکثر ۴ مگابایت باشد.',true);
 if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))return feedback('فایل PDF، JPG، PNG یا WebP را انتخاب کنید.',true);
 const patientId=currentPatient,version=recordLoadVersion, form=new FormData();form.append('patient_id',patientId);form.append('title',$('docTitle').value);form.append('document_type',$('docType').value);form.append('document_date',$('docDate').value);form.append('file',file);
 const button=$('docModal').querySelector('button.primary');button.disabled=true;
 try{const response=await fetch('/api/documents',{method:'POST',credentials:'include',body:form});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'سند ذخیره نشد؛ دوباره تلاش کنید.');if(!selectedRecordIs(patientId,version))return;closeModal('docModal');$('docFile').value='';await loadRecord();if(patientId===currentPatient)feedback('سند پزشکی ذخیره شد.');}
 catch(e){if(selectedRecordIs(patientId,version))feedback(e.message,true);}finally{if($('docModal').dataset.patientId===patientId)button.disabled=false;}
};

// A patient switch closes patient dialogs and disables their controls until the new record is ready.
// Also guard direct keyboard/programmatic calls that may arrive during an in-flight switch.
const patientDialogs={openEpisode:'episodeModal',editAccess:'accessModal',openChat:'chatModal',openDocument:'docModal',openEmergency:'emergencyModal'};
const patientSaves={saveEpisode:'episodeModal',saveAccess:'accessModal',sendMessage:'chatModal',enableEmergency:'emergencyModal',disableEmergency:'emergencyModal'};
for(const name of ['openEpisode','saveEpisode','setEpisodeStatus','completeTask','editAccess','saveAccess','revokeAccess','openChat','sendMessage','openDocument','openDoc','openEmergency','enableEmergency','disableEmergency','addCareReminder','submitDoctorReview']){
  const action=window[name];
  window[name]=function(...args){
    if(!recordReady())return;
    if(patientDialogs[name]){const modal=$(patientDialogs[name]);modal.dataset.patientId=currentPatient;modal.querySelectorAll('button.primary').forEach(button=>button.disabled=false);}
    if(patientSaves[name]&&$(patientSaves[name]).dataset.patientId!==currentPatient)return feedback('پرونده تغییر کرده؛ فرم را دوباره باز کنید.',true);
    return action(...args);
  };
}
