import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { readEntitlement, planLimit } from './_lib/entitlements.js';

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireUser(req, res);
  if (!session) return;

  try{
  const {user,plan,startsAt,expiresAt}=await readEntitlement(supabase,session.sub);
  const [usage,testsResult,paymentsResult] = await Promise.all([
    supabase.from('test_results').select('id', { count: 'exact', head: true }).eq('user_id', session.sub).gte('created_at', monthStart()),
    supabase.from('test_results').select('id,age,gender,reason,analysis,status,status_reason,structured_analysis,ai_confidence,created_at').eq('user_id', session.sub).order('created_at', { ascending: false }).limit(50),
    supabase.from('payments').select('id,amount,status,tracking_code,created_at,paid_at,plans(name,slug)').eq('user_id', session.sub).order('created_at', { ascending: false }).limit(20)
  ]);
  const failure=[usage,testsResult,paymentsResult].find(r=>r.error);
  if(failure)throw failure.error;

  const limit = planLimit(plan,'test_limit');
  const used = Number(usage.count || 0);
  const remaining = Math.max(0, limit - used);

  return res.status(200).json({
    success: true,
    user: { id: user.id, name: user.name, phone: user.phone },
    subscription: {
      plan,
      starts_at: startsAt,
      expires_at: expiresAt,
      used_this_month: used,
      remaining
    },
    tests: testsResult.data || [],
    payments: paymentsResult.data || []
  });
  }catch(error){
    console.error('account',error?.code||error?.name||'DATABASE_ERROR');
    return res.status(503).json({success:false,error:'دریافت اطلاعات حساب موقتاً در دسترس نیست'});
  }
}
