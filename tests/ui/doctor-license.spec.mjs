import { test, expect } from '@playwright/test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D1sAAAAASUVORK5CYII=', 'base64');
const doctorId = '22222222-2222-4222-8222-222222222222';
const doctor = { id: doctorId, full_name: 'پزشک آزمون', medical_license_number: '12345', specialty: 'پزشک عمومی', phone: '09123456789', city: 'تهران', verification_status: 'pending', accepts_online: true, accepts_in_person: true };
const licensed = { doctor_id: doctorId, status: 'uploaded', document: { id: '33333333-3333-4333-8333-333333333333', image_url: `/api/doctor-license?id=${doctorId}&image=1` }, ai_report: { status: 'unavailable', summary: 'بررسی اولیه خودکار انجام نشد؛ تصویر برای بررسی مدیر محفوظ است.' }, review: { decision: 'pending' } };
const missing = { status: 'missing', document: null };
const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname === '/api/doctor-license' && url.searchParams.get('image') === '1') return route.fulfill({ contentType: 'image/png', body: png });
    if (url.pathname === '/api/doctor-license') return json(route, { success: true, ...licensed });
    if (url.pathname === '/api/doctor-dashboard') return json(route, { success: true, doctor, patients: [], appointments: [], messages: [] });
    if (url.pathname === '/api/availability') return json(route, { success: true, schedule: [] });
    if (url.pathname.startsWith('/api/')) return json(route, { success: true, doctor: null, license: missing });
    return route.continue();
  });
});
test('membership requires an image, previews it and submits multipart without manual content-type', async ({ page }) => {
  let posted, contentType;
  await page.route('**/api/doctor-onboarding', route => {
    if (route.request().method() !== 'POST') return json(route, { success: true, doctor: null, license: missing });
    posted = route.request().postDataBuffer().toString(); contentType = route.request().headers()['content-type'];
    return json(route, { success: true, doctor, license: licensed });
  });
  await page.goto('/doctor-onboarding');
  await expect(page.locator('#onboardingFields')).toBeEnabled();
  await page.locator('#name').fill(doctor.full_name); await page.locator('#license').fill('12345'); await page.locator('#specialty').fill(doctor.specialty); await page.locator('#city').fill('تهران'); await page.locator('#phone').fill(doctor.phone);
  await page.locator('#submitButton').click(); expect(posted).toBeUndefined();
  await page.locator('#licenseImage').setInputFiles({ name: 'license.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('پیش‌نمایش تصویر مجوز انتخاب‌شده')).toBeVisible();
  await page.locator('#submitButton').click(); await expect(page.locator('#status')).toContainText('تصویر مجوز محفوظ شدند');
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/); expect(posted).toContain('name="license_image"'); expect(posted).toContain('name="medical_license_number"');
  await expect(page.locator('#licenseReport')).toContainText('تأیید نهایی عضویت در انتظار بررسی مدیر');
  await expect(page.locator('#licenseReport img')).toBeVisible(); await expect(page.locator('#licensePreview')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test('existing private license and admin feedback survive page reload without a new upload', async ({ page }) => {
  const feedback = { ...licensed, review: { decision: 'rejected', reason: '<img src=x onerror=alert(1)> تصویر کامل مجوز را ارسال کنید' } };
  await page.route('**/api/doctor-onboarding', route => json(route, { success: true, doctor: { ...doctor, verification_status: 'rejected' }, license: feedback }));
  await page.goto('/doctor-onboarding');
  await expect(page.locator('#licenseReport')).toContainText(feedback.review.reason);
  expect(await page.locator('#licenseImage').getAttribute('required')).toBeNull();
  await expect(page.locator('#licenseReport img')).toHaveCount(1);
  await page.reload(); await expect(page.locator('#licenseReport')).toContainText(feedback.review.reason); await expect(page.locator('#name')).toHaveValue(doctor.full_name);
});
test('doctor portal shows registration details and the saved private professional document', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('/doctor-portal');
  await page.getByRole('tab', { name: 'پروفایل و مجوز حرفه‌ای' }).click();
  await expect(page.locator('#professionalDetails')).toContainText('شماره نظام پزشکی: 12345');
  await expect(page.locator('#professionalLicense img')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ویرایش مشخصات یا بارگذاری مجدد مدرک' })).toBeVisible();
  expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
