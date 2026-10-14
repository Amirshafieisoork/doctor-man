import { test, expect } from '@playwright/test';

test('all six home options align with the hero and wrap within the same centered RTL bounds', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.startsWith('mobile');
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'ابتدا وارد حساب شوید' }) });
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.features .feature')).toHaveCount(6);
  const layout = await page.evaluate(() => {
    const bounds = element => {
      const { left, right, top, bottom, width } = element.getBoundingClientRect();
      return { left, right, top, bottom, width };
    };
    return {
      hero: bounds(document.querySelector('.heroBox')),
      options: bounds(document.querySelector('.features')),
      cards: [...document.querySelectorAll('.features .feature')].map(bounds),
      direction: getComputedStyle(document.querySelector('.features')).direction,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      viewport: innerWidth
    };
  });
  expect(layout.direction).toBe('rtl');
  expect(layout.overflow).toBe(false);
  expect(Math.abs(layout.options.left - layout.hero.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.options.right - layout.hero.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.options.left - (layout.viewport - layout.options.right))).toBeLessThanOrEqual(1);
  const rows = [];
  for (const card of layout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(layout.hero.left - 1);
    expect(card.right).toBeLessThanOrEqual(layout.hero.right + 1);
    expect(card.width).toBeGreaterThan(0);
    const row = rows.find(row => Math.abs(row[0].top - card.top) <= 1);
    if (row) row.push(card); else rows.push([card]);
  }
  expect(rows.map(row => row.length)).toEqual(mobile ? [2, 2, 2] : [6]);
  for (const row of rows) {
    expect(Math.abs(row[0].right - layout.options.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(row.at(-1).left - layout.options.left)).toBeLessThanOrEqual(1);
    for (let index = 1; index < row.length; index++) expect(row[index].right).toBeLessThan(row[index - 1].left);
  }
  await testInfo.attach('home-options-' + (mobile ? '390' : '1920'), { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('home artwork follows the selected theme and keeps the dark hero background dark', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.startsWith('mobile');
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 });
  await page.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'ابتدا وارد حساب شوید' }) }));
  await page.goto('/');
  const hero = page.locator('.heroArtwork');
  const family = page.locator('.familyImage img');
  async function expectArtwork(theme) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => hero.evaluate((img, selected) => img.complete && img.naturalWidth > 0 && img.currentSrc.endsWith(`hero-copyspace-signature-${selected}.webp`), theme)).toBe(true);
    await family.scrollIntoViewIfNeeded();
    await expect.poll(() => family.evaluate((img, selected) => img.complete && img.naturalWidth > 0 && img.currentSrc.endsWith(`family-health-${selected}${selected === 'light' ? '-v2' : ''}.webp`), theme)).toBe(true);
  }
  await expectArtwork('dark');
  const backgroundBrightness = await hero.evaluate(img => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    return [[0.02, 0.02], [0.96, 0.06], [0.97, 0.95]].map(([x, y]) => {
      const pixel = context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data;
      return (pixel[0] + pixel[1] + pixel[2]) / 3;
    });
  });
  // The old image has a pale baked-in studio background even on a dark card.
  for (const brightness of backgroundBrightness) expect(brightness).toBeLessThan(95);
  if (mobile) {
    const imageBounds = await hero.boundingBox();
    expect(imageBounds.height).toBeGreaterThanOrEqual(imageBounds.width - 1);
    const copyBounds = await page.locator('.heroCopy').boundingBox();
    expect(copyBounds.y + copyBounds.height).toBeLessThanOrEqual(imageBounds.y + 1);
  }
  await page.getByRole('button', { name: 'تغییر به حالت روشن' }).click();
  await expectArtwork('light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4fbff');
  await page.reload(); await expectArtwork('light');
  await page.getByRole('button', { name: 'تغییر به حالت تیره' }).click();
  await expectArtwork('dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#07111e');
});
