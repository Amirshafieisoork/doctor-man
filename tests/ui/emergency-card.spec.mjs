import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import pngjs from 'pngjs';
import { createEmergencyPageHandler } from '../../server/api/emergency-page.js';

const token = 'syntheticEmergencyCardToken12345', nextToken = 'secondEmergencyCardToken12345678';
const json = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
const scopes = { show_blood_type: true, show_allergies: true, show_conditions: true, show_medications: true, show_emergency_contact: true };
const patient = { id: 'synthetic-person', display_name: 'فرد ساختگی آزمون', relation: 'self', sex: 'female', blood_type: 'A+', birth_date: '1990-01-01', emergency_contact_name: 'همراه آزمون', emergency_contact_phone: '09120000000' };
const other = { ...patient, id: 'synthetic-other', display_name: 'پرونده دوم ساختگی', blood_type: 'O-' };
const decode = canvas => canvas.evaluate(node => { const data = node.getContext('2d').getImageData(0, 0, node.width, node.height); return { data: Array.from(data.data), width: data.width, height: data.height }; }).then(image => jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data);
function contrast(color, background) {
  const lum = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((total, n, i) => total + n * [.2126, .7152, .0722][i], 0);
  const one = lum(color), two = lum(background); return (Math.max(one, two) + .05) / (Math.min(one, two) + .05);
}

test.beforeEach(async ({ page }) => {
  let card = null, creates = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') return json(route, { success: true, patients: [patient, other] });
    if (url.pathname === '/api/health-record') return json(route, { record: { allergies: [{ allergen: 'حساسیت آزمون', severity: 'severe' }], conditions: [{ name: 'بیماری آزمون', status: 'active' }], medications: [{ name: 'داروی آزمون', status: 'active' }] } });
    if (url.pathname === '/api/notifications') return json(route, { notifications: [], unread: 0 });
    if (url.pathname === '/api/emergency-card') {
      if (route.request().method() === 'GET') return json(route, { success: true, card });
      const body = route.request().postDataJSON(); card = { id: 'synthetic-card', ...scopes, ...body, updated_at: 'revision-' + (++creates) };
      return json(route, { success: true, card, url: body.enabled ? '/emergency/' + (creates === 1 ? token : nextToken) : null });
    }
    return json(route, { success: true });
  });
});

async function createCard(page) {
  await page.goto('/health'); await expect(page.locator('#healthLoadStatus')).toBeHidden();
  await page.getByRole('button', { name: 'کارت اضطراری', exact: true }).click(); await expect(page.locator('#emergencyCreate')).toBeEnabled();
  await page.locator('#emergencyCreate').click(); await expect(page.locator('#emergencyPreview')).toBeVisible();
}

test('a locally generated QR decodes to the real revocable URL and the downloaded PNG contains that same QR', async ({ page }, testInfo) => {
  const external = []; page.on('request', request => { if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  await createCard(page); const url = new URL('/emergency/' + token, page.url()).href;
  expect(await decode(page.locator('#emergencyPreview canvas'))).toBe(url); await expect(page.locator('#emergencyOpen')).toHaveAttribute('href', url);
  await expect(page.locator('#emergencyPreview')).toContainText('A+'); await expect(page.locator('#emergencyPreview strong[dir="ltr"]')).toHaveText('A+'); await expect(page.locator('#emergencyPreview')).toContainText('حساسیت آزمون');
  const waiting = page.waitForEvent('download'); await page.locator('#emergencyDownload').click(); const download = await waiting;
  expect(download.suggestedFilename()).toBe('DrMan-emergency-card.png'); const path = testInfo.outputPath('synthetic-emergency-card.png'); await download.saveAs(path);
  const image = pngjs.PNG.sync.read(await readFile(path)); expect(image.width).toBe(1500); expect(image.height).toBe(1020);
  expect(jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data).toBe(url);
  expect(await page.evaluate(value => [localStorage, sessionStorage].every(store => !Object.values(store).some(item => String(item).includes(value))), token)).toBe(true);
  expect(external.some(value => /qrserver|quickchart|googleapis.*chart/.test(value))).toBe(false);
});

test('print contains a readable card and matching QR; disabled cards remove all download and open actions', async ({ page }) => {
  await createCard(page); await page.evaluate(() => { window.print = () => { window.printWasCalled = true; }; });
  await page.locator('#emergencyPrint').click(); expect(await page.evaluate(() => window.printWasCalled)).toBe(true);
  expect(await decode(page.locator('.emergency-print-root canvas'))).toBe(new URL('/emergency/' + token, page.url()).href);
  await page.emulateMedia({ media: 'print' }); await expect(page.locator('.emergency-print-root')).toBeVisible(); await expect(page.locator('body > header')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.emergency-print-root')).toHaveCount(0);
  await page.locator('#emergencyDisable').click(); await expect(page.locator('#emergencyPreview')).toBeHidden(); await expect(page.locator('#emergencyExportActions')).toBeHidden();
  await expect(page.locator('#emergencyOpen')).not.toHaveAttribute('href'); await expect(page.locator('#emergencyLink')).toContainText('دیگر اطلاعاتی نشان نمی‌دهند');
});

test('selection changes hide stale previews, and a family switch cannot download the prior person card', async ({ page }) => {
  await createCard(page); await page.locator('#eBlood').uncheck(); await expect(page.locator('#emergencyPreview')).toBeHidden();
  await page.locator('#emergencyCreate').click(); await expect(page.locator('#emergencyPreview')).toBeVisible(); await expect(page.locator('#emergencyPreview')).not.toContainText('A+');
  await page.locator('#patientSelect').evaluate(node => { node.value = 'synthetic-other'; node.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#emergencyModal')).toBeHidden(); await page.evaluate(() => document.getElementById('emergencyDownload').click());
  await page.getByRole('button', { name: 'کارت اضطراری', exact: true }).click(); await expect(page.locator('#emergencyPreview')).toBeHidden();
});

test('emergency text stays readable with both owner themes and public system themes', async ({ page }) => {
  await createCard(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const colors = await page.locator('#emergencyPreview .emergency-glass-card').evaluate(card => ({ ink: getComputedStyle(card.querySelector('strong')).color, muted: getComputedStyle(card.querySelector('.emergency-card-label')).color, background: getComputedStyle(card).backgroundImage.match(/rgba?\([^)]+\)/)?.[0] }));
    expect(contrast(colors.ink, colors.background)).toBeGreaterThanOrEqual(4.5); expect(contrast(colors.muted, colors.background)).toBeGreaterThanOrEqual(4.5);
  }
  const publicDatabase = { from(table) { const query = { select() { return this; }, eq() { return this; }, limit() { return this; }, async maybeSingle() { return { data: table === 'emergency_cards' ? { patient_id: patient.id, ...scopes } : patient }; }, then(yes, no) { return Promise.resolve({ data: [] }).then(yes, no); } }; return query; } };
  let html; await createEmergencyPageHandler({ database: publicDatabase })({ method: 'GET', query: { token } }, { setHeader() {}, status() { return this; }, end(value) { html = value; } });
  await page.route('**/emergency/' + token, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme }); await page.goto('/emergency/' + token); await expect(page.locator('h1')).toHaveText(patient.display_name);
    const colors = await page.locator('.emergency-glass-card').evaluate(card => ({ ink: getComputedStyle(card.querySelector('h1')).color, muted: getComputedStyle(card.querySelector('.emergency-muted')).color, background: getComputedStyle(card).backgroundImage.match(/rgba?\([^)]+\)/)?.[0] }));
    expect(contrast(colors.ink, colors.background)).toBeGreaterThanOrEqual(4.5); expect(contrast(colors.muted, colors.background)).toBeGreaterThanOrEqual(4.5);
  }
});
