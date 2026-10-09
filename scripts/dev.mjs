import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import router from '../api/router.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

// Only expose artifacts in the Vercel static builds, never source or secrets.
function staticPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) return null;
  if (!(/^\/[^/]+\.html$/.test(decoded) || /^\/assets\/[\w/.-]+$/.test(decoded)
    || ['/manifest.webmanifest', '/service-worker.js'].includes(decoded))) return null;
  const path = resolve(root, '.' + decoded);
  return path.startsWith(root + '/') ? path : null;
}

function setHeaders(res, headers) {
  for (const [key, value] of Object.entries(headers || {})) res.setHeader(key, value);
}

function routeMatch(rule, pathname, method) {
  if (!rule.src || (rule.methods && !rule.methods.includes(method))) return null;
  return new RegExp('^(?:' + rule.src + ')$').exec(pathname);
}

export function createDevServer({ apiHandler = router } = {}) {
  // Read on creation, so CLI/test servers use the current deployment config.
  const configPromise = readFile(resolve(root, 'vercel.json'), 'utf8').then(JSON.parse);
  return http.createServer(async (req, res) => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
    res.send = body => res.end(body);
    res.redirect = (status, url) => {
      if (typeof status === 'string') { url = status; status = 302; }
      res.writeHead(status, { Location: url }); res.end();
    };
    try {
      const config = await configPromise;
      const original = new URL(req.url, 'http://localhost');
      let destination = original.pathname;
      for (const rule of config.routes || []) {
        if (rule.handle === 'filesystem') {
          const path = staticPath(destination);
          if (path) {
            try { if ((await stat(path)).isFile()) break; } catch {}
          }
          continue;
        }
        const match = routeMatch(rule, original.pathname, req.method);
        if (!match) continue;
        setHeaders(res, rule.headers);
        if (rule.status) res.statusCode = rule.status;
        if (rule.dest) {
          destination = rule.dest.replace(/\$(\d+)/g, (_, index) => encodeURIComponent(match[Number(index)] || ''));
        }
        // Header-only continue rules set policy and allow later rewrites.
        if (rule.continue) continue;
        if (rule.dest || rule.status) break;
      }
      for (const group of config.headers || []) {
        if (new RegExp('^(?:' + group.source + ')$').test(original.pathname)) {
          for (const header of group.headers) res.setHeader(header.key, header.value);
        }
      }
      const target = new URL(destination, 'http://localhost');
      // Rewrite parameters take precedence over caller-supplied route/slug.
      for (const [key, value] of target.searchParams) original.searchParams.set(key, value);
      req.query = Object.fromEntries(original.searchParams);
      if (['/api/router.js', '/api/router'].includes(target.pathname)) return await apiHandler(req, res);
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ error: 'Method not allowed' });
      }
      const path = staticPath(target.pathname);
      if (!path) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
      if (/\/(?:health|profile|admin|auth|doctor-portal|visit-intake|support|payment-result)[^/]*\.html$/.test(path)
        || target.pathname === '/service-worker.js') res.setHeader('Cache-Control', 'no-store, private');
      const content = await readFile(path);
      res.setHeader('Content-Length', content.length);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) {
        const status = error.code === 'ENOENT' ? 404 : error instanceof URIError || error instanceof TypeError ? 400 : 500;
        res.status(status).json({ error: 'درخواست انجام نشد' });
      } else if (!res.writableEnded) res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createDevServer();
  server.listen(port, host, () => console.log(`DrMan development server: http://${host}:${port}`));
  server.on('error', error => { console.error('Development server:', error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
