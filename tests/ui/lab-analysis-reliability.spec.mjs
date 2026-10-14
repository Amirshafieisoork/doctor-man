import { test, expect } from '@playwright/test';

const photo = { name: 'synthetic-lab.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D1sAAAAASUVORK5CYII=', 'base64') };
const account = { success: true, user: { id: 'synthetic-owner', name: 'کاربر آزمون' }, subscription: { plan: { name: 'رایگان' }, remaining: 2 } };
const patients = { success: true, patients: [{ id: 'synthetic-patient', display_name: 'پرونده آزمایشی', relation: 'self', sex: 'male' }] };
const result = { success: true, analysis: 'نتیجه آزمایشی برای بررسی رابط کاربری', read_quality: 'good' };
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  // All requests that could read or mutate a real account or call a model are blocked.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    return json(route, 401, { success: false });
  });
  await page.route('**/api/account', route => json(route, 200, account));
  await page.route('**/api/patients', route => json(route, 200, patients));
});

async function readyPhoto(page) {
  await page.goto('/');
  await expect(page.locator('#patient')).toHaveValue('synthetic-patient');
  await page.locator('#picker').setInputFiles(photo);
  await expect(page.locator('#analyze')).toBeEnabled();
}

test('rapid analysis clicks while the account is loading submit one archive and one analysis', async ({ page }) => {
  let releaseAccount;
  const gate = new Promise(resolve => { releaseAccount = resolve; });
  let accountRequests = 0, archiveCalls = 0, analysisCalls = 0;
  await page.route('**/api/account', async route => { if (++accountRequests === 1) await gate; await json(route, 200, account); });
  await page.route('**/api/documents', async route => { archiveCalls++; await json(route, 201, { success: true, document: { id: 'saved-image' } }); });
  await page.route('**/api/analyze-lab', async route => { analysisCalls++; await json(route, 200, result); });
  await page.goto('/');
  await page.locator('#picker').setInputFiles(photo);
  await page.locator('#analyze').evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#analyze')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'حذف صفحه ۱', exact: true })).toBeDisabled();
  expect(archiveCalls).toBe(0);
  releaseAccount();
  await expect(page.locator('#result')).toContainText(result.analysis);
  expect(archiveCalls).toBe(1);
  expect(analysisCalls).toBe(1);
  await expect(page.locator('#analyze')).toBeEnabled();
});

test('slow analysis has its own longer timeout and a retry reuses the saved original', async ({ page }) => {
  await page.clock.install();
  let archiveCalls = 0, analysisCalls = 0;
  await page.route('**/api/documents', async route => { archiveCalls++; await json(route, 201, { success: true, document: { id: 'saved-image' } }); });
  await page.route('**/api/analyze-lab', route => { if (++analysisCalls > 1) return json(route, 200, result); });
  await readyPhoto(page);
  await page.locator('#analyze').click();
  await expect.poll(() => analysisCalls).toBe(1);
  await page.clock.fastForward(65001);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#analyze')).toBeDisabled();
  await page.clock.fastForward(175000);
  await expect(page.locator('#error')).toContainText('تحلیل طول کشید');
  await expect(page.locator('#error')).toContainText('تصویرهای ثبت‌شده در پرونده سلامت شما موجودند');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.lab-thumbnail')).toHaveCount(1);
  await page.locator('#analyze').click();
  await expect(page.locator('#result')).toContainText(result.analysis);
  expect(archiveCalls).toBe(1);
  expect(analysisCalls).toBe(2);
});

test('archive timeout stops analysis and does not claim that an unsaved image exists in the record', async ({ page }) => {
  await page.clock.install();
  let archiveCalls = 0, analysisCalls = 0;
  await page.route('**/api/documents', () => { archiveCalls++; });
  await page.route('**/api/analyze-lab', route => { analysisCalls++; return json(route, 200, result); });
  await readyPhoto(page);
  await page.locator('#analyze').click();
  await expect.poll(() => archiveCalls).toBe(1);
  await page.clock.fastForward(65001);
  await expect(page.locator('#error')).toContainText('ذخیره تصویر طول کشید');
  await expect(page.locator('#error')).not.toContainText('تصویرهای ثبت‌شده');
  expect(analysisCalls).toBe(0);
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('.lab-thumbnail')).toHaveCount(1);
});

test('an analysis network failure reports an actionable error while preserving the archived image', async ({ page }) => {
  await page.route('**/api/documents', route => json(route, 201, { success: true, document: { id: 'saved-image' } }));
  await page.route('**/api/analyze-lab', route => route.abort('failed'));
  await readyPhoto(page);
  await page.locator('#analyze').click();
  await expect(page.locator('#error')).toContainText('ارتباط با سرویس برقرار نشد');
  await expect(page.locator('#error')).toContainText('تصویرهای ثبت‌شده در پرونده سلامت شما موجودند');
  await expect(page.locator('#error')).not.toContainText('Failed to fetch');
  await expect(page.locator('#error').getByRole('link', { name: 'مشاهده تصاویر در پرونده سلامت' })).toHaveAttribute('href', '/health');
  await expect(page.locator('#analyze')).toBeEnabled();
});
