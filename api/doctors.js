import { supabase } from './_lib/db.js';

function clean(v, max = 100) { return String(v || '').trim().slice(0, max); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const slug = clean(req.query?.slug, 160);
    let query = supabase
      .from('doctor_profiles')
      .select('id,slug,full_name,specialty,sub_specialty,bio,city,avatar_url,accepts_online,accepts_in_person,consultation_fee,verification_status,organizations(id,name,type,city,address,phone)')
      .eq('verification_status', 'verified')
      .eq('public_profile', true);

    if (slug) {
      const { data, error } = await query.eq('slug', slug).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'پزشک پیدا نشد' });
      return res.status(200).json({ success: true, doctor: data });
    }

    const specialty = clean(req.query?.specialty);
    const city = clean(req.query?.city);
    const q = clean(req.query?.q, 120).replace(/[,%]/g, '');
    if (specialty) query = query.ilike('specialty', `%${specialty}%`);
    if (city) query = query.ilike('city', `%${city}%`);
    if (q) query = query.or(`full_name.ilike.%${q}%,specialty.ilike.%${q}%,sub_specialty.ilike.%${q}%`);
    const { data, error } = await query.order('full_name').limit(100);
    if (error) throw error;
    return res.status(200).json({ success: true, doctors: data || [] });
  } catch (error) {
    console.error('doctors', error);
    return res.status(500).json({ success: false, error: 'دریافت فهرست پزشکان انجام نشد' });
  }
}
