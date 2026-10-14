import crypto from 'node:crypto';

export const RESET_REQUEST_MESSAGE='اگر این شماره حساب فعال داشته باشد، درخواست بازیابی برای پشتیبانی ثبت می‌شود. پشتیبانی پس از تأیید هویت، پیوند بازنشانی رمز را در اختیار شما می‌گذارد.';
export const RESET_TOKEN_SECONDS=30*60;
export function createResetToken(){return crypto.randomBytes(32).toString('base64url');}
export function hashResetToken(token){return crypto.createHash('sha256').update(token).digest('hex');}
export function isResetToken(token){return typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token);}
export function hashNewPassword(password){const salt=crypto.randomBytes(16).toString('hex');return `scrypt$${salt}$${crypto.scryptSync(password,salt,64).toString('hex')}`;}
export function recoveryOrigin(req){
  const configured=process.env.PUBLIC_BASE_URL||process.env.PUBLIC_SITE_URL||(process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:'');
  if(configured){const url=new URL(configured);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid public recovery origin');return url.origin;}
  // Local development is the only case where a caller-supplied host is trusted.
  const host=String(req.headers?.host||'');
  if(process.env.NODE_ENV!=='production'&&/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host))return `http://${host}`;
  return 'https://drman.vercel.app';
}
export function recoveryUnavailable(res){return res.status(503).json({success:false,error:'بازیابی رمز موقتاً در دسترس نیست. دوباره تلاش کنید.'});}
export function recoveryRateDenied(res,gate){res.setHeader('Retry-After',String(gate.retry_after_seconds||900));return res.status(429).json({success:false,error:'درخواست‌های بازیابی زیاد بوده است. چند دقیقه بعد دوباره تلاش کنید.'});}
