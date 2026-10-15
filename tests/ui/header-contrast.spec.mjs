import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const result = url.pathname === '/api/patients'
      ? { patients: [{ id: 'contrast-fixture', display_name: 'پرونده آزمون خوانایی', relation: 'self', sex: 'female' }] }
      : url.pathname === '/api/health-record' ? { record: {} }
        : url.pathname === '/api/account' ? { user: { id: 'contrast-user' } }
          : { notifications: [], unread: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ...result }) });
  });
});

async function expectReadable(locator) {
  const measured = await locator.evaluate(element => {
    const rgba = value => value.match(/[\d.]+/g).map(Number);
    const blend = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * (foreground[3] ?? 1) + background[index] * (1 - (foreground[3] ?? 1)));
    let background = [255, 255, 255];
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    for (const node of ancestors) background = blend(rgba(getComputedStyle(node).backgroundColor), background);
    const foreground = blend(rgba(getComputedStyle(element).color), background);
    const luminance = color => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const light = luminance(foreground), dark = luminance(background);
    return { ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05), foreground, background, text: element.textContent.slice(0, 70) };
  });
  expect(measured.ratio, JSON.stringify(measured)).toBeGreaterThanOrEqual(4.5);
}

test('header links and controls glow around text with a keyboard underline and no rectangular highlight', async ({ page }, testInfo) => {
  await page.goto('/');
  const menu = page.locator('.site-menu > summary');
  for (const theme of ['dark', 'light']) {
    const targets = [page.locator('.theme-toggle'), menu, page.locator('#accountLink')];
    if (!testInfo.project.name.startsWith('mobile')) targets.push(page.locator('header nav:not(.site-menu-panel) a').first());
    for (const target of targets) {
      await page.keyboard.press('Tab');
      await target.focus();
      await expect(target).toBeFocused();
      await expect.poll(() => target.evaluate(element => element.matches(':focus-visible'))).toBe(true);
      await expect.poll(() => target.evaluate(element => getComputedStyle(element).textShadow)).not.toBe('none');
      expect(await target.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
      expect(await target.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
      expect(await target.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain('underline');
      await expectReadable(target);
      if (!testInfo.project.name.startsWith('mobile')) {
        await target.evaluate(element => element.blur());
        await target.hover();
        await expect.poll(() => target.evaluate(element => getComputedStyle(element).textShadow)).not.toBe('none');
        expect(await target.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
      }
    }
    await menu.focus();
    await page.keyboard.press('Enter');
    const entry = page.locator('.site-menu-panel a[href="/health"]');
    await expect(entry).toBeVisible();
    await entry.focus();
    await expectReadable(entry);
    expect(await entry.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain('underline');
    expect(await entry.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
    await page.keyboard.press('Escape');
    if (theme === 'dark') await page.getByRole('button', { name: 'تغییر به حالت روشن' }).click();
  }
});

test('health dialog labels, secondary descriptions, input text and save controls remain readable in both themes', async ({ page }) => {
  await page.goto('/health');
  await expect(page.locator('#patientSelect')).toHaveValue('contrast-fixture');
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: '+ عضو خانواده', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'افزودن عضو خانواده', exact: true });
    await expect(dialog).toBeVisible();
    const input = dialog.getByLabel('نام', { exact: true });
    await input.fill('نام ساختگی برای آزمون خوانایی');
    await expectReadable(dialog.locator('h2'));
    await expectReadable(dialog.locator('label').first());
    await expectReadable(input);
    await expectReadable(dialog.getByRole('button', { name: 'ساخت پرونده', exact: true }));
    expect(await dialog.locator('label').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
    await page.keyboard.press('Tab');
    await input.focus();
    expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
    await expectReadable(page.locator('.hero .muted').first());
    if (theme === 'dark') await page.getByRole('button', { name: 'تغییر به حالت روشن' }).click();
  }
});
