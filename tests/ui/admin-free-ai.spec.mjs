import { test, expect } from '@playwright/test';

const dashboard = { stats: {}, system: { ai: false, ai_provider: 'groq' }, plans: [], users: [], patients: [], doctors: [], doctor_reviews: [], appointments: [], tasks: [], orders: [], tests: [], payments: [], organizations: [], articles: [], support: [], deletion_requests: [], audits: [] };
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const syntheticKey = 'gsk-synthetic-only-free-key-not-a-real-secret';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/admin-dashboard') return json(route, 200, dashboard);
    if (url.pathname === '/api/admin-settings') return json(route, 200, { settings: {} });
    return json(route, 401, { error: 'ورود لازم است' });
  });
});

test('direct admin link opens free AI settings, requires Free account confirmation and clears the submitted key', async ({ page }) => {
  const bodies = []; let configured = false;
  await page.route('**/api/admin-ai-settings', route => {
    if (route.request().method() === 'PUT') { bodies.push(route.request().postDataJSON()); configured = true; }
    return json(route, 200, { settings: { provider: 'groq', free_only: true, key_configured: configured, free_account_confirmed: configured, encryption_ready: true } });
  });
  await page.goto('/admin#ai-settings');
  await expect(page.locator('#aiSettings')).toBeVisible();
  await expect(page.locator('#privateAIKeyState')).toContainText('هنوز تنظیم نشده');
  const key = page.getByLabel('کلید API حساب رایگان Groq', { exact: true });
  await expect(key).toHaveAttribute('type', 'password'); await key.fill(syntheticKey);
  await page.getByRole('button', { name: 'ذخیره اتصال رایگان', exact: true }).click(); expect(bodies).toHaveLength(0);
  await page.getByLabel('تأیید می‌کنم این کلید مربوط به حساب Free در Groq است.', { exact: true }).check();
  await page.getByRole('button', { name: 'ذخیره اتصال رایگان', exact: true }).click();
  await expect(page.locator('#privateAIFeedback')).toContainText('تنظیمات رایگان ذخیره شد');
  await expect(key).toHaveValue('');
  expect(bodies).toEqual([{ provider: 'groq', free_only: true, free_account_confirmed: true, api_key: syntheticKey }]);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(syntheticKey);
  await expect(page.locator('#privateAIKeyState')).toContainText('اتصال هنگام تحلیل بررسی می‌شود');
  await expect(page.getByRole('link', { name: 'صفحه کلیدهای Groq', exact: true })).toHaveAttribute('href', 'https://console.groq.com/keys');
  await page.locator('[data-page="users"]').click();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: '↻ بروزرسانی', exact: true }).click();
  await expect(page.locator('#users')).toBeVisible();
});

test('configured key never prefills the field, blank saving preserves it and explicit removal sends no secret', async ({ page }) => {
  const bodies = []; let configured = true;
  await page.route('**/api/admin-ai-settings', route => {
    if (route.request().method() === 'PUT') { const body = route.request().postDataJSON(); bodies.push(body); if (body.clear_key) configured = false; }
    return json(route, 200, { settings: { provider: 'groq', free_only: true, key_configured: configured, free_account_confirmed: true, encryption_ready: true } });
  });
  await page.goto('/admin#ai-settings');
  await expect(page.locator('#privateAIKeyState')).toContainText('به‌صورت امن ذخیره');
  await expect(page.locator('#privateAIKey')).toHaveValue('');
  await page.getByRole('button', { name: 'ذخیره اتصال رایگان', exact: true }).click();
  await expect(page.locator('#privateAIFeedback')).toContainText('تنظیمات رایگان ذخیره شد');
  expect(bodies).toEqual([{ provider: 'groq', free_only: true, free_account_confirmed: true }]);
  await page.getByRole('button', { name: 'حذف کلید ذخیره‌شده', exact: true }).click();
  await expect(page.locator('#privateAIFeedback')).toContainText('کلید ذخیره‌شده حذف شد');
  expect(bodies[1]).toEqual({ provider: 'groq', free_only: true, free_account_confirmed: true, clear_key: true });
  await expect(page.getByRole('button', { name: 'حذف کلید ذخیره‌شده', exact: true })).toBeDisabled();
});

test('failed save reports the server error, clears secret input and never claims connection success', async ({ page }) => {
  await page.route('**/api/admin-ai-settings', route => route.request().method() === 'PUT'
    ? json(route, 503, { error: 'ذخیره امن کلید موقتاً در دسترس نیست.' })
    : json(route, 200, { settings: { provider: 'groq', free_only: true, key_configured: false, free_account_confirmed: false, encryption_ready: true } }));
  await page.goto('/admin#ai-settings');
  await expect(page.getByRole('button', { name: 'ذخیره اتصال رایگان', exact: true })).toBeEnabled();
  await page.locator('#privateAIKey').fill(syntheticKey); await page.locator('#privateAIFreeAccount').check();
  await page.getByRole('button', { name: 'ذخیره اتصال رایگان', exact: true }).click();
  await expect(page.locator('#privateAIFeedback')).toContainText('ذخیره امن کلید موقتاً');
  await expect(page.locator('#privateAIKey')).toHaveValue('');
  await expect(page.locator('#privateAIKeyState')).toContainText('هنوز تنظیم نشده');
  await expect(page.getByRole('button', { name: 'ذخیره اتصال رایگان', exact: true })).toBeEnabled();
});

test('server encryption readiness prevents storing keys until secure setup is available', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/admin-ai-settings', route => {
    if (route.request().method() === 'PUT') writes++;
    return json(route, 200, { settings: { provider: 'groq', free_only: true, key_configured: false, free_account_confirmed: false, encryption_ready: false } });
  });
  await page.goto('/admin#ai-settings');
  await expect(page.locator('#privateAIFeedback')).toContainText('ذخیره امن کلید در سرور آماده نیست');
  await expect(page.getByRole('button', { name: 'ذخیره اتصال رایگان', exact: true })).toBeDisabled();
  expect(writes).toBe(0);
});

test('owner runs the synthetic connection test without sending the saved key or a patient image', async ({ page }) => {
  await page.route('**/api/admin-ai-settings', route => json(route, 200, { settings: { provider: 'groq', free_only: true, key_configured: true, free_account_confirmed: true, encryption_ready: true } }));
  let requests = 0;
  await page.route('**/api/admin-ai-test', route => {
    requests++; expect(route.request().method()).toBe('POST'); expect(route.request().postDataJSON()).toEqual({});
    return json(route, 200, { success: true, free_only: true, samples_checked: 4, checks_passed: 6, checks_total: 6, report_sections: 9, report_words: 480, elapsed_ms: 1200 });
  });
  await page.goto('/admin#ai-settings');
  await expect(page.locator('#testPrivateAI')).toBeEnabled();
  await page.locator('#testPrivateAI').click();
  await expect(page.locator('#privateAITestFeedback')).toContainText('آزمون موفق بود');
  await expect(page.locator('#privateAITestFeedback')).toContainText('گزارش ۹‌بخشی با ۴۸۰ کلمه تولید شد');
  expect(requests).toBe(1); await expect(page.locator('#privateAIKey')).toHaveValue('');
});
test('a free connection failure remains visible and permits a fresh test', async ({ page }) => {
  await page.route('**/api/admin-ai-settings', route => json(route, 200, { settings: { provider: 'groq', free_only: true, key_configured: true, free_account_confirmed: true, encryption_ready: true } }));
  await page.route('**/api/admin-ai-test', route => json(route, 503, { success: false, code: 'AI_AUTH_UNAVAILABLE', error: 'کلید یا دسترسی حساب رایگان تأیید نشد' }));
  await page.goto('/admin#ai-settings');
  await page.locator('#testPrivateAI').click();
  await expect(page.locator('#privateAITestFeedback')).toContainText('کلید یا دسترسی حساب رایگان تأیید نشد');
  await expect(page.locator('#testPrivateAI')).toBeEnabled();
  await expect(page.locator('#privateAITestFeedback')).not.toContainText('موفق بود');
});
