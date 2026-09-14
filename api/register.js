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
  const name = String(body.name || '').trim().slice(0, 80);

  if (!/^09\d{9}$/.test(phone) || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'شماره تماس یا رمز عبور معتبر نیست' });
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();

  if (existing) {
    return res.status(400).json({ error: 'این شماره قبلاً ثبت شده است' });
  }

  const { data, error } = await supabase
    .from('users')
    .insert([{ phone, password: hashPassword(password), name }])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'خطا در ثبت‌نام: ' + error.message });
  }

  return res.status(200).json({ success: true, userId: data.id });
}
