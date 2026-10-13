import { test, expect } from '@playwright/test';

test('signup accepts international Persian mobile input and proceeds to the server', async ({ page }) => {
  let submitted;
  await page.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'ابتدا وارد حساب شوید' }) }));
  await page.route('**/api/register', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'ثبت‌نام موقتاً در دسترس نیست.' }) });
  });
  await page.goto('/auth');
  await page.getByRole('tab', { name: 'ثبت‌نام', exact: true }).click();
  await page.getByLabel('نام', { exact: true }).fill('کاربر آزمایشی');
  await page.getByLabel('شماره موبایل', { exact: true }).last().fill('+۹۸ (۹۱۲) ۳۴۵-۶۷۸۹');
  await page.getByLabel('رمز عبور (حداقل ۸ کاراکتر)').fill('test-only-password');
  await page.getByRole('button', { name: 'ساخت حساب رایگان' }).click();
  await expect(page.locator('#msg')).toContainText('ثبت‌نام موقتاً');
  expect(submitted.phone).toBe('09123456789');
  await expect(page.getByRole('button', { name: 'ساخت حساب رایگان' })).toBeEnabled();
});

test('an account created by an earlier failed signup can proceed to login without re-registering', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'ابتدا وارد حساب شوید' }) }));
  await page.route('**/api/register', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'این شماره قبلاً ثبت شده است' }) }));
  await page.goto('/auth');
  await page.getByRole('tab', { name: 'ثبت‌نام', exact: true }).click();
  await page.getByLabel('نام', { exact: true }).fill('کاربر آزمایشی');
  await page.getByLabel('شماره موبایل', { exact: true }).last().fill('00989123456789');
  await page.getByLabel('رمز عبور (حداقل ۸ کاراکتر)').fill('test-only-password');
  await page.getByRole('button', { name: 'ساخت حساب رایگان' }).click();
  await expect(page.getByRole('tab', { name: 'ورود', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#lp')).toHaveValue('09123456789');
  await expect(page.locator('#lw')).toHaveValue('');
  await expect(page.locator('#lw')).toBeFocused();
  await expect(page.locator('#msg')).toContainText('با رمز همان حساب وارد شوید');
  await expect(page.getByRole('button', { name: 'ورود به حساب', exact: true })).toBeEnabled();
});
