import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, password, name } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'شماره و رمز الزامی است' });
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
    return res.status(500).json({ error: 'خطا در ثبت‌نام' });
  }

  return res.status(200).json({ success: true, userId: data.id });
}
