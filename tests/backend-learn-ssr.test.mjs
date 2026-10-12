import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = 'https://learn-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-database-key';
const { supabase } = await import('../server/api/_lib/db.js');
const { default: router } = await import('../api/router.js');

function database(result) {
  const calls = [];
  supabase.from = table => {
    const operations = [];
    const query = {};
    for (const name of ['select', 'eq', 'order', 'limit']) {
      query[name] = (...args) => { operations.push([name, ...args]); return query; };
    }
    const finish = async () => { calls.push({ table, operations }); return result; };
    query.then = (resolve, reject) => finish().then(resolve, reject);
    query.maybeSingle = finish;
    return query;
  };
  return calls;
}
function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; this.headersSent = true; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
    end(body) { this.body = body; this.headersSent = true; return this; } };
}
async function request(query = {}) {
  const res = response();
  await router({ method: 'GET', headers: {}, query: { route: 'learn-page', ...query } }, res);
  return res;
}
const article = { slug: 'lab-guide', title: 'راهنمای آزمایش', summary: 'توضیح عمومی', category: 'آزمایش و نتایج',
  status: 'published', review_level: 'editorial', risk_level: 'low', doctor_profiles: null,
  body_html: '<p>متن <strong>معتبر</strong></p><script>unsafe()</script>' };

test('the Vercel router loads the knowledge SSR module and renders only publishable entries', async () => {
  const calls = database({ data: [article, { ...article, slug: 'unreviewed', risk_level: 'high', title: 'Hidden sensitive article' },
    { ...article, slug: 'doctor-reviewed', title: 'پزشکی بازبینی‌شده', risk_level: 'high', review_level: 'medical',
      doctor_profiles: { full_name: 'Test reviewer', verification_status: 'verified' } }], error: null });
  const res = await request();
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.headers['Cache-Control'], /s-maxage=900/);
  assert.match(res.body, /href="\/learn\/lab-guide"/);
  assert.match(res.body, /href="\/learn\/doctor-reviewed"/);
  assert.doesNotMatch(res.body, /Hidden sensitive article/);
  assert.equal(calls[0].table, 'medical_articles');
  assert.ok(calls[0].operations.some(([operation, field, value]) => operation === 'eq' && field === 'status' && value === 'published'));
});

test('knowledge article SSR sanitizes the body and escapes injected metadata', async () => {
  database({ data: { ...article, title: '<unsafe-title>', source_links: [{ title: '<unsafe-source>', url: 'https://example.com/path' }] }, error: null });
  const res = await request({ slug: article.slug });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<p>متن <strong>معتبر<\/strong><\/p>/);
  assert.doesNotMatch(res.body, /unsafe\(\)|<unsafe-title>|<unsafe-source>/);
  assert.match(res.body, /&lt;unsafe-title&gt;/);
  assert.match(res.body, /&lt;unsafe-source&gt;/);
  assert.match(res.body, /"@type":"MedicalWebPage"/);
});

test('knowledge query failures return uncached educational error pages instead of fake empty content', async () => {
  for (const query of [{}, { slug: article.slug }]) {
    database({ data: null, error: { message: 'test query failure' } });
    const res = await request(query);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.match(res.body, /noindex,nofollow/);
    assert.doesNotMatch(res.body, /test query failure|خطای داخلی سرویس/);
  }
});

test('a missing or unreviewed sensitive article is a real noindex 404', async () => {
  for (const data of [null, { ...article, risk_level: 'high' }]) {
    database({ data, error: null });
    const res = await request({ slug: article.slug });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /noindex,nofollow/);
  }
});

test('deployed knowledge SSR and sanitization work with experimental require(ESM) disabled', {
  skip: process.env.DRMAN_LEARN_RUNTIME_CHILD === '1'
}, () => {
  const child = spawnSync(process.execPath, ['--no-experimental-require-module', '--test',
    fileURLToPath(import.meta.url), fileURLToPath(new URL('./backend-article-html.test.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, DRMAN_LEARN_RUNTIME_CHILD: '1' }, timeout: 15000
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr + child.stdout);
});
