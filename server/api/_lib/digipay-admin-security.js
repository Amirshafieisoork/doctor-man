import { allowRate } from './rate-limit.js';

export function validDigiPayMutationOrigin(req) {
  if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
  try {
    const origin = new URL(req.headers?.origin || '');
    const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    return (origin.protocol === 'https:' || (local && origin.protocol === 'http:')) && origin.host.toLowerCase() === String(req.headers?.host || '').toLowerCase();
  } catch { return false; }
}
export async function allowDigiPayAdminAction(req, res, action, limit, rateLimit = allowRate) {
  if (!validDigiPayMutationOrigin(req)) { res.status(403).json({ success: false, error: 'مبدأ درخواست معتبر نیست؛ صفحه مدیریت را دوباره باز کنید.' }); return false; }
  const rate = await rateLimit(req, { action, limit, windowMinutes: 15 });
  if (rate.allowed) return true;
  if (rate.unavailable) { res.status(503).json({ success: false, error: 'بررسی امنیتی موقتاً در دسترس نیست؛ دوباره تلاش کنید.' }); return false; }
  const seconds = Math.max(1, Number(rate.retry_after_seconds) || 900);
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({ success: false, error: 'تعداد درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.', retry_after_seconds: seconds });
  return false;
}
