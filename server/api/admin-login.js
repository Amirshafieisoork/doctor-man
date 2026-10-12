import crypto from 'node:crypto';
import { setAdminSession } from './_lib/session.js';
import { allowRate, recordRate } from './_lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const gate=await allowRate(req,{action:'admin-login',subject:'admin',limit:5,windowMinutes:30});
  if(gate.unavailable)return res.status(503).json({error:'ورود مدیر موقتاً در دسترس نیست'});
  if(!gate.allowed){res.setHeader('Retry-After',String(gate.retry_after_seconds));return res.status(429).json({error:'ورود مدیر موقتاً محدود شده است'})}
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword || typeof password !== 'string') {
    return res.status(503).json({ error: 'تنظیمات ورود مدیر کامل نیست' });
  }

  const supplied = Buffer.from(password);
  const expected = Buffer.from(configuredPassword);
  const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!valid)return res.status(401).json({ error: 'رمز اشتباه است' });

  await recordRate(gate.keyHash,'admin-login',true,gate.eventId);
  setAdminSession(res);
  return res.status(200).json({ success: true, token: 'server-session' });
}
