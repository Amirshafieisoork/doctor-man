/* Patient-owned base/supplementary insurance. Values never enter emergency URLs. */
(() => {
  const labels={base:'بیمه پایه',supplementary:'بیمه تکمیلی',none:'بدون بیمه'};
  let editVersion=0;
  const markup=`<label>نوع بیمه<select name="coverage_type"><option value="base">بیمه پایه</option><option value="supplementary">بیمه تکمیلی</option><option value="none">بیمه ندارم</option></select></label><label>نام بیمه‌گر<input name="provider_name" list="insuranceProviders" maxlength="160" placeholder="مثلاً تأمین اجتماعی یا بیمه دانا"><datalist id="insuranceProviders"><option value="تأمین اجتماعی"><option value="بیمه سلامت"><option value="نیروهای مسلح"><option value="دانا"><option value="آسیا"><option value="ایران"><option value="دی"><option value="سامان"></datalist></label><label>شماره بیمه یا بیمه‌نامه<input name="policy_number" maxlength="120"></label><label>نام طرح بیمه<input name="plan_name" maxlength="120"></label><label>شروع اعتبار<input type="date" name="valid_from"></label><label>پایان اعتبار<input type="date" name="valid_until"></label><p class="tiny full">بیمه پایه و تکمیلی را جدا ثبت کنید. این اطلاعات را شما اعلام می‌کنید؛ استعلام پوشش بیمه انجام نمی‌شود. اگر بیمه ندارید گزینه «بیمه ندارم» را ثبت کنید؛ ثبت سوابق و ارزیابی پزشک همچنان امکان‌پذیر است.</p>`;
  fields.insurance=markup;
  function renderInsurance(){
    const box=document.getElementById('insurances');if(!box)return;
    const patientId=currentPatient,version=recordLoadVersion;
    box.innerHTML=(record?.insurances||[]).map(item=>`<article class="item"><strong>${esc(labels[item.coverage_type||'base']||'بیمه')} · ${esc(item.provider_name)}</strong><div class="tiny">${item.policy_number?'شماره بیمه: '+esc(item.policy_number)+' · ':''}${item.plan_name?'طرح: '+esc(item.plan_name)+' · ':''}${item.valid_until?'اعتبار تا '+fmt(item.valid_until):'پایان اعتبار ثبت نشده'}</div><div class="archive-actions"><button type="button" data-insurance-edit="${esc(item.id)}">ویرایش بیمه</button><button type="button" data-insurance-delete="${esc(item.id)}">حذف بیمه</button></div></article>`).join('')||'<div class="empty">بیمه پایه یا تکمیلی برای این پرونده ثبت نشده است.</div>';
    box.querySelectorAll('[data-insurance-edit]').forEach(button=>button.addEventListener('click',()=>{if(selectedRecordIs(patientId,version)&&recordReady())editInsurance(button.dataset.insuranceEdit)}));
    box.querySelectorAll('[data-insurance-delete]').forEach(button=>button.addEventListener('click',()=>removeInsurance(button.dataset.insuranceDelete,patientId,version,button)));
  }
  function editInsurance(id){
    const item=record?.insurances?.find(row=>row.id===id);if(!item)return;
    let modal=document.getElementById('insuranceEditModal');
    if(!modal){modal=document.createElement('div');modal.id='insuranceEditModal';modal.className='modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','insuranceEditTitle');modal.innerHTML='<div class="dialog"><h2 id="insuranceEditTitle">ویرایش بیمه</h2><form class="form">'+markup.replace(/insuranceProviders/g,'editInsuranceProviders')+'<p class="tiny full" role="status" aria-live="polite"></p><button class="primary full" type="submit">ذخیره بیمه</button><button class="full" type="button" data-close>انصراف</button></form></div>';document.body.append(modal);modal.querySelector('[data-close]').addEventListener('click',()=>modal.classList.remove('open'));}
    const form=modal.querySelector('form'),patientId=currentPatient,version=recordLoadVersion,generation=++editVersion,status=form.querySelector('[role=status]');status.textContent='';form.querySelector('[type=submit]').disabled=false;
    for(const input of form.querySelectorAll('[name]'))input.value=item[input.name]??(input.name==='coverage_type'?'base':'');
    form.onsubmit=async event=>{event.preventDefault();if(!selectedRecordIs(patientId,version)||!recordReady())return;
      const payload={type:'insurance',id,patient_id:patientId,...Object.fromEntries(new FormData(form))},submit=form.querySelector('[type=submit]');submit.disabled=true;status.textContent='در حال ذخیره…';
      try{await api('/api/health-entry',{method:'PATCH',body:JSON.stringify(payload)});if(!selectedRecordIs(patientId,version)||generation!==editVersion)return;modal.classList.remove('open');await loadRecord();}
      catch(error){if(selectedRecordIs(patientId,version)&&generation===editVersion)status.textContent=error.message||'بیمه ذخیره نشد؛ دوباره تلاش کنید.';}
      finally{if(generation===editVersion)submit.disabled=false;}
    };
    modal.classList.add('open');form.querySelector('select').focus();
  }
  async function removeInsurance(id,patientId,version,button){
    if(!selectedRecordIs(patientId,version)||!recordReady()||!confirm('این بیمه از پرونده انتخاب‌شده حذف شود؟'))return;button.disabled=true;
    try{await api('/api/health-entry',{method:'DELETE',body:JSON.stringify({type:'insurance',patient_id:patientId,id})});if(selectedRecordIs(patientId,version))await loadRecord();}
    catch(error){if(selectedRecordIs(patientId,version))feedback(error.message||'حذف بیمه انجام نشد.',true);}
    finally{if(button.isConnected)button.disabled=false;}
  }
  const originalRender=window.render;
  window.render=function(...args){const result=originalRender.apply(this,args);renderInsurance();return result;};
  document.addEventListener('drman:health-record-loading',()=>{editVersion++;document.getElementById('insuranceEditModal')?.classList.remove('open');});
  if(record)renderInsurance();
})();
