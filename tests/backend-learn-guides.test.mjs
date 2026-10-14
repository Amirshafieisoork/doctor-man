import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://learn-guide-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-db-key';
const { supabase } = await import('../server/api/_lib/db.js');
const { default: learn } = await import('../server/api/learn-page.js');
function database(t, data) {
  const saved = supabase.from; t.after(() => { supabase.from = saved; });
  supabase.from = table => { assert.equal(table, 'medical_articles'); const query = {}; for (const name of ['select', 'eq', 'order', 'limit']) query[name] = () => query; query.maybeSingle = async () => ({ data }); query.then = (resolve, reject) => Promise.resolve({ data }).then(resolve, reject); return query; };
}
async function page(query = {}) { const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, send(html) { this.html = html; return this; }, end(html) { this.html = html; return this; } }; await learn({ method: 'GET', query }, res); return res; }
const guide = { slug: 'mri-visit-checklist', title: 'راهنمای ام‌آر‌آی', summary: 'تصویربرداری و مدارک', content_type: 'guide', category: 'تصویربرداری', status: 'published', risk_level: 'low', review_level: 'editorial', doctor_profiles: null };
const article = { ...guide, slug: 'lab-article', title: 'خواندن CBC', category: 'آزمایش', content_type: 'article' };
test('learn clearly labels articles and guides with working content type filters', async t => {
  database(t, [guide, article]); const list = await page(); assert.match(list.html, /<h1>مقالات و راهنماهای سلامت<\/h1>/); assert.match(list.html, /name="kind"/); assert.match(list.html, /خواندن راهنما/); assert.match(list.html, /خواندن مقاله/);
  const guides = await page({ kind: 'guide' }); assert.match(guides.html, /href="\/learn\/mri-visit-checklist"/); assert.doesNotMatch(guides.html, /href="\/learn\/lab-article"/);
  const articles = await page({ kind: 'article' }); assert.doesNotMatch(articles.html, /href="\/learn\/mri-visit-checklist"/); assert.match(articles.html, /href="\/learn\/lab-article"/);
});
test('Persian spelling normalization combines search with category and guide filters', async t => {
  database(t, [guide, { ...guide, slug: 'record', title: 'پیگیری پرونده', category: 'پرونده سلامت' }, article]);
  const result = await page({ q: 'پيگيري', category: 'پرونده سلامت', kind: 'guide' });
  assert.match(result.html, /href="\/learn\/record"/); assert.doesNotMatch(result.html, /href="\/learn\/mri-visit-checklist"/); assert.match(result.html, /پاک‌کردن فیلترها/);
});
test('filtered empty results help recover and escape the original search safely', async t => {
  database(t, [guide]); const result = await page({ q: '\"><script>unsafe()</script>' });
  assert.match(result.html, /عبارت کوتاه‌تر یا دسته دیگری/); assert.match(result.html, /دیدن همه مقالات و راهنماها/); assert.doesNotMatch(result.html, /<script>unsafe/);
});
test('public guides disclose AI assistance and editorial review without inventing a physician', async t => {
  database(t, { ...guide, author_name: 'تحریریه دکتر من', ai_assisted: true, evidence_updated_at: '2026-10-13', next_review_at: '2027-04-13', body_html: '<h2>راهنما</h2><p>اصل سند را نگه دارید.</p><script>unsafe()</script>', source_links: [{ title: 'MedlinePlus', url: 'https://medlineplus.gov/lab-tests/complete-blood-count-cbc/' }] });
  const result = await page({ slug: guide.slug });
  assert.equal(result.statusCode, 200); assert.match(result.html, /بازبینی تحریریه/); assert.match(result.html, /از ابزار هوش مصنوعی استفاده شده/); assert.match(result.html, /2027-04-13/); assert.match(result.html, /href="https:\/\/medlineplus.gov/); assert.doesNotMatch(result.html, /unsafe\(\)|"@type":"Physician"|reviewedBy/);
});
test('source links require clean HTTPS URLs and never link credential-bearing or script URLs', async t => {
  database(t, { ...guide, source_links: [{ title: 'unsafe script', url: 'javascript:alert(1)' }, { title: 'unsafe credentials', url: 'https://name:secret@example.invalid/' }, { title: 'trusted source', url: 'https://www.radiologyinfo.org/en/info/bodymr' }] });
  const result = await page({ slug: guide.slug }); assert.doesNotMatch(result.html, /href="javascript:|href="https:\/\/name:secret/); assert.match(result.html, /rel="nofollow noopener noreferrer"/); assert.match(result.html, /href="https:\/\/www.radiologyinfo.org\/en\/info\/bodymr"/);
});
test('new guide UI keeps unreviewed medical drafts and sensitive editorial content private', async t => {
  database(t, [guide, { ...article, slug: 'hidden-draft', title: 'hidden draft', status: 'draft' }, { ...article, slug: 'hidden-sensitive', title: 'hidden sensitive', risk_level: 'moderate' }]);
  const result = await page(); assert.doesNotMatch(result.html, /hidden draft|hidden sensitive/); assert.match(result.html, /href="\/learn\/mri-visit-checklist"/);
});
