import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
let scripts = 0, references = 0, pages = 0;
const errors = [];

function syntax(code, label, module = true, path) {
  const result = spawnSync(process.execPath, path ? ['--check', path]
    : ['--check', '--input-type=' + (module ? 'module' : 'commonjs')], { input: code, encoding: 'utf8' });
  if (result.status !== 0) errors.push(label + ': ' + result.stderr.trim());
  scripts++;
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(js|mjs)$/.test(path)) syntax(undefined, path.slice(root.length + 1), true, path);
    else if (extname(path) === '.css') {
      const css = await readFile(path, 'utf8');
      for (const [, value] of css.matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/g)) await localReference(value, path, false);
    }
  }
}

async function localReference(value, source, isNavigation) {
  value = value.replace(/&amp;/g, '&');
  if (!value || /^(?:#|https?:|data:|blob:|mailto:|tel:|javascript:|\/\/)/i.test(value)
    || /\$\{|<|>|\s/.test(value)) return;
  const url = new URL(value, 'http://local/' + source.slice(root.length + 1));
  if (url.origin !== 'http://local') return;
  const path = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (path !== root && !path.startsWith(root + '/')) { errors.push(source + ': reference escapes site: ' + value); return; }
  let file = false;
  try { file = (await stat(path)).isFile(); } catch {}
  const route = isNavigation && (config.routes || []).some(rule => rule.dest && rule.status !== 404
    && new RegExp('^(?:' + rule.src + ')$').test(url.pathname));
  if (!file && !route) errors.push(source.slice(root.length + 1) + ': missing ' + value);
  references++;
}

for (const dir of ['api', 'server', 'assets', 'scripts', 'tests']) await walk(resolve(root, dir));
for (const name of await readdir(root)) {
  if (!name.endsWith('.html')) continue;
  const path = resolve(root, name), html = await readFile(path, 'utf8');
  for (const [, attrs, code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/ld\+json/i.test(attrs)) continue;
    syntax(code, name, /type\s*=\s*["']module["']/i.test(attrs));
  }
  // Read element attributes, not strings embedded inside inline scripts.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const [, tag, attrs] of markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    for (const [, attr, value] of attrs.matchAll(/(?:^|\s)(href|src)\s*=\s*["']([^"']*)["']/gi)) {
      await localReference(value, path, tag.toLowerCase() === 'a' && attr.toLowerCase() === 'href');
    }
  }
  pages++;
}
for (const path of ['package.json', 'package-lock.json', 'manifest.webmanifest']) {
  try { JSON.parse(await readFile(resolve(root, path), 'utf8')); } catch (error) { errors.push(path + ': ' + error.message); }
}
// Legacy Vercel builds preserve the .js suffix in the function artifact name.
const functions = new Set((config.builds || []).filter(build => build.use === '@vercel/node').map(build => '/' + build.src));
for (const rule of config.routes || []) {
  if (!rule.dest) continue;
  const destination = rule.dest.split('?')[0];
  if (destination.startsWith('/api/') && !functions.has(destination)) errors.push('vercel.json: function artifact does not exist: ' + destination);
  else if (destination.endsWith('.html')) {
    try { await stat(resolve(root, '.' + destination)); } catch { errors.push('vercel.json: page destination does not exist: ' + destination); }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Validated ${scripts} JavaScript files/scripts, ${pages} pages, ${references} local references, JSON and Vercel destinations.`);
