import crypto from 'node:crypto';
import { setUserSession } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { allowRate, recordRate } from './_lib/rate-limit.js';

function verifyPassword(password, stored) {
  const value = String(stored || '');
  if (value.startsWith('scrypt$')) {
    const [, salt, expectedHex] = value.split('$');
    if (!salt || !expectedHex) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  // Legacy compatibility for any pre-migration rows.
  const legacy = crypto.createHash('sha256').update(password).digest('hex');
  const a = Buffer.from(legacy);
  const b = Buffer.from(value);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  const gate=await allowRate(req,{action:'login',subject:phone,limit:8,windowMinutes:15});
  if(gate.unavailable)return res.status(503).json({error:'ورود موقتاً در دسترس نیست. دوباره تلاش کنید.'});
  if(!gate.allowed){res.setHeader('Retry-After',String(gate.retry_after_seconds));return res.status(429).json({error:'تلاش‌های ورود زیاد بوده است. چند دقیقه بعد دوباره امتحان کنید'})}
  if (!/^09\d{9}$/.test(phone) || password.length < 1 || password.length > 128) {
    return res.status(400).json({ error: 'شماره تماس یا رمز عبور معتبر نیست' });
  }

  const { data, error } = await supabase.from('users').select('id,name,phone,password,status').eq('phone', phone).maybeSingle();
  if (error) return res.status(503).json({error:'ورود موقتاً در دسترس نیست. دوباره تلاش کنید.'});
  if (!data || !verifyPassword(password, data.password))return res.status(401).json({ error: 'شماره یا رمز اشتباه است' });
  if (data.status === 'blocked') return res.status(403).json({ error: 'حساب کاربری شما غیرفعال شده است' });

  const user = { id: data.id, name: data.name, phone: data.phone };
  await recordRate(gate.keyHash,'login',true,gate.eventId);
  setUserSession(res, user);
  return res.status(200).json({ success: true, user });
}
