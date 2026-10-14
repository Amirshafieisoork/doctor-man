import { test, expect } from '@playwright/test';

const photo = { name: 'synthetic-lab.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D1sAAAAASUVORK5CYII=', 'base64') };
const account = { success: true, user: { id: 'synthetic-owner', name: 'کاربر آزمون' }, subscription: { plan: { name: 'رایگان' }, remaining: 2 } };
const patients = { success: true, patients: [{ id: 'synthetic-patient', display_name: 'پرونده آزمایشی', relation: 'self', sex: 'male' }] };
const result = { success: true, analysis: 'نتیجه آزمایشی برای بررسی رابط کاربری', read_quality: 'good' };
const reportSections = [
  { section_id: 1, title: 'خلاصه کلی وضعیت سلامت', content: 'این گزارش ساختگی برای نمایش ساختار تفسیر و کیفیت خواندن نتیجه آزمایش است.' },
  { section_id: 2, title: 'بررسی تک‌تک مقادیر آزمایش', content: 'هر مقدار با نام، واحد و محدوده چاپ‌شده همان برگه مرور می‌شود.' },
  { section_id: 3, title: 'توضیح تفصیلی موارد غیرنرمال', content: 'یافته غیرطبیعی بدون افزودن تشخیص قطعی توضیح داده می‌شود و نیاز به پیگیری دارد.' },
  { section_id: 4, title: 'هشدارهای مهم پزشکی', content: 'علائم شدید و بدتر شدن سریع حال نیازمند ارزیابی پزشکی فوری هستند.' },
  { section_id: 5, title: 'توصیه‌های تغذیه‌ای دقیق', content: 'سبزی، حبوبات و غلات کامل بیشتر مصرف کنید و نوشیدنی شیرین و غذاهای فراوری‌شده را کمتر کنید.' },
  { section_id: 6, title: 'سبک زندگی و فعالیت بدنی', content: 'پیاده‌روی را تدریجی شروع کنید، خواب منظم داشته باشید و هنگام درد قفسه سینه فعالیت را متوقف کنید.' },
  { section_id: 7, title: 'گزینه‌های گیاهی و طب مکمل (با احتیاط)', content: 'پیش از مصرف درمانی گیاه یا مکمل، تداخل آن با داروهای فعلی را با پزشک یا داروساز بررسی کنید.' },
  { section_id: 8, title: 'کِی به پزشک مراجعه کند و چه تخصصی', content: 'برای مرور نتیجه با پزشک خود شروع کنید و تصویر خوانا و فهرست داروها را همراه داشته باشید.' },
  { section_id: 9, title: 'نکته پایانی و دلگرمی', content: 'با نگهداری آزمایش در پرونده سلامت و نوشتن پرسش‌های خود، قدم بعدی را روشن و قابل انجام کنید.' }
];
function structuredResult(sections = reportSections) {
  return { success: true, analysis: 'LEGACY_FULL_TEXT_MUST_NOT_REPLACE_SECTIONS', read_quality: 'good', structured: { sections } };
}
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

test('a detailed analysis displays all nine categories, actionable nutrition and exercise, and the health-record link', async ({ page }) => {
  await page.route('**/api/documents', route => json(route, 201, { success: true, document: { id: 'saved-image' } }));
  await page.route('**/api/analyze-lab', route => json(route, 200, structuredResult()));
  await readyPhoto(page);
  await page.locator('#analyze').click();
  const output = page.locator('#result');
  await expect(output.locator('h3')).toHaveText(reportSections.map(section => `${section.section_id}. ${section.title}`));
  await expect(output.locator('.lab-report-section')).toHaveCount(9);
  await expect(output.locator('.lab-report-section p')).toHaveText(reportSections.map(section => section.content));
  await expect(output).toContainText('نوشیدنی شیرین و غذاهای فراوری‌شده را کمتر کنید');
  await expect(output).toContainText('پیاده‌روی را تدریجی شروع کنید');
  await expect(output).not.toContainText('LEGACY_FULL_TEXT_MUST_NOT_REPLACE_SECTIONS');
  await expect(output.getByRole('link', { name: 'مشاهده در پرونده سلامت', exact: true })).toHaveAttribute('href', '/health');
  await expect(page.locator('#analyze')).toBeEnabled();
});

test('section titles and bodies display embedded markup as text and never execute model-supplied HTML', async ({ page }) => {
  const sections = structuredClone(reportSections);
  sections[0].title += ' <img src=x onerror="window.syntheticReportXss=1">';
  sections[4].content += ' <script>window.syntheticReportXss=2</script><img src=x onerror="window.syntheticReportXss=3">';
  await page.route('**/api/documents', route => json(route, 201, { success: true, document: { id: 'saved-image' } }));
  await page.route('**/api/analyze-lab', route => json(route, 200, structuredResult(sections)));
  await readyPhoto(page);
  await page.locator('#analyze').click();
  const output = page.locator('#result');
  await expect(output.locator('h3')).toHaveText(sections.map(section => `${section.section_id}. ${section.title}`));
  await expect(output.locator('.lab-report-section p')).toHaveText(sections.map(section => section.content));
  await expect(output.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => window.syntheticReportXss)).toBeUndefined();
  await expect(output.getByRole('link', { name: 'مشاهده در پرونده سلامت', exact: true })).toHaveAttribute('href', '/health');
});
