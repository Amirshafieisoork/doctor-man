import {test,expect} from '@playwright/test';

const token='A'.repeat(43);
async function loggedOut(page){await page.route('**/api/**',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'ابتدا وارد شوید'})}));}

test('forgot password normalizes Persian phone numbers and honestly queues support recovery',async({page})=>{
  await loggedOut(page);let submitted;
  await page.route('**/api/password-reset-request',route=>{submitted=route.request().postDataJSON();return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({success:true,message:'درخواست بازیابی برای پشتیبانی ثبت شد.'})});});
  await page.goto('/auth');
  await page.locator('#lp').fill('+۹۸ (۹۱۲) ۳۴۵-۶۷۸۹');
  await page.getByRole('button',{name:'رمز عبور را فراموش کرده‌ام'}).click();
  await expect(page.getByRole('tablist')).toBeHidden();
  await expect(page.getByLabel('شماره موبایل حساب')).toHaveValue('+۹۸ (۹۱۲) ۳۴۵-۶۷۸۹');
  await page.getByRole('button',{name:'ثبت درخواست بازیابی'}).click();
  expect(submitted).toEqual({phone:'09123456789'});
  await expect(page.locator('#msg')).toContainText('برای پشتیبانی ثبت شد');
  await expect(page.getByRole('button',{name:'ثبت درخواست بازیابی'})).toBeEnabled();
  await page.getByRole('button',{name:'بازگشت به ورود'}).click();
  await expect(page.getByRole('tab',{name:'ورود',exact:true})).toHaveAttribute('aria-selected','true');
});

test('one-use reset links are removed from the address bar, require matching passwords, and never auto-login',async({page})=>{
  await loggedOut(page);const submitted=[];
  await page.route('**/api/password-reset',route=>{submitted.push(route.request().postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,message:'رمز عبور تغییر کرد. با رمز جدید وارد حساب شوید.'})});});
  await page.goto('/auth#reset='+token);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole('heading',{name:'انتخاب رمز جدید'})).toBeVisible();
  await expect(page.getByRole('tablist')).toBeHidden();
  await page.getByLabel('رمز جدید (حداقل ۸ کاراکتر)').fill('new-test-password');
  await page.getByLabel('تکرار رمز جدید').fill('wrong-test-password');
  await page.getByRole('button',{name:'ذخیره رمز جدید'}).click();
  await expect(page.locator('#msg')).toContainText('یکسان نیست');expect(submitted).toHaveLength(0);
  await page.getByLabel('تکرار رمز جدید').fill('new-test-password');
  await page.getByRole('button',{name:'ذخیره رمز جدید'}).click();
  expect(submitted).toEqual([{token,password:'new-test-password'}]);
  await expect(page.getByRole('tab',{name:'ورود',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#msg')).toContainText('با رمز جدید وارد');
  await expect(page.locator('#lw')).toHaveValue('');await expect(page).toHaveURL(/\/auth$/);
  await expect(page.locator('#np')).toHaveValue('');await expect(page.locator('#nc')).toHaveValue('');
});

test('an expired reset link explains the failure and offers a fresh recovery request',async({page})=>{
  await loggedOut(page);
  await page.route('**/api/password-reset',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({success:false,code:'RESET_LINK_INVALID',error:'پیوند بازنشانی استفاده شده یا منقضی شده است. پیوند تازه درخواست کنید.'})}));
  await page.goto('/auth#reset='+token);
  await page.getByLabel('رمز جدید (حداقل ۸ کاراکتر)').fill('new-test-password');
  await page.getByLabel('تکرار رمز جدید').fill('new-test-password');
  await page.getByRole('button',{name:'ذخیره رمز جدید'}).click();
  await expect(page.locator('#msg')).toContainText('منقضی');
  await expect(page.getByRole('button',{name:'ذخیره رمز جدید'})).toBeEnabled();
  await page.getByRole('button',{name:'درخواست پیوند تازه'}).click();
  await expect(page.getByLabel('شماره موبایل حساب')).toBeVisible();
});

test('recovery remains available to a browser with an existing user session',async({page})=>{
  await page.route('**/api/account',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,user:{id:'existing-user'}})}));
  await page.goto('/auth#reset='+token);
  await expect(page.getByRole('heading',{name:'انتخاب رمز جدید'})).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);
});
