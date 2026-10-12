import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createDevServer } from '../scripts/dev.mjs';

let server, apiServer, base, apiBase;
before(async () => {
  server = createDevServer({ apiHandler: (req, res) => res.json({ method: req.method, query: req.query }) });
  apiServer = createDevServer();
  server.listen(0, '127.0.0.1'); apiServer.listen(0, '127.0.0.1');
  await Promise.all([once(server, 'listening'), once(apiServer, 'listening')]);
  base = `http://127.0.0.1:${server.address().port}`;
  apiBase = `http://127.0.0.1:${apiServer.address().port}`;
});
after(async () => {
  for (const item of [server, apiServer]) {
    item.closeAllConnections();
    await new Promise(resolve => item.close(resolve));
  }
});

const pages = {
  '/': 'home-v2.html', '/index.html': 'home-v2.html',
  '/auth': 'auth-v2.html', '/auth.html': 'auth-v2.html',
  '/health': 'health-v4.html', '/profile': 'health-v4.html', '/profile.html': 'health-v4.html',
  '/account': 'profile-v2.html', '/settings': 'profile-v2.html',
  '/settings.html': 'profile-v2.html', '/doctors': 'doctors.html',
  '/pricing': 'pricing-v2.html', '/pricing.html': 'pricing-v2.html',
  '/doctor-onboarding': 'doctor-onboarding.html', '/doctor-portal': 'doctor-portal-v2.html',
  '/visit-intake': 'visit-intake.html', '/support': 'support.html',
  '/admin': 'admin-v7.html', '/admin.html': 'admin-v7.html',
  '/payment-result': 'payment-result.html', '/privacy': 'privacy.html',
  '/terms': 'terms.html', '/medical-methodology': 'medical-methodology.html'
};

test('all public and private page URLs serve the intended HTML after header rules', async () => {
  for (const [route, file] of Object.entries(pages)) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/, route);
    assert.equal(await response.text(), await readFile(new URL('../' + file, import.meta.url), 'utf8'), route);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', route);
    assert.ok(response.headers.get('content-security-policy'), route);
  }
});

test('private pages carry noindex and no-store through aliases', async () => {
  for (const route of ['/auth', '/auth.html', '/health', '/profile.html', '/account', '/settings', '/settings.html', '/doctor-portal', '/admin', '/support', '/payment-result']) {
    const response = await fetch(base + route);
    assert.match(response.headers.get('x-robots-tag'), /noindex/, route);
    assert.match(response.headers.get('cache-control'), /no-store/, route);
  }
});

test('page resources have matching content types, and HEAD has no response body', async () => {
  for (const [path, type] of [['/assets/drman-logo.svg', 'image/svg+xml'], ['/assets/product.css', 'text/css'], ['/assets/theme.js', 'text/javascript'], ['/assets/fonts/vazirmatn-arabic.woff2', 'font/woff2'], ['/manifest.webmanifest', 'application/manifest+json']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(type), path);
  }
  const response = await fetch(base + '/health', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get('content-length')) > 0);
  assert.equal(await response.text(), '');
});

test('unknown URLs show the real 404 page and cannot expose source or credentials', async () => {
  for (const path of ['/a-page-that-does-not-exist', '/missing.html', '/assets/missing.css', '/package.json', '/.env', '/server/api/account.js', '/assets/%2e%2e%2fpackage.json']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
    const content = await response.text();
    assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY|"dependencies"\s*:|requireUser\(/, path);
  }
  const response = await fetch(base + '/a-page-that-does-not-exist');
  assert.equal(await response.text(), await readFile(new URL('../404.html', import.meta.url), 'utf8'));
});

test('API and generated-page destinations preserve route authority and original filters', async () => {
  for (const [path, expected] of [
    ['/api/doctors?q=%D9%82%D9%84%D8%A8&route=login', { q: 'قلب', route: 'doctors' }],
    ['/doctor/cardiologist?route=login&slug=other', { route: 'doctor-page', slug: 'cardiologist' }],
    ['/emergency/card-token?token=other&route=account', { token: 'card-token', route: 'emergency-page' }],
    ['/learn/heart-health?slug=other', { slug: 'heart-health', route: 'learn-page' }],
    ['/learn', { route: 'learn-page' }],
    ['/robots.txt?route=account', { route: 'robots' }],
    ['/sitemap.xml', { route: 'sitemap' }],
    ['/api/router.js?route=session', { route: 'session' }],
    ['/api/router?route=session', { route: 'session' }]
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.deepEqual((await response.json()).query, expected, path);
  }
});

test('every Vercel API rewrite names a built serverless function artifact', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const artifacts = new Set(config.builds.filter(build => build.use === '@vercel/node').map(build => '/' + build.src));
  for (const route of config.routes) if (route.dest?.startsWith('/api/')) {
    assert.ok(artifacts.has(route.dest.split('?')[0]), route.src + ' targets absent function ' + route.dest);
  }
});

test('static writes are rejected, while API receives the original HTTP method', async () => {
  const response = await fetch(base + '/', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  const api = await fetch(base + '/api/login', { method: 'POST', body: '{}' });
  assert.equal((await api.json()).method, 'POST');
});

test('real API rejects unknown names, invalid JSON and cross-origin writes before external work', async () => {
  for (const route of ['/api/unknown-name', '/api/account/nested']) {
    const response = await fetch(apiBase + route);
    assert.equal(response.status, 404, route);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const crossOrigin = await fetch(apiBase + '/api/login', {
    method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(crossOrigin.status, 403);
  const environment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    const local = await fetch(apiBase + '/api/login', {
      method: 'POST', headers: { Origin: apiBase, 'Content-Type': 'application/json' }, body: '{'
    });
    assert.equal(local.status, 400, 'same-origin loopback HTTP reaches body validation in development');
    assert.match((await local.json()).error, /JSON/);
    process.env.NODE_ENV = 'production';
    const production = await fetch(apiBase + '/api/login', {
      method: 'POST', headers: { Origin: apiBase, 'Content-Type': 'application/json' }, body: '{'
    });
    assert.equal(production.status, 403, 'production must reject HTTP loopback origins');
  } finally {
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  }
});
