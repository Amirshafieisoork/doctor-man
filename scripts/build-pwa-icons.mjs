// Mechanical exports of the approved D/cross artwork. Keep install icons opaque:
// some operating systems flatten transparent PWA icons onto a white background.
// https://web.dev/learn/pwa/web-app-manifest#icons
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../assets/drman-icon-v7-maskable-512.png', import.meta.url));
const sizes = [32, 44, 48, 64, 88, 128, 150, 180, 192, 256, 512];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const exports = new Map();
try {
  const page = await browser.newPage();
  for (const size of sizes) {
    const base64 = await page.evaluate(async ({ source, size }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#071726';
      context.fillRect(0, 0, size, size);
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source: source.toString('base64'), size });
    exports.set(size, Buffer.from(base64, 'base64'));
    const file = size === 180 ? 'apple-touch-icon-v8.png' : `drman-icon-v8-${size}.png`;
    await writeFile(root + 'assets/' + file, exports.get(size));
  }
} finally {
  await browser.close();
}

// The maskable artwork already fits the central safe circle. Keep a distinct
// URL and purpose, even though its pixels match the 512px ordinary export.
await writeFile(root + 'assets/drman-icon-v8-maskable-512.png', exports.get(512));

// Modern Windows ICO supports PNG-compressed images. Include actual sizes,
// rather than a single tiny favicon enlarged for desktop shortcuts.
const icoSizes = [32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + icoSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((size, index) => {
  const at = 6 + index * 16;
  const png = exports.get(size);
  header[at] = header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile(root + 'assets/drman-favicon-v8.ico', Buffer.concat([header, ...icoSizes.map(size => exports.get(size))]));
console.log('Exported opaque v8 PWA icons and multi-resolution Windows favicon.');
