import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D1sAAAAASUVORK5CYII=', 'base64');
const image = name => ({ name, mimeType: 'image/png', buffer: png });
const freePlan = { id: 'free', name: 'رایگان', price: 0, test_limit: 2, active: true, features: ['پرونده سلامت'] };
const paidPlan = { id: 'plus', name: 'همراه', price: 149000, test_limit: 10, active: true, features: ['تحلیل بیشتر'] };
const account = { success: true, user: { id: 'test-user', name: 'کاربر آزمون', phone: '09123456789' }, subscription: { plan: freePlan, remaining: 2 }, tests: [], payments: [] };

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test.beforeEach(async ({ page }) => {
  // Every API is simulated at the browser boundary. No real health data,
  // account, provider call, payment, or database write can occur in UI QA.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (!local) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/doctors') return json(route, 200, { success: true, doctors: [] });
    if (url.pathname === '/api/get-plans') return json(route, 200, { success: true, plans: [freePlan, paidPlan] });
    if (url.pathname === '/api/status') return json(route, 200, { success: true, ai: { configured: false }, payments: { digipay_configured: false } });
    return json(route, 401, { success: false, error: 'ابتدا وارد حساب شوید' });
  });
});

for (const path of ['/', '/auth', '/doctors', '/pricing', '/privacy', '/terms', '/medical-methodology', '/support']) {
  test(`Persian page ${path} renders readable RTL without horizontal scrolling`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('rtl');
    expect(errors).toEqual([]);
    if (path === '/') await testInfo.attach('landing-' + testInfo.project.name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}

test('theme can be changed with the keyboard and persists on reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const toggle = page.getByRole('button', { name: /حالت تیره$/ });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /حالت روشن$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

for (const [path, next] of [['/health', '/health'], ['/account', '/account'], ['/doctor-portal', '/doctor-portal']]) {
  test(`unauthenticated ${path} redirects to login preserving the destination`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(url => url.pathname === '/auth' && url.searchParams.get('next') === next);
    await expect(page.getByRole('button', { name: 'ورود به حساب', exact: true })).toBeVisible();
  });
}

test('login validates locally, normalizes Persian numbers and recovers from rejected credentials', async ({ page }) => {
  let loginCalls = 0, payload;
  await page.route('**/api/login', async route => {
    loginCalls++; payload = route.request().postDataJSON();
    await json(route, 401, { success: false, error: 'شماره موبایل یا رمز عبور صحیح نیست' });
  });
  await page.goto('/auth');
  await page.getByLabel('شماره موبایل', { exact: true }).first().fill('۱۲۳');
  await page.getByLabel('رمز عبور', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'ورود به حساب', exact: true }).click();
  await expect(page.locator('#msg')).toContainText('صحیح وارد کنید');
  expect(loginCalls).toBe(0);
  await page.getByLabel('شماره موبایل', { exact: true }).first().fill('۰۹۱۲۳۴۵۶۷۸۹');
  await page.getByRole('button', { name: 'ورود به حساب', exact: true }).click();
  await expect(page.locator('#msg')).toContainText('شماره موبایل یا رمز عبور صحیح نیست');
  expect(payload.phone).toBe('09123456789');
  await expect(page.getByRole('button', { name: 'ورود به حساب', exact: true })).toBeEnabled();
});

test('lab upload limits pages, supports selection/removal and rejects unsuitable files', async ({ page }) => {
  await page.goto('/');
  await page.locator('#picker').setInputFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('#error')).toContainText(/فرمت تصویر|تصاویر JPG/);
  await page.locator('#picker').setInputFiles([1, 2, 3, 4, 5].map(number => image(`page-${number}.png`)));
  await expect(page.locator('.lab-thumbnail')).toHaveCount(4);
  await expect(page.locator('#count')).toHaveText('۴ از ۴');
  await page.getByRole('button', { name: 'نمایش صفحه ۲', exact: true }).click();
  await expect(page.locator('.lab-preview img')).toHaveAttribute('alt', 'پیش‌نمایش صفحه ۲ آزمایش');
  await page.getByRole('button', { name: 'حذف صفحه ۲', exact: true }).click();
  await expect(page.locator('.lab-thumbnail')).toHaveCount(3);
  await expect(page.locator('#count')).toHaveText('۳ از ۴');
  await page.locator('#picker').setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await expect(page.locator('#error')).toContainText('۴ مگابایت');
  await expect(page.locator('.lab-thumbnail')).toHaveCount(3);
});

test('lab analysis routes visitors to login and never calls the analysis provider', async ({ page }) => {
  let analysisCalls = 0;
  await page.route('**/api/analyze-lab', async route => { analysisCalls++; await json(route, 500, {}); });
  await page.goto('/');
  await page.locator('#picker').setInputFiles(image('lab.png'));
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(url => url.pathname === '/auth' && url.searchParams.get('next') === '/#lab');
  expect(analysisCalls).toBe(0);
});

test('signed-in lab quota errors are visible and leave the form usable', async ({ page }) => {
  await page.route('**/api/account', route => json(route, 200, account));
  await page.route('**/api/patients', route => json(route, 200, { success: true, patients: [{ id: 'test-patient', display_name: 'کاربر آزمون', relation: 'self' }] }));
  await page.route('**/api/analyze-lab', route => json(route, 402, { success: false, error: 'سهمیه تحلیل این دوره به پایان رسیده است.' }));
  await page.goto('/');
  await expect(page.locator('#welcome')).toContainText('کاربر آزمون');
  await page.locator('#picker').setInputFiles(image('lab.png'));
  await expect(page.locator('#analyze')).toBeDisabled();
  await page.locator('#labConsent').check();
  await page.locator('#analyze').click();
  await expect(page.locator('#error')).toContainText('سهمیه تحلیل');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('.lab-thumbnail')).toHaveCount(1);
});

test('paid subscriptions stay disabled when the payment provider is unavailable', async ({ page }) => {
  let paymentCalls = 0;
  await page.route('**/api/payment-start', async route => { paymentCalls++; await json(route, 500, {}); });
  await page.goto('/pricing');
  await expect(page.locator('#plans .card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'پرداخت به‌زودی فعال می‌شود' })).toBeDisabled();
  await page.getByRole('button', { name: 'شروع رایگان', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/auth' && url.searchParams.get('next') === '/pricing');
  expect(paymentCalls).toBe(0);
});

test('pricing reports an API failure instead of leaving an endless loading state', async ({ page }) => {
  await page.route('**/api/get-plans', route => json(route, 503, { success: false, error: 'سرویس موقتاً در دسترس نیست' }));
  await page.goto('/pricing');
  await expect(page.locator('#alert')).toBeVisible();
  await expect(page.locator('#plans')).not.toContainText('در حال بارگذاری');
});

test('doctor directory separates an outage from the honest empty-network state', async ({ page }) => {
  await page.goto('/doctors');
  await expect(page.locator('#grid')).toContainText('هنوز پروفایل عمومی');
  await page.route('**/api/doctors**', route => json(route, 503, { success: false, error: 'فهرست پزشکان موقتاً در دسترس نیست' }));
  await page.getByRole('button', { name: 'جستجو', exact: true }).click();
  await expect(page.locator('#grid')).toContainText(/خطا|دسترس نیست/);
  await expect(page.locator('#grid')).not.toContainText('هنوز پروفایل عمومی');
});

test('support failure recovers the send button and keeps the user message', async ({ page }) => {
  await page.route('**/api/status', route => json(route, 200, { success: true, ai: { configured: true }, payments: { digipay_configured: false } }));
  await page.route('**/api/support-chat', route => json(route, 503, { success: false, error: 'راهنما موقتاً در دسترس نیست؛ دوباره تلاش کنید' }));
  await page.goto('/support');
  await page.locator('#input').fill('چطور پرونده سلامت بسازم؟');
  await page.getByRole('button', { name: 'ارسال', exact: true }).click();
  await expect(page.locator('.m.user')).toHaveText('چطور پرونده سلامت بسازم؟');
  await expect(page.locator('.m.bot').last()).toContainText('موقتاً در دسترس نیست');
  await expect(page.getByRole('button', { name: 'ارسال', exact: true })).toBeEnabled();
});

test('unknown route provides a Persian 404 and a way back to the site', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'این صفحه پیدا نشد' })).toBeVisible();
  await expect(page.locator('a[href="/"]')).toBeVisible();
});

test('mobile menu and skip link are usable with the keyboard', async ({ page }) => {
  await page.goto('/');
  const summary = page.locator('summary[aria-label="فهرست بخش‌های دکتر من"]');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.site-menu-panel')).toBeVisible();
  await expect(page.locator('.site-menu-panel').getByRole('link', { name: 'پرونده سلامت', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.site-menu-panel')).toBeHidden();
  await expect(summary).toBeFocused();
  await page.getByRole('link', { name: 'رفتن به محتوای اصلی', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main').first()).toBeFocused();
});

test('unconfigured support provides a readable guide and prevents provider submission', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/support-chat', async route => { requests++; await json(route, 500, {}); });
  await page.goto('/support');
  await expect(page.locator('#meta')).toContainText('فعلاً در دسترس نیست');
  await expect(page.getByRole('button', { name: 'ارسال', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'راهنمای استفاده از دکتر من' })).toBeVisible();
  expect(requests).toBe(0);
});

test('authentication return URLs reject external and backslash destinations', async ({ page }) => {
  await page.route('**/api/account', route => json(route, 200, account));
  await page.route('**/api/patients', route => json(route, 200, { success: true, patients: [] }));
  await page.route('**/api/notifications', route => json(route, 200, { success: true, notifications: [], unread: 0 }));
  for (const next of ['https://outside.example/path', '//outside.example/path', '/\\outside.example/path']) {
    await page.goto('/auth?next=' + encodeURIComponent(next), { waitUntil: 'commit' });
    await expect(page).toHaveURL(url => url.pathname === '/health');
    await expect(page.locator('#patientSelect')).toBeVisible();
  }
  await page.goto('/auth?next=' + encodeURIComponent('/pricing'), { waitUntil: 'commit' });
  await expect(page).toHaveURL(url => url.pathname === '/pricing');
});

async function mockHealth(page, record = {}) {
  await page.route('**/api/patients', route => json(route, 200, { success: true, patients: [{ id: 'synthetic-patient', display_name: 'پرونده آزمایشی', relation: 'self' }] }));
  await page.route('**/api/health-record**', route => json(route, 200, { success: true, record }));
  await page.route('**/api/notifications', route => json(route, 200, { success: true, notifications: [], unread: 0 }));
  for (const route of ['care-plan', 'care-episodes', 'biomarker-trends']) await page.route('**/api/' + route + '**', request => json(request, 200, { success: true }));
}

test('health family dialog traps keyboard focus and returns to the opening control', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/health');
  await expect(page.locator('#patientSelect')).toHaveValue('synthetic-patient');
  const trigger = page.getByRole('button', { name: '+ عضو خانواده', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'افزودن عضو خانواده', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('نام', { exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'انصراف', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('نام', { exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'انصراف', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('health edit saves the current patient entry and reloads the rendered record', async ({ page }) => {
  const record = { medications: [{ id: 'synthetic-medication', name: 'داروی آزمایشی', dose: '۱۰ میلی‌گرم', frequency: 'روزانه', status: 'active' }] };
  await mockHealth(page, record);
  let submitted;
  await page.route('**/api/health-entry', async route => {
    submitted = route.request().postDataJSON();
    expect(route.request().method()).toBe('PATCH');
    record.medications[0] = { ...record.medications[0], ...submitted };
    await json(route, 200, { success: true });
  });
  await page.goto('/health');
  await page.getByRole('button', { name: 'ویرایش داروی آزمایشی', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ویرایش اطلاعات سلامت', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="dose"]').fill('مقدار اصلاح‌شده');
  await dialog.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#medications')).toContainText('مقدار اصلاح‌شده');
  expect(submitted.patient_id).toBe('synthetic-patient');
  expect(submitted.id).toBe('synthetic-medication');
  await expect(page.locator('#healthFeedback')).toContainText('ذخیره شد');
});

test('health save failure stays in the dialog with values preserved and retry enabled', async ({ page }) => {
  await mockHealth(page);
  await page.route('**/api/health-entry', route => json(route, 503, { success: false, error: 'ذخیره موقتاً ممکن نیست؛ دوباره تلاش کنید' }));
  await page.goto('/health');
  await expect(page.locator('#patientSelect')).toHaveValue('synthetic-patient');
  await page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن اطلاعات سلامت', exact: true });
  await dialog.locator('input[name="name"]').fill('ورودی آزمایشی');
  await dialog.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="name"]')).toHaveValue('ورودی آزمایشی');
  await expect(dialog.getByRole('button', { name: 'ذخیره', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('alert')).toContainText('موقتاً ممکن نیست');
});

test('future appointment offers intake and cancellation then removes the cancelled action', async ({ page }) => {
  const appointment = { id: 'synthetic-appointment', status: 'confirmed', starts_at: new Date(Date.now() + 86400000).toISOString(), mode: 'online', doctor_profiles: { full_name: 'پزشک آزمایشی' } };
  await mockHealth(page, { appointments: [appointment] });
  let submitted;
  await page.route('**/api/appointments', async route => {
    submitted = route.request().postDataJSON();
    appointment.status = 'cancelled';
    await json(route, 200, { success: true });
  });
  await page.goto('/health');
  await expect(page.locator('#patientSelect')).toHaveValue('synthetic-patient');
  await page.getByRole('button', { name: 'مراقبت و پیگیری', exact: true }).click();
  await expect(page.getByRole('link', { name: 'آماده‌سازی ویزیت', exact: true })).toHaveAttribute('href', '/visit-intake?appointment_id=synthetic-appointment');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'لغو نوبت', exact: true }).click();
  await expect(page.getByRole('button', { name: 'لغو نوبت', exact: true })).toHaveCount(0);
  expect(submitted).toEqual({ id: 'synthetic-appointment', action: 'cancel' });
  await expect(page.locator('#healthFeedback')).toContainText('نوبت لغو شد');
});

test('large lab image is reduced before consented upload and successful result links to the record', async ({ page }) => {
  await page.route('**/api/account', route => json(route, 200, account));
  await page.route('**/api/patients', route => json(route, 200, { success: true, patients: [{ id: 'test-patient', display_name: 'کاربر آزمون', relation: 'self' }] }));
  let requests = 0, payload;
  await page.route('**/api/analyze-lab', async route => {
    requests++; payload = route.request().postDataBuffer();
    await json(route, 200, { success: true, read_quality: 'good', analysis: 'پاسخ شبیه‌سازی‌شده برای آزمون رابط کاربری.' });
  });
  await page.goto('/');
  await expect(page.locator('#welcome')).toContainText('کاربر آزمون');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 700;
    const context = canvas.getContext('2d'), pixels = context.createImageData(700, 700);
    let seed = 1234567;
    for (let index = 0; index < pixels.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[index + channel] = seed & 255; }
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
  });
  const buffer = Buffer.from(bytes, 'base64');
  expect(buffer.length).toBeGreaterThan(900 * 1024);
  await page.locator('#picker').setInputFiles({ name: 'large-lab.png', mimeType: 'image/png', buffer });
  await expect(page.locator('.lab-thumbnail')).toHaveCount(1);
  await expect(page.locator('#analyze')).toBeDisabled();
  expect(requests).toBe(0);
  await page.locator('#labConsent').check();
  await page.locator('#analyze').click();
  await expect(page.locator('#result')).toContainText('پاسخ شبیه‌سازی‌شده');
  expect(requests).toBe(1);
  expect(payload.length).toBeLessThan(1024 * 1024);
  expect(payload.toString('latin1')).toMatch(/name="ai_consent"\r\n\r\ntrue/);
  expect(payload.toString('latin1')).toContain('Content-Type: image/jpeg');
  await expect(page.locator('#result').getByRole('link', { name: 'مشاهده در پرونده سلامت', exact: true })).toHaveAttribute('href', '/health');
});
