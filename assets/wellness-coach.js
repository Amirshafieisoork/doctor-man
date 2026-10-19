/* Question-driven educational programs, scoped to the selected health record. */
(() => {
  'use strict';
  const configs={
    nutrition:{mount:'nutritionCoachMount',page:'nutritionCoach',title:'برنامه غذایی هوشمند',intro:'غذای روزمره، سلیقه و شرایط شما مهم است. چند سؤال کوتاه را پاسخ دهید تا یک برنامهٔ قابل اجرا برای همین پرونده تهیه شود.',button:'ساخت برنامه غذایی من'},
    skin_hair:{mount:'skinHairCoachMount',page:'skinHairCoach',title:'روتین پوست و مو',intro:'نوع پوست، محصولات فعلی و وضعیت موهایتان را بگویید تا راهنمای مراقبت روزانهٔ متناسب با پاسخ‌های شما آماده شود.',button:'ساخت روتین پوست و موی من'}
  };
  const states=new Map();let generation=0,context=null,bmi=null;
  const REQUEST_TIMEOUT_MS=60000,LOAD_TIMEOUT_MS=20000;
  const pregnancyOptions='<option value="unknown">نمی‌دانم / هنوز بررسی نکرده‌ام</option><option value="no">خیر</option><option value="yes">باردار هستم</option><option value="possible">احتمال بارداری وجود دارد</option>';
  const pregnancyField='<label class="full wellness-pregnancy" data-pregnancy-field>آیا باردار هستید یا احتمال آن وجود دارد؟<select name="pregnancy_status">'+pregnancyOptions+'</select><small>برای انتخاب توصیه‌های ایمن از اطلاعات همین پرونده هم استفاده می‌شود.</small></label>';
  const nutritionFields=`<fieldset><legend>هدف و شرایط روزمره</legend><div class="wellness-fields"><label>هدف شما چیست؟<select name="goal" required><option value="maintain">تغذیه بهتر و حفظ وزن</option><option value="gradual_loss">کاهش وزن تدریجی</option><option value="gradual_gain">افزایش وزن تدریجی</option></select></label><label data-target-field hidden>وزن دلخواه (کیلوگرم؛ اختیاری)<input name="target_weight_kg" type="number" min="0.2" max="500" step="0.1" inputmode="decimal"><small>این عدد ترجیح شماست؛ هدف مناسب به شرایط بدنتان بستگی دارد.</small></label>${pregnancyField}<p class="full wellness-weight-note" data-weight-note hidden></p><label>فعالیت معمول روزانه<select name="activity_level" required><option value="low">بیشتر روز نشسته‌ام</option><option value="moderate">تحرک معمول یا ورزش سبک دارم</option><option value="high">کار بدنی یا فعالیت زیادی دارم</option><option value="limited">به دلیل بیماری یا محدودیت، تحرکم کم است</option></select></label><label>الگوی غذای شما<select name="dietary_pattern" required><option value="balanced">غذای معمول؛ محدودیت خاصی ندارم</option><option value="vegetarian">گیاه‌خواری؛ لبنیات یا تخم‌مرغ می‌خورم</option><option value="vegan">کاملاً گیاهی</option><option value="pescatarian">ماهی می‌خورم؛ گوشت و مرغ نمی‌خورم</option><option value="other">الگوی دیگر؛ در توضیحات می‌نویسم</option></select></label><label>بودجهٔ مواد غذایی<select name="budget" required><option value="economy">اقتصادی و در دسترس</option><option value="standard">متوسط</option><option value="flexible">محدودیت مشخصی ندارم</option></select></label><label>چقدر وقت آشپزی دارید؟<select name="cooking_time" required><option value="quick">غذاهای سریع؛ تا حدود ۲۰ دقیقه</option><option value="moderate">حدود ۲۰ تا ۴۵ دقیقه</option><option value="flexible">زمان بیشتری دارم</option></select></label></div></fieldset><fieldset><legend>سلیقه، عادت‌ها و محدودیت‌ها</legend><div class="wellness-fields"><label>چه غذاهایی دوست دارید؟<textarea name="preferences" maxlength="600" placeholder="مثلاً غذای خانگی ایرانی، عدسی، ماهی…"></textarea></label><label>چه غذاهایی نمی‌خورید یا دوست ندارید؟<textarea name="dislikes" maxlength="600" placeholder="مثلاً قارچ را دوست ندارم؛ گوشت قرمز کم می‌خورم…"></textarea></label><label class="full">ساعت و الگوی معمول وعده‌ها<textarea name="meal_schedule" maxlength="600" placeholder="مثلاً صبحانه نمی‌خورم، ناهار سر کار است و شام دیر می‌خورم…"></textarea></label><label>حساسیت یا محدودیت غذایی دیگری دارید؟<textarea name="additional_allergies" maxlength="600" placeholder="اگر موردی در پرونده نیست، اینجا بنویسید؛ وگرنه خالی بگذارید."></textarea></label><label>توصیه یا محدودیت خاص پزشک<textarea name="medical_restrictions" maxlength="600" placeholder="مثلاً محدودیت مایعات، غذای خاص، مشکل جویدن یا بلع…"></textarea></label></div></fieldset>`;
  const skinFields=`<fieldset><legend>پوست و مراقبت فعلی</legend><div class="wellness-fields"><label>پوست صورت شما معمولاً چگونه است؟<select name="skin_type" required><option value="unknown">مطمئن نیستم</option><option value="normal">معمولی</option><option value="dry">خشک یا کشیده</option><option value="oily">چرب و براق</option><option value="combination">ترکیبی؛ بعضی قسمت‌ها چرب و بعضی خشک</option></select></label><label>پوستتان به محصولات حساسیت نشان می‌دهد؟<select name="skin_sensitivity" required><option value="unknown">مطمئن نیستم</option><option value="no">معمولاً خیر</option><option value="yes">بله؛ زود قرمز، دچار سوزش یا خارش می‌شود</option></select></label><label>نگرانی اصلی دربارهٔ پوست<textarea name="skin_concerns" maxlength="600" placeholder="مثلاً خشکی، جوش، لک، قرمزی؛ اگر فقط مشکل مو دارید، این قسمت اختیاری است."></textarea></label><label>الان چه محصولاتی استفاده می‌کنید؟<textarea name="current_products" maxlength="600" placeholder="نام شوینده، کرم، ضدآفتاب و داروهای پوستی؛ اگر استفاده نمی‌کنید بنویسید ندارم."></textarea></label>${pregnancyField}</div></fieldset><fieldset><legend>مو، پوست سر و علائم مهم</legend><div class="wellness-fields"><label>پوست سرتان معمولاً چگونه است؟<select name="scalp_type" required><option value="unknown">مطمئن نیستم</option><option value="normal">معمولی</option><option value="dry">خشک</option><option value="oily">چرب</option><option value="flaky">پوسته‌دار یا همراه شوره</option></select></label><label>نگرانی دربارهٔ مو یا پوست سر<textarea name="hair_scalp_concerns" maxlength="600" placeholder="مثلاً ریزش، شوره، خارش یا چربی؛ اگر ندارید خالی بگذارید."></textarea></label><label>این وضعیت از چه زمانی شروع شده؟<input name="duration" maxlength="200" placeholder="مثلاً حدود سه ماه پیش"></label><label class="full">آیا علامت مهم یا تازه‌ای دارید؟<select name="urgent_symptoms" required><option value="not_sure">مطمئن نیستم</option><option value="none">خیر؛ هیچ‌کدام از موارد پایین را ندارم</option><option value="yes">بله؛ توضیح می‌دهم</option></select><small>ورم چشم یا صورت، تب همراه ضایعه، قرمزیِ دردناک و در حال گسترش، ریزش ناگهانی تکه‌ای مو، زخم خوب‌نشونده یا خالِ در حال تغییر.</small></label><label class="full" data-urgent-details>توضیح علامت مهم (اگر وجود دارد)<textarea name="urgent_details" maxlength="600"></textarea></label><label class="full">حساسیت شناخته‌شده به محصول، دارو یا مواد دیگر<textarea name="additional_allergies" maxlength="600" placeholder="حساسیت‌هایی که قبلاً در پرونده نوشته‌اید نیز در نظر گرفته می‌شوند."></textarea></label></div></fieldset>`;
  function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text??'');if(className)element.className=className;return element;}
  const number=value=>Number(value).toLocaleString('fa-IR',{maximumFractionDigits:1});
  const formatDate=value=>{try{return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeZone:'Asia/Tehran'}).format(new Date(value));}catch{return '';}};
  function current(state,ticket){return context&&state.patientId===context.patient.id&&state.generation===generation&&ticket===state.ticket;}
  function setBusy(state,value){
    state.busy=value;
    state.form.querySelectorAll('input,select,textarea,button').forEach(field=>field.disabled=value||!context);
    state.consent.querySelector('button').disabled=value||!context;
    state.form.setAttribute('aria-busy',String(value));
    if(!value)refreshWeightFields(state);
  }
  function beginRequest(state,timeout){
    state.controller?.abort();const controller=new AbortController();state.controller=controller;
    const request={controller,timedOut:false,timer:null};request.timer=setTimeout(()=>{request.timedOut=true;controller.abort();},timeout);
    return request;
  }
  function showConsent(state){state.consent.hidden=false;status(state,'برای ساخت برنامه با هوش مصنوعی، ابتدا اجازهٔ پردازش اطلاعات همین پرونده را انتخاب کنید.');}
  function refreshSkinFields(state){
    if(state.kind!=='skin_hair')return;
    const required=state.form.elements.urgent_symptoms.value==='yes';
    state.form.elements.urgent_details.required=required;
    state.form.querySelector('[data-urgent-details]').classList.toggle('wellness-needs-detail',required);
  }
  function status(state,message,error=false){state.status.textContent=message;state.status.classList.toggle('wellness-error',error);}
  function pregnancy(){return bmi?.pregnancyContext(context?.patient||{},context?.record||{}).status||'unknown';}
  function age(){return bmi?.ageInYears(context?.patient?.birth_date)??null;}
  function refreshWeightFields(state){
    if(state.kind!=='nutrition'||!context)return;
    const form=state.form,patient=context.patient,statusValue=form.elements.pregnancy_status.value,knownPregnancy=['yes','possible'].includes(pregnancy());
    const unsuitable=age()===null||age()<20||knownPregnancy||['yes','possible'].includes(statusValue)||(patient.sex==='female'&&statusValue==='unknown');
    for(const option of form.elements.goal.options)if(option.value!=='maintain')option.disabled=unsuitable;
    if(unsuitable)form.elements.goal.value='maintain';
    const showTarget=!unsuitable&&form.elements.goal.value!=='maintain';form.querySelector('[data-target-field]').hidden=!showTarget;form.elements.target_weight_kg.disabled=!showTarget;
    const note=form.querySelector('[data-weight-note]');note.hidden=!unsuitable;
    note.textContent=age()===null?'برای هدف تغییر وزن، ابتدا تاریخ تولد را در مشخصات فردی ثبت کنید. فعلاً برنامه روی عادت‌های غذایی تمرکز می‌کند.':age()<20?'برای کودکان و نوجوانان، هدف وزن بزرگسال تعیین نمی‌شود؛ برنامه باید با رشد و شرایط سنی هماهنگ باشد.':'در بارداری، احتمال آن یا تا روشن شدن وضعیت بارداری، این صفحه هدف کاهش یا افزایش وزن تعیین نمی‌کند.';
  }
  function contextCard(state){
    const box=state.context;box.replaceChildren();if(!context){box.append(node('p','ابتدا یک پروندهٔ سلامت را انتخاب کنید.'));return;}
    const patient=context.patient,record=context.record||{},weight=[...(record.vitals||[])].filter(item=>bmi?.measurement(item.weight_kg,.2,500)!=null).sort((one,two)=>new Date(two.measured_at||0)-new Date(one.measured_at||0))[0]?.weight_kg;
    if(state.kind==='nutrition'&&bmi){
      const guidance=bmi.bmiGuidance({weightKg:weight,heightCm:patient.height_cm,birthDate:patient.birth_date,pregnancy:bmi.hasPregnancyContext(patient,record)});
      const hero=node('div',undefined,'wellness-hero');
      const body=node('div',undefined,'wellness-hero-card');
      body.append(node('span','تناسب قد و وزن شما','label'),node('strong',({healthy:'وزن متناسب',overweight:'اضافه‌وزن',underweight:'کم‌وزنی',obesity:'وزن در محدودهٔ چاقی'})[guidance.category]||guidance.title,'value'));
      if(guidance.bmi!=null)body.append(node('span','شاخص توده بدنی: '+number(guidance.bmi),'hint'));
      const plan=node('div',undefined,'wellness-hero-card');plan.append(node('span','از اطلاعات شما تا غذای روزمره','label'),node('strong','برنامهٔ قابل اجرا','value'),node('span','سلیقه، زمان آشپزی و بودجه را بگویید؛ وعده‌ها، جایگزین‌ها و خریدها را یک‌جا می‌بینید.','hint'));
      hero.append(body,plan);box.append(hero);
    }
    box.append(node('strong','اطلاعاتی که از همین پرونده در نظر گرفته می‌شود'));
    const list=node('dl',undefined,'wellness-context-list');
    for(const [label,value] of [['سن',age()===null?'تاریخ تولد ثبت نشده':number(age())+' سال'],['قد',patient.height_cm?number(patient.height_cm)+' سانتی‌متر':'ثبت نشده'],['وزن',weight?number(weight)+' کیلوگرم':'ثبت نشده'],['بیماری‌ها',(record.conditions||[]).filter(item=>item.status!=='resolved'&&item.status!=='inactive').map(item=>item.name).filter(Boolean).join('، ')||'موردی ثبت نشده'],['حساسیت‌ها',(record.allergies||[]).map(item=>item.allergen).filter(Boolean).join('، ')||'موردی ثبت نشده']]){const row=node('div');row.append(node('dt',label),node('dd',value));list.append(row);}
    box.append(list,node('p','اگر اطلاعات بالا کامل یا به‌روز نیست، آن را در همین پرونده اصلاح کنید. پاسخ‌های این فرم جای مشخصات یا سوابق پزشکی را تغییر نمی‌دهد.','wellness-small'));
  }
  function seed(state,answers={}){
    state.form.reset();for(const field of state.form.querySelectorAll('[name]')){const value=answers[field.name];if(value==null)continue;if(field.tagName==='SELECT'){if([...field.options].some(option=>option.value===String(value)))field.value=String(value);}else field.value=String(value);}
    if(!Object.hasOwn(answers,'pregnancy_status'))state.form.elements.pregnancy_status.value=pregnancy();
    state.form.querySelector('[data-pregnancy-field]').hidden=context?.patient?.sex!=='female';
    refreshWeightFields(state);refreshSkinFields(state);state.dirty=false;
  }
  function listSection(container,title,items,ordered=false,className=''){
    if(!Array.isArray(items)||!items.some(value=>typeof value==='string'&&value.trim()))return;const section=node('section',undefined,'wellness-program-section'+(className?' '+className:''));section.append(node('h3',title));const list=node(ordered?'ol':'ul');for(const value of items.slice(0,14))if(typeof value==='string'&&value.trim())list.append(node('li',value));section.append(list);container.append(section);
  }
  function renderProgram(state,data){
    state.output.replaceChildren();state.consent.hidden=data.state!=='consent_not_granted';
    const program=data.program;if(!program||typeof program!=='object')return;
    const held=program.plan_status==='clinical_hold';
    const article=node('article',undefined,'wellness-program'+(held?' wellness-clinical-hold':'')),heading=node('h2',program.title||configs[state.kind].title);heading.tabIndex=-1;
    article.dataset.planStatus=program.plan_status||'ready';
    const sourceLabel=data.source==='ai'||(data.source==='cached'&&data.program_source==='ai')?'برنامه با هوش مصنوعی':'راهنمای آمادهٔ بررسی‌شده';
    const header=node('div',undefined,'wellness-program-header');header.append(node('span',sourceLabel,'wellness-source-badge'),heading);article.append(header,node('p',program.summary||'','wellness-summary'));
    const meta=node('p',data.source==='cached'?(data.program_source==='local'?'راهنمای عمومی ذخیره‌شدهٔ همین پرونده':'برنامهٔ ذخیره‌شدهٔ همین پرونده'):data.source==='ai'?'تهیه‌شده با هوش مصنوعی بر اساس پاسخ‌ها و اطلاعات ثبت‌شده':'راهنمای عمومی بر اساس پاسخ‌ها؛ بدون تحلیل تازهٔ هوش مصنوعی','wellness-meta');
    if(data.generated_at)meta.append(document.createTextNode(' · '+formatDate(data.generated_at)));article.append(meta);
    listSection(article,'این برنامه بر چه اساسی است؟',program.based_on,false,'wellness-basis');
    if(state.kind==='nutrition'){
      if(typeof program.weight_goal==='string'&&program.weight_goal)article.append(node('p',program.weight_goal,'wellness-weight-goal'));
      if(!held){
        listSection(article,'زمان‌بندی وعده‌ها',program.meal_timing);
        if(Array.isArray(program.weekly_menu)&&program.weekly_menu.length){const section=node('section',undefined,'wellness-menu-section');section.append(node('h3','نمونهٔ وعده‌ها برای شروع'));const menu=node('div',undefined,'wellness-menu');for(const day of program.weekly_menu.slice(0,7)){if(!day||typeof day!=='object')continue;const card=node('section',undefined,'wellness-day');card.append(node('h4',day.day||'یک روز پیشنهادی'));const meals=node('div',undefined,'wellness-meals');for(const [key,label] of [['breakfast','صبحانه'],['lunch','ناهار'],['dinner','شام'],['snacks','میان‌وعده']])if(typeof day[key]==='string'&&day[key]){const line=node('div',undefined,'wellness-meal wellness-meal-'+key);line.append(node('strong',label,'meal-label'),node('p',day[key],'meal-text'));meals.append(line);}card.append(meals);menu.append(card);}section.append(menu);article.append(section);}
        const practical=node('div',undefined,'wellness-practical');
        listSection(practical,'خریدهای پیشنهادی',program.shopping_list,false,'wellness-shopping');listSection(practical,'آماده‌سازی سادهٔ غذا',program.preparation,true);listSection(practical,'جایگزین‌های در دسترس',program.alternatives);article.append(practical);
        listSection(article,'عادت‌های غذایی قابل اجرا',program.habits);
        listSection(article,'این هفته چه چیزی را پیگیری کنم؟',program.check_in);
      }
    }else{
      const routines=node('div',undefined,'wellness-routines');listSection(routines,'صبح‌ها، به ترتیب',program.morning_steps,true);listSection(routines,'شب‌ها، به ترتیب',program.evening_steps,true);article.append(routines);listSection(article,'مراقبت هفتگی',program.weekly_steps);listSection(article,'مو و پوست سر',program.hair_steps);listSection(article,'چه چیزهایی را فعلاً کنار بگذارم؟',program.avoid);
      if(typeof program.patch_test==='string'&&program.patch_test)article.append(node('p',program.patch_test,'wellness-patch-test'));
    }
    listSection(article,'نکات متناسب با شرایط شما',program.precautions);listSection(article,'چه زمانی ارزیابی پزشکی لازم است؟',program.seek_care);listSection(article,'پیگیری و بازبینی برنامه',program.follow_up);listSection(article,'اطلاعاتی که هنوز کم است',program.data_limits);
    listSection(article,held?'برای ادامه، این اطلاعات را روشن کنیم':'برای دقیق‌تر شدن برنامه',program.questions,false,'wellness-questions');
    if(Array.isArray(data.sources)&&data.sources.length){const details=node('details',undefined,'wellness-sources');details.append(node('summary','منابع راهنما'));for(const source of data.sources){try{const url=new URL(source.url);if(url.protocol!=='https:'||!/(^|\.)(nhs\.uk|aad\.org|who\.int|niddk\.nih\.gov|cdc\.gov|medlineplus\.gov|myplate\.gov|ods\.od\.nih\.gov)$/.test(url.hostname))continue;const link=node('a',source.label||url.hostname);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}catch{}}article.append(details);}
    article.append(node('p',data.disclaimer||'این برنامه راهنمای آموزشی است. برای تشخیص، رژیم درمانی یا تجویز دارو به درمانگر مراجعه کنید.','wellness-small'));state.output.append(article);
  }
  function responseStatus(state,data){
    const messages={consent_not_granted:'راهنمای عمومی آماده شد. برای ساخت برنامه با هوش مصنوعی، می‌توانید پردازش هوشمند همین پرونده را فعال کنید.',provider_unavailable:'سرویس هوشمند فعلاً پاسخ کامل نداد؛ راهنمای عمومی متناسب با پاسخ‌ها نمایش داده می‌شود.',daily_limit:'سهم ساخت برنامهٔ هوشمند امروز تمام شده است؛ راهنمای عمومی فعلاً در دسترس است.',pending:'درخواست قبلی همین پرونده هنوز در حال آماده شدن است؛ کمی بعد دوباره بررسی کنید.',record_changed:'اطلاعات پرونده تغییر کرده است؛ پاسخ‌ها را مرور کنید و برنامهٔ تازه بسازید.',red_flags_review:'علائم مهمی گزارش شده است؛ پیش از شروع روتین تازه، توصیهٔ مراجعه را بخوانید.',clinical_review:'راهنمای آمادهٔ متناسب با پاسخ‌ها و محدودیت‌های شما نمایش داده می‌شود.',record_too_large:'اطلاعات این پرونده برای تحلیل تازه زیاد است؛ راهنمای عمومیِ سازگار با پاسخ‌ها نمایش داده می‌شود.',not_saved:'راهنمای عمومی آماده شد؛ ذخیرهٔ برنامه موفق نبود. پاسخ‌ها را نگه دارید و دوباره تلاش کنید.',temporarily_unavailable:'ذخیرهٔ برنامه فعلاً در دسترس نیست؛ راهنمای عمومی نمایش داده می‌شود. کمی بعد دوباره تلاش کنید.'};
    const clinicalMessage=data.program?.plan_status==='clinical_hold'?'برای ادامهٔ برنامه، علت و سؤال‌های مشخص‌شده را در پایین بخوانید.':data.state==='clinical_review'?'راهنمای آمادهٔ متناسب با پاسخ‌ها و محدودیت‌های شما نمایش داده می‌شود.':null;
    status(state,clinicalMessage||messages[data.state]||(data.program?'برنامه آماده است. می‌توانید پاسخ‌ها را تغییر دهید و برنامهٔ تازه بسازید.':'پاسخ‌ها را کامل کنید و دکمهٔ ساخت برنامه را بزنید.'));
  }
  async function load(state){
    if(!context||state.loaded||state.busy||!document.getElementById(configs[state.kind].page)?.classList.contains('on'))return;
    const ticket=++state.ticket;state.loaded=true;status(state,'در حال بارگذاری برنامهٔ ذخیره‌شده…');
    const request=beginRequest(state,LOAD_TIMEOUT_MS);
    try{
      const params=new URLSearchParams({patient_id:context.patient.id,kind:state.kind});
      const response=await fetch('/api/wellness-coach?'+params,{credentials:'include',signal:request.controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!current(state,ticket))return;
      if(response.status===401){status(state,'نشست منقضی شده؛ دوباره وارد شوید.',true);return;}
      if(!response.ok){state.loaded=false;status(state,data.error||'بارگذاری برنامه موفق نبود.',true);return;}
      const savedAnswers=data.questionnaire||data.answers;
      if(savedAnswers&&!state.dirty)seed(state,savedAnswers);
      if(data.program)renderProgram(state,data);
      responseStatus(state,data);
    }catch(error){
      if(!current(state,ticket))return;
      state.loaded=false;
      if(request.timedOut)status(state,'زمان بارگذاری تمام شد؛ دوباره تلاش کنید.',true);
      else if(error.name!=='AbortError')status(state,'بارگذاری برنامه موفق نبود.',true);
    }finally{
      clearTimeout(request.timer);
    }
  }
  async function submit(state,grantConsent=false){
    if(!context||state.busy)return;
    const form=state.form;
    if(!form.reportValidity())return;
    const answers={};
    for(const field of form.querySelectorAll('[name]')){
      if(field.disabled||field.type==='submit')continue;
      answers[field.name]=field.type==='number'&&field.value!==''?Number(field.value):field.value;
    }
    const body={patient_id:context.patient.id,kind:state.kind,answers};
    const ticket=++state.ticket;setBusy(state,true);status(state,grantConsent?'در حال فعال‌سازی پردازش و ساخت برنامه…':'در حال ساخت برنامه…');
    const request=beginRequest(state,REQUEST_TIMEOUT_MS);
    try{
      if(grantConsent){
        const response=await fetch('/api/consent',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({patient_id:body.patient_id,consent_type:'ai_processing',granted:true,version:'1'}),signal:request.controller.signal});
        const data=await response.json().catch(()=>({}));
        if(!current(state,ticket))return;
        if(!response.ok){status(state,data.error||'ثبت اجازهٔ پردازش موفق نبود؛ دوباره تلاش کنید.',true);return;}
      }
      const response=await fetch('/api/wellness-coach',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:request.controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!current(state,ticket))return;
      if(response.status===401){status(state,'نشست منقضی شده؛ دوباره وارد شوید.',true);return;}
      if(response.status===428||(response.status===403&&data.state==='consent_not_granted')){if(data.program)renderProgram(state,data);showConsent(state);return;}
      if(!response.ok){status(state,data.error||'ساخت برنامه موفق نبود.',true);return;}
      state.dirty=false;
      if(data.program)renderProgram(state,data);
      responseStatus(state,data);
    }catch(error){
      if(!current(state,ticket))return;
      if(request.timedOut)status(state,'ساخت برنامه بیش از حد طول کشید؛ پاسخ‌ها حفظ شدند. دوباره تلاش کنید.',true);
      else if(error.name!=='AbortError')status(state,'ساخت برنامه موفق نبود.',true);
    }finally{
      clearTimeout(request.timer);
      if(current(state,ticket))setBusy(state,false);
    }
  }
  function mountCoach(kind){
    const cfg=configs[kind];const mount=document.getElementById(cfg.mount);if(!mount)return;
    mount.classList.add('wellness-coach');
    const heading=node('h2',cfg.title);const intro=node('p',cfg.intro,'wellness-intro');
    const contextBox=node('div',undefined,'wellness-context');
    const form=document.createElement('form');form.className='wellness-questionnaire';form.innerHTML=(kind==='nutrition'?nutritionFields:skinFields)+'<div class="wellness-actions"><button type="submit" class="primary">'+cfg.button+'</button></div>';
    const statusBox=node('p',undefined,'wellness-status');statusBox.setAttribute('role','status');statusBox.setAttribute('aria-live','polite');
    const consent=node('div',undefined,'wellness-consent');consent.hidden=true;
    const consentButton=node('button','اجازهٔ پردازش هوشمند و ساخت برنامه','primary');consentButton.type='button';consent.append(node('p','برای ساخت برنامه با هوش مصنوعی، اجازهٔ پردازش اطلاعات همین پرونده لازم است.'));consent.append(consentButton);
    const output=node('div',undefined,'wellness-output');
    const editor=node('details',undefined,'wellness-editor');editor.open=true;
    editor.append(node('summary','پاسخ‌های من و ساخت برنامهٔ تازه'),form);
    mount.replaceChildren(heading,intro,contextBox,statusBox,consent,output,editor);
    const state={kind,mount,context:contextBox,form,status:statusBox,consent,output,busy:false,loaded:false,dirty:false,patientId:'',generation:0,ticket:0,controller:null};states.set(kind,state);
    form.addEventListener('submit',event=>{event.preventDefault();submit(state);});
    form.addEventListener('input',()=>state.dirty=true);
    form.addEventListener('change',()=>{state.dirty=true;refreshWeightFields(state);refreshSkinFields(state);});
    consentButton.addEventListener('click',()=>submit(state,true));
    form.querySelectorAll('input,select,textarea,button').forEach(field=>field.disabled=true);
  }
  function reset(){generation++;context=null;for(const state of states.values()){state.generation=generation;state.ticket++;state.controller?.abort();state.output.replaceChildren();state.context.replaceChildren();state.consent.hidden=true;state.loaded=false;state.busy=false;state.dirty=false;state.patientId='';state.form.reset();state.form.removeAttribute('aria-busy');state.form.querySelectorAll('input,select,textarea,button').forEach(field=>field.disabled=true);status(state,'در حال بارگذاری پروندهٔ انتخاب‌شده…');}}
  function ready(event){const detail=event.detail;if(!detail?.patientId||!detail.patient||!detail.record)return;reset();context={patient:detail.patient,record:detail.record};for(const state of states.values()){state.patientId=detail.patientId;state.generation=generation;state.form.querySelectorAll('input,select,textarea,button').forEach(field=>field.disabled=false);state.form.removeAttribute('aria-busy');contextCard(state);seed(state);status(state,'پاسخ‌ها را کامل کنید و دکمهٔ ساخت برنامه را بزنید.');load(state);}}
  document.addEventListener('drman:health-record-loading',reset);
  document.addEventListener('drman:health-record-loaded',ready);document.addEventListener('drman:health-profile-updated',ready);
  document.addEventListener('click',event=>{const tab=event.target.closest('[data-page]');if(tab)for(const state of states.values())if(configs[state.kind].page===tab.dataset.page)queueMicrotask(()=>load(state));});
  for(const kind of Object.keys(configs))mountCoach(kind);
  import('/assets/bmi.js').then(module=>{bmi=module;document.dispatchEvent(new Event('drman:health-record-request'));}).catch(()=>document.dispatchEvent(new Event('drman:health-record-request')));
})();
