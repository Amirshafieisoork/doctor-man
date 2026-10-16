import { test, expect } from '@playwright/test';

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const patients = [{ id: 'overview-self', display_name: 'پروندهٔ آزمون اول', relation: 'self' }, { id: 'overview-family', display_name: 'پروندهٔ آزمون دوم', relation: 'child' }];
const overview = name => ({ success: true, source: 'cached', state: 'ready', stale: false, generated_at: '2026-10-15T10:00:00Z', overview: { overall: 'جمع‌بندی آموزشی ' + name, next_steps: ['قدم بعدی ' + name], nutrition: ['خوراک پیشنهادی ' + name], movement: ['حرکت پیشنهادی ' + name], seek_care: 'در صورت علائم شدید ارزیابی پزشکی لازم است.', questions_for_doctor: ['در مراجعه چه چیزی بپرسم؟'], data_limits: ['بخشی از داده‌ها هنوز ثبت نشده است.'] } });
const program = name => ({ goal: 'هدف کوچک و قابل ادامه برای ' + name, based_on: ['این برنامه بر اساس چربی خون و سابقهٔ همین پرونده است.'],
  first_week: [
    { label: 'روزهای ۱ و ۲ · شروع آسان', steps: ['یک انتخاب غذایی قابل اجرا برای ' + name, 'زمان معمول خواب و بیداری را یادداشت کنید.'] },
    { label: 'روزهای ۳ و ۴ · تکرار عادت', steps: ['حرکت سبک متناسب با توان و شرایط خود انتخاب کنید.', 'همان تغییر غذایی را تکرار و موانعش را یادداشت کنید.'] },
    { label: 'روزهای ۵ تا ۷ · مرور هفته', steps: ['تعداد روزهای اجرای عادت را مرور کنید.', 'پرسش مربوط به آزمایش را برای مراجعه آماده کنید.'] }
  ], next_weeks: ['فقط یک عادت را در هفتهٔ دوم کمی گسترش دهید.', 'پایان هفتهٔ دوم پایبندی و انرژی خود را مرور کنید.'],
  sleep_and_stress: ['نزدیک خواب استفاده از صفحه‌نمایش را کمتر کنید.', 'یک مکث کوتاه برای آرام‌سازی در روز بگذارید.'],
  tracking: ['تعداد روزهای انجام عادت را برای خود ثبت کنید.', 'علائم و محدودیت‌ها را در مراجعه مطرح کنید.'], precautions: ['حساسیت به بادام زمینی را رعایت کنید.'] });

async function expectReadable(locator) {
  const measured = await locator.evaluate(element => {
    const rgba = value => value.match(/[\d.]+/g).map(Number);
    const blend = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * (foreground[3] ?? 1) + background[index] * (1 - (foreground[3] ?? 1)));
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    let backgrounds = [[255, 255, 255]];
    for (const node of ancestors) {
      const style = getComputedStyle(node);
      backgrounds = backgrounds.map(background => blend(rgba(style.backgroundColor), background));
      // Check each gradient stop as well as the surface beneath it, including
      // the strongest part of the translucent teal decoration.
      const stops = style.backgroundImage.match(/rgba?\([^)]+\)/g) || [];
      if (stops.length) backgrounds = backgrounds.flatMap(background => [background, ...stops.map(stop => blend(rgba(stop), background))]);
    }
    const luminance = color => color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const foreground = rgba(getComputedStyle(element).color);
    const ratios = backgrounds.map(background => {
      const one = luminance(blend(foreground, background)), two = luminance(background);
      return (Math.max(one, two) + .05) / (Math.min(one, two) + .05);
    });
    return { ratio: Math.min(...ratios), text: element.textContent.slice(0, 70) };
  });
  expect(measured.ratio, JSON.stringify(measured)).toBeGreaterThanOrEqual(4.5);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') return json(route, { success: true, patients });
    if (url.pathname === '/api/notifications') return json(route, { notifications: [], unread: 0 });
    if (url.pathname === '/api/health-record') return json(route, { success: true, record: { medications: [{ id: 'synthetic-medication', name: 'داروی ثبت‌شدهٔ ساختگی', status: 'active' }] } });
    return json(route, { success: true });
  });
});

test('opening a health record automatically shows practical guidance without a question or button', async ({ page }) => {
  const submitted = [];
  await page.route('**/api/health-navigator', route => { submitted.push(route.request().postDataJSON()); return json(route, overview('پروندهٔ اول')); });
  await page.goto('/health');
  await expect(page.locator('#automaticHealthOverview')).toContainText('جمع‌بندی آموزشی پروندهٔ اول');
  await expect(page.locator('#automaticHealthOverview')).toContainText('چه بخورم؟');
  await expect(page.locator('#automaticHealthOverview')).toContainText('چطور فعال‌تر باشم؟');
  expect(submitted).toEqual([{ mode: 'overview', patient_id: 'overview-self' }]);
  await expect(page.locator('#automaticHealthOverview button')).toHaveCount(0);
  await expect(page.locator('#medications')).toContainText('داروی ثبت‌شدهٔ ساختگی');
});

test('a late prior-family response cannot populate the next selected private record', async ({ page }) => {
  let release, started = 0; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/health-navigator', async route => {
    const { patient_id: id } = route.request().postDataJSON();
    if (id === 'overview-self') { started++; await gate; await json(route, overview('اطلاعات خصوصی اول')).catch(() => {}); }
    else await json(route, overview('پرونده دوم'));
  });
  await page.goto('/health'); await expect.poll(() => started).toBe(1);
  await page.locator('#patientSelect').selectOption('overview-family');
  await expect(page.locator('#automaticHealthOverview')).toContainText('جمع‌بندی آموزشی پرونده دوم');
  release(); await expect(page.locator('#automaticHealthOverview')).not.toContainText('اطلاعات خصوصی اول');
});

test('summary content stays readable in either theme and stored markup remains plain text', async ({ page }) => {
  const payload = overview('متن آزمون'); payload.overview.nutrition = ['<img src=x onerror="window.overviewExecuted=true">'];
  await page.route('**/api/health-navigator', route => json(route, payload));
  await page.goto('/health'); await expect(page.locator('#automaticHealthOverview')).toContainText('<img src=x');
  await expect(page.locator('#automaticHealthOverview img')).toHaveCount(0);
  expect(await page.evaluate(() => window.overviewExecuted)).toBeUndefined();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const selector of ['h2', '.health-overview-intro', '.health-overview-status', '.health-overview-summary', 'li', '.health-overview-care p', '.health-overview-disclaimer']) {
      await expectReadable(page.locator('#automaticHealthOverview ' + selector).first());
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test('a failed automatic request leaves the rest of the record usable', async ({ page }) => {
  await page.route('**/api/health-navigator', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) }));
  await page.goto('/health'); await expect(page.locator('#automaticHealthOverview')).toContainText('جمع‌بندی فعلاً دریافت نشد');
  await expect(page.locator('#medications')).toContainText('داروی ثبت‌شدهٔ ساختگی');
  await expect(page.getByRole('button', { name: '+ اطلاعات سلامت', exact: true })).toBeEnabled();
});

test('a lifestyle program shows seven-day actions, continuation and safe sources without creating patient tasks', async ({ page }) => {
  const calls = [], payload = overview('برنامهٔ آزمایشی'); payload.overview.lifestyle_plan = program('برنامهٔ آزمایشی'); payload.lifestyle_source = 'record';
  page.on('request', request => { if (request.url().includes('/api/')) calls.push({ url: request.url(), method: request.method() }); });
  await page.route('**/api/health-navigator', route => json(route, payload));
  await page.goto('/health');
  const plan = page.locator('#automaticHealthOverview .health-lifestyle-plan');
  await expect(plan).toContainText('برنامهٔ اصلاح سبک زندگی شما');
  await expect(plan.locator('.health-lifestyle-week>section')).toHaveCount(3);
  await expect(plan.locator('.health-lifestyle-week li')).toHaveCount(6);
  for (const heading of ['ادامه در هفته‌های بعد', 'خواب و آرامش', 'چطور پیشرفتم را ببینم؟', 'متناسب با شرایط شما']) await expect(plan.getByRole('heading', { name: heading })).toBeVisible();
  await expect(plan).toContainText('بادام زمینی'); await expect(plan).toContainText('برنامهٔ شخصی‌تر');
  await plan.locator('summary').click();
  for (const link of await plan.locator('a').all()) expect(await link.getAttribute('href')).toMatch(/^https:\/\/(www\.)?(who\.int|niddk\.nih\.gov|cdc\.gov)\//);
  expect(calls.filter(call => /health-entry|care-tasks|patients/.test(call.url) && call.method !== 'GET')).toEqual([]);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expectReadable(plan.locator('.health-lifestyle-goal'));
    await expectReadable(plan.locator('.health-lifestyle-week li').first());
    await expectReadable(plan.locator('a').first());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test('lifestyle text is inert and switching family clears the prior personal program immediately', async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/health-navigator', async route => {
    const id = route.request().postDataJSON().patient_id, payload = overview(id);
    payload.overview.lifestyle_plan = program(id === 'overview-self' ? 'اطلاعات سبک زندگی اول' : 'برنامهٔ عضو خانواده');
    if (id === 'overview-family') await gate;
    else payload.overview.lifestyle_plan.first_week[0].steps[0] = '<img src=x onerror="window.lifestyleExecuted=true">';
    await json(route, payload);
  });
  await page.goto('/health'); const plan = page.locator('.health-lifestyle-plan');
  await expect(plan).toContainText('<img src=x'); await expect(plan.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.lifestyleExecuted)).toBeUndefined();
  await page.locator('#patientSelect').selectOption('overview-family');
  await expect(page.locator('#automaticHealthOverview')).not.toContainText('اطلاعات سبک زندگی اول');
  await expect(page.locator('.health-lifestyle-plan')).toHaveCount(0);
  release(); await expect(plan).toContainText('برنامهٔ عضو خانواده');
});
