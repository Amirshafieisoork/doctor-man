import { test, expect } from '@playwright/test';

const patients = [
  { id: 'synthetic-self', display_name: 'پرونده اول آزمون', relation: 'self' },
  { id: 'synthetic-child', display_name: 'پرونده دوم آزمون', relation: 'child' }
];
const medication = (name, id = name) => ({ id, name, dose: 'مقدار آزمون', status: 'active' });
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') return json(route, 200, { success: true, patients });
    if (url.pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
    if (['/api/care-plan', '/api/care-episodes', '/api/biomarker-trends'].includes(url.pathname)) return json(route, 200, { success: true });
    return json(route, 401, { error: 'ورود لازم است' });
  });
});

test('saved lab interpretation expands as readable text without executing stored markup', async ({ page }) => {
  const text = 'تفسیر ذخیره‌شده برای آزمون\nخط بعدی و توضیح کامل\n<script>window.storedAnalysisExecuted=true</script>\n<img src=x onerror="window.storedAnalysisExecuted=true">';
  await page.route('**/api/health-record**', route => json(route, 200, {
    record: { tests: [{ id: 'synthetic-test', created_at: '2026-10-08T08:00:00Z', reason: 'آزمون رابط', status: 'normal', analysis: text }] }
  }));
  await page.goto('/health');
  await page.locator('#tests summary').click();
  await expect(page.locator('#tests details')).toHaveAttribute('open', '');
  await expect(page.locator('#tests .lab-analysis')).toHaveText(text);
  expect(await page.locator('#tests .lab-analysis').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  await expect(page.locator('#tests script,#tests img')).toHaveCount(0);
  expect(await page.evaluate(() => window.storedAnalysisExecuted)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('rapid family switches clear old records and ignore a late result from the prior selection', async ({ page }) => {
  const second = deferred(), firstReload = deferred(), secondDone = deferred();
  let selfLoads = 0, childLoads = 0;
  await page.route('**/api/health-record**', async route => {
    const pid = new URL(route.request().url()).searchParams.get('patient_id');
    if (pid === 'synthetic-child') {
      childLoads++; await second.promise;
      await json(route, 200, { record: { medications: [medication('داروی پرونده دوم')] } }).catch(() => {});
      secondDone.resolve(); return;
    }
    selfLoads++;
    if (selfLoads > 1) await firstReload.promise;
    await json(route, 200, { record: { medications: [medication('داروی پرونده اول')] } });
  });
  await page.goto('/health');
  await expect(page.locator('#medications')).toContainText('داروی پرونده اول');
  await page.getByRole('button', { name: 'ویرایش داروی پرونده اول', exact: true }).click();
  await expect(page.locator('#addModal')).toBeVisible();
  // Dispatching a selector change also exercises closing an open patient-bound form.
  await page.locator('#patientSelect').evaluate(select => { select.value = 'synthetic-child'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(() => childLoads).toBe(1);
  await expect(page.locator('#addModal')).toBeHidden();
  await expect(page.locator('#medications')).not.toContainText('داروی پرونده اول');
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeDisabled();
  await expect(page.locator('#patientSelect')).toBeEnabled();
  await page.locator('#patientSelect').selectOption('synthetic-self');
  await expect.poll(() => selfLoads).toBe(2);
  firstReload.resolve();
  await expect(page.locator('#medications')).toContainText('داروی پرونده اول');
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeEnabled();
  second.resolve(); await secondDone.promise;
  await expect(page.locator('#patientSelect')).toHaveValue('synthetic-self');
  await expect(page.locator('#medications')).toContainText('داروی پرونده اول');
  await expect(page.locator('#medications')).not.toContainText('داروی پرونده دوم');
});

test('record load failure shows a retry and keeps patient actions disabled until recovery', async ({ page }) => {
  let loads = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/health-record**', route => ++loads === 1
    ? json(route, 503, { error: 'دریافت موقتاً ممکن نیست' })
    : json(route, 200, { record: { medications: [medication('داروی بازیابی‌شده')] } }));
  await page.goto('/health');
  await expect(page.locator('#healthLoadMessage')).toContainText('بارگذاری نشد');
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeDisabled();
  await expect(page.locator('#patientSelect')).toBeEnabled();
  await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(page.locator('#medications')).toContainText('داروی بازیابی‌شده');
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeEnabled();
  await expect(page.locator('#healthLoadStatus')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a pending Navigator answer cannot appear in another family member record', async ({ page }) => {
  const answer = deferred(), done = deferred(); let asked = 0, submitted;
  await page.route('**/api/health-record**', route => json(route, 200, { record: {} }));
  await page.route('**/api/health-navigator', async route => {
    asked++; submitted = route.request().postDataJSON(); await answer.promise;
    await json(route, 200, { answer: 'پاسخ خصوصی پرونده اول', remaining_today: 1 }); done.resolve();
  });
  await page.goto('/health');
  await expect(page.locator('#healthLoadStatus')).toBeHidden();
  await page.getByRole('button', { name: 'Health Navigator', exact: true }).click();
  await page.locator('#navQuestion').fill('چه چیزهایی را برای مراجعه آماده کنم؟');
  await page.getByRole('button', { name: 'پرسیدن', exact: true }).click();
  await expect.poll(() => asked).toBe(1);
  await page.locator('#patientSelect').selectOption('synthetic-child');
  await expect(page.locator('#healthLoadStatus')).toBeHidden();
  answer.resolve(); await done.promise;
  await expect(page.locator('#navAnswer')).toHaveText('');
  await expect(page.locator('#navQuestion')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'پرسیدن', exact: true })).toBeEnabled();
  expect(submitted.patient_id).toBe('synthetic-self');
});

test('an earlier save stays bound to its patient and cannot close a newly opened family form', async ({ page }) => {
  const saved = deferred(), done = deferred(); let submitted;
  await page.route('**/api/health-record**', route => json(route, 200, { record: {} }));
  await page.route('**/api/health-entry', async route => {
    submitted = route.request().postDataJSON(); await saved.promise;
    await json(route, 200, { success: true }); done.resolve();
  });
  await page.goto('/health');
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true }).click();
  await page.locator('#dynamicFields input[name="name"]').fill('اطلاعات پرونده اول');
  await page.locator('#addModal button.primary').click();
  await expect.poll(() => submitted?.patient_id).toBe('synthetic-self');
  await page.locator('#patientSelect').evaluate(select => { select.value = 'synthetic-child'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true }).click();
  await page.locator('#dynamicFields input[name="name"]').fill('اطلاعات جدید پرونده دوم');
  await expect(page.locator('#addModal button.primary')).toBeEnabled();
  saved.resolve(); await done.promise;
  await expect(page.locator('#addModal')).toBeVisible();
  await expect(page.locator('#dynamicFields input[name="name"]')).toHaveValue('اطلاعات جدید پرونده دوم');
  await expect(page.locator('#healthFeedback')).toBeHidden();
  await expect(page.locator('#addModal button.primary')).toBeEnabled();
  expect(submitted.name).toBe('اطلاعات پرونده اول');
});

test('partial secondary-record outage retains clinical records and offers an explicit retry', async ({ page }) => {
  let careLoads = 0;
  await page.route('**/api/health-record**', route => json(route, 200, { record: { medications: [medication('داروی باقی‌مانده')] } }));
  await page.route('**/api/care-plan**', route => ++careLoads === 1
    ? json(route, 503, { error: 'دریافت موقتاً ممکن نیست' })
    : json(route, 200, { success: true }));
  await page.goto('/health');
  await expect(page.locator('#medications')).toContainText('داروی باقی‌مانده');
  await expect(page.locator('#healthLoadMessage')).toContainText('پرونده اصلی بارگذاری شد');
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(page.locator('#healthLoadStatus')).toBeHidden();
  await expect(page.locator('#medications')).toContainText('داروی باقی‌مانده');
});
