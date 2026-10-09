import { build } from 'esbuild';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'server/api/_lib/vendor/article-sanitizer.mjs');
const notices = resolve(root, 'server/api/_lib/vendor/article-sanitizer.NOTICES.txt');
const check = process.argv.includes('--check');
const version = JSON.parse(await readFile(resolve(root, 'node_modules/sanitize-html/package.json'), 'utf8')).version;

// The current sanitizer's CommonJS entry requires ESM-only dependencies.
// Bundle them together so Node 22 deployments also work when the host disables
// experimental require(ESM). Keep native built-ins available through require.
const result = await build({
  absWorkingDir: root,
  stdin: { contents: "import sanitizeHtml from 'sanitize-html'; export default sanitizeHtml;", resolveDir: root, sourcefile: 'article-sanitizer-entry.mjs' },
  outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22',
  minify: true, legalComments: 'inline', metafile: true, write: false,
  banner: { js: `// Generated from sanitize-html ${version}; run npm run build:article-sanitizer.\n// Third-party license notices: article-sanitizer.NOTICES.txt.\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);` }
});

const mit = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;
const packages = [...new Set(Object.keys(result.metafile.inputs)
  .map(path => path.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/)?.[1]).filter(Boolean))].sort();
const licenses = [];
for (const name of packages) {
  const directory = resolve(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory)).filter(file => /^(?:license|licence|copying)(?:[._-].*)?$/i.test(file)).sort();
  let text = (await Promise.all(files.map(file => readFile(resolve(directory, file), 'utf8')))).join('\n\n').trim();
  if (!text) {
    if (pkg.license !== 'MIT') throw new Error(`License text is required for ${name}`);
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || `${name} contributors`;
    text = `MIT License\n\nCopyright (c) ${author}\n\n${mit}`;
  }
  licenses.push(`${name}@${pkg.version}\nLicense: ${pkg.license}\n\n${text}`);
}
const artifacts = [[output, result.outputFiles[0].text], [notices, `Third-party software bundled in article-sanitizer.mjs\n\n${licenses.join('\n\n--------------------\n\n')}\n`]];
await mkdir(dirname(output), { recursive: true });
for (const [path, content] of artifacts) {
  if (check) {
    const existing = await readFile(path, 'utf8').catch(() => '');
    if (existing !== content) throw new Error('Article sanitizer bundle is stale; run npm run build:article-sanitizer');
  } else await writeFile(path, content);
}
console.log(`Article sanitizer bundle ${check ? 'verified' : 'generated'} (${packages.length} licensed packages).`);
