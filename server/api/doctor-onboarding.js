import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { InputValidationError, numberField } from './_lib/validate.js';

function slugify(input) {
  return String(input || '')
    .trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

export default async function handler(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { data } = await supabase.from('doctor_profiles').select('*').eq('user_id', session.sub).maybeSingle();
    return res.status(200).json({ success: true, doctor: data || null });
  }

  if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const {data:settings,error:settingsError}=await supabase.from('app_settings').select('value').eq('key','general').maybeSingle();
  if(settingsError)return res.status(503).json({success:false,error:'ثبت درخواست پزشک موقتاً در دسترس نیست'});
  if(settings?.value?.doctor_onboarding_enabled===false)return res.status(503).json({success:false,error:'ثبت درخواست پزشک جدید موقتاً غیرفعال است'});
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const fullName = String(body.full_name || '').trim().slice(0, 120);
  const specialty = String(body.specialty || '').trim().slice(0, 120);
  const license = String(body.medical_license_number || '').trim().slice(0, 80);
  if (!fullName || !specialty || !license) return res.status(400).json({ success: false, error: 'نام، تخصص و شماره نظام پزشکی الزامی است' });

  let consultationFee;try{consultationFee=numberField(body.consultation_fee,{label:'هزینه ویزیت',min:0,max:100000000,integer:true})}catch(e){if(e instanceof InputValidationError)return res.status(400).json({success:false,error:e.message});throw e}

  const payload = {
    full_name: fullName,
    medical_license_number: license,
    specialty,
    sub_specialty: body.sub_specialty ? String(body.sub_specialty).trim().slice(0, 120) : null,
    bio: body.bio ? String(body.bio).trim().slice(0, 4000) : null,
    city: body.city ? String(body.city).trim().slice(0, 100) : null,
    phone: body.phone ? String(body.phone).trim().slice(0, 30) : null,
    accepts_online: Boolean(body.accepts_online),
    accepts_in_person: body.accepts_in_person !== false,
    consultation_fee: consultationFee,
    verification_status: 'pending',
    public_profile: false,
    updated_at: new Date().toISOString()
  };

  const { data: existing } = await supabase.from('doctor_profiles').select('id,slug').eq('user_id', session.sub).maybeSingle();
  if (existing) {
    const { data, error } = await supabase.from('doctor_profiles').update(payload).eq('id', existing.id).select('*').single();
    if (error) return res.status(500).json({ success: false, error: 'ویرایش درخواست انجام نشد' });
    await supabase.from('users').update({ account_type: 'doctor' }).eq('id', session.sub);
    return res.status(200).json({ success: true, doctor: data });
  }

  let slug = slugify(fullName) || `doctor-${Date.now()}`;
  const { data: collision } = await supabase.from('doctor_profiles').select('id').eq('slug', slug).maybeSingle();
  if (collision) slug = `${slug}-${String(Date.now()).slice(-6)}`;
  const { data, error } = await supabase.from('doctor_profiles').insert({ ...payload, user_id: session.sub, slug }).select('*').single();
  if (error) return res.status(500).json({ success: false, error: 'ثبت درخواست پزشک انجام نشد' });
  await supabase.from('users').update({ account_type: 'doctor' }).eq('id', session.sub);
  await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'doctor', action: 'doctor.onboarding_requested', resource_type: 'doctor_profile', resource_id: data.id });
  return res.status(201).json({ success: true, doctor: data });
}
