import {test,expect} from '@playwright/test';

const patients=[
  {id:'wellness-self',display_name:'پروندهٔ ساختگی من',relation:'self',sex:'male',birth_date:'1990-03-20',height_cm:175},
  {id:'wellness-family',display_name:'عضو ساختگی خانواده',relation:'child',sex:'female',birth_date:'2017-01-11',height_cm:135}
];
const nutritionAnswers={pregnancy_status:'unknown',goal:'gradual_loss',target_weight_kg:74,activity_level:'moderate',dietary_pattern:'balanced',budget:'economy',cooking_time:'quick',preferences:'عدسی و غذای خانگی',dislikes:'قارچ',meal_schedule:'ناهار در محل کار',additional_allergies:'کنجد',medical_restrictions:''};
const skinAnswers={pregnancy_status:'unknown',skin_type:'dry',skin_sensitivity:'yes',scalp_type:'flaky',urgent_symptoms:'none',skin_concerns:'خشکی پوست',current_products:'شویندهٔ ساده',additional_allergies:'عطر',hair_scalp_concerns:'شورهٔ خفیف',duration:'سه ماه',urgent_details:''};
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({success:true,...body})});
const deferred=()=>{let release;const promise=new Promise(resolve=>release=resolve);return{promise,release};};
const result=(kind,name='ساختگی',extra={})=>({kind,questionnaire:kind==='nutrition'?nutritionAnswers:skinAnswers,source:'ai',state:'ready',generated_at:'2026-10-16T06:00:00Z',ai_consent:true,disclaimer:'این راهنمای آموزشی جای برنامهٔ درمانگر را نمی‌گیرد.',sources:[{label:'راهنمای علمی تغذیه',url:'https://www.who.int/news-room/fact-sheets/detail/healthy-diet'}],program:{title:'برنامهٔ '+name,summary:'برنامهٔ عملی متناسب با پاسخ‌های همین پرونده.',based_on:['قد و وزن و سابقهٔ همین پرونده در نظر گرفته شده است.'],precautions:['حساسیت‌های شناخته‌شده رعایت شود.'],seek_care:['در صورت مشکل تازه با درمانگر تماس بگیرید.'],follow_up:['پس از یک هفته عادت‌ها را مرور کنید.'],data_limits:['نیاز انرژی فردی نسخه‌نویسی نشده است.'],...(kind==='nutrition'?{weight_goal:'هدف شما ترجیح رفتاری است؛ نتیجه تضمین نمی‌شود.',weekly_menu:[{day:'روز اول',breakfast:'عدسی سادهٔ سازگار با شرایط',lunch:'خوراک خانگی ساده',dinner:'خوراک سبزیجات',snacks:'میوهٔ مجاز و در دسترس'}],shopping_list:['عدس و سبزیجات مجاز'],habits:['صبحانه را منظم کنید.']}:{morning_steps:['شست‌وشوی ملایم با آب ولرم'],evening_steps:['پاک‌سازی آرام و مرطوب‌کنندهٔ سازگار'],weekly_steps:['واکنش پوست را یادداشت کنید.'],hair_steps:['مو را سفت نبندید.'],avoid:['محصولات محرک را کنار بگذارید.'],patch_test:'محصول تازه طبق برچسب روی قسمت کوچکی از پوست سالم بررسی شود.'})},...extra});
const empty=kind=>({kind,questionnaire:{},program:null,source:null,state:'not_started',ai_consent:true});
async function open(page,kind='nutrition'){
  await page.goto('/health');
  await page.getByRole('tab',{name:kind==='nutrition'?'برنامه غذایی هوشمند':'روتین پوست و مو',exact:true}).click();
  const mount=page.locator(kind==='nutrition'?'#nutritionCoachMount':'#skinHairCoachMount');
  await expect(mount.locator('button[type=submit]')).toBeEnabled();return mount;
}
async function fillNutrition(mount){
  await mount.locator('[name=goal]').selectOption('gradual_loss');await mount.locator('[name=target_weight_kg]').fill('74');
  await mount.locator('[name=activity_level]').selectOption('moderate');
  for(const key of ['preferences','dislikes','meal_schedule','additional_allergies'])await mount.locator('[name='+key+']').fill(nutritionAnswers[key]);
}
async function fillSkin(mount){
  for(const key of ['skin_type','skin_sensitivity','scalp_type','urgent_symptoms'])await mount.locator('[name='+key+']').selectOption(skinAnswers[key]);
  for(const key of ['skin_concerns','current_products','additional_allergies','hair_scalp_concerns','duration'])await mount.locator('[name='+key+']').fill(skinAnswers[key]);
}
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort('blockedbyclient');
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/patients')return json(route,{patients});
    if(url.pathname==='/api/notifications')return json(route,{notifications:[],unread:0});
    if(url.pathname==='/api/health-record')return json(route,{record:{vitals:[{weight_kg:82,measured_at:'2026-10-15T08:00:00Z'}],conditions:[{name:'چربی خون ثبت‌شده',status:'active'}],allergies:[{allergen:'بادام زمینی'}]}});
    if(url.pathname==='/api/wellness-coach')return json(route,empty(url.searchParams.get('kind')));
    return json(route,{});
  });
});

test('nutrition asks preferences and practical constraints, uses selected record and sends one explicit request',async({page})=>{
  const requests=[],gate=deferred();await page.route('**/api/wellness-coach**',async route=>{if(route.request().method()==='GET')return json(route,empty(new URL(route.request().url()).searchParams.get('kind')));requests.push(route.request().postDataJSON());await gate.promise;return json(route,result('nutrition'));});
  const mount=await open(page);await expect(mount.locator('.wellness-context')).toContainText('۱۷۵ سانتی‌متر');await expect(mount.locator('.wellness-context')).toContainText('۸۲ کیلوگرم');await expect(mount.locator('.wellness-context')).toContainText('چربی خون ثبت‌شده');await expect(mount.locator('.wellness-context')).toContainText('بادام زمینی');expect(requests).toEqual([]);
  await fillNutrition(mount);await mount.locator('button[type=submit]').click();await expect.poll(()=>requests.length).toBe(1);await expect(mount.locator('button[type=submit]')).toBeDisabled();await expect(mount.locator('[name=preferences]')).toBeDisabled();
  await mount.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(requests).toHaveLength(1);gate.release();
  await expect(mount.locator('.wellness-program')).toContainText('نمونهٔ وعده‌ها برای شروع');await expect(mount.locator('.wellness-program')).toContainText('عدسی ساده');await expect(mount.locator('.wellness-program')).toContainText('خریدهای پیشنهادی');expect(requests).toEqual([{patient_id:'wellness-self',kind:'nutrition',answers:nutritionAnswers}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('saved answers and program restore after reload with Persian dates and no new generation',async({page})=>{
  let saved=null,posts=0;await page.route('**/api/wellness-coach**',route=>{if(route.request().method()==='POST'){posts++;saved=result('nutrition','ذخیره‌شده');saved.questionnaire=route.request().postDataJSON().answers;return json(route,saved);}return json(route,saved?{...saved,source:'cached'}:empty('nutrition'));});
  let mount=await open(page);await fillNutrition(mount);await mount.locator('button[type=submit]').click();await expect(mount.locator('.wellness-program')).toContainText('برنامهٔ ذخیره‌شده');
  mount=await open(page);await expect(mount.locator('[name=preferences]')).toHaveValue(nutritionAnswers.preferences);await expect(mount.locator('[name=target_weight_kg]')).toHaveValue('74');await expect(mount.locator('.wellness-program')).toContainText('برنامهٔ ذخیره‌شدهٔ همین پرونده');await expect(mount.locator('.wellness-meta')).toContainText('۱۴۰۵');await expect(mount.locator('.wellness-meta')).not.toContainText('2026');expect(posts).toBe(1);
});

test('a delayed saved form cannot overwrite answers already typed by the user',async({page})=>{
  const gate=deferred();let started=0;await page.route('**/api/wellness-coach**',async route=>{started++;await gate.promise;return json(route,result('nutrition','قدیمی',{source:'cached'}));});
  const mount=await open(page);await expect.poll(()=>started).toBe(1);await mount.locator('[name=preferences]').fill('پاسخ تازهٔ من');gate.release();await expect(mount.locator('.wellness-program')).toContainText('برنامهٔ قدیمی');await expect(mount.locator('[name=preferences]')).toHaveValue('پاسخ تازهٔ من');
});

test('a late first-family result cannot appear in the next record and childhood weight targets stay unavailable',async({page})=>{
  const gate=deferred();let started=0;await page.route('**/api/wellness-coach**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='GET')return json(route,empty(url.searchParams.get('kind')));const request=route.request().postDataJSON();if(request.patient_id==='wellness-self'){started++;await gate.promise;}return json(route,result('nutrition','اطلاعات خصوصی اول'));});
  const mount=await open(page);await fillNutrition(mount);await mount.locator('button[type=submit]').click();await expect.poll(()=>started).toBe(1);await page.locator('#patientSelect').selectOption('wellness-family');await expect(mount.locator('.wellness-context')).toContainText('۱۳۵ سانتی‌متر');
  await expect(mount.locator('[name=preferences]')).toHaveValue('');await expect(mount.locator('[name=goal]')).toHaveValue('maintain');await expect(mount.locator('[name=goal] option[value=gradual_loss]')).toHaveJSProperty('disabled',true);await expect(mount.locator('[name=target_weight_kg]')).toBeHidden();gate.release();await expect(mount).not.toContainText('اطلاعات خصوصی اول');await expect(mount.locator('button[type=submit]')).toBeEnabled();
});

test('consent fallback gives useful guidance and only an explicit consent button grants and retries',async({page})=>{
  const requests=[];await page.route('**/api/consent',route=>{requests.push({url:'consent',body:route.request().postDataJSON()});return json(route,{});});
  await page.route('**/api/wellness-coach**',route=>{if(route.request().method()==='GET')return json(route,empty('nutrition'));requests.push({url:'program',body:route.request().postDataJSON()});return json(route,result('nutrition','راهنمای فعلی',{source:requests.some(row=>row.url==='consent')?'ai':'local',state:requests.some(row=>row.url==='consent')?'ready':'consent_not_granted',ai_consent:requests.some(row=>row.url==='consent')}));});
  const mount=await open(page);await mount.locator('button[type=submit]').click();await expect(mount.locator('.wellness-consent')).toBeVisible();await expect(mount.locator('.wellness-program')).toContainText('برنامهٔ راهنمای فعلی');expect(requests.map(row=>row.url)).toEqual(['program']);
  await mount.getByRole('button',{name:'اجازهٔ پردازش هوشمند و ساخت برنامه',exact:true}).click();await expect(mount.locator('.wellness-consent')).toBeHidden();await expect(mount.locator('.wellness-program')).toContainText('تهیه‌شده با هوش مصنوعی');expect(requests.map(row=>row.url)).toEqual(['program','consent','program']);expect(requests[1].body).toEqual({patient_id:'wellness-self',consent_type:'ai_processing',granted:true,version:'1'});
});

test('a consent-required response never grants automatically and service errors preserve answers for retry',async({page})=>{
  let calls=0,consent=0;await page.route('**/api/consent',route=>{consent++;return json(route,{});});await page.route('**/api/wellness-coach**',route=>{if(route.request().method()==='GET')return json(route,empty('nutrition'));calls++;if(calls===1)return json(route,{success:false,error:'اجازه لازم است.'},428);if(calls===2)return json(route,{success:false,error:'سرویس موقتاً در دسترس نیست.'},503);return json(route,result('nutrition'));});
  const mount=await open(page);await fillNutrition(mount);await mount.locator('button[type=submit]').click();await expect(mount.locator('.wellness-consent')).toBeVisible();expect(consent).toBe(0);await mount.locator('button[type=submit]').click();await expect(mount.locator('.wellness-status')).toHaveText('سرویس موقتاً در دسترس نیست.');await expect(mount.locator('[name=preferences]')).toHaveValue(nutritionAnswers.preferences);await expect(mount.locator('button[type=submit]')).toBeEnabled();await mount.locator('button[type=submit]').click();await expect(mount.locator('.wellness-program')).toBeVisible();expect(consent).toBe(0);
});

test('skin and hair questionnaire captures scalp, products and alerts and renders ordered routines',async({page})=>{
  const submitted=[];await page.route('**/api/wellness-coach**',route=>{if(route.request().method()==='GET')return json(route,empty('skin_hair'));submitted.push(route.request().postDataJSON());return json(route,result('skin_hair'));});const mount=await open(page,'skin_hair');await fillSkin(mount);await mount.locator('[name=urgent_symptoms]').selectOption('yes');await mount.locator('button[type=submit]').click();expect(submitted).toHaveLength(0);await expect(mount.locator('[name=urgent_details]')).toBeFocused();await mount.locator('[name=urgent_details]').fill('علامت مهم نیازمند بررسی');await mount.locator('button[type=submit]').click();await expect(mount.locator('.wellness-program')).toContainText('صبح‌ها، به ترتیب');await expect(mount.locator('.wellness-routines ol')).toHaveCount(2);await expect(mount.locator('.wellness-program')).toContainText('مو و پوست سر');await expect(mount.locator('.wellness-patch-test')).toBeVisible();expect(submitted).toEqual([{patient_id:'wellness-self',kind:'skin_hair',answers:{...skinAnswers,urgent_symptoms:'yes',urgent_details:'علامت مهم نیازمند بررسی'}}]);
});

test('program markup remains text, references reject unsafe URLs and layouts are readable in either theme',async({page})=>{
  const payload=result('skin_hair');payload.program.summary='<img src=x onerror="window.coachExecuted=true">';payload.sources.push({label:'پیوند خطرناک',url:'javascript:alert(1)'},{label:'دامنهٔ مشابه',url:'https://who.int.example.com/'},{label:'ساختگی',url:'https://example.com/'});await page.route('**/api/wellness-coach**',route=>json(route,{...payload,source:'cached'}));const mount=await open(page,'skin_hair');await expect(mount.locator('.wellness-program')).toContainText('<img src=x');await expect(mount.locator('.wellness-program img')).toHaveCount(0);expect(await page.evaluate(()=>window.coachExecuted)).toBeUndefined();await mount.locator('.wellness-sources summary').click();await expect(mount.locator('.wellness-sources a')).toHaveCount(1);await expect(mount.locator('.wellness-sources a')).toHaveAttribute('rel','noopener noreferrer');await expect(mount.locator('.wellness-sources a')).toHaveAttribute('href',/^https:\/\/www.who.int\//);
  for(const theme of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);const contrast=await mount.locator('.wellness-meta').evaluate(el=>{const rgba=value=>value.match(/[\d.]+/g).map(Number),blend=(one,two)=>one.slice(0,3).map((value,i)=>value*(one[3]??1)+two[i]*(1-(one[3]??1)));let background=[255,255,255];const ancestors=[];for(let parent=el;parent;parent=parent.parentElement)ancestors.unshift(parent);for(const parent of ancestors)background=blend(rgba(getComputedStyle(parent).backgroundColor),background);const lum=color=>color.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0),one=lum(blend(rgba(getComputedStyle(el).color),background)),two=lum(background);return(Math.max(one,two)+.05)/(Math.min(one,two)+.05);});expect(contrast).toBeGreaterThanOrEqual(4.5);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
});

test('an unresponsive generation times out, preserves questionnaire and allows another attempt',async({page})=>{
  await page.clock.install();let calls=0;const gate=deferred();await page.route('**/api/wellness-coach**',async route=>{if(route.request().method()==='GET')return json(route,empty('nutrition'));calls++;if(calls===1){await gate.promise;return json(route,result('nutrition')).catch(()=>{});}return json(route,result('nutrition'));});
  const mount=await open(page);await fillNutrition(mount);await mount.locator('button[type=submit]').click();await expect.poll(()=>calls).toBe(1);await page.clock.fastForward(60001);await expect(mount.locator('.wellness-status')).toContainText('بیش از حد طول کشید');await expect(mount.locator('[name=preferences]')).toHaveValue(nutritionAnswers.preferences);await expect(mount.locator('button[type=submit]')).toBeEnabled();gate.release();await mount.locator('button[type=submit]').click();await expect(mount.locator('.wellness-program')).toBeVisible();expect(calls).toBe(2);
});
