import { test, expect } from '@playwright/test';

const self='archive-self',child='archive-child';
const patients=[{id:self,display_name:'پرونده من',relation:'self',sex:'female'},{id:child,display_name:'پرونده خانواده',relation:'child',sex:'unknown'}];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7r8AAAAASUVORK5CYII=','base64');
function syntheticPdf(){
  const stream='BT /F1 24 Tf 40 200 Td (Synthetic medical PDF) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(body));body+=(index+1)+' 0 obj\n'+object+'\nendobj\n'});
  const xref=Buffer.byteLength(body);body+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(body);
}
const pdf=syntheticPdf();
const documentFile=(id='doc',patient_id=self)=>({id,source:'document',patient_id,patient_name:patient_id===self?'پرونده من':'پرونده خانواده',title:'نسخه اصلی',mime_type:'image/png',document_type:'prescription',created_at:'2026-10-12T09:00:00Z',original_filename:'نسخه.png'});
const labFile=(id='lab',patient_id=self)=>({id,result_id:id,source:'lab',patient_id,title:'آزمایش اصلی',mime_type:'image/png',document_type:'lab',page_index:0,created_at:'2026-10-12T09:00:00Z'});
const json=(route,status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};

test.beforeEach(async({page})=>{
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(['chrome-extension:','chrome:'].includes(url.protocol))return route.continue();
    if(url.hostname==='synthetic.supabase.co'&&url.pathname.startsWith('/storage/v1/object/sign/'))return route.fulfill({contentType:url.pathname.endsWith('.pdf')?'application/pdf':'image/png',body:url.pathname.endsWith('.pdf')?pdf:png});
    if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort('blockedbyclient');
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/patients')return json(route,200,{success:true,patients});
    if(url.pathname==='/api/health-record')return json(route,200,{record:{archive_files:[]}});
    if(url.pathname==='/api/medical-archive'){const pid=url.searchParams.get('patient_id');return json(route,200,{success:true,patient:{id:pid},files:[documentFile('doc',pid),labFile('lab',pid)],next_offset:null})}
    if(url.pathname==='/api/medical-file')return json(route,200,{success:true,url:'https://synthetic.supabase.co/storage/v1/object/sign/lab-images/original.png?token=synthetic',title:'فایل ذخیره‌شده',mime_type:'image/png',expires_in:300,filename:'original.png'});
    if(url.pathname==='/api/notifications')return json(route,200,{notifications:[],unread:0});
    if(['/api/care-plan','/api/care-episodes','/api/biomarker-trends'].includes(url.pathname))return json(route,200,{success:true});
    if(url.pathname==='/api/account-deletion-request')return json(route,200,{success:true,request:null});
    return json(route,404,{success:false,error:'درخواست آزمون تعریف نشده است'});
  });
});

const openArchive=async page=>{await page.goto('/health');await expect(page.locator('#patientSexSave')).toBeEnabled();await page.locator('[data-page="documentsPage"]').click();await expect(page.locator('#documents .archive-item')).toHaveCount(2)};

test('archive opens originals without AI consent, escapes stored metadata, and restores focus after Escape',async({page})=>{
  const apiCalls=[];page.on('request',request=>{if(request.url().includes('/api/'))apiCalls.push(new URL(request.url()).pathname)});
  const malicious='<img src=x onerror="window.archiveExecuted=true"><script>window.archiveExecuted=true</script>';
  await page.route('**/api/medical-archive**',route=>json(route,200,{success:true,patient:{id:self},files:[{...documentFile(),title:malicious},labFile()]}));
  await openArchive(page);
  await expect(page.locator('#documents')).toContainText(malicious);
  await expect(page.locator('#documents img,#documents script')).toHaveCount(0);
  const view=page.locator('#documents .archive-item').first().getByRole('button',{name:'مشاهده فایل',exact:true});
  await view.click();await expect(page.locator('#medicalFileContent img')).toBeVisible();
  await expect(page.locator('#medicalFileTitle')).toContainText(malicious);
  await expect(page.locator('#medicalFileStatus')).toContainText('تصویر ذخیره‌شده پزشکی');
  await page.keyboard.press('Escape');await expect(page.locator('#medicalFileDialog')).not.toBeVisible();await expect(view).toBeFocused();
  expect(apiCalls).not.toContain('/api/consent');expect(apiCalls).not.toContain('/api/analyze');
  expect(await page.evaluate(()=>window.archiveExecuted)).toBeUndefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('valid PDF files render in the browser and downloads request a separate signed attachment',async({page},testInfo)=>{
  const calls=[];
  await page.route('**/api/medical-file**',route=>{const url=new URL(route.request().url());calls.push(Object.fromEntries(url.searchParams));return json(route,200,{success:true,url:'https://synthetic.supabase.co/storage/v1/object/sign/medical-documents/original.pdf?token=synthetic',mime_type:'application/pdf',filename:'original.pdf',title:'نسخه اصلی',expires_in:300})});
  await openArchive(page);await page.locator('#documents .archive-item').first().getByRole('button',{name:'مشاهده فایل',exact:true}).click();
  await expect(page.locator('#medicalFileContent iframe')).not.toHaveAttribute('sandbox',/.*/);
  await expect(page.locator('#medicalFileOpen')).toHaveAttribute('href',/^https:\/\/synthetic\.supabase\.co\/storage\/v1\/object\/sign\//);
  await expect.poll(async()=>{for(const frame of page.frames())if(frame.url().startsWith('chrome-extension://')){try{if(await frame.locator('embed').count())return true}catch{}}return false}).toBe(true);
  await page.locator('#medicalFileDialog').screenshot({path:testInfo.outputPath('pdf-rendered.png')});
  await expect(page.locator('#medicalFileContent iframe')).toHaveAttribute('referrerpolicy','no-referrer');
  await expect(page.locator('#medicalFileDownload')).toBeEnabled();
  await page.evaluate(()=>{HTMLAnchorElement.prototype.click=function(){window.syntheticAttachment={url:this.href,filename:this.download,rel:this.rel}}});
  await page.locator('#medicalFileDownload').click();await expect.poll(()=>calls.length).toBe(2);
  expect(calls[1]).toMatchObject({source:'document',id:'doc',download:'true'});
  await expect.poll(()=>page.evaluate(()=>window.syntheticAttachment?.filename)).toBe('original.pdf');
  expect(await page.evaluate(()=>window.syntheticAttachment.rel)).toBe('noopener noreferrer');
});

test('archive pagination preserves earlier original files and avoids duplicate rows',async({page})=>{
  const offsets=[];
  await page.route('**/api/medical-archive**',route=>{const offset=Number(new URL(route.request().url()).searchParams.get('offset')||0);offsets.push(offset);return json(route,200,{success:true,patient:{id:self},files:offset?[labFile(),documentFile('older')]:[documentFile(),labFile()],next_offset:offset?null:50})});
  await openArchive(page);await expect(page.locator('#archiveMore')).toBeVisible();await page.locator('#archiveMore').click();
  await expect(page.locator('#documents .archive-item')).toHaveCount(3);await expect(page.locator('#archiveMore')).toBeHidden();expect(offsets).toEqual([0,50]);
});

test('an archive outage offers retry while a corrupt source image offers a readable download fallback',async({page})=>{
  let calls=0;await page.route('**/api/medical-archive**',route=>++calls===1?json(route,503,{success:false,error:'موقتاً در دسترس نیست'}):json(route,200,{success:true,patient:{id:self},files:[documentFile()]}));
  await page.goto('/health#documentsPage');await expect(page.locator('#archiveRetry')).toBeVisible();await expect(page.locator('#archiveStatus')).toContainText('فایل‌ها دریافت نشد');
  await page.locator('#archiveRetry').click();await expect(page.locator('#documents .archive-item')).toHaveCount(1);await expect(page.locator('#archiveRetry')).toBeHidden();
  await page.route('**/storage/v1/object/sign/**',route=>route.fulfill({contentType:'image/png',body:'corrupt-synthetic-image'}));
  await page.getByRole('button',{name:'مشاهده فایل',exact:true}).click();await expect(page.locator('#medicalFileStatus')).toContainText('نمایش فایل انجام نشد');await expect(page.locator('#medicalFileRetry')).toBeVisible();await expect(page.locator('#medicalFileDownload')).toBeEnabled();
});

test('file upload saves without AI consent and a late save cannot close another family upload form',async({page})=>{
  const saved=deferred(),done=deferred();let payload,requests=0;const calls=[];
  page.on('request',request=>{if(request.url().includes('/api/'))calls.push(new URL(request.url()).pathname)});
  await page.route('**/api/documents',async route=>{requests++;payload=route.request().postDataBuffer().toString('utf8');await saved.promise;await json(route,201,{success:true,document:{id:'uploaded'}});done.resolve()});
  await page.goto('/health');await expect(page.locator('#patientSexSave')).toBeEnabled();await page.getByRole('button',{name:'+ سند پزشکی',exact:true}).click();
  await page.locator('#docTitle').fill('فایل پرونده من');await page.locator('#docFile').setInputFiles({name:'original.png',mimeType:'image/png',buffer:png});await page.locator('#docModal button.primary').click();await expect.poll(()=>requests).toBe(1);
  await page.locator('#patientSelect').evaluate(select=>{select.value='archive-child';select.dispatchEvent(new Event('change',{bubbles:true}))});await expect(page.locator('#patientSexSave')).toBeEnabled();await page.getByRole('button',{name:'+ سند پزشکی',exact:true}).click();
  await expect(page.locator('#docFile')).toHaveValue('');await page.locator('#docTitle').fill('فایل تازه خانواده');saved.resolve();await done.promise;
  await expect(page.locator('#docModal')).toBeVisible();await expect(page.locator('#docTitle')).toHaveValue('فایل تازه خانواده');await expect(page.locator('#docModal button.primary')).toBeEnabled();
  expect(payload).toMatch(/name="patient_id"\r\n\r\narchive-self/);expect(payload).toContain('فایل پرونده من');expect(calls).not.toContain('/api/consent');
});

test('late original signing cannot replace the newly selected family viewer',async({page})=>{
  const first=deferred(),done=deferred();let selfCalls=0;
  await page.route('**/api/medical-file**',async route=>{const url=new URL(route.request().url());if(url.searchParams.get('id')==='self-doc'){selfCalls++;await first.promise;await json(route,200,{success:true,url:'https://synthetic.supabase.co/storage/v1/object/sign/medical-documents/private-self.png?token=synthetic',title:'فایل من',mime_type:'image/png'}).catch(()=>{});done.resolve();return}return json(route,200,{success:true,url:'https://synthetic.supabase.co/storage/v1/object/sign/medical-documents/child.png?token=synthetic',mime_type:'image/png',title:'فایل خانواده'})});
  await page.route('**/api/medical-archive**',route=>{const pid=new URL(route.request().url()).searchParams.get('patient_id');return json(route,200,{success:true,patient:{id:pid},files:[{...documentFile(pid===self?'self-doc':'child-doc',pid),title:pid===self?'فایل من':'فایل خانواده'}]})});
  await page.goto('/health#documentsPage');await expect(page.locator('#documents .archive-item')).toHaveCount(1);await page.getByRole('button',{name:'مشاهده فایل',exact:true}).click();await expect.poll(()=>selfCalls).toBe(1);
  await page.locator('#patientSelect').evaluate(select=>{select.value='archive-child';select.dispatchEvent(new Event('change',{bubbles:true}))});
  await expect(page.locator('#medicalFileDialog')).not.toBeVisible();await expect(page.locator('#documents')).toContainText('فایل خانواده');
  await page.getByRole('button',{name:'مشاهده فایل',exact:true}).click();await expect(page.locator('#medicalFileContent img')).toHaveAttribute('src',/child\.png/);
  first.resolve();await done.promise;await expect(page.locator('#medicalFileTitle')).toContainText('فایل خانواده');await expect(page.locator('#medicalFileContent img')).toHaveAttribute('src',/child\.png/);
});

for(const [label,url,mime] of [['script','javascript:alert(1)','image/png'],['data','data:text/html,<script>alert(1)</script>','image/png'],['public','https://example.supabase.co/storage/v1/object/public/lab-images/file.png','image/png'],['foreign signed path','https://example.com/storage/v1/object/sign/lab-images/file.png','image/png'],['HTML','/storage/v1/object/sign/lab-images/file.html','text/html'],['SVG','/storage/v1/object/sign/lab-images/file.svg','image/svg+xml']]){
  test('original viewer rejects '+label+' without embedding or navigating',async({page})=>{
    await page.route('**/api/medical-file**',route=>json(route,200,{success:true,url,mime_type:mime}));
    await openArchive(page);await page.locator('#documents .archive-item').first().getByRole('button',{name:'مشاهده فایل',exact:true}).click();
    await expect(page.locator('#medicalFileRetry')).toBeVisible();await expect(page.locator('#medicalFileContent img,#medicalFileContent iframe')).toHaveCount(0);await expect(page.locator('#medicalFileDownload')).toBeDisabled();
  });
}

test('unknown sex requires an explicit female or male selection without an inferred default',async({page})=>{
  const writes=[];await page.route('**/api/patients',route=>{if(route.request().method()==='PATCH'){writes.push(route.request().postDataJSON());return json(route,200,{success:true,patient:{id:child,sex:'male'}})}return json(route,200,{success:true,patients})});
  await page.goto('/health');await expect(page.locator('#patientSex')).toHaveValue('female');await page.locator('#patientSelect').selectOption(child);await expect(page.locator('#patientSexSave')).toBeEnabled();
  await expect(page.locator('#patientSexPrompt')).toBeVisible();await expect(page.locator('#patientSex')).toHaveValue('');await page.locator('#patientSexSave').click();expect(writes).toEqual([]);
  expect(await page.locator('#patientSex option').evaluateAll(options=>options.map(option=>option.value))).toEqual(['','female','male']);
  await page.locator('#patientSex').selectOption('male');await page.locator('#patientSexSave').click();await expect(page.locator('#patientSexStatus')).toContainText('ثبت شد');expect(writes).toEqual([{id:child,sex:'male'}]);await expect(page.locator('#patientSexPrompt')).toBeHidden();
  await page.getByRole('button',{name:'+ عضو خانواده',exact:true}).click();await expect(page.locator('#fSex')).toHaveValue('');await expect(page.locator('#fSex')).toHaveAttribute('required','');expect(await page.locator('#fSex option').evaluateAll(options=>options.map(option=>option.value))).toEqual(['','female','male']);
});

test('account history opens original lab files through signing and links to the family archive',async({page})=>{
  const calls=[];
  await page.route('**/api/account',route=>json(route,200,{success:true,user:{name:'کاربر آزمون'},subscription:{plan:{name:'رایگان'},remaining:1},payments:[],tests:[{id:'historical-result',gender:'female',age:40,analysis:'تفسیر',reason:'آزمایش قبلی',created_at:'2026-10-12',image_urls:['https://example.supabase.co/storage/v1/object/public/lab-images/old.png']}]}));
  await page.route('**/api/medical-file**',route=>{const url=new URL(route.request().url());calls.push(Object.fromEntries(url.searchParams));return json(route,200,{success:true,url:'https://synthetic.supabase.co/storage/v1/object/sign/lab-images/historical.png?token=synthetic',mime_type:'image/png',title:'اصل آزمایش'})});
  await page.addInitScript(()=>{window.open=(url,target,features)=>{window.syntheticOpened={url,target,features};return null}});
  await page.goto('/account');await page.getByRole('button',{name:'مشاهده تصویر ذخیره‌شده آزمایش',exact:true}).click();
  await expect(page.locator('#fileState')).toContainText('تصویر ذخیره‌شده آماده شد');expect(calls).toEqual([{source:'lab',id:'historical-result',page:'0'}]);
  expect(await page.evaluate(()=>window.syntheticOpened.url)).toContain('/storage/v1/object/sign/');expect(await page.evaluate(()=>window.syntheticOpened.features)).toBe('noopener,noreferrer');
  await expect(page.getByRole('link',{name:'آرشیو فایل‌های پزشکی',exact:true})).toHaveAttribute('href','/health#documentsPage');await expect(page.locator('#records img')).toHaveCount(0);
});
