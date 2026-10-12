import { test, expect } from '@playwright/test';

// Render the real generated doctor page from synthetic server rows. Every
// browser API and external request is intercepted; no account or booking exists.
process.env.SUPABASE_URL = 'https://doctor-ui-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-database-key';
const { supabase } = await import('../../server/api/_lib/db.js');
const { default: doctorPage } = await import('../../server/api/doctor-page.js');

async function renderedPage() {
  supabase.from = table => {
    const query = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'gte', 'lt', 'in']) query[method] = () => query;
    const result = () => ({ data: table === 'doctor_profiles' ? {
      id: 'doctor', slug: 'lifecycle-qa', full_name: 'پزشک آزمون', specialty: 'پزشک عمومی',
      verification_status: 'verified', public_profile: true, accepts_in_person: true, timezone: 'Asia/Tehran'
    } : [] });
    query.maybeSingle = async () => result(); query.then = (yes, no) => Promise.resolve(result()).then(yes, no);
    return query;
  };
  const res = { headers: {}, status() { return this; }, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
  await doctorPage({ method: 'GET', query: { slug: 'lifecycle-qa' } }, res);
  return res.body;
}
async function json(route, status, data) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}
const slot = (organization_id, organization_name, starts_at = '2031-01-06T06:30:00.000Z') => ({
  starts_at, ends_at: '2031-01-06T07:00:00.000Z', local_time: '10:00', mode: 'in_person',
  organization_id, organization_name, organization_address: `نشانی ${organization_name}`
});

test.beforeEach(async ({ page }) => {
  const html = await renderedPage();
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname === '/doctor/lifecycle-qa') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/patients') return json(route, 200, { success: true, patients: [{ id: 'patient', display_name: 'پرونده آزمون' }] });
    if (url.pathname.startsWith('/api/')) return json(route, 503, { success: false, error: 'پاسخ آزمون' });
    return route.continue();
  });
});

test('same-time appointments show each clinic and send the selected location', async ({ page }) => {
  let submitted;
  await page.route('**/api/availability?**', route => json(route, 200, {
    success: true, slots: [slot('clinic-a', 'درمانگاه آفتاب'), slot('clinic-b', 'درمانگاه بهار')]
  }));
  await page.route('**/api/appointments', async route => {
    submitted = route.request().postDataJSON();
    await json(route, 201, { success: true, appointment: { id: 'synthetic-appointment' } });
  });
  await page.goto('/doctor/lifecycle-qa');
  await expect(page.getByRole('button', { name: '10:00 · درمانگاه آفتاب' })).toBeVisible();
  const selected = page.getByRole('button', { name: '10:00 · درمانگاه بهار' });
  await expect(selected).toHaveAttribute('title', 'نشانی درمانگاه بهار');
  await selected.click(); await page.getByRole('button', { name: 'ثبت نوبت انتخاب‌شده' }).click();
  await expect(page.getByRole('link', { name: 'شرح حال قبل از ویزیت را تکمیل کنید' })).toBeVisible();
  expect(submitted.organization_id).toBe('clinic-b'); expect(submitted.patient_id).toBe('patient');
});

test('availability service failures show an error instead of claiming the doctor has no appointments', async ({ page }) => {
  await page.route('**/api/availability?**', route => json(route, 503, { success: false, error: 'برنامه پزشک موقتاً در دسترس نیست' }));
  await page.goto('/doctor/lifecycle-qa');
  await expect(page.locator('#slots')).toHaveText('برنامه پزشک موقتاً در دسترس نیست');
  await expect(page.locator('#slots button')).toHaveCount(0);
});

test('generated doctor profile uses the shared dark theme and preserves a saved light preference', async ({ page }) => {
  await page.goto('/doctor/lifecycle-qa');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(7, 17, 30)');
  await expect(page.locator('.profile')).toHaveCSS('background-color', 'rgb(13, 27, 43)');
  await page.getByRole('button', { name: /حالت روشن$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 251, 255)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 251, 255)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('a late availability response cannot replace a newly selected date', async ({ page }) => {
  let release, firstRequest;
  const pending = new Promise(resolve => { firstRequest = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/availability?**', async route => {
    if (new URL(route.request().url()).searchParams.get('date') === '2031-01-07') {
      return json(route, 200, { success: true, slots: [slot('clinic-new', 'زمان جدید')] });
    }
    firstRequest(); await delayed;
    await json(route, 200, { success: true, slots: [slot('clinic-old', 'زمان قبلی')] });
  });
  await page.goto('/doctor/lifecycle-qa'); await pending;
  await page.locator('#date').fill('2031-01-07'); await page.locator('#date').dispatchEvent('change');
  await expect(page.getByRole('button', { name: '10:00 · زمان جدید' })).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().includes('/api/availability?') && !response.url().includes('2031-01-07'));
  release(); await oldResponse;
  await expect(page.getByRole('button', { name: '10:00 · زمان جدید' })).toBeVisible();
  await expect(page.getByRole('button', { name: '10:00 · زمان قبلی' })).toHaveCount(0);
});
