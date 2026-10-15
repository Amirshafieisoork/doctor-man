import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'ابتدا وارد حساب شوید' }) });
    return route.continue();
  });
});

async function expectMark(page, theme) {
  const mark = page.locator('img[data-drman-brandmark]').first();
  const version = theme === 'dark' ? 6 : 5;
  await expect.poll(() => mark.evaluate((img, selected) => img.complete && img.naturalWidth > 0 && img.currentSrc.endsWith(`/assets/drman-mark-v${selected}.webp`), version)).toBe(true);
  return mark;
}

test('approved brand mark stays visible, transparent in dark mode, and switches consistently after reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const mark = await expectMark(page, 'dark');
  const expectedSize = testInfo.project.name.startsWith('mobile') ? 44 : 52;
  const darkState = await mark.evaluate(img => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    const alpha = [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
    const style = getComputedStyle(img), bounds = img.getBoundingClientRect();
    return { alpha, width: bounds.width, height: bounds.height, background: style.backgroundColor, shadow: style.boxShadow, objectFit: style.objectFit };
  });
  expect(darkState.alpha).toEqual([0, 0, 0, 0]);
  expect(darkState.background).toBe('rgba(0, 0, 0, 0)');
  expect(darkState.shadow).toBe('none');
  expect(darkState.objectFit).toBe('contain');
  expect(darkState.width).toBe(expectedSize); expect(darkState.height).toBe(expectedSize);
  await testInfo.attach('approved-dark-header', { body: await page.locator('header').screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'تغییر به حالت روشن' }).click();
  await expectMark(page, 'light');
  await page.reload(); await expectMark(page, 'light');
  await testInfo.attach('approved-light-header', { body: await page.locator('header').screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'تغییر به حالت تیره' }).click();
  await expectMark(page, 'dark');
  await page.goto('/auth');
  await expectMark(page, 'dark');
});

test('later inserted header and nav marks use the active theme without changing their design', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => {
    const header = document.createElement('header');
    header.id = 'later-header';
    header.innerHTML = '<a class="brand" href="/"><img src="/assets/drman-mark-v5.webp" alt="دکتر من"></a><nav><a href="/"><img src="/assets/drman-mark-v5.webp" alt="دکتر من"></a></nav>';
    document.body.append(header);
  });
  const marks = page.locator('#later-header img');
  await expect(marks).toHaveCount(2);
  for (const mark of await marks.all()) {
    await expect(mark).toHaveAttribute('data-drman-brandmark', '');
    await expect(mark).toHaveAttribute('src', '/assets/drman-mark-v6.webp');
    const size = testInfo.project.name.startsWith('mobile') ? 44 : 52;
    expect(await mark.evaluate(img => {
      const style = getComputedStyle(img);
      return { width: parseFloat(style.width), height: parseFloat(style.height) };
    })).toEqual({ width: size, height: size });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.getByRole('button', { name: 'تغییر به حالت روشن' }).click();
  for (const mark of await marks.all()) await expect(mark).toHaveAttribute('src', '/assets/drman-mark-v5.webp');
  await page.getByRole('button', { name: 'تغییر به حالت تیره' }).click();
  for (const mark of await marks.all()) await expect(mark).toHaveAttribute('src', '/assets/drman-mark-v6.webp');
});

test('interactive cards glow for keyboard and mouse without moving', async ({ page }, testInfo) => {
  await page.goto('/');
  const targets = [page.locator('.features a.feature').first(), page.locator('a.guideCard').first(), page.locator('.heroCtas a.btn.primary').first()];
  const geometry = target => target.evaluate(el => {
    const { x, y, width, height } = el.getBoundingClientRect();
    const parent = el.parentElement.getBoundingClientRect();
    // Sticky header controls move with scrolling; their position in the layout stays fixed.
    return { x: x - parent.x, y: y - parent.y, width, height };
  });
  for (const theme of ['dark', 'light']) {
    for (const target of targets) {
      const before = await geometry(target);
      await page.keyboard.press('Tab'); await target.focus();
      await expect.poll(() => target.evaluate(el => el.matches(':focus-visible'))).toBe(true);
      await expect.poll(() => target.evaluate(el => getComputedStyle(el).boxShadow)).toContain('22px');
      expect(await target.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
      expect(await target.evaluate(el => getComputedStyle(el).transform)).toBe('none');
      expect(await geometry(target)).toEqual(before);
      if (!testInfo.project.name.startsWith('mobile')) {
        await target.evaluate(el => el.blur()); await target.hover();
        await expect.poll(() => target.evaluate(el => getComputedStyle(el).boxShadow)).toContain('22px');
        expect(await geometry(target)).toEqual(before);
      }
    }
    await testInfo.attach(`${theme}-card-highlight`, { body: await page.locator('.features').screenshot(), contentType: 'image/png' });
    if (theme === 'dark') await page.getByRole('button', { name: 'تغییر به حالت روشن' }).click();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Tab'); await targets[0].focus();
  await expect.poll(() => targets[0].evaluate(el => getComputedStyle(el).boxShadow)).toContain('22px');
  expect(await targets[0].evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await targets[0].evaluate(el => getComputedStyle(el).transform)).toBe('none');
});

test('family photograph loads the crisp light artwork and keeps the existing evening dark artwork', async ({ page }, testInfo) => {
  await page.goto('/');
  const family = page.locator('.familyImage img');
  await family.scrollIntoViewIfNeeded();
  await expect.poll(() => family.evaluate(img => img.complete && img.currentSrc.endsWith('/assets/family-health-dark.webp'))).toBe(true);
  await testInfo.attach('family-dark', { body: await page.locator('.familyBox').screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'تغییر به حالت روشن' }).click();
  await expect.poll(() => family.evaluate(img => img.complete && img.currentSrc.endsWith('/assets/family-health-light-v2.webp'))).toBe(true);
  expect(await family.evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight }))).toEqual({ width: 1448, height: 1086 });
  await testInfo.attach('family-light-crisp', { body: await page.locator('.familyBox').screenshot(), contentType: 'image/png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});
