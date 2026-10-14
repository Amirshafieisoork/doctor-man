import { getUserSession, clearUserSession } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = getUserSession(req);
  if (!session) return res.status(200).json({ authenticated: false });

  const { data, error } = await supabase.from('users').select('id,name,phone,status,session_version').eq('id', session.sub).maybeSingle();
  if (error) return res.status(503).json({ authenticated: false, error: 'بررسی نشست موقتاً در دسترس نیست' });
  const accountVersion=Number(data?.session_version??0),tokenVersion=session.ver??0;
  if (!data || data.status !== 'active' || !Number.isSafeInteger(accountVersion) || accountVersion<0 || !Number.isSafeInteger(tokenVersion) || tokenVersion!==accountVersion) {
    clearUserSession(res);
    return res.status(200).json({ authenticated: false });
  }
  const {status,session_version,...user}=data;
  return res.status(200).json({ authenticated: true, user });
}
