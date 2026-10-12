import { test, expect } from '@playwright/test';

const free = { id: 'synthetic-free', name: 'رایگان', slug: 'free', price: 0, test_limit: 2, active: true };
const plus = { id: 'synthetic-plus', name: 'همراه', slug: 'plus', price: 249000, test_limit: 12, active: false };
const dashboard = {
  stats: {}, system: {}, plans: [free, plus],
  users: [{ id: 'synthetic-user', name: 'کاربر آزمون', plan_id: free.id, status: 'active' }],
  doctors: [], doctor_reviews: [], appointments: [], tasks: [], orders: [], tests: [],
  payments: [], organizations: [], articles: [], support: [], deletion_requests: [], audits: []
};
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    return json(route, 401, { error: 'ورود لازم است' });
  });
});

async function signedIn(page) {
  await page.route('**/api/admin-dashboard', route => json(route, 200, dashboard));
  await page.route('**/api/admin-settings', route => json(route, 200, { settings: {} }));
  await page.goto('/admin');
  await expect(page.locator('#app')).toBeVisible();
}

test('admin login submits with Enter and recovers from rejected credentials', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/admin-login', async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ password: 'synthetic-password' });
    await json(route, 401, { error: 'رمز مدیریت صحیح نیست' });
  });
  await page.goto('/admin');
  await page.getByLabel('رمز مدیر', { exact: true }).fill('synthetic-password');
  await page.getByLabel('رمز مدیر', { exact: true }).press('Enter');
  await expect(page.locator('#loginErr')).toContainText('رمز مدیریت صحیح نیست');
  await expect(page.getByRole('button', { name: 'ورود', exact: true })).toBeEnabled();
  expect(requests).toBe(1);
});

test('accepted admin login reports a dashboard outage and retries without resubmitting credentials', async ({ page }, testInfo) => {
  let authenticated = false, unavailable = true, loginRequests = 0;
  await page.route('**/api/admin-login', route => { authenticated = true; loginRequests++; return json(route, 200, { success: true }); });
  await page.route('**/api/admin-dashboard', route => json(route, !authenticated ? 401 : unavailable ? 503 : 200, !authenticated ? {} : unavailable ? { error: 'پنل موقتاً در دسترس نیست' } : dashboard));
  await page.route('**/api/admin-settings', route => json(route, authenticated ? 200 : 401, { settings: {} }));
  await page.goto('/admin');
  await page.getByLabel('رمز مدیر', { exact: true }).fill('synthetic-password');
  await page.getByLabel('رمز مدیر', { exact: true }).press('Enter');
  await expect(page.locator('#loginErr')).toContainText('پنل موقتاً در دسترس نیست');
  await expect(page.getByRole('button', { name: 'تلاش دوباره برای دریافت پنل', exact: true })).toBeVisible();
  unavailable = false;
  await page.getByRole('button', { name: 'تلاش دوباره برای دریافت پنل', exact: true }).click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
  expect(loginRequests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach('admin-' + testInfo.project.name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('admin refresh failure remains visible beside the last loaded data and can recover', async ({ page }) => {
  await signedIn(page);
  await page.route('**/api/admin-dashboard', route => json(route, 503, { error: 'دریافت اطلاعات مدیریت ممکن نیست' }));
  await page.getByRole('button', { name: /بروزرسانی/ }).click();
  await expect(page.locator('#dashboardFeedback')).toContainText('دریافت اطلاعات مدیریت ممکن نیست');
  await expect(page.locator('#app')).toBeVisible();
  await page.route('**/api/admin-dashboard', route => json(route, 200, dashboard));
  await page.getByRole('button', { name: 'تلاش دوباره برای دریافت پنل', exact: true }).click();
  await expect(page.locator('#dashboardFeedback')).toBeHidden();
});

test('admin session expiry while saving closes the overlay and exposes login', async ({ page }) => {
  await signedIn(page);
  await page.locator('[data-page="plans"]').click();
  await page.getByRole('button', { name: '+ پلن جدید', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ویرایش پلن', exact: true })).toBeVisible();
  await page.route('**/api/manage-plans', route => json(route, 401, { error: 'نشست مدیریت منقضی شده' }));
  await page.getByRole('button', { name: 'ذخیره پلن', exact: true }).click();
  await expect(page.locator('#planModal')).toBeHidden();
  await expect(page.locator('#loginErr')).toContainText('دوباره وارد شوید');
  await expect(page.getByLabel('رمز مدیر', { exact: true })).toBeFocused();
  await expect(page.locator('#app')).toBeHidden();
});

test('rejected manual plan change restores the saved plan selection', async ({ page }) => {
  await signedIn(page);
  await page.locator('[data-page="users"]').click();
  await page.route('**/api/admin-action', route => json(route, 503, { error: 'تغییر پلن انجام نشد' }));
  page.once('dialog', dialog => dialog.accept('دلیل آزمایشی تغییر پلن'));
  // Add an active alternate plan through the same dashboard response format.
  await page.route('**/api/admin-dashboard', route => json(route, 200, { ...dashboard, plans: [free, { ...plus, active: true }] }));
  await page.getByRole('button', { name: /بروزرسانی/ }).click();
  const selection = page.locator('#usersBody select');
  await selection.selectOption(plus.id);
  await expect(page.locator('#toast')).toContainText('تغییر پلن انجام نشد');
  await expect(selection).toHaveValue(free.id);
  await expect(selection).toBeEnabled();
});

test('plan activation and deactivation failures show feedback without losing the current plans', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await signedIn(page);
  await page.locator('[data-page="plans"]').click();
  await page.route('**/api/manage-plans', route => json(route, 503, { error: 'ذخیره وضعیت پلن ممکن نیست' }));
  await page.getByRole('button', { name: 'فعال', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('ذخیره وضعیت پلن ممکن نیست');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'غیرفعال', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('ذخیره وضعیت پلن ممکن نیست');
  await expect(page.locator('#planGrid .plan')).toHaveCount(2);
  expect(errors).toEqual([]);
});
