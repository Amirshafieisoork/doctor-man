import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('assets/vendor/emergency-qr.js');
const license = [(await readFile('node_modules/qrcode/license', 'utf8')).trim(), (await readFile('node_modules/dijkstrajs/LICENSE.md', 'utf8')).trim()].join('\n\n');
const compiled = await build({ stdin: { contents: "import QRCode from 'qrcode/lib/core/qrcode.js'; window.DrManEmergencyQR = Object.freeze({ create: QRCode.create });", resolveDir: process.cwd(), sourcefile: 'emergency-qr-entry.js' }, bundle: true, minify: true, platform: 'browser', write: false, format: 'iife', target: ['es2020'], banner: { js: `/*! qrcode 1.5.4, MIT. Generated locally by scripts/build-emergency-qr.mjs.\n${license.replace(/\*\//g, '* /')}\n*/` } });
const code = compiled.outputFiles[0].text;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8').catch(() => '') !== code) throw new Error('Emergency QR bundle is stale; run npm run build:emergency-qr.');
  console.log('Emergency QR bundle and pinned license are current.');
} else { await mkdir(resolve('assets/vendor'), { recursive: true }); await writeFile(output, code); }
