import { test, expect } from '@playwright/test';

const dashboard = { stats: {}, system: {}, plans: [], users: [], patients: [], doctors: [], doctor_reviews: [], appointments: [], tasks: [], orders: [], tests: [], payments: [], organizations: [], articles: [], support: [], deletion_requests: [], audits: [] };
const credentials = { client_id: 'synthetic-client-id', client_secret: 'synthetic-client-secret', username: 'synthetic-api-username', password: 'synthetic-api-password' };
const fieldIds = { client_id: 'digiPayClientId', client_secret: 'digiPayClientSecret', username: 'digiPayUsername', password: 'digiPayPassword' };
const summary = (source = 'private') => ({ environment: 'production', source, configured: true, fields: { client_id: true, client_secret: true, username: true, password: true }, encryption_ready: true, updated_at: '2026-10-15T12:00:00Z', last_auth_check: null });
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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

test('direct payment link requires all four official values for first secure setup, clears them and never auto-tests', async ({ page }) => {
  const writes = []; let saved = false, tests = 0;
  await page.route('**/api/admin-digipay-settings', route => { if (route.request().method() === 'PUT') { writes.push(route.request().postDataJSON()); saved = true; } return json(route, 200, { settings: summary(saved ? 'private' : 'environment') }); });
  await page.route('**/api/admin-digipay-test', route => { tests++; return json(route, 200, { success: true, authenticated: true }); });
  await page.goto('/admin#payment-settings');
  await expect(page.locator('#paymentSettings')).toBeVisible();
  await expect(page.locator('#digiPaySettingsState')).toContainText('اتصال تأیید نشده');
  await page.locator('#saveDigiPaySettings').click(); expect(writes).toHaveLength(0);
  await page.locator('#digiPayClientId').fill(credentials.client_id); await page.locator('#digiPayClientSecret').fill(credentials.client_secret);
  await page.locator('#saveDigiPaySettings').click(); expect(writes).toHaveLength(0);
  for (const [field, id] of Object.entries(fieldIds)) { await expect(page.locator('#' + id)).toHaveAttribute('type', 'password'); await page.locator('#' + id).fill(credentials[field]); }
  await page.locator('#saveDigiPaySettings').click();
  await expect(page.locator('#digiPaySettingsFeedback')).toContainText('رمزگذاری‌شده ذخیره شد');
  expect(writes).toEqual([{ environment: 'production', ...credentials }]); expect(tests).toBe(0);
  for (const id of Object.values(fieldIds)) await expect(page.locator('#' + id)).toHaveValue('');
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const value of Object.values(credentials)) expect(storage).not.toContain(value);
  await expect(page.locator('#testDigiPayConnection')).toBeEnabled();
});

test('existing encrypted credentials never prefill; blank save preserves them and environment switch requires fresh values', async ({ page }) => {
  const writes = [];
  await page.route('**/api/admin-digipay-settings', route => { if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON()); return json(route, 200, { settings: summary() }); });
  await page.goto('/admin#payment-settings'); await expect(page.locator('#paymentSettings')).toBeVisible();
  for (const id of Object.values(fieldIds)) await expect(page.locator('#' + id)).toHaveValue('');
  await page.locator('#saveDigiPaySettings').click(); await expect(page.locator('#digiPaySettingsFeedback')).toContainText('رمزگذاری‌شده ذخیره شد');
  expect(writes).toEqual([{ environment: 'production' }]);
  await page.locator('#digiPayEnvironment').selectOption('uat');
  await expect(page.locator('#testDigiPayConnection')).toBeDisabled();
  for (const id of Object.values(fieldIds)) await expect(page.locator('#' + id)).toHaveJSProperty('required', true);
  await page.locator('#saveDigiPaySettings').click(); expect(writes).toHaveLength(1);
});

test('explicit OAuth-only test sends no credentials and failure keeps admin logged in with clear technical guidance', async ({ page }) => {
  const calls = [];
  await page.route('**/api/admin-digipay-settings', route => json(route, 200, { settings: summary() }));
  await page.route('**/api/admin-digipay-test', route => { calls.push(route.request().postDataJSON()); return json(route, 502, { success: false, authenticated: false, code: 'DIGIPAY_AUTH_FAILED', error: 'دیجی‌پی اطلاعات اتصال را نپذیرفت. نام کاربری و رمز API باید از دیجی‌پی باشند.' }); });
  await page.goto('/admin#payment-settings'); await expect(page.locator('#testDigiPayConnection')).toBeEnabled(); expect(calls).toHaveLength(0);
  await page.locator('#testDigiPayConnection').click(); await expect(page.locator('#digiPayTestFeedback')).toContainText('نام کاربری و رمز API');
  expect(calls).toEqual([{}]); await expect(page.locator('#paymentSettings')).toBeVisible(); await expect(page.locator('#login')).toBeHidden();
  await page.locator('#digiPayPassword').fill('rotated-synthetic-password'); await expect(page.locator('#testDigiPayConnection')).toBeDisabled();
  await page.locator('[data-page="users"]').click(); await expect(page.locator('#digiPayPassword')).toHaveValue(''); expect(new URL(page.url()).hash).toBe('');
});

test('successful explicit auth check reports technical connection without claiming a payment was made', async ({ page }) => {
  await page.route('**/api/admin-digipay-settings', route => json(route, 200, { settings: summary() }));
  await page.route('**/api/admin-digipay-test', route => json(route, 200, { success: true, authenticated: true, environment: 'production', code: 'OK', message: 'اتصال فنی دیجی‌پی تأیید شد. آزمون هیچ سفارش یا پرداختی ایجاد نکرد.' }));
  await page.goto('/admin#payment-settings'); await expect(page.locator('#testDigiPayConnection')).toBeEnabled();
  await page.locator('#testDigiPayConnection').click();
  await expect(page.locator('#digiPayTestFeedback')).toContainText('هیچ سفارش یا پرداختی ایجاد نکرد');
});

test('failed save clears submitted secret, and encryption-unavailable state prevents any write', async ({ page }) => {
  let unavailable = false, writes = 0;
  await page.route('**/api/admin-digipay-settings', route => {
    if (route.request().method() === 'PUT') { writes++; return json(route, 503, { error: 'ذخیره امن اطلاعات انجام نشد.' }); }
    return json(route, 200, { settings: { ...summary(), encryption_ready: !unavailable } });
  });
  await page.goto('/admin#payment-settings'); await expect(page.locator('#saveDigiPaySettings')).toBeEnabled();
  await page.locator('#digiPayPassword').fill('rotated-synthetic-password'); await page.locator('#saveDigiPaySettings').click();
  await expect(page.locator('#digiPaySettingsFeedback')).toContainText('ذخیره امن اطلاعات انجام نشد'); await expect(page.locator('#digiPayPassword')).toHaveValue(''); expect(writes).toBe(1);
  unavailable = true; await page.locator('#reloadDigiPaySettings').click();
  await expect(page.locator('#saveDigiPaySettings')).toBeDisabled(); await expect(page.locator('#digiPaySettingsFeedback')).toContainText('ذخیره امن اطلاعات در سرور آماده نیست');
});
