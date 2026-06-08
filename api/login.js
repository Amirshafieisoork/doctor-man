import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  "https://dhciuxijsagtskrrtxua.supabase.co",
  "sb_secret_qoQ4qTs8BDVEf4ajnoHdQA_Vm8PzU2H"
);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'شماره و رمز الزامی است' });
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, name, phone')
    .eq('phone', phone)
    .eq('password', hashPassword(password))
    .single();

  if (error || !data) {
    return res.status(401).json({ error: 'شماره یا رمز اشتباه است' });
  }

  return res.status(200).json({ success: true, user: data });
}
