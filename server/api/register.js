import crypto from 'node:crypto';
import { setUserSession } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { allowRate, recordRate } from './_lib/rate-limit.js';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 80);
  const gate=await allowRate(req,{action:'register',subject:phone,limit:5,windowMinutes:60});
  if(!gate.allowed){res.setHeader('Retry-After',String(gate.retry_after_seconds));return res.status(429).json({error:'تعداد تلاش ثبت‌نام زیاد بوده است. بعداً دوباره امتحان کنید'})}

  if (!/^09\d{9}$/.test(phone) || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'شماره تماس یا رمز عبور معتبر نیست' });
  }

  const { data: existing } = await supabase.from('users').select('id').eq('phone', phone).maybeSingle();
  if (existing) return res.status(409).json({ error: 'این شماره قبلاً ثبت شده است' });

  const { data: freePlan } = await supabase.from('plans').select('id,duration_days').eq('slug', 'free').single();
  const now = new Date();
  const expires = new Date(now.getTime() + Number(freePlan?.duration_days || 30) * 86400000);

  const { data, error } = await supabase
    .from('users')
    .insert([{
      phone,
      password: hashPassword(password),
      name,
      plan_id: freePlan?.id || null,
      plan_started_at: now.toISOString(),
      plan_expires_at: expires.toISOString()
    }])
    .select('id, name, phone')
    .single();

  if (error) {
    console.error('register', error);
    return res.status(500).json({ error: 'خطا در ثبت‌نام' });
  }

  await recordRate(gate.keyHash,'register',true);
  setUserSession(res, data);
  return res.status(200).json({ success: true, user: data });
}
