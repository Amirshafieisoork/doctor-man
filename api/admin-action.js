import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const action = String(req.body?.action || '');
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ success: false, error: 'شناسه الزامی است' });

  try {
    if (action === 'block-user' || action === 'unblock-user') {
      const status = action === 'block-user' ? 'blocked' : 'active';
      const { error } = await supabase.from('users').update({ status }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true, status });
    }

    if (action === 'set-plan') {
      const planId = String(req.body?.plan_id || '');
      if (!planId) return res.status(400).json({ success: false, error: 'پلن انتخاب نشده است' });
      const { data: plan } = await supabase.from('plans').select('id,duration_days').eq('id', planId).single();
      if (!plan) return res.status(404).json({ success: false, error: 'پلن پیدا نشد' });
      const now = new Date();
      const expires = new Date(now.getTime() + Number(plan.duration_days || 30) * 86400000);
      const { error } = await supabase.from('users').update({ plan_id: plan.id, plan_started_at: now.toISOString(), plan_expires_at: expires.toISOString() }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'mark-payment-failed') {
      const { error } = await supabase.from('payments').update({ status: 'failed' }).eq('id', id).neq('status', 'paid');
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'عملیات پشتیبانی نمی‌شود' });
  } catch (error) {
    console.error('admin-action', error);
    return res.status(500).json({ success: false, error: 'عملیات مدیریت انجام نشد' });
  }
}
