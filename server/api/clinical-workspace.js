import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function text(v,max=3000){return v==null?null:String(v).trim().slice(0,max)}
function bool(v){return v===true||v==='true'||v===1||v==='1'}
async function doctorForUser(userId){const {data}=await supabase.from('doctor_profiles').select('id,user_id,full_name,verification_status').eq('user_id',userId).maybeSingle();return data}
async function writableGrant(patientId,doctorId){const {data}=await supabase.from('patient_access_grants').select('id,scope,status,expires_at').eq('patient_id',patientId).eq('doctor_id',doctorId).eq('status','active').maybeSingle();if(!data)return null;if(data.expires_at&&new Date(data.expires_at).getTime()<Date.now())return null;return Array.isArray(data.scope)&&data.scope.includes('clinical_write')?data:null}
async function notifyPatient(patientId,title,body,type='care_update'){const {data:p}=await supabase.from('patients').select('owner_user_id').eq('id',patientId).maybeSingle();if(p?.owner_user_id)await supabase.from('notifications').insert({user_id:p.owner_user_id,patient_id:patientId,type,title,body:text(body,300),action_url:'/health'}).catch(()=>null)}
async function audit(userId,patientId,action,type,id,meta={}){await supabase.from('audit_logs').insert({actor_user_id:userId,actor_type:'doctor',patient_id:patientId,action,resource_type:type,resource_id:id,metadata:meta}).catch(()=>null)}
function readyForPrescription(e){
  if(!e)return false;
  const core=[e.chief_complaint,e.history_of_present_illness,e.assessment,e.plan].every(v=>String(v||'').trim());
  const safety=e.patient_identity_verified&&e.medications_reviewed&&e.allergies_reviewed&&e.red_flags_reviewed&&e.clinician_attested;
  const assessment=e.encounter_type==='in_person'?e.clinical_exam_completed:['video','phone','follow_up'].includes(e.encounter_type)?(e.telehealth_appropriate&&e.telehealth_consent_confirmed&&String(e.remote_assessment_notes||'').trim()):Boolean(e.clinical_exam_completed||String(e.remote_assessment_notes||'').trim());
  return Boolean(core&&safety&&assessment);
}

export default async function handler(req,res){
  const session=requireUser(req,res);if(!session)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const doctor=await doctorForUser(session.sub);if(!doctor||doctor.verification_status!=='verified')return res.status(403).json({success:false,error:'حساب پزشک تأیید نشده است'});
  const body=req.body&&typeof req.body==='object'?req.body:{};const patientId=text(body.patient_id,64),action=String(body.action||'');
  if(!patientId||!(await writableGrant(patientId,doctor.id)))return res.status(403).json({success:false,error:'بیمار اجازه ثبت اطلاعات بالینی نداده است'});
  try{
    if(action==='encounter'){
      const type=['in_person','video','phone','follow_up','other'].includes(body.encounter_type)?body.encounter_type:'other';
      const chief=text(body.chief_complaint,1200),hpi=text(body.history_of_present_illness,5000),assessment=text(body.assessment,5000),plan=text(body.plan,5000);
      if(!chief||!hpi||!assessment||!plan)return res.status(400).json({success:false,error:'شکایت اصلی، شرح حال فعلی، ارزیابی و برنامه درمانی باید کامل شوند'});
      const payload={
        patient_id:patientId,doctor_id:doctor.id,appointment_id:body.appointment_id||null,organization_id:body.organization_id||null,intake_id:body.intake_id||null,
        occurred_at:body.occurred_at||new Date().toISOString(),encounter_type:type,chief_complaint:chief,history_of_present_illness:hpi,
        summary:text(body.summary,5000),assessment,plan,review_of_systems:body.review_of_systems&&typeof body.review_of_systems==='object'?body.review_of_systems:{},
        past_medical_history:text(body.past_medical_history,3500),medication_reconciliation:text(body.medication_reconciliation,3500),
        allergy_review:text(body.allergy_review,2500),family_history:text(body.family_history,2500),social_history:text(body.social_history,2500),
        pregnancy_status:text(body.pregnancy_status,80),exam_findings:text(body.exam_findings,4000),remote_assessment_notes:text(body.remote_assessment_notes,4000),
        vitals_reviewed:bool(body.vitals_reviewed),medications_reviewed:bool(body.medications_reviewed),allergies_reviewed:bool(body.allergies_reviewed),
        red_flags_reviewed:bool(body.red_flags_reviewed),clinical_exam_completed:bool(body.clinical_exam_completed),patient_identity_verified:bool(body.patient_identity_verified),
        telehealth_appropriate:bool(body.telehealth_appropriate),telehealth_consent_confirmed:bool(body.telehealth_consent_confirmed),clinician_attested:bool(body.clinician_attested),
        attested_at:bool(body.clinician_attested)?new Date().toISOString():null,updated_at:new Date().toISOString()
      };
      if(!payload.patient_identity_verified)return res.status(400).json({success:false,error:'قبل از نهایی‌کردن ویزیت، هویت بیمار باید توسط پزشک تأیید شود'});
      if(!payload.medications_reviewed||!payload.allergies_reviewed||!payload.red_flags_reviewed||!payload.clinician_attested)return res.status(400).json({success:false,error:'چک‌لیست ایمنی شامل داروها، حساسیت‌ها، علائم هشدار و تأیید پزشک باید کامل شود'});
      if(type==='in_person'&&!payload.clinical_exam_completed)return res.status(400).json({success:false,error:'برای ویزیت حضوری، انجام معاینه باید ثبت شود'});
      if(['video','phone','follow_up'].includes(type)&&(!payload.telehealth_appropriate||!payload.telehealth_consent_confirmed||!payload.remote_assessment_notes))return res.status(400).json({success:false,error:'برای ویزیت راه‌دور، مناسب‌بودن Telehealth، رضایت بیمار و ارزیابی راه‌دور باید ثبت شود'});
      const {data,error}=await supabase.from('encounters').insert(payload).select('*').single();if(error)throw error;
      if(payload.intake_id)await supabase.from('visit_intakes').update({status:'reviewed',reviewed_at:new Date().toISOString(),reviewed_by_doctor_id:doctor.id,updated_at:new Date().toISOString()}).eq('id',payload.intake_id).eq('patient_id',patientId).eq('doctor_id',doctor.id);
      await audit(session.sub,patientId,'encounter.created','encounter',data.id,{prescribing_ready:readyForPrescription(data)});await notifyPatient(patientId,'خلاصه ویزیت جدید',payload.summary||'پزشک ارزیابی بالینی جدید ثبت کرد.','encounter');
      return res.status(201).json({success:true,item:{...data,prescribing_ready:readyForPrescription(data)}});
    }
    if(action==='prescription'){
      const encounterId=String(body.encounter_id||'').trim();if(!encounterId)return res.status(400).json({success:false,error:'نسخه باید به یک ویزیت کامل و تأییدشده متصل باشد'});
      const {data:enc}=await supabase.from('encounters').select('*').eq('id',encounterId).eq('patient_id',patientId).eq('doctor_id',doctor.id).maybeSingle();
      if(!readyForPrescription(enc))return res.status(409).json({success:false,error:'ارزیابی بالینی این ویزیت برای نسخه‌نویسی کامل نیست. شرح حال، هویت، داروها، حساسیت‌ها، علائم هشدار و معاینه/ارزیابی را تکمیل کنید'});
      const items=Array.isArray(body.items)?body.items.slice(0,30).map(x=>({medication_name:text(x.medication_name,180),dose:text(x.dose,120),frequency:text(x.frequency,120),duration:text(x.duration,120),instructions:text(x.instructions,800)})).filter(x=>x.medication_name):[];
      if(!items.length)return res.status(400).json({success:false,error:'حداقل یک دارو لازم است'});
      const {data:rx,error}=await supabase.from('prescriptions').insert({patient_id:patientId,doctor_id:doctor.id,encounter_id:encounterId,issued_at:new Date().toISOString(),notes:text(body.notes,2000),clinical_basis:text(body.clinical_basis,2500),status:'active'}).select('*').single();if(error)throw error;
      const {error:itemError}=await supabase.from('prescription_items').insert(items.map(x=>({...x,prescription_id:rx.id})));if(itemError){await supabase.from('prescriptions').delete().eq('id',rx.id);throw itemError}
      await audit(session.sub,patientId,'prescription.created','prescription',rx.id,{item_count:items.length,encounter_id:encounterId});await notifyPatient(patientId,'نسخه جدید ثبت شد',`${items.length} قلم دارو توسط ${doctor.full_name||'پزشک'} ثبت شد.`,'prescription');
      return res.status(201).json({success:true,item:rx,items});
    }
    if(action==='diagnostic_order'){
      const items=Array.isArray(body.items)?body.items.map(x=>text(x,160)).filter(Boolean).slice(0,50):[];if(!items.length)return res.status(400).json({success:false,error:'موارد درخواست را وارد کنید'});
      const orderType=['lab','imaging','pathology','other'].includes(body.order_type)?body.order_type:'lab',priority=['routine','urgent'].includes(body.priority)?body.priority:'routine';
      const {data,error}=await supabase.from('diagnostic_orders').insert({patient_id:patientId,ordered_by_doctor_id:doctor.id,destination_organization_id:body.destination_organization_id||null,order_type:orderType,items,clinical_note:text(body.clinical_note,2500),priority,status:'ordered',ordered_at:new Date().toISOString()}).select('*').single();if(error)throw error;
      await audit(session.sub,patientId,'diagnostic_order.created','diagnostic_order',data.id,{order_type:orderType});await notifyPatient(patientId,'درخواست بررسی جدید',`${orderType==='lab'?'آزمایش':'بررسی تشخیصی'} جدید برای شما ثبت شد.`,'diagnostic_order');return res.status(201).json({success:true,item:data});
    }
    if(action==='follow_up'){
      const title=text(body.title,180);if(!title)return res.status(400).json({success:false,error:'عنوان پیگیری لازم است'});
      const type=['medication','lab','appointment','measurement','follow_up','vaccine','general'].includes(body.task_type)?body.task_type:'follow_up';
      const {data,error}=await supabase.from('care_tasks').insert({patient_id:patientId,created_by_doctor_id:doctor.id,type,title,details:text(body.details,1500),due_at:body.due_at||null,recurrence_rule:text(body.recurrence_rule,300),status:'open'}).select('*').single();if(error)throw error;
      await audit(session.sub,patientId,'care_task.created','care_task',data.id);await notifyPatient(patientId,'پیگیری جدید',title,'follow_up');return res.status(201).json({success:true,item:data});
    }
    return res.status(400).json({success:false,error:'عملیات پشتیبانی نمی‌شود'});
  }catch(error){
    console.error('clinical-workspace',error);
    const m=String(error?.message||'');if(/PRESCRIPTION_REQUIRES|CLINICAL_|PATIENT_IDENTITY|PHYSICAL_EXAM|REMOTE_ASSESSMENT|TELEHEALTH_/.test(m))return res.status(409).json({success:false,error:'نسخه بدون ارزیابی بالینی کامل و تأیید پزشک قابل ثبت نیست'});
    return res.status(500).json({success:false,error:'ثبت اطلاعات بالینی انجام نشد'});
  }
}
