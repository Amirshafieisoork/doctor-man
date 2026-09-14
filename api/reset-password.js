import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase server configuration is missing');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');

  if (!/^09\d{9}$/.test(phone) || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'شماره تماس یا رمز عبور معتبر نیست' });
  }

  const { data: user, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (lookupError) {
    return res.status(500).json({ error: 'خطا در بررسی حساب کاربری' });
  }

  if (!user) {
    return res.status(404).json({ error: 'حسابی با این شماره پیدا نشد' });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ password: hashPassword(password) })
    .eq('id', user.id);

  if (updateError) {
    return res.status(500).json({ error: 'تغییر رمز عبور انجام نشد' });
  }

  return res.status(200).json({ success: true });
}
