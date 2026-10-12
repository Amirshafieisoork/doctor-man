import { safeErrorMetadata } from './_lib/errors.js';
import { supabase } from './_lib/db.js';

function clean(v, max = 100) { return String(v || '').trim().slice(0, max); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const slug = clean(req.query?.slug, 160);
    let query = supabase
      .from('doctor_profiles')
      .select('id,slug,full_name,specialty,sub_specialty,bio,city,avatar_url,accepts_online,accepts_in_person,consultation_fee,verification_status,years_experience,languages,gender,organizations(id,name,type,city,address,phone)')
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
    const mode = clean(req.query?.mode, 20);
    const gender = clean(req.query?.gender, 20);
    const q = clean(req.query?.q, 120).replace(/[,%]/g, '');
    if (specialty) query = query.ilike('specialty', `%${specialty}%`);
    if (city) query = query.ilike('city', `%${city}%`);
    if (mode === 'online') query = query.eq('accepts_online', true);
    if (mode === 'in_person') query = query.eq('accepts_in_person', true);
    if (gender && ['male','female'].includes(gender)) query = query.eq('gender', gender);
    if (q) query = query.or(`full_name.ilike.%${q}%,specialty.ilike.%${q}%,sub_specialty.ilike.%${q}%,bio.ilike.%${q}%`);
    const { data, error } = await query.order('full_name').limit(100);
    if (error) throw error;
    const doctors=data||[], ids=doctors.map(x=>x.id);
    if(!ids.length)return res.status(200).json({ success: true, doctors: [] });
    const {data:reviews}=await supabase.from('doctor_reviews').select('doctor_id,rating').in('doctor_id',ids).eq('status','published').eq('verified_visit',true);
    const rr=reviews||[];
    const enriched=doctors.map(d=>{const own=rr.filter(x=>x.doctor_id===d.id),rating=own.length?Number((own.reduce((s,x)=>s+Number(x.rating||0),0)/own.length).toFixed(2)):null;return {...d,rating,review_count:own.length}});
    return res.status(200).json({ success: true, doctors: enriched });
  } catch (error) {
    console.error('doctors', safeErrorMetadata(error));
    return res.status(500).json({ success: false, error: 'دریافت فهرست پزشکان انجام نشد' });
  }
}
