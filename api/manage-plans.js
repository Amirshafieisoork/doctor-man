import { requireAdmin } from './_lib/session.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Supabase server configuration is missing');

function cleanPlan(body = {}) {
  return {
    name: String(body.name || '').trim().slice(0, 80),
    price: Math.max(0, Number(body.price) || 0),
    test_limit: Number.isFinite(Number(body.test_limit)) ? Number(body.test_limit) : 0,
    features: Array.isArray(body.features) ? body.features.map(v => String(v).trim().slice(0, 120)).filter(Boolean).slice(0, 12) : [],
    is_popular: Boolean(body.is_popular),
    display_order: Number(body.display_order) || 0
  };
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'PUT') {
      const id = String(req.body?.id || '').trim();
      if (!id) return res.status(400).json({ success: false, error: 'شناسه پلن الزامی است' });
      const rows = await supabase(`plans?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(cleanPlan(req.body))
      });
      return res.status(200).json({ success: true, plan: rows?.[0] || null });
    }

    if (req.method === 'POST') {
      const plan = cleanPlan(req.body);
      if (!plan.name) return res.status(400).json({ success: false, error: 'نام پلن الزامی است' });
      const rows = await supabase('plans', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(plan)
      });
      return res.status(200).json({ success: true, plan: rows?.[0] || null });
    }

    if (req.method === 'DELETE') {
      const id = String(req.body?.id || '').trim();
      if (!id) return res.status(400).json({ success: false, error: 'شناسه پلن الزامی است' });
      await supabase(`plans?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'خطا در مدیریت پلن' });
  }
}
