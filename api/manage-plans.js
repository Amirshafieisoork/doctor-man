import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function cleanSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9-]{2,40}$/.test(slug) ? slug : null;
}

function cleanPlan(body = {}, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = String(body.name || '').trim().slice(0, 80);
  if (!partial || body.slug !== undefined) out.slug = cleanSlug(body.slug);
  if (!partial || body.price !== undefined) out.price = Math.max(0, Math.round(Number(body.price) || 0));
  if (!partial || body.test_limit !== undefined) {
    const n = Number(body.test_limit);
    out.test_limit = Number.isFinite(n) ? Math.max(-1, Math.min(1000, Math.round(n))) : 0;
  }
  if (!partial || body.features !== undefined) out.features = Array.isArray(body.features) ? body.features.map(v => String(v).trim().slice(0, 140)).filter(Boolean).slice(0, 12) : [];
  if (!partial || body.is_popular !== undefined) out.is_popular = Boolean(body.is_popular);
  if (!partial || body.display_order !== undefined) out.display_order = Math.max(0, Math.round(Number(body.display_order) || 0));
  if (!partial || body.duration_days !== undefined) out.duration_days = Math.max(1, Math.min(365, Math.round(Number(body.duration_days) || 30)));
  if (!partial || body.active !== undefined) out.active = body.active !== false;
  return out;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'PUT') {
      const id = String(req.body?.id || '').trim();
      if (!id) return res.status(400).json({ success: false, error: 'شناسه پلن الزامی است' });
      const patch = cleanPlan(req.body, true);
      if (patch.name !== undefined && !patch.name) return res.status(400).json({ success: false, error: 'نام پلن الزامی است' });
      if (patch.slug === null && req.body?.slug !== undefined) return res.status(400).json({ success: false, error: 'slug پلن معتبر نیست' });
      const { data, error } = await supabase.from('plans').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, plan: data });
    }

    if (req.method === 'POST') {
      const plan = cleanPlan(req.body, false);
      if (!plan.name || !plan.slug) return res.status(400).json({ success: false, error: 'نام و slug معتبر الزامی است' });
      const { data, error } = await supabase.from('plans').insert(plan).select().single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ success: false, error: 'این slug قبلاً استفاده شده است' });
        throw error;
      }
      return res.status(200).json({ success: true, plan: data });
    }

    if (req.method === 'DELETE') {
      const id = String(req.body?.id || '').trim();
      if (!id) return res.status(400).json({ success: false, error: 'شناسه پلن الزامی است' });
      // Keep referential history intact; deactivation is safer than hard deletion.
      const { data, error } = await supabase.from('plans').update({ active: false, is_popular: false }).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, plan: data, deactivated: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('manage-plans', error);
    return res.status(500).json({ success: false, error: 'خطا در مدیریت پلن' });
  }
}
