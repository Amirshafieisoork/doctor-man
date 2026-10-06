import crypto from 'node:crypto';

const COOKIE_NAME = 'drman_session';
const ADMIN_COOKIE_NAME = 'drman_admin';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function getSecret() {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) return explicit;

  const serverOnlyKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverOnlyKey) throw new Error('Session signing secret is missing');
  return crypto.createHash('sha256').update(`drman-session:${serverOnlyKey}`).digest('hex');
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(unsigned) {
  return crypto.createHmac('sha256', getSecret()).update(unsigned).digest('base64url');
}

function safeEqual(a, b) {
  const aa = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function createToken(payload, maxAge = SESSION_MAX_AGE) {
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + maxAge
  };
  const encoded = b64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map(v => v.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx > -1) acc[decodeURIComponent(part.slice(0, idx))] = decodeURIComponent(part.slice(idx + 1));
      return acc;
    }, {});
}

function cookieHeader(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function setUserSession(res, user) {
  const token = createToken({ sub: String(user.id), role: 'user' });
  res.setHeader('Set-Cookie', cookieHeader(COOKIE_NAME, token, SESSION_MAX_AGE));
}

export function setAdminSession(res) {
  const token = createToken({ sub: 'admin', role: 'admin' }, 60 * 60 * 8);
  res.setHeader('Set-Cookie', cookieHeader(ADMIN_COOKIE_NAME, token, 60 * 60 * 8));
}

export function clearUserSession(res) {
  res.setHeader('Set-Cookie', cookieHeader(COOKIE_NAME, '', 0));
}

export function clearAdminSession(res) {
  res.setHeader('Set-Cookie', cookieHeader(ADMIN_COOKIE_NAME, '', 0));
}

export function getUserSession(req) {
  const payload = verifyToken(parseCookies(req)[COOKIE_NAME]);
  return payload?.role === 'user' && payload?.sub ? payload : null;
}

export function getAdminSession(req) {
  const payload = verifyToken(parseCookies(req)[ADMIN_COOKIE_NAME]);
  return payload?.role === 'admin' ? payload : null;
}

export function requireUser(req, res) {
  const session = getUserSession(req);
  if (!session) {
    res.status(401).json({ success: false, error: 'ابتدا وارد حساب کاربری شوید' });
    return null;
  }
  return session;
}

export function requireAdmin(req, res) {
  const session = getAdminSession(req);
  if (!session) {
    res.status(401).json({ success: false, error: 'دسترسی مدیر معتبر نیست' });
    return null;
  }
  return session;
}
