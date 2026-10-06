import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { setUserSession } from './_lib/session.js';

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');

  if (!/^09\d{9}$/.test(phone) || password.length < 1 || password.length > 128) {
    return res.status(400).json({ error: 'شماره تماس یا رمز عبور معتبر نیست' });
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, name, phone')
    .eq('phone', phone)
    .eq('password', hashPassword(password))
    .single();

  if (error || !data) return res.status(401).json({ error: 'شماره یا رمز اشتباه است' });

  setUserSession(res, data);
  return res.status(200).json({ success: true, user: data });
}
