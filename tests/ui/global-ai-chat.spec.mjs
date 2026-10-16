import { test, expect } from '@playwright/test';

const patients = [
  { id: 'chat-synthetic-self', display_name: 'پروندهٔ ساختگی اول', relation: 'self', sex: 'female' },
  { id: 'chat-synthetic-family', display_name: 'پروندهٔ ساختگی دوم', relation: 'child', sex: 'male' }
];
const emergencyToken = 'syntheticEmergencyToken123456789';
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const launcher = page => page.locator('#drmanAiChatButton');
const chat = page => page.getByRole('dialog', { name: 'راهنمای هوشمند سلامت', exact: true });
const question = page => chat(page).getByRole('textbox', { name: 'سؤال شما', exact: true });
const submit = page => chat(page).getByRole('button', { name: 'ارسال سؤال', exact: true });
let learnHtml, emergencyHtml, emergencyHeaders;

test.beforeAll(async () => {
  // Render the actual server templates with synthetic database results. No
  // application API or real medical/provider data is used by these UI tests.
  process.env.SUPABASE_URL ||= 'https://global-chat-ui.invalid';
  process.env.SUPABASE_SECRET_KEY ||= 'synthetic-global-chat-ui-key';
  const { supabase } = await import('../../server/api/_lib/db.js');
  const { default: learn } = await import('../../server/api/learn-page.js');
  const { createEmergencyPageHandler } = await import('../../server/api/emergency-page.js');
  const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, send(html) { this.html = html; return this; }, end(html) { this.html = html; return this; } });
  const previous = supabase.from;
  try {
    supabase.from = () => {
      const query = {};
      for (const key of ['select', 'eq', 'order', 'limit']) query[key] = () => query;
      query.then = (resolve, reject) => Promise.resolve({ data: [] }).then(resolve, reject);
      return query;
    };
    const res = response(); await learn({ method: 'GET', query: {} }, res); learnHtml = res.html;
  } finally { supabase.from = previous; }
  const database = { from(table) {
    const data = table === 'emergency_cards' ? { patient_id: patients[0].id, enabled: true, show_blood_type: true }
      : table === 'patients' ? { display_name: 'کارت ساختگی عمومی', blood_type: 'A+' } : [];
    const query = {};
    for (const key of ['select', 'eq', 'limit']) query[key] = () => query;
    query.maybeSingle = () => Promise.resolve({ data });
    query.then = (resolve, reject) => Promise.resolve({ data }).then(resolve, reject);
    return query;
  } };
  const res = response();
  await createEmergencyPageHandler({ database })({ method: 'GET', query: { token: emergencyToken } }, res);
  expect(res.statusCode).toBe(200); emergencyHtml = res.html; emergencyHeaders = res.headers;
});

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname === '/learn') return route.fulfill({ status: 200, contentType: 'text/html', body: learnHtml });
    if (url.pathname.startsWith('/emergency/')) return route.fulfill({ status: 200, headers: emergencyHeaders, body: emergencyHtml });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') return json(route, 200, { success: true, patients });
    if (url.pathname === '/api/health-record') return json(route, 200, { success: true, record: {} });
    if (url.pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
    if (url.pathname === '/api/account') return json(route, 200, { success: true, user: { id: 'chat-synthetic-owner' } });
    if (url.pathname === '/api/health-navigator') return json(route, 200, { success: true, answer: 'پاسخ ساختگی برای بررسی رابط گفت‌وگو.' });
    return json(route, 200, { success: true });
  });
});

async function open(page, path = '/') {
  await page.goto(path); await launcher(page).click(); await expect(question(page)).toBeEnabled();
}
async function ask(page, text) { await question(page).fill(text); await submit(page).click(); }

test('a clearly labelled fixed launcher remains within the viewport across all public and private shells', async ({ page }) => {
  for (const path of ['/', '/health', '/learn', '/support', '/account', '/pricing', '/emergency/' + emergencyToken]) {
    await page.goto(path);
    await expect(launcher(page)).toHaveText('چت با هوش مصنوعی'); await expect(launcher(page)).toBeVisible();
    expect(await launcher(page).evaluate(button => {
      const box = button.getBoundingClientRect();
      return getComputedStyle(button).position === 'fixed' && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && box.height >= 44;
    }), path).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(launcher(page)).toBeVisible(); await expect(launcher(page)).toHaveCount(1);
  }
});

test('signed-out visitors get login without medical requests or leaking auth and emergency query values', async ({ page }) => {
  const medical = [];
  await page.route('**/api/account', route => json(route, 401, { error: 'ورود لازم است' }));
  await page.route('**/api/patients', route => json(route, 401, { error: 'ورود لازم است' }));
  await page.route('**/api/health-navigator', route => { medical.push(route.request().postData()); return json(route, 401, { error: 'ورود لازم است' }); });
  for (const path of ['/?token=synthetic-secret&code=synthetic-code#private', '/auth?next=/health&token=synthetic-auth-secret', '/emergency/' + emergencyToken + '?private=synthetic-secret']) {
    await page.goto(path); await launcher(page).click();
    await expect(chat(page).getByRole('link', { name: 'ورود / ثبت‌نام', exact: true })).toBeVisible();
    const href = await chat(page).getByRole('link', { name: 'ورود / ثبت‌نام', exact: true }).getAttribute('href');
    expect(href).toBe('/auth?next=' + encodeURIComponent(path.startsWith('/?') ? '/' : '/health'));
    expect(href).not.toMatch(/secret|token|synthetic|code|private/);
    await expect(question(page)).toBeDisabled(); await expect(submit(page)).toBeDisabled();
    await chat(page).getByRole('button', { name: 'بستن گفت‌وگو' }).click();
  }
  expect(medical).toEqual([]);
});

test('chat sends the explicitly selected family record and only two bounded prior answered turns', async ({ page }) => {
  const calls = [], referrers = [];
  await page.route('**/api/health-navigator', route => {
    const body = route.request().postDataJSON(); calls.push(body); referrers.push(route.request().headers().referer);
    return json(route, 200, { success: true, answer: 'پاسخ ' + calls.length + ' ' + 'آ'.repeat(1100) });
  });
  await open(page, '/emergency/' + emergencyToken + '?access_token=synthetic-private#private');
  await chat(page).getByRole('combobox').selectOption(patients[1].id);
  for (let number = 1; number <= 4; number++) {
    await ask(page, 'پرسش ' + number + ' ' + 'ب'.repeat(800));
    await expect(submit(page)).toBeEnabled(); await expect(chat(page).locator('.ai-chat-answer').last()).toContainText('پاسخ ' + number);
  }
  expect(calls).toHaveLength(4);
  for (const body of calls) {
    expect(body.patient_id).toBe(patients[1].id); expect(Object.keys(body).sort()).toEqual(['history', 'patient_id', 'question']);
    expect(body.history.length).toBeLessThanOrEqual(2);
    for (const turn of body.history) { expect(turn.question.length).toBeLessThanOrEqual(700); expect(turn.answer.length).toBeLessThanOrEqual(1000); }
  }
  expect(calls[0].history).toEqual([]);
  expect(calls[3].history.map(turn => turn.question.slice(0, 6))).toEqual(['پرسش 2', 'پرسش 3']);
  expect(referrers).toEqual([undefined, undefined, undefined, undefined]);
  expect(JSON.stringify(calls)).not.toMatch(/synthetic-private|access_token|syntheticEmergency/);
});

test('failed chat responses stay out of follow-up context and MyPlate is rendered as a trusted source', async ({ page }) => {
  const calls = [];
  await page.route('**/api/health-navigator', route => {
    calls.push(route.request().postDataJSON());
    return calls.length === 1 ? json(route, 503, { error: 'خطای ساختگی سرویس' })
      : json(route, 200, { success: true, answer: 'پاسخ علمی قابل پیگیری', sources: [{ label: 'راهنمای بشقاب غذایی', url: 'https://www.myplate.gov/eat-healthy' }] });
  });
  await open(page); await ask(page, 'سؤال ناموفق');
  await expect(chat(page).locator('.ai-chat-answer')).toHaveText('خطای ساختگی سرویس'); await expect(submit(page)).toBeEnabled();
  await ask(page, 'سؤال موفق');
  await expect(chat(page).locator('.ai-chat-answer').last()).toHaveText('پاسخ علمی قابل پیگیری'); await expect(submit(page)).toBeEnabled();
  await expect(chat(page).getByRole('link', { name: 'راهنمای بشقاب غذایی', exact: true })).toHaveAttribute('href', 'https://www.myplate.gov/eat-healthy');
  await ask(page, 'پیگیری سؤال موفق');
  await expect(chat(page).locator('.ai-chat-answer').last()).toHaveText('پاسخ علمی قابل پیگیری');
  expect(calls).toHaveLength(3); expect(calls[1].history).toEqual([]);
  expect(calls[2].history).toEqual([{ question: 'سؤال موفق', answer: 'پاسخ علمی قابل پیگیری' }]);
});

test('health-page chat initially follows the currently selected record rather than the first family member', async ({ page }) => {
  const calls = [];
  await page.route('**/api/health-navigator', route => {
    const body = route.request().postDataJSON(); if (body.mode !== 'overview') calls.push(body);
    return json(route, 200, { success: true, answer: 'پاسخ همین پروندهٔ انتخاب‌شده' });
  });
  await page.goto('/health'); await expect(page.locator('#patientSelect')).toHaveValue(patients[0].id);
  await page.locator('#patientSelect').selectOption(patients[1].id);
  await launcher(page).click(); await expect(chat(page).getByRole('combobox')).toHaveValue(patients[1].id);
  await ask(page, 'از همین پرونده بگو'); await expect(submit(page)).toBeEnabled();
  expect(calls).toEqual([{ patient_id: patients[1].id, question: 'از همین پرونده بگو', history: [] }]);
});

test('responses stay plain text and only approved medical HTTPS or local article sources become links', async ({ page }) => {
  const malicious = '<img src=x onerror="window.chatExecuted=true"><script>window.chatExecuted=true</script>';
  await page.route('**/api/health-navigator', route => json(route, 200, { success: true, answer: malicious, sources: [
    { label: 'مرجع پزشکی', url: 'https://medlineplus.gov/lab-tests/' },
    { label: '<img src=x onerror="window.chatExecuted=true">', url: '/learn/synthetic-guide' },
    { label: 'دامنهٔ نامعتبر', url: 'https://nhs.uk.evil.invalid/' },
    { label: 'بدون رمزنگاری', url: 'http://nhs.uk/' },
    { label: 'نشانی رمزدار', url: 'https://name:password@nih.gov/' },
    { label: 'اسکریپت', url: 'javascript:alert(1)' },
    { label: 'صفحهٔ دیگر', url: '/admin' }, null
  ] }));
  await open(page); await ask(page, malicious);
  await expect(chat(page).locator('.ai-chat-answer')).toHaveText(malicious);
  await expect(chat(page).locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(() => window.chatExecuted)).toBeUndefined();
  const sources = chat(page).locator('.ai-chat-sources a'); await expect(sources).toHaveCount(2);
  for (const source of await sources.all()) { await expect(source).toHaveAttribute('rel', 'noopener noreferrer'); await expect(source).toHaveAttribute('referrerpolicy', 'no-referrer'); }
  await expect(sources.first()).toHaveAttribute('href', 'https://medlineplus.gov/lab-tests/');
  expect(await chat(page).locator('.ai-chat-answer').evaluate(node => getComputedStyle(node).whiteSpace)).toBe('pre-wrap');
});

test('explicit consent retries the original turn once and blocks overlapping questions while permission is saved', async ({ page }) => {
  const requests = [], consentRequests = [], permission = deferred();
  await page.route('**/api/health-navigator', route => {
    const body = route.request().postDataJSON(); requests.push(body);
    return requests.length === 1 ? json(route, 428, { code: 'AI_CONSENT_REQUIRED' }) : json(route, 200, { success: true, answer: 'پاسخ بعد از اجازهٔ صریح' });
  });
  await page.route('**/api/consent', async route => {
    consentRequests.push(route.request().postDataJSON()); await permission.promise; return json(route, 200, { success: true });
  });
  await open(page); await ask(page, 'پرسش نیازمند اجازه');
  const allow = chat(page).getByRole('button', { name: 'اجازه می‌دهم و ادامه می‌دهم', exact: true });
  await expect(allow).toBeVisible(); expect(consentRequests).toHaveLength(0); expect(requests).toHaveLength(1);
  await allow.click(); await expect.poll(() => consentRequests.length).toBe(1);
  await expect(question(page)).toBeDisabled(); await expect(submit(page)).toBeDisabled();
  await expect(chat(page).getByRole('combobox')).toBeDisabled(); await expect(allow).toBeDisabled();
  permission.resolve(); await expect(chat(page).locator('.ai-chat-answer')).toHaveText('پاسخ بعد از اجازهٔ صریح');
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  expect(consentRequests).toEqual([{ patient_id: patients[0].id, consent_type: 'ai_processing', granted: true, version: '1' }]);
  await expect(chat(page).locator('.ai-chat-turn')).toHaveCount(1);
});

test('closing and reopening a busy chat preserves one request and one answer', async ({ page }) => {
  const started = deferred(), release = deferred(); let count = 0;
  await page.route('**/api/health-navigator', async route => { count++; started.resolve(); await release.promise; return json(route, 200, { success: true, answer: 'پاسخ همان درخواست اول' }); });
  await open(page); await ask(page, 'پرسش طولانی'); await started.promise;
  await expect(submit(page)).toBeDisabled(); await chat(page).getByRole('button', { name: 'بستن گفت‌وگو' }).click();
  await expect(launcher(page)).toBeFocused(); await launcher(page).click(); await expect(submit(page)).toBeDisabled(); expect(count).toBe(1);
  release.resolve(); await expect(chat(page).locator('.ai-chat-answer')).toHaveText('پاسخ همان درخواست اول');
  await expect(chat(page).locator('.ai-chat-turn')).toHaveCount(1); await expect(submit(page)).toBeEnabled(); expect(count).toBe(1);
});

test('closing and reopening during profile loading reuses the one pending request', async ({ page }) => {
  const started = deferred(), release = deferred(); let loads = 0;
  await page.route('**/api/patients', async route => {
    loads++; started.resolve(); await release.promise; return json(route, 200, { success: true, patients });
  });
  await page.goto('/'); await launcher(page).click(); await started.promise;
  await expect(question(page)).toBeDisabled(); await chat(page).getByRole('button', { name: 'بستن گفت‌وگو' }).click();
  await launcher(page).click(); await expect(chat(page)).toBeVisible(); await expect(question(page)).toBeDisabled();
  release.resolve(); await expect(question(page)).toBeEnabled(); expect(loads).toBe(1);
  await chat(page).getByRole('combobox').selectOption(patients[1].id);
  await ask(page, 'پرسش پس از بارگذاری'); await expect(chat(page).locator('.ai-chat-answer')).toHaveText('پاسخ ساختگی برای بررسی رابط گفت‌وگو.');
  await expect(chat(page).getByRole('combobox')).toHaveValue(patients[1].id); expect(loads).toBe(1);
});

test('changing the health family selection clears private chat and ignores the prior delayed answer', async ({ page }) => {
  const started = deferred(), release = deferred(), delivered = deferred(), calls = [];
  await page.route('**/api/health-navigator', async route => {
    const body = route.request().postDataJSON(); if (body.mode === 'overview') return json(route, 200, { success: true }); calls.push(body);
    if (body.patient_id === patients[0].id) { started.resolve(); await release.promise; await json(route, 200, { success: true, answer: 'پاسخ خصوصی پروندهٔ اول' }).catch(() => {}); delivered.resolve(); return; }
    return json(route, 200, { success: true, answer: 'پاسخ مخصوص پروندهٔ دوم' });
  });
  await open(page, '/health'); await ask(page, 'پرسش خصوصی فرد اول'); await started.promise;
  await chat(page).getByRole('button', { name: 'بستن گفت‌وگو' }).click();
  await page.locator('#patientSelect').selectOption(patients[1].id); await launcher(page).click();
  await expect(chat(page).getByRole('combobox')).toHaveValue(patients[1].id); await expect(chat(page).locator('.ai-chat-turn')).toHaveCount(0);
  release.resolve(); await delivered.promise; await expect(chat(page)).not.toContainText('پرسش خصوصی فرد اول'); await expect(chat(page)).not.toContainText('پاسخ خصوصی پروندهٔ اول');
  await ask(page, 'پرسش تازهٔ فرد دوم'); await expect(chat(page).locator('.ai-chat-answer')).toHaveText('پاسخ مخصوص پروندهٔ دوم');
  expect(calls[1]).toEqual({ patient_id: patients[1].id, question: 'پرسش تازهٔ فرد دوم', history: [] });
});

test('keyboard users can open, remain inside, close, and return to the launcher; printing hides chat', async ({ page }) => {
  await page.goto('/'); await launcher(page).focus(); await page.keyboard.press('Enter');
  await expect(question(page)).toBeFocused(); await expect(chat(page)).toBeVisible();
  await page.keyboard.press('Shift+Tab'); await expect(chat(page).getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(chat(page).getByRole('button', { name: 'بستن گفت‌وگو' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(chat(page).getByRole('combobox')).toBeFocused();
  await launcher(page).evaluate(button => button.focus());
  await expect(chat(page).getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(chat(page)).toBeHidden(); await expect(launcher(page)).toBeFocused();
  await launcher(page).click(); await page.emulateMedia({ media: 'print' });
  await expect(launcher(page)).toBeHidden(); await expect(chat(page)).toBeHidden();
});

test('chat text and controls remain readable in both themes without horizontal overflow', async ({ page }) => {
  await open(page); await ask(page, 'پرسش ساختگی برای خوانایی'); await expect(submit(page)).toBeEnabled();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const target of [chat(page).locator('h2'), chat(page).locator('.ai-chat-intro'), chat(page).locator('.ai-chat-answer'), chat(page).locator('[data-chat-status]'), question(page), submit(page)]) {
      const measured = await target.evaluate(element => {
        const rgba = value => value.match(/[\d.]+/g).map(Number);
        const blend = (front, back) => front.slice(0, 3).map((channel, index) => channel * (front[3] ?? 1) + back[index] * (1 - (front[3] ?? 1)));
        const lineage = []; for (let node = element; node; node = node.parentElement) lineage.unshift(node);
        let background = [255, 255, 255];
        for (const node of lineage) background = blend(rgba(getComputedStyle(node).backgroundColor), background);
        const color = blend(rgba(getComputedStyle(element).color), background);
        const luminance = rgb => rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((total, n, i) => total + n * [.2126, .7152, .0722][i], 0);
        const one = luminance(color), two = luminance(background);
        return { contrast: (Math.max(one, two) + .05) / (Math.min(one, two) + .05), text: element.textContent.slice(0, 50) };
      });
      expect(measured.contrast, JSON.stringify({ theme, ...measured })).toBeGreaterThanOrEqual(4.5);
    }
    expect(await chat(page).evaluate(element => {
      const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
  }
});
