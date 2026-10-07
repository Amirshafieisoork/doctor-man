import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { avalaiClient, HEALTH_NAVIGATOR_MODEL, HEALTH_NAVIGATOR_FALLBACK_MODEL } from './_lib/ai-models.js';

function dayStart(){const d=new Date();d.setUTCHours(0,0,0,0);return d.toISOString();}
async function latestConsent(userId,patientId){const {data}=await supabase.from('consent_records').select('granted,granted_at').eq('user_id',userId).eq('patient_id',patientId).eq('consent_type','ai_processing').order('granted_at',{ascending:false}).limit(1).maybeSingle();return data?.granted===true;}

const NAV_SCHEMA={type:'object',additionalProperties:false,properties:{overall:{type:'string'},next_steps:{type:'array',items:{type:'string'}},seek_care:{type:'string'},questions_for_doctor:{type:'array',items:{type:'string'}},data_limits:{type:'array',items:{type:'string'}}},required:['overall','next_steps','seek_care','questions_for_doctor','data_limits']};

async function callNavigator(client,model,messages,safetyIdentifier){
  return client.chat.completions.create({model,messages,max_completion_tokens:1800,response_format:{type:'json_schema',json_schema:{name:'drman_health_navigator',strict:true,schema:NAV_SCHEMA}},safety_identifier:safetyIdentifier});
}
async function runNavigator(client,messages,safetyIdentifier){
  const models=[HEALTH_NAVIGATOR_MODEL,HEALTH_NAVIGATOR_FALLBACK_MODEL].filter((v,i,a)=>v&&a.indexOf(v)===i);let last;
  for(const model of models){try{const r=await callNavigator(client,model,messages,safetyIdentifier);const parsed=JSON.parse(r.choices?.[0]?.message?.content||'{}');if(!parsed?.overall||!Array.isArray(parsed.next_steps))throw new Error('INVALID_NAV_JSON');return{parsed,model:r.model||model,requestId:r._request_id||null};}catch(e){last=e;console.error('navigator model failed',model,e?.message||e);}}
  throw last||new Error('NAVIGATOR_AI_FAILED');
}
function renderAnswer(x){const lines=['برداشت کلی',String(x.overall||'اطلاعات کافی نیست.'),'','کارهای بعدی',...(x.next_steps||[]).map(v=>'• '+v),'','چه زمانی مراجعه شود',String(x.seek_care||'اگر علائم جدید، شدید یا رو به بدتر شدن دارید ارزیابی پزشکی لازم است.'),'','سؤال‌های پیشنهادی برای پزشک',...(x.questions_for_doctor||[]).map(v=>'• '+v)];if((x.data_limits||[]).length)lines.push('','محدودیت داده‌ها',...(x.data_limits||[]).map(v=>'• '+v));return lines.join('\n').slice(0,12000);}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const session=requireUser(req,res);if(!session)return;
  const client=await avalaiClient();if(!client)return res.status(503).json({success:false,error:'راهنمای هوشمند هنوز تنظیم نشده است'});
  const body=req.body||{},patientId=String(body.patient_id||''),question=String(body.question||'').trim().slice(0,2500);if(!question)return res.status(400).json({success:false,error:'سؤال را وارد کنید'});
  try{
    const [{data:patient},{data:user},{count:todayCount}]=await Promise.all([
      supabase.from('patients').select('id,display_name,birth_date,sex,blood_type,height_cm').eq('id',patientId).eq('owner_user_id',session.sub).maybeSingle(),
      supabase.from('users').select('plans(navigator_daily_limit,name)').eq('id',session.sub).single(),
      supabase.from('audit_logs').select('id',{count:'exact',head:true}).eq('actor_user_id',session.sub).eq('action','ai.navigator_used').gte('created_at',dayStart())
    ]);
    if(!patient)return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
    const dailyLimit=Math.max(0,Number(user?.plans?.navigator_daily_limit??3));if(Number(todayCount||0)>=dailyLimit)return res.status(429).json({success:false,error:'سقف استفاده امروز Health Navigator تمام شده است.'});
    if(!(await latestConsent(session.sub,patientId)))return res.status(428).json({success:false,code:'AI_CONSENT_REQUIRED',error:'برای استفاده از راهنمای هوشمند، رضایت پردازش هوش مصنوعی لازم است'});
    const [conditions,allergies,meds,vitals,tests,tasks,appointments,encounters]=await Promise.all([
      supabase.from('patient_conditions').select('name,status,diagnosed_at,notes').eq('patient_id',patientId).limit(30),
      supabase.from('patient_allergies').select('allergen,allergy_type,severity,reaction').eq('patient_id',patientId).limit(30),
      supabase.from('patient_medications').select('name,dose,frequency,status,instructions').eq('patient_id',patientId).eq('status','active').limit(30),
      supabase.from('patient_vitals').select('measured_at,weight_kg,systolic,diastolic,heart_rate,oxygen_saturation,temperature_c,glucose_mg_dl').eq('patient_id',patientId).order('measured_at',{ascending:false}).limit(30),
      supabase.from('test_results').select('status,status_reason,reason,structured_analysis,created_at').eq('patient_id',patientId).order('created_at',{ascending:false}).limit(12),
      supabase.from('care_tasks').select('type,title,due_at,status').eq('patient_id',patientId).eq('status','open').order('due_at',{ascending:true}).limit(30),
      supabase.from('appointments').select('starts_at,status,reason,doctor_profiles(full_name,specialty)').eq('patient_id',patientId).gte('starts_at',new Date().toISOString()).order('starts_at',{ascending:true}).limit(10),
      supabase.from('encounters').select('occurred_at,encounter_type,chief_complaint,summary,assessment,plan').eq('patient_id',patientId).order('occurred_at',{ascending:false}).limit(8)
    ]);
    const record={patient,conditions:conditions.data||[],allergies:allergies.data||[],medications:meds.data||[],recent_vitals:vitals.data||[],recent_tests:(tests.data||[]).map(t=>({created_at:t.created_at,status:t.status,status_reason:t.status_reason,reason:t.reason,summary:t.structured_analysis?.summary||null,abnormal_items:Array.isArray(t.structured_analysis?.abnormal_items)?t.structured_analysis.abnormal_items.slice(0,20):[]})),open_tasks:tasks.data||[],upcoming_appointments:appointments.data||[],recent_encounters:encounters.data||[]};
    const system=`تو Health Navigator فارسی DrMan هستی؛ نقش تو ناوبری سلامت و آماده‌سازی کاربر برای مراقبت بهتر است، نه تشخیص یا درمان.
- فقط از داده پرونده و دانش پزشکی عمومی تثبیت‌شده استفاده کن؛ داده‌ای که در پرونده نیست اختراع نکن.
- تشخیص قطعی، نسخه، شروع/قطع دارو، تغییر دوز، توصیه داروی نسخه‌ای یا تضمین نتیجه ممنوع است.
- درباره تداخل دارویی یا تصمیم درمانی، کاربر را به پزشک/داروساز هدایت کن.
- اگر سؤال می‌تواند فوریت پزشکی باشد، علائم هشدار را واضح و کوتاه بگو و توصیه به ارزیابی فوری/اورژانس محلی کن.
- در کودک، بارداری، سالمند، بیماری زمینه‌ای جدی یا نتایج بحرانی محافظه‌کارتر باش.
- اگر داده ناقص یا قدیمی است، در data_limits مشخص کن.
- پاسخ باید فارسی، روشن، عملی و بدون ایجاد ترس غیرضروری باشد.
- هدف: برداشت کلی، قدم بعدی، زمان مراجعه و سؤال‌های خوب برای پزشک.`;
    const safetyIdentifier=crypto.createHash('sha256').update(`drman-nav:${session.sub}`).digest('hex').slice(0,32);
    const messages=[{role:'system',content:system},{role:'user',content:`زمان فعلی سیستم: ${new Date().toISOString()}\nپرونده سلامت:\n${JSON.stringify(record)}\n\nسؤال کاربر:\n${question}`}];
    const {parsed,model,requestId}=await runNavigator(client,messages,safetyIdentifier);const answer=renderAnswer(parsed);
    await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:patientId,action:'ai.navigator_used',resource_type:'patient',resource_id:patientId,metadata:{model,request_id:requestId}}).catch(()=>null);
    return res.status(200).json({success:true,answer,structured:parsed,model,remaining_today:Math.max(0,dailyLimit-Number(todayCount||0)-1),disclaimer:'این راهنمایی آموزشی است و جای تشخیص یا درمان توسط پزشک را نمی‌گیرد.'});
  }catch(error){console.error('health-navigator',error);return res.status(500).json({success:false,error:'راهنمای هوشمند فعلاً در دسترس نیست. دوباره تلاش کنید.'});}
}
