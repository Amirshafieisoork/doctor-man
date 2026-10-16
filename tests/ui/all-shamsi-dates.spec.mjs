import { test, expect } from '@playwright/test';
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: true, ...data }) });
const patient = { id: 'calendar-patient', display_name: 'پرونده ساختگی', relation: 'self', sex: 'female', birth_date: '1990-01-01' };
const field = (page, selector) => page.locator(selector + ' + .jalali-control [data-jalali-input]');
async function intercept(page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') return json(route, { patients: [patient] });
    if (url.pathname === '/api/health-record') return json(route, { patient, record: {} });
    return json(route, { notifications: [], unread: 0 });
  });
}
test.beforeEach(async ({ page }) => intercept(page));

test('dynamic health date accepts Persian leap-day and blocks invalid date without deleting its value', async ({ page }) => {
  const bodies = [];
  await page.route('**/api/health-entry', route => { bodies.push(route.request().postDataJSON()); return json(route, {}); });
  await page.goto('/health'); await page.waitForFunction(() => !!globalThis.DrManCalendar);
  await page.evaluate(() => openAdd('condition'));
  await page.locator('#dynamicFields [name=name]').fill('بیماری ساختگی');
  const visible = field(page, '#dynamicFields [name=diagnosed_at]');
  await expect(visible).toBeVisible(); await expect(page.locator('#dynamicFields [name=diagnosed_at]')).toBeHidden();
  await visible.fill('۱۴۰۰/۱۲/۳۰'); await page.locator('#addModal button.primary').click();
  expect(bodies).toHaveLength(0); await expect(visible).toHaveValue('۱۴۰۰/۱۲/۳۰');
  expect(await visible.evaluate(input => input.validationMessage)).toContain('تقویم شمسی');
  await visible.fill('۱۳۹۹/۱۲/۳۰'); await page.locator('#addModal button.primary').click();
  await expect(page.locator('#addModal')).toBeHidden();
  expect(bodies[0]).toMatchObject({ patient_id: patient.id, type: 'condition', diagnosed_at: '2021-03-20' });
  expect(Object.keys(bodies[0]).some(key => key.startsWith('jalali'))).toBe(false);
});

test('native contract preserves required/min/max, edit-prefill, clearing and form reset', async ({ page }) => {
  await page.goto('/support'); await page.waitForFunction(() => !!globalThis.DrManCalendar);
  await page.evaluate(() => {
    const form = document.createElement('form'); form.id = 'calendarFixture';
    form.innerHTML = '<label for="calendarDate">تاریخ پیگیری</label><input id="calendarDate" name="date" type="date" required min="2025-03-20" max="2026-10-16" value="2025-03-20"><button>ثبت</button>';
    document.querySelector('main').prepend(form); DrManCalendar.enhance(form);
  });
  const visible = page.locator('#jalali-calendarDate');
  await expect(visible).toHaveValue('۱۴۰۳/۱۲/۳۰');
  await expect(page.getByLabel('تاریخ پیگیری (شمسی)', { exact: true })).toHaveAttribute('id', 'jalali-calendarDate');
  await visible.fill('۱۴۰۳/۱۲/۲۹');
  expect(await page.evaluate(() => DrManCalendar.validate(document.querySelector('#calendarFixture')))).toBe(false);
  expect(await visible.evaluate(input => input.validationMessage)).toContain('پیش از');
  await visible.fill('۱۴۰۵/۰۷/۲۵');
  expect(await page.evaluate(() => DrManCalendar.validate(document.querySelector('#calendarFixture')))).toBe(false);
  expect(await visible.evaluate(input => input.validationMessage)).toContain('پس از');
  await visible.fill('');
  expect(await page.evaluate(() => DrManCalendar.validate(document.querySelector('#calendarFixture')))).toBe(false);
  await page.evaluate(() => { document.querySelector('#calendarDate').value = '2026-10-16'; });
  await expect(visible).toHaveValue('۱۴۰۵/۰۷/۲۴');
  expect(await page.evaluate(() => Object.fromEntries(new FormData(document.querySelector('#calendarFixture'))))).toEqual({ date: '2026-10-16' });
  await page.evaluate(() => document.querySelector('#calendarFixture').reset());
  await expect(visible).toHaveValue('۱۴۰۳/۱۲/۳۰');
  await page.evaluate(() => { const input = document.querySelector('#calendarDate'); input.required = false; input.value = ''; });
  await expect(visible).toHaveValue('');
  expect(await page.evaluate(() => DrManCalendar.validate(document.querySelector('#calendarFixture')))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('datetime editing keeps Iran local clock and serializes the same UTC instant', async ({ page }) => {
  await page.goto('/support'); await page.waitForFunction(() => !!globalThis.DrManCalendar);
  await page.evaluate(() => {
    const form = document.createElement('form'); form.id = 'calendarTimeFixture';
    form.innerHTML = '<label>موعد پیگیری<input id="calendarTime" name="due_at" type="datetime-local"></label>';
    document.querySelector('main').prepend(form); DrManCalendar.enhance(form);
    document.querySelector('#calendarTime').value = DrManJalali.localDateTime('2026-10-16T11:00:00Z');
  });
  await expect(page.locator('#jalali-calendarTime')).toHaveValue('۱۴۰۵/۰۷/۲۴');
  await expect(page.locator('#jalali-calendarTime-time')).toHaveValue('14:30');
  await page.locator('#jalali-calendarTime').fill('۱۴۰۵/۰۷/۲۵');
  await page.locator('#jalali-calendarTime-time').fill('10:15');
  expect(await page.evaluate(() => DrManCalendar.validate(document.querySelector('#calendarTimeFixture')))).toBe(true);
  expect(await page.evaluate(() => new Date(document.querySelector('#calendarTime').value).toISOString())).toBe('2026-10-17T06:45:00.000Z');
  await page.locator('#jalali-calendarTime').fill('');
  expect(await page.evaluate(() => DrManCalendar.validate(document.querySelector('#calendarTimeFixture')))).toBe(false);
  expect(await page.locator('#jalali-calendarTime').evaluate(input => input.validationMessage)).toContain('تاریخ');
});

test('previsit date is Shamsi on screen and Gregorian in the saved clinical payload', async ({ page }) => {
  const writes = [];
  await page.route('**/api/previsit-intake**', route => {
    if (route.request().method() === 'GET') return json(route, { appointment: { starts_at: '2026-10-16T11:00:00Z', mode: 'in_person' }, intake: { last_menstrual_period: '2026-09-23' } });
    writes.push(route.request().postDataJSON()); return json(route, {});
  });
  await page.goto('/visit-intake?appointment_id=synthetic-calendar');
  await expect(page.locator('#jalali-lmp')).toHaveValue('۱۴۰۵/۰۷/۰۱');
  await page.locator('#jalali-lmp').fill('۱۴۰۵/۰۷/۰۲');
  await page.evaluate(() => save(false));
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].last_menstrual_period).toBe('2026-09-24');
  await page.locator('#jalali-lmp').fill('۱۴۰۴/۱۲/۳۰');
  await page.evaluate(() => save(false));
  expect(writes).toHaveLength(1);
});

test('admin task schedule prefill and changes preserve Gregorian UTC API values', async ({ page }) => {
  const writes = [], task = { id: 'calendar-task', patient_id: patient.id, title: 'پیگیری ساختگی', due_at: '2026-10-16T11:00:00Z', status: 'open', priority: 'routine', patients: patient };
  await page.route('**/api/admin-dashboard', route => json(route, { stats: {}, system: {}, plans: [], users: [], patients: [patient], doctors: [], articles: [], tasks: [], orders: [] }));
  await page.route('**/api/admin-settings', route => json(route, { settings: {} }));
  await page.route('**/api/admin-operations', route => {
    if (route.request().method() === 'PATCH') { writes.push(route.request().postDataJSON()); return json(route, {}); }
    return json(route, { tasks: [task], orders: [], episodes: [], care_plans: [] });
  });
  await page.goto('/admin'); await expect(page.locator('#app')).toBeVisible();
  await page.locator('[data-page=operations]').click(); await page.locator('#tasksBody button').click();
  await expect(page.locator('#jalali-operation_due_at')).toHaveValue('۱۴۰۵/۰۷/۲۴');
  await expect(page.locator('#jalali-operation_due_at-time')).toHaveValue('14:30');
  await page.locator('#jalali-operation_due_at').fill('۱۴۰۵/۰۷/۲۵');
  await page.locator('#jalali-operation_due_at-time').fill('10:15');
  await page.getByLabel('دلیل تغییر', { exact: true }).fill('زمان پیگیری اصلاح شد');
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(page.locator('#operationModal')).toBeHidden();
  expect(writes[0].patch.due_at).toBe('2026-10-17T06:45:00.000Z');
  expect(Object.keys(writes[0].patch).some(key => key.includes('jalali'))).toBe(false);
});

test('admin article evidence and review dates block invalid inputs and save exact Gregorian dates', async ({ page }) => {
  const writes = [];
  await page.route('**/api/admin-dashboard', route => json(route, { stats: {}, system: {}, plans: [], users: [], patients: [], doctors: [], articles: [] }));
  await page.route('**/api/admin-settings', route => json(route, { settings: {} }));
  await page.route('**/api/admin-content**', route => {
    if (route.request().method() === 'GET') return json(route, { article: { id: 'calendar-article', title: 'راهنمای ساختگی', evidence_updated_at: '2025-03-20', next_review_at: '2027-04-13' } });
    writes.push(route.request().postDataJSON()); return json(route, {});
  });
  await page.goto('/admin'); await page.waitForFunction(() => !!globalThis.DrManCalendar);
  await page.evaluate(() => openArticle('calendar-article'));
  await expect(page.locator('#jalali-artEvidenceDate')).toHaveValue('۱۴۰۳/۱۲/۳۰');
  await expect(page.locator('#jalali-artNextReview')).toHaveValue('۱۴۰۶/۰۱/۲۴');
  await page.locator('#jalali-artEvidenceDate').fill('۱۴۰۴/۱۲/۳۰');
  await page.locator('#articleModal button.primary').click(); expect(writes).toHaveLength(0);
  await page.locator('#jalali-artEvidenceDate').fill('۱۴۰۴/۱۲/۲۹');
  await page.locator('#articleModal button.primary').click();
  await expect(page.locator('#articleModal')).toBeHidden();
  expect(writes[0]).toMatchObject({ evidence_updated_at: '2026-03-20', next_review_at: '2027-04-13' });
});
