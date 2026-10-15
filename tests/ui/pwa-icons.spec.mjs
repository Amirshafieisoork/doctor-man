import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"success":false}' });
    return route.continue();
  });
});

async function inspectIcon(page, src) {
  return page.evaluate(async src => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0, opaqueWhite = 0, nonOpaque = 0, maxArtworkRadius = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const [red, green, blue, alpha] = data.slice(offset, offset + 4);
      if (alpha === 0) transparent++;
      if (alpha !== 255) nonOpaque++;
      if (Math.min(red, green, blue) > 240 && alpha > 240) opaqueWhite++;
      // The navy background remains below 100 in all channels. The brighter
      // cyan/blue brand must fit the standard central maskable safe circle.
      if (Math.max(red, green, blue) > 100 && alpha > 240) {
        const index = offset / 4;
        const x = index % canvas.width - (canvas.width - 1) / 2;
        const y = Math.floor(index / canvas.width) - (canvas.height - 1) / 2;
        maxArtworkRadius = Math.max(maxArtworkRadius, Math.hypot(x, y) / canvas.width);
      }
    }
    return { width: canvas.width, height: canvas.height, transparent, nonOpaque, opaqueWhite, maxArtworkRadius, corner: [...data.slice(0, 4)] };
  }, src);
}

test('install manifest provides transparent ordinary icons and a separate opaque maskable icon', async ({ page, request }) => {
  await page.goto('/');
  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await request.get(manifestPath);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest.id).toBe('/');
  expect(manifest.display).toBe('standalone');
  const ordinary = manifest.icons.filter(icon => icon.purpose === 'any');
  const maskable = manifest.icons.find(icon => icon.purpose === 'maskable');
  expect(ordinary.map(icon => icon.sizes).sort()).toEqual(['192x192', '512x512']);
  expect(maskable.sizes).toBe('512x512');
  expect(ordinary.map(icon => icon.src)).not.toContain(maskable.src);
  for (const icon of ordinary) {
    const measured = await inspectIcon(page, icon.src);
    expect(`${measured.width}x${measured.height}`).toBe(icon.sizes);
    expect(measured.transparent).toBeGreaterThan(measured.width * measured.height * 0.3);
    expect(measured.corner[3]).toBe(0);
    expect(measured.opaqueWhite).toBe(0);
  }
  const measured = await inspectIcon(page, maskable.src);
  expect(measured.width).toBe(512);
  expect(measured.height).toBe(512);
  expect(measured.nonOpaque).toBe(0);
  expect(measured.opaqueWhite).toBe(0);
  expect(measured.corner).toEqual([7, 23, 38, 255]);
  expect(measured.maxArtworkRadius).toBeLessThanOrEqual(0.4);
});

test('Apple and browser shortcut artwork contains no baked-in white tile', async ({ page }) => {
  await page.goto('/');
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(favicon).toBe('/assets/drman-icon-v7-32.png');
  expect(apple).toBe('/assets/apple-touch-icon-v7.png');
  const faviconPixels = await inspectIcon(page, favicon);
  expect([faviconPixels.width, faviconPixels.height]).toEqual([32, 32]);
  expect(faviconPixels.corner[3]).toBe(0);
  expect(faviconPixels.opaqueWhite).toBe(0);
  const applePixels = await inspectIcon(page, apple);
  expect([applePixels.width, applePixels.height]).toEqual([180, 180]);
  expect(applePixels.nonOpaque).toBe(0);
  expect(applePixels.opaqueWhite).toBe(0);
  expect(applePixels.corner).toEqual([7, 23, 38, 255]);
});
