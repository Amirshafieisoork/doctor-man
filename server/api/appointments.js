import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { canTransitionAppointment, meetingUrl, overlaps } from './_lib/appointments.js';
import { timestampField, InputValidationError } from './_lib/validate.js';

async function getDoctorForUser(userId) {
  const { data } = await supabase.from('doctor_profiles').select('id,verification_status,timezone').eq('user_id', userId).maybeSingle();
  return data;
}
async function publicAppointmentsEnabled(){const {data}=await supabase.from('app_settings').select('value').eq('key','features').maybeSingle();return data?.value?.appointments===true;}
function localParts(date,timeZone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return{weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),minutes:Number(p.hour)*60+Number(p.minute)};}
function mins(t){const [h,m]=String(t).slice(0,5).split(':').map(Number);return h*60+m;}
async function validateSlot(doctor,starts,mode){
  if(starts.getUTCSeconds()!==0||starts.getUTCMilliseconds()!==0)return null;
  const tz=doctor.timezone||'Asia/Tehran',lp=localParts(starts,tz);
  const {data:rows}=await supabase.from('doctor_availability').select('weekday,start_time,end_time,slot_minutes,mode,active').eq('doctor_id',doctor.id).eq('weekday',lp.weekday).eq('active',true);
  const match=(rows||[]).find(r=>{const s=mins(r.start_time),e=mins(r.end_time),step=Math.max(10,Number(r.slot_minutes)||30);return (!r.mode||r.mode===mode)&&lp.minutes>=s&&lp.minutes+step<=e&&(lp.minutes-s)%step===0;});
  if(!match)return null;
  const ends=new Date(starts.getTime()+Math.max(10,Number(match.slot_minutes)||30)*60000);
  const {data:conflicts,error}=await supabase.from('appointments').select('starts_at,ends_at').eq('doctor_id',doctor.id).in('status',['requested','confirmed']).lt('starts_at',ends.toISOString()).gte('starts_at',new Date(starts.getTime()-86400000).toISOString());
  if(error)throw error;
  if((conflicts||[]).some(a=>overlaps(starts,ends,a)))return null;
  return ends;
}

export default async function handler(req, res) {
  const session = requireUser(req, res); if (!session) return;
  try {
  if (req.method === 'GET') {
    const role = String(req.query?.role || 'patient');
    if (role === 'doctor') {
      const doctor = await getDoctorForUser(session.sub); if (!doctor) return res.status(403).json({ success: false, error: 'حساب پزشک فعال نیست' });
      const { data, error } = await supabase.from('appointments').select('id,starts_at,ends_at,mode,status,reason,patient_note,doctor_note,meeting_url,patients(id,display_name,birth_date,sex),organizations(name,city,address)').eq('doctor_id', doctor.id).order('starts_at', { ascending: true }).limit(200);
      if (error) return res.status(500).json({ success: false, error: 'دریافت نوبت‌ها انجام نشد' });
      return res.status(200).json({ success: true, appointments: data || [] });
    }
    const { data: patients } = await supabase.from('patients').select('id').eq('owner_user_id', session.sub); const ids = (patients || []).map(p => p.id);
    if (!ids.length) return res.status(200).json({ success: true, appointments: [] });
    const { data, error } = await supabase.from('appointments').select('id,patient_id,starts_at,ends_at,mode,status,reason,patient_note,doctor_note,meeting_url,doctor_profiles(id,full_name,specialty,slug,avatar_url),organizations(name,city,address)').in('patient_id', ids).order('starts_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ success: false, error: 'دریافت نوبت‌ها انجام نشد' }); return res.status(200).json({ success: true, appointments: data || [] });
  }
  if (req.method === 'POST') {
    if(!(await publicAppointmentsEnabled())) return res.status(503).json({success:false,code:'APPOINTMENTS_NOT_LAUNCHED',error:'نوبت‌دهی عمومی هنوز راه‌اندازی نشده است. شبکه پزشکان در حال تکمیل است.'});
    const body = req.body || {}, patientId = String(body.patient_id || ''), doctorId = String(body.doctor_id || '');
    const [{ data: patient }, { data: doctor }] = await Promise.all([
      supabase.from('patients').select('id').eq('id', patientId).eq('owner_user_id', session.sub).maybeSingle(),
      supabase.from('doctor_profiles').select('id,verification_status,public_profile,timezone').eq('id', doctorId).maybeSingle()
    ]);
    if (!patient || !doctor || doctor.verification_status !== 'verified' || !doctor.public_profile) return res.status(400).json({ success: false, error: 'پزشک یا پرونده معتبر نیست' });
    const starts = new Date(timestampField(body.starts_at,{label:'زمان نوبت'})||NaN); if (!Number.isFinite(starts.getTime()) || starts.getTime() < Date.now() + 5*60000) return res.status(400).json({ success: false, error: 'زمان نوبت معتبر نیست' });
    const mode = ['in_person','video','phone'].includes(body.mode) ? body.mode : 'in_person'; const ends=await validateSlot(doctor,starts,mode);
    if(!ends)return res.status(409).json({success:false,error:'این زمان در برنامه پزشک نیست یا قبلاً رزرو شده است'});
    const { data, error } = await supabase.from('appointments').insert({ patient_id: patientId, doctor_id: doctorId, organization_id: body.organization_id || null, starts_at: starts.toISOString(), ends_at: ends.toISOString(), mode, reason: body.reason ? String(body.reason).trim().slice(0,1200) : null, patient_note: body.patient_note ? String(body.patient_note).trim().slice(0,2000) : null }).select('id,starts_at,ends_at,mode,status').single();
    if (error) { if(error.code==='23505')return res.status(409).json({success:false,error:'این اسلات همین الان رزرو شد؛ زمان دیگری انتخاب کنید'}); return res.status(500).json({ success: false, error: 'رزرو نوبت انجام نشد' }); }
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: 'appointment.requested', resource_type: 'appointment', resource_id: data.id }); return res.status(201).json({ success: true, appointment: data });
  }
  if (req.method === 'PATCH') {
    const body = req.body || {}, id = String(body.id || '');
    if (!id) return res.status(400).json({success:false,error:'شناسه نوبت لازم است'});
    const patientCancellation = body.action === 'cancel';
    const status = patientCancellation ? 'cancelled' : String(body.status || '');
    let doctor;
    if (!patientCancellation) {
      doctor = await getDoctorForUser(session.sub);
      if (!doctor || doctor.verification_status !== 'verified') return res.status(403).json({success:false,error:'حساب پزشک تأییدشده لازم است'});
    }
    let query = supabase.from('appointments').select('id,patient_id,status,starts_at').eq('id',id);
    if (doctor) query = query.eq('doctor_id',doctor.id);
    const {data: appt,error: lookupError} = await query.maybeSingle();
    if (lookupError) throw lookupError;
    if (!appt) return res.status(404).json({success:false,error:'نوبت پیدا نشد'});
    if (patientCancellation) {
      const {data:patient,error} = await supabase.from('patients').select('id').eq('id',appt.patient_id).eq('owner_user_id',session.sub).maybeSingle();
      if (error) throw error;
      if (!patient) return res.status(404).json({success:false,error:'نوبت پیدا نشد'});
      if (new Date(appt.starts_at).getTime() <= Date.now()) return res.status(409).json({success:false,error:'برای لغو نوبت گذشته با مرکز درمان تماس بگیرید'});
    }
    if (!canTransitionAppointment(appt.status,status,appt.starts_at)) return res.status(409).json({success:false,error:'این تغییر وضعیت نوبت مجاز نیست'});
    const patch = {status,updated_at:new Date().toISOString()};
    if (!patientCancellation && body.doctor_note !== undefined) patch.doctor_note = String(body.doctor_note||'').trim().slice(0,3000)||null;
    if (!patientCancellation && body.meeting_url !== undefined) patch.meeting_url = meetingUrl(body.meeting_url);
    if (body.cancellation_reason !== undefined) patch.cancellation_reason = String(body.cancellation_reason||'').trim().slice(0,1000)||null;
    let update = supabase.from('appointments').update(patch).eq('id',id).eq('status',appt.status);
    update = doctor ? update.eq('doctor_id',doctor.id) : update.eq('patient_id',appt.patient_id);
    const {data,error} = await update.select('id,status,meeting_url').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({success:false,error:'وضعیت نوبت تغییر کرده؛ صفحه را تازه کنید'});
    await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:patientCancellation?'user':'doctor',patient_id:appt.patient_id,action:`appointment.${status}`,resource_type:'appointment',resource_id:id});
    return res.status(200).json({success:true,appointment:data});
  }
  return res.status(405).json({ error: 'Method not allowed' });
  } catch(error) {
    if(error instanceof InputValidationError)return res.status(400).json({success:false,error:error.message});
    console.error('appointments',error);
    return res.status(500).json({success:false,error:'عملیات نوبت انجام نشد'});
  }
}
