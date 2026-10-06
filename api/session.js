import { createClient } from '@supabase/supabase-js';
import { getUserSession } from './_lib/session.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = getUserSession(req);
  if (!session) return res.status(200).json({ authenticated: false });

  const { data, error } = await supabase.from('users').select('id,name,phone').eq('id', session.sub).single();
  if (error || !data) return res.status(200).json({ authenticated: false });
  return res.status(200).json({ authenticated: true, user: data });
}
