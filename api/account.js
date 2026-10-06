import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireUser(req, res);
  if (!session) return;

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id,name,phone,status,plan_id,plan_started_at,plan_expires_at,plans(id,name,slug,price,test_limit,features,is_popular,duration_days)')
    .eq('id', session.sub)
    .single();

  if (userError || !user) return res.status(404).json({ success: false, error: 'حساب کاربری پیدا نشد' });
  if (user.status === 'blocked') return res.status(403).json({ success: false, error: 'حساب کاربری شما غیرفعال شده است' });

  const [{ count: usedThisMonth }, { data: recentTests }, { data: payments }] = await Promise.all([
    supabase.from('test_results').select('id', { count: 'exact', head: true }).eq('user_id', session.sub).gte('created_at', monthStart()),
    supabase.from('test_results').select('id,age,gender,reason,analysis,status,created_at,images_base64').eq('user_id', session.sub).order('created_at', { ascending: false }).limit(50),
    supabase.from('payments').select('id,amount,status,tracking_code,created_at,paid_at,plans(name,slug)').eq('user_id', session.sub).order('created_at', { ascending: false }).limit(20)
  ]);

  const plan = user.plans || null;
  const limit = Number(plan?.test_limit ?? 2);
  const used = Number(usedThisMonth || 0);
  const remaining = limit < 0 ? null : Math.max(0, limit - used);

  return res.status(200).json({
    success: true,
    user: { id: user.id, name: user.name, phone: user.phone },
    subscription: {
      plan,
      starts_at: user.plan_started_at,
      expires_at: user.plan_expires_at,
      used_this_month: used,
      remaining
    },
    tests: recentTests || [],
    payments: payments || []
  });
}
