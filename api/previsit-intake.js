import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function text(v,max=3000){return v==null?null:String(v).trim().slice(0,max)}
function safeObject(v,maxKeys=40){if(!v||typeof v!=='object'||Array.isArray(v))return{};return Object.fromEntries(Object.entries(v).slice(0,maxKeys).map(([k,val])=>[String(k).slice(0,80),typeof val==='string'?val.slice(0,500):val]));}
async function doctorForUser(userId){const {data}=await supabase.from('doctor_profiles').select('id,user_id,full_name,verification_status').eq('user_id',userId).maybeSingle();return data;}

export default async function handler(req,res){
  const session=requireUser(req,res);if(!session)return;
  const appointmentId=String(req.method==='GET'?req.query?.appointment_id:req.body?.appointment_id||'').trim();
  if(!appointmentId)return res.status(400).json({success:false,error:'شناسه نوبت لازم است'});
  try{
    if(req.method==='GET'){
      const role=String(req.query?.role||'patient');
      if(role==='doctor'){
        const doctor=await doctorForUser(session.sub);if(!doctor||doctor.verification_status!=='verified')return res.status(403).json({success:false,error:'حساب پزشک معتبر نیست'});
        const {data:appt}=await supabase.from('appointments').select('id,patient_id,doctor_id,starts_at,mode,status,reason,patients(display_name,birth_date,sex)').eq('id',appointmentId).eq('doctor_id',doctor.id).maybeSingle();
        if(!appt)return res.status(404).json({success:false,error:'نوبت پیدا نشد'});
        const {data:intake}=await supabase.from('visit_intakes').select('*').eq('appointment_id',appointmentId).maybeSingle();
        await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'doctor',patient_id:appt.patient_id,action:'visit_intake.viewed',resource_type:'visit_intake',resource_id:intake?.id||null,metadata:{appointment_id:appointmentId}}).catch(()=>null);
        return res.status(200).json({success:true,appointment:appt,intake:intake||null});
      }
      const {data:appt}=await supabase.from('appointments').select('id,patient_id,doctor_id,starts_at,mode,status,reason,patients!inner(owner_user_id,display_name),doctor_profiles(full_name,specialty)').eq('id',appointmentId).eq('patients.owner_user_id',session.sub).maybeSingle();
      if(!appt)return res.status(404).json({success:false,error:'نوبت پیدا نشد'});
      const {data:intake}=await supabase.from('visit_intakes').select('*').eq('appointment_id',appointmentId).maybeSingle();
      return res.status(200).json({success:true,appointment:appt,intake:intake||null});
    }
    if(req.method==='POST'){
      const b=req.body||{};
      const {data:appt}=await supabase.from('appointments').select('id,patient_id,doctor_id,starts_at,mode,status,patients!inner(owner_user_id)').eq('id',appointmentId).eq('patients.owner_user_id',session.sub).maybeSingle();
      if(!appt)return res.status(404).json({success:false,error:'نوبت معتبر نیست'});
      if(['completed','cancelled','no_show'].includes(appt.status))return res.status(409).json({success:false,error:'برای این نوبت امکان ثبت شرح حال جدید وجود ندارد'});
      const submit=b.submit===true||b.status==='submitted';
      const chief=text(b.chief_complaint,1200),hpi=text(b.history_of_present_illness,5000);
      if(submit&&(!chief||!hpi))return res.status(400).json({success:false,error:'برای ارسال نهایی، مشکل اصلی و شرح علائم را کامل کنید'});
      const payload={
        appointment_id:appointmentId,patient_id:appt.patient_id,doctor_id:appt.doctor_id,created_by_user_id:session.sub,
        chief_complaint:chief,symptom_onset:text(b.symptom_onset,500),history_of_present_illness:hpi,
        associated_symptoms:text(b.associated_symptoms,3000),past_medical_history:text(b.past_medical_history,3000),
        surgical_history:text(b.surgical_history,2500),family_history:text(b.family_history,2500),social_history:text(b.social_history,2500),
        current_medications_note:text(b.current_medications_note,2500),allergies_note:text(b.allergies_note,2500),
        pregnancy_status:['not_applicable','no','possible','yes','unknown'].includes(b.pregnancy_status)?b.pregnancy_status:'unknown',
        last_menstrual_period:b.last_menstrual_period||null,home_vitals:safeObject(b.home_vitals,20),red_flag_answers:safeObject(b.red_flag_answers,30),
        questions_for_doctor:text(b.questions_for_doctor,2500),status:submit?'submitted':'draft',submitted_at:submit?new Date().toISOString():null,updated_at:new Date().toISOString()
      };
      const {data,error}=await supabase.from('visit_intakes').upsert(payload,{onConflict:'appointment_id'}).select('*').single();if(error)throw error;
      await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:appt.patient_id,action:submit?'visit_intake.submitted':'visit_intake.saved',resource_type:'visit_intake',resource_id:data.id,metadata:{appointment_id:appointmentId}}).catch(()=>null);
      if(submit){
        const {data:doc}=await supabase.from('doctor_profiles').select('user_id,full_name').eq('id',appt.doctor_id).maybeSingle();
        if(doc?.user_id)await supabase.from('notifications').insert({user_id:doc.user_id,patient_id:appt.patient_id,type:'visit_intake',title:'شرح حال قبل از ویزیت آماده است',body:'بیمار شرح حال اولیه را برای نوبت پیش‌رو تکمیل کرده است.',action_url:'/doctor-portal'}).catch(()=>null);
      }
      return res.status(200).json({success:true,intake:data});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){console.error('previsit-intake',error);return res.status(500).json({success:false,error:'ثبت یا دریافت شرح حال انجام نشد'});}
}
