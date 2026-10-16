import {test,expect} from '@playwright/test';
import {diagnosticOrderWithPreparation} from '../../server/api/_lib/lab-preparation.js';

const patient={id:'prep-self',display_name:'پرونده ساختگی آمادگی آزمایش',relation:'self',sex:'female'};
const order=diagnosticOrderWithPreparation({id:'prep-order',order_type:'lab',items:['PRL','FBS','CBC','آزمایش ناشناخته'],status:'ordered',ordered_at:'2026-10-16T08:00:00Z'});
const json=(route,body)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,...body})});
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort('blockedbyclient');if(!url.pathname.startsWith('/api/'))return route.continue();if(url.pathname==='/api/patients')return json(route,{patients:[patient]});if(url.pathname==='/api/health-record')return json(route,{patient,record:{diagnostic_orders:[order]}});return json(route,{notifications:[],unread:0});});
});
test('physician-ordered tests show preparation before the test, sources and a Persian review date',async({page})=>{
 await page.goto('/health');await expect(page.locator('#diagnostics .lab-preparation')).toHaveCount(1);
 await page.locator('[data-page=history]').click();
 const guidance=page.locator('#diagnostics .lab-preparation');await expect(guidance).toBeVisible();await expect(guidance).toContainText('پرولاکتین');await expect(guidance).toContainText('ورزش شدید');await expect(guidance).toContainText('به‌تنهایی معمولاً آمادگی ویژه');await expect(guidance).toContainText('آزمایش ناشناخته');await expect(guidance).toContainText('راهنمای اختصاصی تأییدشده');await expect(guidance).toContainText('۱۴۰۵');await expect(guidance).not.toContainText('2026-10-16');
 const source=guidance.getByRole('link',{name:'NHS · شرایط نمونه پرولاکتین'});await expect(source).toHaveAttribute('rel','noopener noreferrer');await expect(source).toHaveAttribute('referrerpolicy','no-referrer');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('unknown stored text is escaped and untrusted source URLs never become links',async({page})=>{
 await page.goto('/health');const result=await page.evaluate(()=>{const p={version:'lab-preparation-v1',title:'آمادگی',general:['<img src=x onerror=alert(1)>'],tests:[{title:'<script>bad()</script>',steps:['<img src=x>'],sources:[{label:'بد',url:'javascript:alert(1)'},{label:'ردگیری',url:'https://example.com/track'}]}],unrecognized_items:['<iframe src=x>']};const host=document.createElement('div');host.innerHTML=window.DrManLabPreparation.html(p);return{html:host.innerHTML,unsafe:host.querySelectorAll('img,script,iframe,a').length,text:host.textContent}});expect(result.unsafe).toBe(0);expect(result.text).toContain('<img src=x onerror=alert(1)>');
});
test('doctors see the same preparation with the existing scoped record',async({page})=>{
 await page.route('**/api/doctor-dashboard',route=>json(route,{doctor:{id:'prep-doctor',full_name:'پزشک ساختگی',verification_status:'verified'},patients:[{patients:patient,scope:['clinical_history']}]}));
 await page.route('**/api/doctor-patient-record?**',route=>json(route,{record:{patient,scope:['clinical_history'],permissions:{},diagnostic_orders:[order]}}));await page.goto('/doctor-portal');await page.locator('[data-patient="prep-self"]').first().click();await expect(page.locator('#record .lab-preparation')).toBeVisible();await expect(page.locator('#record .lab-preparation')).toContainText('پرولاکتین');await expect(page.locator('#record .lab-preparation')).toContainText('دارویی را خودسرانه قطع نکنید');
});
