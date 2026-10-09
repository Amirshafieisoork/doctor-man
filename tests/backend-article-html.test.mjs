import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanArticleHtml } from '../server/api/_lib/article-html.js';

test('medical article formatting and readable table content survive sanitization', () => {
  const body = '<h2>راهنمای آزمایش</h2><p>متن <strong>مهم</strong> و <em>توضیح</em></p><ul><li>اول</li></ul><table><caption>مقادیر</caption><thead><tr><th scope="col">نام</th></tr></thead><tbody><tr><td><code>Hb</code></td></tr></tbody></table>';
  assert.equal(cleanArticleHtml(body), body);
});

test('article bodies discard executable content and attributes even inside malformed markup', () => {
  const clean = cleanArticleHtml('<script>dangerous()</script><style>body{display:none}</style><iframe src="https://unsafe.example"></iframe><svg onload="dangerous()"><script>dangerous()</script></svg><p onclick="dangerous()" style="color:red" id="injected">متن<img src=x onerror="dangerous()"></p><object data="https://unsafe.example"></object>');
  assert.equal(clean, '<p>متن</p>');
  assert.equal(cleanArticleHtml('<p><strong>متن</p><script>dangerous()'), '<p><strong>متن</strong></p>');
});

test('only absolute HTTPS article links remain clickable and receive safe relationship attributes', () => {
  const clean = cleanArticleHtml('<a href="https://example.com/path?a=1&amp;b=2" target="_blank" onclick="dangerous()">منبع</a>');
  assert.equal(clean, '<a href="https://example.com/path?a=1&amp;b=2" rel="noopener noreferrer nofollow">منبع</a>');
  for (const href of ['javascript:alert(1)', 'data:text/html,unsafe', 'http://example.com', '//example.com', '/auth', 'mailto:someone@example.com']) {
    assert.equal(cleanArticleHtml(`<a href="${href}">منبع</a>`), '<a>منبع</a>', href);
  }
});
