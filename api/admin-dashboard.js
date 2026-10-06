import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  try {
    const [usersRes, testsRes, plansRes, paymentsRes, supportRes] = await Promise.all([
      supabase.from('users').select('id,name,phone,status,created_at,plan_id,plan_started_at,plan_expires_at,plans(name,slug)').order('created_at', { ascending: false }).limit(500),
      supabase.from('test_results').select('id,user_id,age,gender,reason,status,created_at').order('created_at', { ascending: false }).limit(500),
      supabase.from('plans').select('*').order('display_order', { ascending: true }),
      supabase.from('payments').select('id,user_id,plan_id,amount,status,tracking_code,created_at,paid_at,users(name,phone),plans(name,slug)').order('created_at', { ascending: false }).limit(500),
      supabase.from('support_messages').select('id,user_id,role,content,created_at,users(name,phone)').order('created_at', { ascending: false }).limit(100)
    ]);

    for (const r of [usersRes, testsRes, plansRes, paymentsRes, supportRes]) if (r.error) throw r.error;
    const users = usersRes.data || [];
    const tests = testsRes.data || [];
    const payments = paymentsRes.data || [];
    const revenue = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return res.status(200).json({
      success: true,
      stats: {
        users: users.length,
        active_users: users.filter(u => u.status === 'active').length,
        tests: tests.length,
        danger_tests: tests.filter(t => t.status === 'danger').length,
        paid_payments: payments.filter(p => p.status === 'paid').length,
        revenue
      },
      users,
      tests,
      plans: plansRes.data || [],
      payments,
      support: supportRes.data || []
    });
  } catch (error) {
    console.error('admin-dashboard', error);
    return res.status(500).json({ success: false, error: 'بارگذاری اطلاعات مدیریت انجام نشد' });
  }
}
