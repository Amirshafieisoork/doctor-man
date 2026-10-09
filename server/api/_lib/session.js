import crypto from 'node:crypto';

const COOKIE_NAME = 'drman_session';
const ADMIN_COOKIE_NAME = 'drman_admin';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function getSecret() {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  const serverOnlyKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverOnlyKey) throw new Error('Session signing secret is missing');
  return crypto.createHash('sha256').update(`drman-session:${serverOnlyKey}`).digest('hex');
}
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function sign(unsigned) { return crypto.createHmac('sha256', getSecret()).update(unsigned).digest('base64url'); }
function safeEqual(a, b) { const aa=Buffer.from(a||''),bb=Buffer.from(b||''); return aa.length===bb.length && crypto.timingSafeEqual(aa,bb); }
export function createToken(payload,maxAge=SESSION_MAX_AGE){const body={...payload,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+maxAge};const encoded=b64url(JSON.stringify(body));return `${encoded}.${sign(encoded)}`;}
export function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  const [encoded, signature] = parts;
  try {
    if (!safeEqual(signature, sign(encoded))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) ||
        payload.exp <= now || payload.iat > now + 60 || payload.exp <= payload.iat) return null;
    return payload;
  } catch { return null; }
}
export function parseCookies(req) {
  const cookies = Object.create(null);
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try {
      const name = decodeURIComponent(part.slice(0, index).trim());
      if (!Object.hasOwn(cookies, name)) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch { /* A malformed cookie must not break authentication. */ }
  }
  return cookies;
}
function cookieHeader(name,value,maxAge){const secure=process.env.NODE_ENV==='production'?'; Secure':'';return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;}
function appendCookie(res,cookie){const current=res.getHeader('Set-Cookie');if(!current)return res.setHeader('Set-Cookie',cookie);const values=Array.isArray(current)?current:[String(current)];res.setHeader('Set-Cookie',[...values,cookie]);}
export function setUserSession(res,user){appendCookie(res,cookieHeader(COOKIE_NAME,createToken({sub:String(user.id),role:'user'}),SESSION_MAX_AGE));}
export function setAdminSession(res){appendCookie(res,cookieHeader(ADMIN_COOKIE_NAME,createToken({sub:'admin',role:'admin'},60*60*8),60*60*8));}
export function clearUserSession(res){appendCookie(res,cookieHeader(COOKIE_NAME,'',0));}
export function clearAdminSession(res){appendCookie(res,cookieHeader(ADMIN_COOKIE_NAME,'',0));}
export function getUserSession(req){const payload=verifyToken(parseCookies(req)[COOKIE_NAME]);return payload?.role==='user'&&payload?.sub?payload:null;}
export function getAdminSession(req){const payload=verifyToken(parseCookies(req)[ADMIN_COOKIE_NAME]);return payload?.role==='admin'?payload:null;}
export function requireUser(req,res){const session=getUserSession(req);if(!session){res.status(401).json({success:false,error:'ابتدا وارد حساب کاربری شوید'});return null}return session;}
export function requireAdmin(req,res){const session=getAdminSession(req);if(!session){res.status(401).json({success:false,error:'دسترسی مدیر معتبر نیست'});return null}return session;}
