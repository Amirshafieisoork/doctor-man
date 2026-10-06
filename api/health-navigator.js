import OpenAI from 'openai';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const AVALAI_KEY=process.env.AVALAI_API_KEY; if(!AVALAI_KEY)throw new Error('AVALAI_API_KEY is missing');
function dayStart(){const d=new Date();d.setUTCHours(0,0,0,0);return d.toISOString();}
async function latestConsent(userId,patientId){const {data}=await supabase.from('consent_records').select('granted,granted_at').eq('user_id',userId).eq('patient_id',patientId).eq('consent_type','ai_processing').order('granted_at',{ascending:false}).limit(1).maybeSingle();return data?.granted===true;}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const session=requireUser(req,res); if(!session)return;
  const body=req.body||{},patientId=String(body.patient_id||''),question=String(body.question||'').trim().slice(0,2500); if(!question)return res.status(400).json({success:false,error:'سؤال را وارد کنید'});
  const [{data:patient},{data:user},{count:todayCount}]=await Promise.all([
    supabase.from('patients').select('id,display_name,birth_date,sex,blood_type,height_cm').eq('id',patientId).eq('owner_user_id',session.sub).maybeSingle(),
    supabase.from('users').select('plans(navigator_daily_limit,name)').eq('id',session.sub).single(),
    supabase.from('audit_logs').select('id',{count:'exact',head:true}).eq('actor_user_id',session.sub).eq('action','ai.navigator_used').gte('created_at',dayStart())
  ]);
  if(!patient)return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
  const dailyLimit=Math.max(0,Number(user?.plans?.navigator_daily_limit??3));
  if(Number(todayCount||0)>=dailyLimit)return res.status(429).json({success:false,error:'سقف استفاده امروز Health Navigator تمام شده است.'});
  if(!(await latestConsent(session.sub,patientId)))return res.status(428).json({success:false,code:'AI_CONSENT_REQUIRED',error:'برای استفاده از راهنمای هوشمند، رضایت پردازش هوش مصنوعی لازم است'});
  const [conditions,allergies,meds,vitals,tests,tasks,appointments]=await Promise.all([
    supabase.from('patient_conditions').select('name,status,diagnosed_at,notes').eq('patient_id',patientId).limit(30),
    supabase.from('patient_allergies').select('allergen,allergy_type,severity,reaction').eq('patient_id',patientId).limit(30),
    supabase.from('patient_medications').select('name,dose,frequency,status,instructions').eq('patient_id',patientId).eq('status','active').limit(30),
    supabase.from('patient_vitals').select('measured_at,weight_kg,systolic,diastolic,heart_rate,oxygen_saturation,temperature_c,glucose_mg_dl').eq('patient_id',patientId).order('measured_at',{ascending:false}).limit(20),
    supabase.from('test_results').select('status,reason,analysis,created_at').eq('patient_id',patientId).order('created_at',{ascending:false}).limit(8),
    supabase.from('care_tasks').select('type,title,due_at,status').eq('patient_id',patientId).eq('status','open').order('due_at',{ascending:true}).limit(20),
    supabase.from('appointments').select('starts_at,status,reason,doctor_profiles(full_name,specialty)').eq('patient_id',patientId).gte('starts_at',new Date().toISOString()).order('starts_at',{ascending:true}).limit(10)
  ]);
  const record={patient,conditions:conditions.data||[],allergies:allergies.data||[],medications:meds.data||[],recent_vitals:vitals.data||[],recent_tests:(tests.data||[]).map(t=>({...t,analysis:String(t.analysis||'').slice(0,3500)})),open_tasks:tasks.data||[],upcoming_appointments:appointments.data||[]};
  const openai=new OpenAI({apiKey:AVALAI_KEY,baseURL:'https://api.avalai.ir/v1'});
  const response=await openai.chat.completions.create({model:process.env.HEALTH_NAVIGATOR_MODEL||'gpt-4.1-mini',temperature:.2,max_tokens:1200,messages:[{role:'system',content:`تو Health Navigator فارسی DrMan هستی. بر اساس پرونده به کاربر کمک آموزشی و ناوبری سلامت بده. تشخیص قطعی، نسخه یا تغییر دوز ممنوع است. در علائم بالقوه اورژانسی به ارزیابی فوری/اورژانس محلی توصیه کن. اگر داده کافی نیست صریح بگو. پاسخ را کوتاه و بخش‌بندی‌شده بده: برداشت کلی، کارهای بعدی، چه زمانی مراجعه شود، سؤال‌های پیشنهادی برای پزشک.`},{role:'user',content:`پرونده سلامت:\n${JSON.stringify(record)}\n\nسؤال کاربر:\n${question}`} ]});
  const answer=String(response.choices?.[0]?.message?.content||'پاسخی دریافت نشد').slice(0,12000);
  await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:patientId,action:'ai.navigator_used',resource_type:'patient',resource_id:patientId});
  return res.status(200).json({success:true,answer,remaining_today:Math.max(0,dailyLimit-Number(todayCount||0)-1),disclaimer:'این راهنمایی آموزشی است و جای تشخیص یا درمان توسط پزشک را نمی‌گیرد.'});
}
