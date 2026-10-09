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
      const entry=entries[index]; if(!entry)return;
      const actions=document.createElement('div');actions.className='entry-actions';
      for(const [label,action] of [['ویرایش',()=>editEntry(type,entry)],['حذف',()=>deleteEntry(type,entry)]]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.setAttribute('aria-label',label+' '+(entry.name||entry.title||entry.allergen||'اطلاعات سلامت'));
        button.addEventListener('click',action);actions.append(button);
      }
      item.append(actions);
    });
  }
  document.querySelectorAll('#appointments > .item').forEach((item,index)=>{
    const appointment=record.appointments[index];if(!appointment)return;
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
  editingEntry=null;
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
  const patientId=currentPatient, body={type:$('entryType').value,patient_id:patientId};
  if(editingEntry){if(editingEntry.patientId!==patientId)return feedback('پرونده تغییر کرده؛ فرم را دوباره باز کنید',true);body.id=editingEntry.id;}
  box.querySelectorAll('[name]').forEach(input=>body[input.name]=input.type==='datetime-local'&&input.value?new Date(input.value).toISOString():input.value);
  const button=$('addModal').querySelector('button.primary');button.disabled=true;
  try {
    await api('/api/health-entry',{method:editingEntry?'PATCH':'POST',body:JSON.stringify(body)});
    closeModal('addModal');editingEntry=null;await loadRecord();feedback('اطلاعات سلامت ذخیره شد.');
  }catch(error){feedback(error.message,true);}finally{button.disabled=false;}
};
async function deleteEntry(type,entry) {
  const patientId=currentPatient;
  if(!confirm('این اطلاعات از پرونده حذف شود؟ حذف را نمی‌توان برگرداند.'))return;
  try{await api('/api/health-entry',{method:'DELETE',body:JSON.stringify({type,patient_id:patientId,id:entry.id})});await loadRecord();feedback('اطلاعات حذف شد.');}catch(error){feedback(error.message,true);}
}
async function cancelAppointment(appointment) {
  if(!confirm('نوبت با '+(appointment.doctor_profiles?.full_name||'پزشک')+' لغو شود؟'))return;
  try{await api('/api/appointments',{method:'PATCH',body:JSON.stringify({id:appointment.id,action:'cancel'})});await loadRecord();feedback('نوبت لغو شد.');}catch(error){feedback(error.message,true);}
}

// Keyboard access, focus containment and restoration for the existing dialogs.
const dialogOpeners=new Map();
for(const modal of document.querySelectorAll('.modal')){
  const dialog=modal.querySelector('.dialog');if(!dialog)continue;
  const heading=dialog.querySelector('h2');if(heading&&!heading.id)heading.id=modal.id+'Title';
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.tabIndex=-1;
  if(heading)dialog.setAttribute('aria-labelledby',heading.id);
  new MutationObserver(()=>{
    if(modal.classList.contains('open')){
      dialogOpeners.set(modal,document.activeElement);
      (dialog.querySelector('input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea,button,a[href]')||dialog).focus();
    }else{dialogOpeners.get(modal)?.focus();dialogOpeners.delete(modal);}
  }).observe(modal,{attributes:true,attributeFilter:['class']});
}
document.addEventListener('keydown',event=>{
  const modal=[...document.querySelectorAll('.modal.open')].at(-1);if(!modal)return;
  if(event.key==='Escape'){closeModal(modal.id);return;}
  if(event.key!=='Tab')return;
  const elements=[...modal.querySelectorAll('button:not(:disabled),input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea,a[href]')].filter(x=>x.getClientRects().length);
  const first=elements[0],last=elements.at(-1);
  if(!first){event.preventDefault();return;}
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
if(record)render();
