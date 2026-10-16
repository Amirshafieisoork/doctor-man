import { test, expect } from '@playwright/test';

const people = [
  { id: 'synthetic-self', display_name: 'پرونده آزمایشی من', relation: 'self', birth_date: '1990-04-08', sex: 'male', height_cm: 175, blood_type: 'O+' },
  { id: 'synthetic-family', display_name: 'پرونده آزمایشی خانواده', relation: 'child', birth_date: '2017-01-11', sex: 'female' }
];
const photo = { name: 'synthetic-lab.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D1sAAAAASUVORK5CYII=', 'base64') };
const response = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let archived, analyzed;
test.beforeEach(async ({ page }) => {
  archived = []; analyzed = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') return response(route, 200, { success: true, patients: people });
    if (url.pathname === '/api/account') return response(route, 200, { success: true, user: { id: 'synthetic-owner', name: 'کاربر آزمون' }, subscription: { plan: { name: 'رایگان' }, remaining: 3 } });
    if (url.pathname === '/api/notifications') return response(route, 200, { notifications: [], unread: 0 });
    if (url.pathname === '/api/health-record') {
      const pid = url.searchParams.get('patient_id');
      return response(route, 200, { patient: people.find(p => p.id === pid), record: {
        medications: [{ id: 'synthetic-med', name: 'داروی ثبت‌شده', status: 'active' }],
        vitals: [{ weight_kg: 72, glucose_mg_dl: 96, measured_at: '2026-10-15T08:00:00Z' }],
        procedures: [{ name: 'سابقه ثبت‌شده' }], tests: analyzed.filter(x => x.patientId === pid).map(x => ({ id: 'new-test', analysis: x.analysis, created_at: '2026-10-16T08:00:00Z' })),
        documents: archived.filter(x => x.patientId === pid).map(x => ({ id: x.id, title: 'تصویر آزمایش تازه', document_type: 'lab', created_at: '2026-10-16T08:00:00Z' }))
      } });
    }
    if (['/api/care-plan', '/api/care-episodes', '/api/biomarker-trends'].includes(url.pathname)) return response(route, 200, { success: true });
    if (url.pathname === '/api/health-navigator') return response(route, 200, { success: true, source: 'local', overview: { overall: 'این پرونده ساختگی برای آزمون ظاهر و بارگذاری است.', next_steps: [], nutrition: [], movement: [], questions_for_doctor: [], data_limits: [] } });
    return response(route, 404, { success: false, error: 'مسیر آزمون تعریف نشده' });
  });
});
async function openUpload(page) {
  await page.goto('/health');
  await expect(page.getByRole('button', { name: 'افزودن آزمایش و تفسیر در همین پرونده', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'افزودن آزمایش و تفسیر در همین پرونده', exact: true }).click();
  await expect(page.locator('#healthLabDialog')).toBeVisible();
  await expect(page.locator('[data-lab-id="patient"]')).toHaveValue('synthetic-self');
}
function setupArchive(page) {
  return page.route('**/api/documents', route => {
    const raw = route.request().postDataBuffer().toString();
    const patientId = people.find(p => raw.includes(p.id))?.id;
    const id = 'synthetic-doc-' + archived.length;
    archived.push({ id, patientId });
    return response(route, 201, { success: true, document: { id } });
  });
}

test('the profile has aligned identity and measurement groups, keeps all fields and navigates to insurance independently', async ({ page }, testInfo) => {
  await page.goto('/health');
  await expect(page.locator('#patientWeight')).toHaveValue('72');
  await expect(page.locator('#patientGlucose')).toHaveValue('96');
  for (const id of ['patientSex', 'patientBirthDate', 'patientHeight', 'patientWeight', 'patientGlucose', 'patientBloodType', 'patientNationalCode']) await expect(page.locator('#' + id)).toBeVisible();
  await expect(page.locator('#profileBmi')).toContainText('BMI');
  const geometry = await page.evaluate(() => {
    const labels = [...document.querySelector('.profile-fields').querySelectorAll('label')].map(el => el.getBoundingClientRect());
    const tabs = [...document.querySelectorAll('.tabs .tab')].map(el => el.getBoundingClientRect());
    const measurementCard = document.querySelector('.health-measurements-card').getBoundingClientRect(), grid = document.querySelector('#overview>.grid').getBoundingClientRect(), lab = document.getElementById('healthTestsCard').getBoundingClientRect();
    return { measurementsUseFullRow: Math.abs(measurementCard.width - grid.width) < 2, labsStartAfterMeasurements: lab.top >= measurementCard.bottom, firstTop: labels[0].top, secondTop: labels[1].top, widths: tabs.map(x => x.width), columns: getComputedStyle(document.querySelector('.tabs')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  expect(Math.abs(geometry.firstTop - geometry.secondTop)).toBeLessThan(2);
  expect(Math.max(...geometry.widths) - Math.min(...geometry.widths)).toBeLessThan(2);
  expect(geometry.columns).toBe(testInfo.project.name.startsWith('mobile') ? 2 : 5);
  expect(geometry.overflow).toBe(false);
  expect(geometry.measurementsUseFullRow).toBe(true);
  expect(geometry.labsStartAfterMeasurements).toBe(true);
  await page.getByRole('tab', { name: 'بیمه پایه و تکمیلی', exact: true }).click();
  await expect(page.locator('#insurancePage')).toBeVisible();
  await expect(page.locator('#insurances')).toBeVisible();
  await page.getByRole('tab', { name: 'تاریخچه پزشکی', exact: true }).click();
  await expect(page.locator('#procedures')).toContainText('سابقه ثبت‌شده');
});

test('in-record plus archives the selected family record, analyzes once and refreshes its saved history without navigating home', async ({ page }) => {
  await setupArchive(page);
  let calls = 0;
  const gate = deferred();
  await page.route('**/api/analyze-lab', async route => {
    calls++;
    const raw = route.request().postDataBuffer().toString();
    expect(raw).toContain('synthetic-self'); expect(raw).not.toContain('synthetic-family');
    expect(raw).toMatch(/name="gender"\r\n\r\nmale/);
    await gate.promise;
    analyzed.push({ patientId: 'synthetic-self', analysis: 'تفسیر جدید آزمایش ساختگی در پرونده ثبت شد.' });
    await response(route, 200, { success: true, analysis: analyzed[0].analysis, read_quality: 'good' });
  });
  await openUpload(page);
  await expect(page.locator('[data-lab-id="age"]')).toHaveAttribute('readonly', '');
  await expect(page.locator('[data-lab-id="gender"]')).toBeDisabled();
  await page.locator('[data-lab-id="picker"]').setInputFiles(photo);
  await page.locator('[data-lab-id="analyze"]').evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.getByRole('button', { name: '+ آزمایش جدید', exact: true }).click();
  await expect(page.locator('[data-lab-id="analyze"]')).toBeDisabled();
  gate.resolve();
  await expect(page.locator('[data-lab-id="result"]')).toContainText('تفسیر جدید آزمایش ساختگی');
  await expect(page.locator('#tests')).toContainText('تفسیر جدید آزمایش ساختگی');
  await expect(page.locator('[data-lab-id="analyze"]')).toBeDisabled();
  expect(calls).toBe(1); expect(archived).toEqual([{ id: 'synthetic-doc-0', patientId: 'synthetic-self' }]);
  await page.getByRole('button', { name: 'دیدن نتیجه و تصاویر در همین پرونده', exact: true }).click();
  await expect(page.locator('#healthLabDialog')).toBeHidden();
  await expect(page).toHaveURL(/\/health$/);
  await expect(page.locator('#tests summary')).toBeVisible();
});

test('switching family during an old analysis clears its images and cannot show the old result in the new record', async ({ page }) => {
  await setupArchive(page);
  const gate = deferred(); let calls = 0;
  await page.route('**/api/analyze-lab', async route => {
    calls++; await gate.promise;
    await response(route, 200, { success: true, analysis: 'پاسخ خصوصی پرونده قبلی' }).catch(() => {});
  });
  await openUpload(page);
  await page.locator('[data-lab-id="picker"]').setInputFiles(photo);
  await page.locator('[data-lab-id="analyze"]').click();
  await expect.poll(() => calls).toBe(1);
  await page.locator('#patientSelect').evaluate(select => { select.value = 'synthetic-family'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#healthLabDialog')).toBeHidden();
  await expect(page.locator('#healthLoadStatus')).toBeHidden();
  gate.resolve();
  await page.getByRole('button', { name: '+ آزمایش جدید', exact: true }).click();
  await expect(page.locator('[data-lab-id="patient"]')).toHaveValue('synthetic-family');
  await expect(page.locator('#healthLabPatient')).toContainText('پرونده آزمایشی خانواده');
  await expect(page.locator('.lab-preview img')).toHaveCount(0);
  await expect(page.locator('[data-lab-id="result"]')).not.toContainText('پاسخ خصوصی');
  await expect(page.locator('[data-lab-id="age"]')).toHaveValue('9');
  await expect(page.locator('[data-lab-id="gender"]')).toHaveValue('female');
});

test('archive errors retain a readable retry and never start analysis or discard the chosen page', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/documents', route => response(route, 503, { success: false, error: 'ثبت تصویر موقتاً ممکن نیست' }));
  await page.route('**/api/analyze-lab', route => { calls++; return response(route, 200, { success: true }); });
  await openUpload(page);
  await page.locator('[data-lab-id="picker"]').setInputFiles(photo);
  await page.locator('[data-lab-id="analyze"]').click();
  await expect(page.locator('[data-lab-id="error"]')).toContainText('ثبت تصویر موقتاً ممکن نیست');
  await expect(page.locator('.lab-preview img')).toHaveCount(1);
  await expect(page.locator('[data-lab-id="analyze"]')).toBeEnabled();
  expect(calls).toBe(0);
});

for (const destination of ['home', 'health']) test(`${destination} offers a gallery picker without forced camera and a separate optional camera`, async ({ page }) => {
  if (destination === 'health') await openUpload(page); else await page.goto('/');
  const root = destination === 'health' ? page.locator('#healthLabUploader') : page.locator('#lab');
  const picker = destination === 'health' ? root.locator('[data-lab-id="picker"]') : root.locator('#picker');
  await expect(picker).toHaveAttribute('accept', 'image/*');
  await expect(picker).not.toHaveAttribute('capture');
  const galleryChosen = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'انتخاب از گالری', exact: true }).click();
  const gallery = await galleryChosen; expect(gallery.isMultiple()).toBe(true); await gallery.setFiles(photo);
  await expect(root.locator('.lab-preview img')).toHaveCount(1);
  const cameraChosen = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'گرفتن عکس با دوربین', exact: true }).click();
  const camera = await cameraChosen;
  expect(await camera.element().getAttribute('capture')).toBe('environment');
  await camera.setFiles(photo);
  await expect(root.locator('.lab-thumbnail')).toHaveCount(2);
});

test('a failed analysis refreshes its saved original and retries analysis without archiving the same page twice', async ({ page }) => {
  await setupArchive(page); let calls = 0;
  await page.route('**/api/analyze-lab', route => ++calls === 1
    ? response(route, 503, { success: false, error: 'تحلیل موقتاً در دسترس نیست' })
    : response(route, 200, { success: true, analysis: 'تفسیر ساختگی پس از تلاش دوباره', read_quality: 'good' }));
  await openUpload(page);
  await page.locator('[data-lab-id="picker"]').setInputFiles(photo);
  await page.locator('[data-lab-id="analyze"]').click();
  await expect(page.locator('[data-lab-id="error"]')).toContainText('تحلیل موقتاً در دسترس نیست');
  await expect(page.locator('#healthLoadStatus')).toBeHidden();
  await expect(page.locator('#documents')).toContainText('تصویر آزمایش تازه');
  await expect(page.locator('[data-lab-id="analyze"]')).toBeEnabled();
  await page.locator('[data-lab-id="analyze"]').click();
  await expect(page.locator('[data-lab-id="result"]')).toContainText('تفسیر ساختگی پس از تلاش دوباره');
  expect(calls).toBe(2); expect(archived).toHaveLength(1);
});
