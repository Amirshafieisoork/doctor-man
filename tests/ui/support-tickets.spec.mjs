import {test,expect} from '@playwright/test';

const id='33333333-3333-4333-8333-333333333333';
const stamp='2026-10-14T08:30:00.000Z';
const original={id,user_id:'11111111-1111-4111-8111-111111111111',title:'اشکال ورود',category:'account',status:'waiting_admin',ai_enabled:true,tags:['پیگیری'],created_at:stamp,updated_at:stamp};
function json(route,status,data){return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});}
async function service(page,{unauthorized=false,failedPost=false,manual=false,ticket=null,messages=[]}={}){
  const state={ticket:ticket?{...ticket}:null,messages:[...messages],posts:[]};
  await page.route('**/api/**',route=>json(route,401,{success:false,error:'وارد حساب شوید'}));
  await page.route('**/api/support-tickets**',route=>{
    const request=route.request(),url=new URL(request.url());
    if(unauthorized)return json(route,401,{success:false,error:'ابتدا وارد حساب شوید'});
    if(request.method()==='GET'){
      if(url.searchParams.has('ticket_id'))return state.ticket?json(route,200,{success:true,ticket:state.ticket,messages:state.messages}):json(route,404,{success:false,error:'تیکت پیدا نشد'});
      return json(route,200,{success:true,tickets:state.ticket?[state.ticket]:[]});
    }
    const body=request.postDataJSON();state.posts.push(body);
    if(failedPost)return json(route,503,{success:false,error:'ثبت پیام موقتاً در دسترس نیست؛ دوباره تلاش کنید'});
    if(!state.ticket)state.ticket={...original,title:body.title,category:body.category};
    state.messages.push({id:'user-'+state.messages.length,sender_type:'user',content:body.message,created_at:stamp});
    if(!manual){state.messages.push({id:'ai-'+state.messages.length,sender_type:'assistant',content:'برای بررسی ورود، شماره حساب را با ۰۹ وارد کنید.',created_at:stamp});state.ticket.status='waiting_user';}
    return json(route,200,{success:true,ticket:state.ticket,messages:state.messages,...(manual?{pending_admin:true,ai_unavailable:true}:{answer:'برای بررسی ورود، شماره حساب را با ۰۹ وارد کنید.'})});
  });
  return state;
}

async function draft(page){await page.getByLabel('موضوع درخواست').fill('اشکال ورود');await page.getByLabel('دسته درخواست').selectOption('account');await page.getByLabel('پیام درخواست').fill('رمز حساب کار نمی‌کند');}

test('users can register a persistent ticket and reopen its saved conversation',async({page})=>{
  const state=await service(page);await page.goto('/support');await draft(page);
  await page.getByRole('button',{name:'ثبت تیکت و دریافت پاسخ'}).click();
  await expect(page.locator('#messages')).toContainText('رمز حساب کار نمی‌کند');await expect(page.locator('#messages')).toContainText('شماره حساب را با ۰۹');
  expect(state.posts).toEqual([{title:'اشکال ورود',category:'account',message:'رمز حساب کار نمی‌کند'}]);
  await expect(page).toHaveURL(new RegExp('/support\\?ticket='+id+'$'));
  await page.reload();await expect(page.locator('#conversationTitle')).toHaveText('اشکال ورود');await expect(page.locator('#messages')).toContainText('رمز حساب کار نمی‌کند');
  await page.getByLabel('پیام به پشتیبانی').fill('هنوز وارد نمی‌شوم');await page.getByRole('button',{name:'ارسال پیام',exact:true}).click();
  expect(state.posts[1]).toEqual({ticket_id:id,message:'هنوز وارد نمی‌شوم'});await expect(page.locator('#messages')).toContainText('هنوز وارد نمی‌شوم');await expect(page.locator('#input')).toHaveValue('');
});

test('AI outages keep the ticket saved and available for human support',async({page})=>{
  await service(page,{manual:true});await page.goto('/support');await draft(page);await page.getByRole('button',{name:'ثبت تیکت و دریافت پاسخ'}).click();
  await expect(page.locator('#meta')).toContainText('پیام شما ثبت شد');await expect(page.locator('#meta')).toContainText('منتظر پیگیری مدیر');await expect(page.locator('#messages')).toContainText('رمز حساب کار نمی‌کند');
  await expect(page.getByRole('button',{name:'ارسال پیام',exact:true})).toBeEnabled();
  await page.reload();await expect(page.locator('#messages')).toContainText('رمز حساب کار نمی‌کند');await expect(page.locator('#ticketStatus')).toContainText('منتظر پاسخ');
});

test('unauthenticated visitors get a safe login link and cannot submit a private ticket',async({page})=>{
  const state=await service(page,{unauthorized:true});await page.goto('/support');
  await expect(page.locator('#loginNote')).toBeVisible();await expect(page.locator('#loginNote a')).toHaveAttribute('href','/auth?next=/support');
  await expect(page.getByRole('button',{name:'درخواست تازه'})).toBeDisabled();await expect(page.locator('#createTicket')).toBeHidden();expect(state.posts).toHaveLength(0);
  await expect(page.getByText('چطور شروع کنم؟',{exact:true})).toBeVisible();
});

test('failed ticket writes retain the draft and release the submit button',async({page})=>{
  await service(page,{failedPost:true});await page.goto('/support');await draft(page);await page.getByRole('button',{name:'ثبت تیکت و دریافت پاسخ'}).click();
  await expect(page.locator('#meta')).toContainText('موقتاً در دسترس نیست');await expect(page.getByLabel('موضوع درخواست')).toHaveValue('اشکال ورود');await expect(page.getByLabel('پیام درخواست')).toHaveValue('رمز حساب کار نمی‌کند');
  await expect(page.getByRole('button',{name:'ثبت تیکت و دریافت پاسخ'})).toBeEnabled();
});

test('owner responses and a human takeover become visible when the conversation refreshes',async({page})=>{
  const state=await service(page,{ticket:original,messages:[{id:'u',sender_type:'user',content:'درخواست اولیه',created_at:stamp}]});await page.goto('/support?ticket='+id);await expect(page.locator('#messages')).toContainText('درخواست اولیه');
  state.ticket.ai_enabled=false;state.ticket.status='waiting_user';state.messages.push({id:'admin',sender_type:'admin',content:'حساب شما بررسی شد؛ دوباره وارد شوید.',created_at:stamp});
  await page.getByRole('button',{name:'دریافت پاسخ‌های تازه'}).click();await expect(page.locator('#messages')).toContainText('مدیر پشتیبانی');await expect(page.locator('#messages')).toContainText('حساب شما بررسی شد');await expect(page.locator('#ticketAi')).toHaveText('پیگیری توسط مدیر');await expect(page.locator('#ticketTags')).toContainText('پیگیری');
});

test('closed tickets keep their archive visible and offer a fresh request',async({page})=>{
  await service(page,{ticket:{...original,status:'closed'},messages:[{id:'admin',sender_type:'admin',content:'مشکل رفع شد.',created_at:stamp}]});await page.goto('/support?ticket='+id);
  await expect(page.locator('#messages')).toContainText('مشکل رفع شد');await expect(page.locator('#replyTicket')).toBeHidden();await expect(page.locator('#closedNote')).toBeVisible();
  await page.getByRole('button',{name:'درخواست تازه'}).click();await expect(page.getByLabel('موضوع درخواست')).toBeVisible();await expect(page).toHaveURL(/\/support$/);
});

test('conversation content and labels render as text instead of executable HTML',async({page})=>{
  const attack='<img src=x onerror="window.ticketXss=true">';await service(page,{ticket:{...original,title:attack,tags:[attack]},messages:[{id:'admin',sender_type:'admin',content:attack,created_at:stamp}]});await page.goto('/support?ticket='+id);
  await expect(page.locator('#conversationTitle')).toHaveText(attack);await expect(page.locator('#messages')).toContainText(attack);await expect(page.locator('#messages img')).toHaveCount(0);expect(await page.evaluate(()=>window.ticketXss)).toBeUndefined();
});

test('support fits the viewport and retains accessible forms on mobile and desktop',async({page})=>{
  await service(page);await page.goto('/support');await expect(page.getByLabel('موضوع درخواست')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});

test('an older conversation load cannot overwrite a newly selected request draft',async({page})=>{
  await service(page,{ticket:original});let release,entered;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/support-tickets?ticket_id=*',async route=>{entered();await gate;return json(route,200,{success:true,ticket:original,messages:[]});});
  await page.goto('/support');await expect(page.getByLabel('موضوع درخواست')).toBeVisible();
  await page.locator('.ticket').click();await started;
  await page.getByRole('button',{name:'درخواست تازه'}).click();await page.getByLabel('موضوع درخواست').fill('درخواست جدید');
  release();await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('موضوع درخواست')).toBeVisible();await expect(page.getByLabel('موضوع درخواست')).toHaveValue('درخواست جدید');await expect(page.locator('#conversation')).toBeHidden();
});

test('expired sessions clear the displayed private conversation before offering login',async({page})=>{
  await service(page,{ticket:original,messages:[{id:'u',sender_type:'user',content:'گفتگوی خصوصی',created_at:stamp}]});await page.goto('/support?ticket='+id);await expect(page.locator('#messages')).toContainText('گفتگوی خصوصی');
  await page.route('**/api/support-tickets?ticket_id=*',route=>json(route,401,{success:false,error:'نشست معتبر نیست'}));
  await page.getByRole('button',{name:'دریافت پاسخ‌های تازه'}).click();
  await expect(page.locator('#loginNote')).toBeVisible();await expect(page.locator('#messages')).toBeEmpty();await expect(page.locator('#conversation')).toBeHidden();
});
