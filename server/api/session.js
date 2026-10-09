import { getUserSession, clearUserSession } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = getUserSession(req);
  if (!session) return res.status(200).json({ authenticated: false });

  const { data, error } = await supabase.from('users').select('id,name,phone,status').eq('id', session.sub).maybeSingle();
  if (error) return res.status(503).json({ authenticated: false, error: 'بررسی نشست موقتاً در دسترس نیست' });
  if (!data || data.status !== 'active') {
    clearUserSession(res);
    return res.status(200).json({ authenticated: false });
  }
  const {status,...user}=data;
  return res.status(200).json({ authenticated: true, user });
}
