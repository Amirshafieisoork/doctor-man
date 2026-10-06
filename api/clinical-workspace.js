import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function text(v,max=3000){return v==null?null:String(v).trim().slice(0,max)}
async function doctorForUser(userId){const {data}=await supabase.from('doctor_profiles').select('id,user_id,full_name,verification_status').eq('user_id',userId).maybeSingle();return data}
async function writableGrant(patientId,doctorId){const {data}=await supabase.from('patient_access_grants').select('id,scope,status,expires_at').eq('patient_id',patientId).eq('doctor_id',doctorId).eq('status','active').maybeSingle();if(!data)return null;if(data.expires_at&&new Date(data.expires_at).getTime()<Date.now())return null;return Array.isArray(data.scope)&&data.scope.includes('clinical_write')?data:null}
async function notifyPatient(patientId,title,body,type='care_update'){
  const {data:p}=await supabase.from('patients').select('owner_user_id').eq('id',patientId).maybeSingle();
  if(p?.owner_user_id)await supabase.from('notifications').insert({user_id:p.owner_user_id,patient_id:patientId,type,title,body:text(body,300),action_url:'/health'});
}
async function audit(userId,patientId,action,type,id,meta={}){await supabase.from('audit_logs').insert({actor_user_id:userId,actor_type:'doctor',patient_id:patientId,action,resource_type:type,resource_id:id,metadata:meta})}

export default async function handler(req,res){
  const session=requireUser(req,res); if(!session)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const doctor=await doctorForUser(session.sub); if(!doctor||doctor.verification_status!=='verified')return res.status(403).json({success:false,error:'حساب پزشک تأیید نشده است'});
  const body=req.body&&typeof req.body==='object'?req.body:{}; const patientId=text(body.patient_id,64), action=String(body.action||'');
  if(!patientId||!(await writableGrant(patientId,doctor.id)))return res.status(403).json({success:false,error:'بیمار اجازه ثبت اطلاعات بالینی نداده است'});
  try{
    if(action==='encounter'){
      const payload={patient_id:patientId,doctor_id:doctor.id,appointment_id:body.appointment_id||null,organization_id:body.organization_id||null,occurred_at:body.occurred_at||new Date().toISOString(),encounter_type:['in_person','video','phone','follow_up','other'].includes(body.encounter_type)?body.encounter_type:'other',chief_complaint:text(body.chief_complaint,1000),summary:text(body.summary,4000),assessment:text(body.assessment,4000),plan:text(body.plan,4000)};
      const {data,error}=await supabase.from('encounters').insert(payload).select('*').single(); if(error)throw error;
      await audit(session.sub,patientId,'encounter.created','encounter',data.id); await notifyPatient(patientId,'خلاصه ویزیت جدید',payload.summary||'پزشک یک یادداشت ویزیت جدید ثبت کرد.','encounter');
      return res.status(201).json({success:true,item:data});
    }
    if(action==='prescription'){
      const items=Array.isArray(body.items)?body.items.slice(0,30).map(x=>({medication_name:text(x.medication_name,180),dose:text(x.dose,120),frequency:text(x.frequency,120),duration:text(x.duration,120),instructions:text(x.instructions,800)})).filter(x=>x.medication_name):[];
      if(!items.length)return res.status(400).json({success:false,error:'حداقل یک دارو لازم است'});
      const {data:rx,error}=await supabase.from('prescriptions').insert({patient_id:patientId,doctor_id:doctor.id,encounter_id:body.encounter_id||null,issued_at:new Date().toISOString(),notes:text(body.notes,2000),status:'active'}).select('*').single(); if(error)throw error;
      const {error:itemError}=await supabase.from('prescription_items').insert(items.map(x=>({...x,prescription_id:rx.id}))); if(itemError){await supabase.from('prescriptions').delete().eq('id',rx.id);throw itemError}
      await audit(session.sub,patientId,'prescription.created','prescription',rx.id,{item_count:items.length}); await notifyPatient(patientId,'نسخه جدید ثبت شد',`${items.length} قلم دارو توسط ${doctor.full_name||'پزشک'} ثبت شد.`,'prescription');
      return res.status(201).json({success:true,item:rx,items});
    }
    if(action==='diagnostic_order'){
      const items=Array.isArray(body.items)?body.items.map(x=>text(x,160)).filter(Boolean).slice(0,50):[]; if(!items.length)return res.status(400).json({success:false,error:'موارد درخواست را وارد کنید'});
      const orderType=['lab','imaging','pathology','other'].includes(body.order_type)?body.order_type:'lab'; const priority=['routine','urgent'].includes(body.priority)?body.priority:'routine';
      const {data,error}=await supabase.from('diagnostic_orders').insert({patient_id:patientId,ordered_by_doctor_id:doctor.id,destination_organization_id:body.destination_organization_id||null,order_type:orderType,items,clinical_note:text(body.clinical_note,2500),priority,status:'ordered',ordered_at:new Date().toISOString()}).select('*').single(); if(error)throw error;
      await audit(session.sub,patientId,'diagnostic_order.created','diagnostic_order',data.id,{order_type:orderType}); await notifyPatient(patientId,'درخواست بررسی جدید',`${orderType==='lab'?'آزمایش':'بررسی تشخیصی'} جدید برای شما ثبت شد.`,'diagnostic_order');
      return res.status(201).json({success:true,item:data});
    }
    if(action==='follow_up'){
      const title=text(body.title,180); if(!title)return res.status(400).json({success:false,error:'عنوان پیگیری لازم است'});
      const type=['medication','lab','appointment','measurement','follow_up','vaccine','general'].includes(body.task_type)?body.task_type:'follow_up';
      const {data,error}=await supabase.from('care_tasks').insert({patient_id:patientId,created_by_doctor_id:doctor.id,type,title,details:text(body.details,1500),due_at:body.due_at||null,recurrence_rule:text(body.recurrence_rule,300),status:'open'}).select('*').single(); if(error)throw error;
      await audit(session.sub,patientId,'care_task.created','care_task',data.id); await notifyPatient(patientId,'پیگیری جدید',title,'follow_up');
      return res.status(201).json({success:true,item:data});
    }
    return res.status(400).json({success:false,error:'عملیات پشتیبانی نمی‌شود'});
  }catch(error){console.error('clinical-workspace',error);return res.status(500).json({success:false,error:'ثبت اطلاعات بالینی انجام نشد'})}
}
