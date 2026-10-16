/* Patient-owned insurance. Browser helpers keep dates Gregorian in API payloads. */
(() => {
  const labels={base:'بیمه پایه',supplementary:'بیمه تکمیلی',none:'بدون بیمه پایه'};
  const providers={
    base:['تأمین اجتماعی','بیمه سلامت','نیروهای مسلح'],
    supplementary:['دانا','آسیا','ایران','دی','سامان','البرز','پارسیان','رازی','سینا','کوثر','ما','ملت','معلم','پاسارگاد']
  };
  let editVersion=0;
  const markup=`<div class="insurance-form-intro full"><strong>بیمه پایه و تکمیلی را جدا ثبت کنید</strong><p>بیمه پایه، مثل تأمین اجتماعی یا بیمه سلامت، پوشش اصلی شماست. اگر بیمه تکمیلی هم دارید، آن را در یک ثبت جدا اضافه کنید.</p></div>
  <label class="full">۱. چه چیزی می‌خواهید ثبت کنید؟<select name="coverage_type"><option value="base">بیمه پایه دارم</option><option value="supplementary">بیمه تکمیلی دارم</option><option value="none">بیمه پایه ندارم</option></select><small data-insurance-kind-help></small></label>
  <label class="full" data-insurance-provider-select>۲. نام شرکت بیمه <span class="insurance-required">(الزامی)</span><select data-insurance-provider-choice aria-label="انتخاب شرکت بیمه"><option value="">شرکت بیمه را انتخاب کنید</option></select></label>
  <label class="full" data-insurance-provider-other hidden>نام شرکت بیمه <span class="insurance-required">(الزامی)</span><input name="provider_name" maxlength="160" placeholder="نام بیمه را بنویسید" autocomplete="off"></label>
  <details class="full insurance-extra" data-insurance-extra><summary>جزئیات بیمه و تاریخ اعتبار (اختیاری)</summary><div class="form"><label data-insurance-financial>شماره بیمه‌نامه <small>اختیاری؛ اگر در دسترس دارید</small><input name="policy_number" maxlength="120" autocomplete="off"></label><label data-insurance-financial>نام طرح یا قرارداد <small>اختیاری</small><input name="plan_name" maxlength="120" placeholder="مثلاً قرارداد محل کار"></label><label>شروع اعتبار <small>شمسی؛ اختیاری</small><input type="date" name="valid_from"></label><label>پایان اعتبار <small>شمسی؛ اختیاری</small><input type="date" name="valid_until"></label></div></details>
  <p class="tiny full insurance-note" data-insurance-note>کد ملی در «مشخصات فردی» ثبت می‌شود. برای ثبت بیمه پایه، شماره بیمه‌نامه لازم نیست. اطلاعات بیمه را شما اعلام می‌کنید؛ استعلام آنلاین انجام نمی‌شود.</p><p class="full insurance-form-error" data-insurance-error role="alert" hidden></p>`;
  fields.insurance=markup;

  function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  function period(item){const day=today();if(item.valid_until&&item.valid_until<day)return 'past';if(item.valid_from&&item.valid_from>day)return 'future';return 'current';}
  function overlap(a,b){return (!a.valid_until||!b.valid_from||a.valid_until>=b.valid_from)&&(!b.valid_until||!a.valid_from||b.valid_until>=a.valid_from);}
  function errorIn(form,message){const status=form.querySelector('[data-insurance-error]');status.textContent=message;status.hidden=!message;return false;}
  function initialise(form,item={}){
    const type=form.querySelector('[name=coverage_type]'),choice=form.querySelector('[data-insurance-provider-choice]'),name=form.querySelector('[name=provider_name]');
    if(!type)return;
    for(const input of form.querySelectorAll('[name]'))input.value=item[input.name]??(input.name==='coverage_type'?'base':'');
    const changeKind=(keepName=false)=>{
      const kind=type.value,none=kind==='none',previous=keepName?name.value:'';
      choice.innerHTML='<option value="">شرکت بیمه را انتخاب کنید</option>'+ (providers[kind]||[]).map(provider=>'<option value="'+esc(provider)+'">'+esc(provider)+'</option>').join('')+'<option value="other">سایر شرکت‌ها؛ نام را می‌نویسم</option>';
      choice.value=previous?((providers[kind]||[]).includes(previous)?previous:'other'):'';
      name.value=none?'بدون بیمه':previous;
      form.querySelector('[data-insurance-provider-select]').hidden=none;
      form.querySelector('[data-insurance-provider-other]').hidden=none||choice.value!=='other';
      form.querySelectorAll('[data-insurance-financial]').forEach(label=>label.hidden=none);
      form.querySelector('[data-insurance-extra] summary').textContent=none?'تاریخ شروع و پایان این وضعیت (اختیاری)':'جزئیات بیمه و تاریخ اعتبار (اختیاری)';
      choice.disabled=none;choice.required=!none;name.required=!none;
      form.querySelectorAll('[data-insurance-financial] input').forEach(input=>input.disabled=none);
      form.querySelector('[data-insurance-kind-help]').textContent=kind==='base'?'پوشش اصلی درمان خود را انتخاب کنید. بیمه تکمیلی جای بیمه پایه را نمی‌گیرد.':kind==='supplementary'?'نام شرکت بیمه تکمیلی خود را انتخاب کنید؛ بیمه پایه را جدا ثبت کنید.':'این گزینه یعنی بیمه پایه ندارید. سوابق پزشکی و دریافت ارزیابی پزشک همچنان در دسترس است.';
      form.querySelector('[data-insurance-note]').textContent=none?'اگر بیمه پایه فعالی در پرونده دارید، ابتدا تاریخ پایان آن را ویرایش کنید. سابقه قبلی حذف نمی‌شود.':'کد ملی در «مشخصات فردی» ثبت می‌شود. برای ثبت بیمه پایه، شماره بیمه‌نامه لازم نیست. اطلاعات بیمه را شما اعلام می‌کنید؛ استعلام آنلاین انجام نمی‌شود.';
      if(!keepName)errorIn(form,'');
    };
    type.addEventListener('change',()=>changeKind());
    choice.addEventListener('change',()=>{const other=choice.value==='other';form.querySelector('[data-insurance-provider-other]').hidden=!other;if(!other)name.value=choice.value;else if((providers[type.value]||[]).includes(name.value))name.value='';errorIn(form,'');if(other)name.focus();});
    form.oninput=()=>errorIn(form,'');
    changeKind(true);
    if(item.policy_number||item.plan_name||item.valid_from||item.valid_until)form.querySelector('[data-insurance-extra]').open=true;
    window.DrManCalendar?.enhance(form);
  }
  function prepare(form,id){
    if(window.DrManCalendar&&!window.DrManCalendar.validate(form))return false;
    const type=form.querySelector('[name=coverage_type]'),name=form.querySelector('[name=provider_name]');
    if(type.value==='none'){name.value='بدون بیمه';for(const field of ['policy_number','plan_name'])form.querySelector('[name='+field+']').value='';}
    if(type.value!=='none'&&!name.value.trim()){errorIn(form,'نام شرکت بیمه را انتخاب کنید یا در گزینه «سایر شرکت‌ها» بنویسید.');form.querySelector('[data-insurance-provider-choice]').focus();return false;}
    const draft=Object.fromEntries([...form.querySelectorAll('[name]')].map(input=>[input.name,input.value]));
    if(draft.valid_from&&draft.valid_until&&draft.valid_until<draft.valid_from)return errorIn(form,'پایان اعتبار باید برابر یا بعد از شروع اعتبار باشد.');
    const conflicting=(record?.insurances||[]).find(row=>row.id!==id&&period(draft)!=='past'&&period(row)!=='past'&&overlap(draft,row)&&((draft.coverage_type==='base'&&['base','none'].includes(row.coverage_type||'base'))||(draft.coverage_type==='none'&&['base','none'].includes(row.coverage_type||'base'))));
    if(conflicting){
      const message=draft.coverage_type==='none'?'بیمه پایه یا وضعیت «بدون بیمه» دیگری با این بازه زمانی ثبت شده است. ابتدا همان مورد را ویرایش کنید؛ اگر پایان یافته، تاریخ پایان اعتبارش را ثبت کنید.':'بیمه پایه یا وضعیت «بدون بیمه» دیگری با این بازه زمانی ثبت شده است. همان مورد را ویرایش کنید یا تاریخ اعتبار این بیمه را طوری وارد کنید که با آن تداخل نداشته باشد.';
      return errorIn(form,message);
    }
    for(const input of form.querySelectorAll('input,select,textarea'))if(!input.disabled&&!input.reportValidity())return false;
    errorIn(form,'');return draft;
  }
  const originalRenderFields=window.renderFields;
  window.renderFields=function(...args){const result=originalRenderFields.apply(this,args);if(document.getElementById('entryType')?.value==='insurance')initialise(document.getElementById('dynamicFields'));return result;};
  const originalSaveEntry=window.saveEntry;
  window.saveEntry=function(...args){if(document.getElementById('entryType')?.value==='insurance'&&!prepare(document.getElementById('dynamicFields'),typeof editingEntry==='undefined'?null:editingEntry?.id))return;return originalSaveEntry.apply(this,args);};
  function renderInsurance(){
    const box=document.getElementById('insurances');if(!box)return;
    const patientId=currentPatient,version=recordLoadVersion,items=record?.insurances||[];
    const card=item=>`<article class="item insurance-policy"><div class="insurance-policy-heading"><strong>${esc(labels[item.coverage_type||'base']||'بیمه')}${item.coverage_type==='none'?'':' · '+esc(item.provider_name)}</strong><span class="insurance-period">${({current:'فعلی',future:'از تاریخ آینده',past:'پایان‌یافته'})[period(item)]}</span></div><div class="tiny">${item.policy_number?'شماره بیمه‌نامه: '+esc(item.policy_number)+' · ':''}${item.plan_name?'طرح: '+esc(item.plan_name)+' · ':''}${item.valid_from?'از '+fmt(item.valid_from)+' · ':''}${item.valid_until?'تا '+fmt(item.valid_until):'پایان اعتبار ثبت نشده'}</div><div class="archive-actions"><button type="button" data-insurance-edit="${esc(item.id)}">ویرایش بیمه</button><button type="button" data-insurance-delete="${esc(item.id)}">حذف بیمه</button></div></article>`;
    const current=items.filter(item=>period(item)==='current'),base=current.filter(item=>(item.coverage_type||'base')==='base'),extra=current.filter(item=>item.coverage_type==='supplementary'),none=current.some(item=>item.coverage_type==='none');
    const status=base.length&&none?'<p class="insurance-conflict" role="alert">بیمه پایه و «بدون بیمه» هم‌زمان ثبت شده‌اند. تاریخ اعتبار مورد قبلی را اصلاح کنید تا وضعیت روشن شود.</p>':'';
    const group=(title,rows,empty)=>`<section class="insurance-group"><h3>${title}</h3>${rows.map(card).join('')||'<p class="tiny insurance-empty">'+empty+'</p>'}</section>`;
    box.innerHTML='<p class="tiny insurance-intro">پوشش اصلی و پوشش تکمیلی این فرد، جدا از یکدیگر نمایش داده می‌شوند.</p>'+status+group('بیمه پایه فعلی',current.filter(item=>(item.coverage_type||'base')!=='supplementary'),none?'بیمه پایه ندارید.':'بیمه پایه ثبت نشده است؛ این با «بیمه ندارم» متفاوت است.')+group('بیمه تکمیلی فعلی',extra,'بیمه تکمیلی ثبت نشده است.')+(items.some(item=>period(item)==='future')?group('بیمه با اعتبار آینده',items.filter(item=>period(item)==='future'),''):'')+(items.some(item=>period(item)==='past')?'<details class="insurance-history"><summary>سوابق بیمه‌های پایان‌یافته ('+fa(items.filter(item=>period(item)==='past').length)+')</summary>'+items.filter(item=>period(item)==='past').map(card).join('')+'</details>':'');
    box.querySelectorAll('[data-insurance-edit]').forEach(button=>button.addEventListener('click',()=>{if(selectedRecordIs(patientId,version)&&recordReady())editInsurance(button.dataset.insuranceEdit);}));
    box.querySelectorAll('[data-insurance-delete]').forEach(button=>button.addEventListener('click',()=>removeInsurance(button.dataset.insuranceDelete,patientId,version,button)));
  }
  function editInsurance(id){
    const item=record?.insurances?.find(row=>row.id===id);if(!item)return;
    let modal=document.getElementById('insuranceEditModal');
    if(!modal){modal=document.createElement('div');modal.id='insuranceEditModal';modal.className='modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','insuranceEditTitle');modal.innerHTML='<div class="dialog"><h2 id="insuranceEditTitle">ویرایش بیمه</h2><form class="form"><div class="full form" data-insurance-edit-fields></div><p class="tiny full" role="status" aria-live="polite"></p><button class="primary full" type="submit">ذخیره بیمه</button><button class="full" type="button" data-close>انصراف</button></form></div>';document.body.append(modal);modal.querySelector('[data-close]').addEventListener('click',()=>modal.classList.remove('open'));}
    const form=modal.querySelector('form'),patientId=currentPatient,version=recordLoadVersion,generation=++editVersion,status=form.querySelector('[role=status]');status.textContent='';form.querySelector('[type=submit]').disabled=false;
    form.querySelector('[data-insurance-edit-fields]').innerHTML=markup;initialise(form,item);
    form.onsubmit=async event=>{event.preventDefault();if(!selectedRecordIs(patientId,version)||!recordReady())return;const values=prepare(form,id);if(!values)return;
      const payload={type:'insurance',id,patient_id:patientId,...values},submit=form.querySelector('[type=submit]');submit.disabled=true;status.textContent='در حال ذخیره…';
      try{await api('/api/health-entry',{method:'PATCH',body:JSON.stringify(payload)});if(!selectedRecordIs(patientId,version)||generation!==editVersion)return;modal.classList.remove('open');await loadRecord();}
      catch(error){if(selectedRecordIs(patientId,version)&&generation===editVersion)status.textContent=error.message||'بیمه ذخیره نشد؛ دوباره تلاش کنید.';}
      finally{if(generation===editVersion)submit.disabled=false;}
    };
    modal.classList.add('open');form.querySelector('select').focus();
  }
  async function removeInsurance(id,patientId,version,button){
    if(!selectedRecordIs(patientId,version)||!recordReady()||!confirm('این بیمه از پرونده انتخاب‌شده حذف شود؟ برای حفظ سابقه، می‌توانید به‌جای حذف تاریخ پایان اعتبار را ویرایش کنید.'))return;button.disabled=true;
    try{await api('/api/health-entry',{method:'DELETE',body:JSON.stringify({type:'insurance',patient_id:patientId,id})});if(selectedRecordIs(patientId,version))await loadRecord();}
    catch(error){if(selectedRecordIs(patientId,version))feedback(error.message||'حذف بیمه انجام نشد.',true);}
    finally{if(button.isConnected)button.disabled=false;}
  }
  const originalRender=window.render;
  window.render=function(...args){const result=originalRender.apply(this,args);renderInsurance();return result;};
  document.addEventListener('drman:health-record-loading',()=>{editVersion++;document.getElementById('insuranceEditModal')?.classList.remove('open');});
  if(record)renderInsurance();
})();
