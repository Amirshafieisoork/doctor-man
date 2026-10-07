import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { avalaiClient, HEALTH_NAVIGATOR_MODEL, HEALTH_NAVIGATOR_FALLBACK_MODEL } from './_lib/ai-models.js';

const AI_VERSION='care-plan-v1-2026-10';
const PLAN_SCHEMA={
  type:'object',additionalProperties:false,
  properties:{
    summary:{type:'string'},
    priorities:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},why:{type:'string'},importance:{type:'string',enum:['high','medium','low']}},required:['title','why','importance']}},
    nutrition:{type:'object',additionalProperties:false,properties:{focus:{type:'array',items:{type:'string'}},limit:{type:'array',items:{type:'string'}},avoid:{type:'array',items:{type:'string'}},notes:{type:'array',items:{type:'string'}}},required:['focus','limit','avoid','notes']},
    movement:{type:'object',additionalProperties:false,properties:{start_with:{type:'array',items:{type:'string'}},weekly_goal:{type:'string'},avoid_for_now:{type:'array',items:{type:'string'}},stop_and_seek_help_if:{type:'array',items:{type:'string'}}},required:['start_with','weekly_goal','avoid_for_now','stop_and_seek_help_if']},
    daily_habits:{type:'object',additionalProperties:false,properties:{do:{type:'array',items:{type:'string'}},avoid:{type:'array',items:{type:'string'}}},required:['do','avoid']},
    supplements_and_herbs:{type:'object',additionalProperties:false,properties:{
      policy_note:{type:'string'},
      discuss_with_professional:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},why:{type:'string'},cautions:{type:'string'},evidence:{type:'string',enum:['limited','moderate','uncertain']}},required:['name','why','cautions','evidence']}},
      avoid_or_review:{type:'array',items:{type:'string'}}
    },required:['policy_note','discuss_with_professional','avoid_or_review']},
    follow_up:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},reason:{type:'string'},urgency:{type:'string',enum:['routine','soon','urgent']},due_in_days:{type:'integer',minimum:0,maximum:365},seek_sooner_if:{type:'array',items:{type:'string'}}},required:['title','reason','urgency','due_in_days','seek_sooner_if']}},
    red_flags:{type:'array',items:{type:'string'}},
    questions_for_clinician:{type:'array',items:{type:'string'}},
    data_gaps:{type:'array',items:{type:'string'}},
    education_topics:{type:'array',items:{type:'string'}}
  },
  required:['summary','priorities','nutrition','movement','daily_habits','supplements_and_herbs','follow_up','red_flags','questions_for_clinician','data_gaps','education_topics']
};

function dayStart(){const d=new Date();d.setUTCHours(0,0,0,0);return d.toISOString()}
function days(n){return new Date(Date.now()+Number(n||0)*86400000).toISOString()}
function safeArr(v,max=20){return Array.isArray(v)?v.slice(0,max):[]}
async function consent(userId,patientId){const {data}=await supabase.from('consent_records').select('granted').eq('user_id',userId).eq('patient_id',patientId).eq('consent_type','ai_processing').order('granted_at',{ascending:false}).limit(1).maybeSingle();return data?.granted===true}
async function aiCall(client,model,messages,safetyIdentifier){
  return client.chat.completions.create({model,messages,max_completion_tokens:3200,response_format:{type:'json_schema',json_schema:{name:'drman_personal_care_plan',strict:true,schema:PLAN_SCHEMA}},safety_identifier:safetyIdentifier});
}
async function generate(client,messages,safetyIdentifier){
  const models=[HEALTH_NAVIGATOR_MODEL,HEALTH_NAVIGATOR_FALLBACK_MODEL].filter((v,i,a)=>v&&a.indexOf(v)===i);let last;
  for(const model of models){try{const r=await aiCall(client,model,messages,safetyIdentifier);const plan=JSON.parse(r.choices?.[0]?.message?.content||'{}');if(!plan?.summary||!Array.isArray(plan.follow_up))throw new Error('INVALID_CARE_PLAN');return{plan,model:r.model||model,requestId:r._request_id||null}}catch(e){last=e;console.error('care-plan model failed',model,e?.message||e)}}
  throw last||new Error('CARE_PLAN_AI_FAILED');
}
async function ownedPatient(userId,patientId){const {data}=await supabase.from('patients').select('id,display_name,birth_date,sex,blood_type,height_cm,relation,updated_at').eq('id',patientId).eq('owner_user_id',userId).maybeSingle();return data}
async function latestPlan(userId,patientId){const {data}=await supabase.from('personalized_care_plans').select('id,patient_id,plan,ai_model,ai_version,generated_at,valid_until,status').eq('user_id',userId).eq('patient_id',patientId).eq('status','active').order('generated_at',{ascending:false}).limit(1).maybeSingle();return data}
async function relatedArticles(){
  const {data}=await supabase.from('medical_articles').select('slug,title,summary,category,featured,risk_level,review_level').eq('status','published').eq('noindex',false).order('featured',{ascending:false}).order('published_at',{ascending:false}).limit(8);
  return data||[];
}
function addRecommendationIds(plan){return {...plan,follow_up:safeArr(plan.follow_up,12).map(x=>({...x,recommendation_id:crypto.randomUUID()}))}}
function snapshot(record){return{generated_from:{episodes:record.episodes.length,conditions:record.conditions.length,medications:record.medications.length,allergies:record.allergies.length,vitals:record.vitals.length,tests:record.tests.length,screenings:record.screenings.length,vaccinations:record.vaccinations.length,tasks:record.tasks.length,encounters:record.encounters.length},latest_vital_at:record.vitals[0]?.measured_at||null,latest_test_at:record.tests[0]?.created_at||null}}
export default async function handler(req,res){
  const session=requireUser(req,res);if(!session)return;
  const patientId=String((req.method==='GET'?req.query?.patient_id:req.body?.patient_id)||'').trim();
  if(!patientId)return res.status(400).json({success:false,error:'پرونده سلامت لازم است'});
  const patient=await ownedPatient(session.sub,patientId);if(!patient)return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
  try{
    if(req.method==='GET'){
      const [plan,articles]=await Promise.all([latestPlan(session.sub,patientId),relatedArticles()]);
      return res.status(200).json({success:true,care_plan:plan||null,articles,disclaimer:'این برنامه آموزشی و حمایتی است و جای تشخیص، نسخه یا ارزیابی پزشک را نمی‌گیرد.'});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const action=String(req.body?.action||'generate');
    if(action==='create_task'){
      const planId=String(req.body?.plan_id||''),recommendationId=String(req.body?.recommendation_id||'');
      const {data:p}=await supabase.from('personalized_care_plans').select('id,plan').eq('id',planId).eq('user_id',session.sub).eq('patient_id',patientId).maybeSingle();
      if(!p)return res.status(404).json({success:false,error:'برنامه مراقبت پیدا نشد'});
      const item=safeArr(p.plan?.follow_up,20).find(x=>x.recommendation_id===recommendationId);if(!item)return res.status(404).json({success:false,error:'پیگیری پیدا نشد'});
      const dueAt=days(Math.max(0,Math.min(365,Number(item.due_in_days)||0)));
      const {data:existing}=await supabase.from('care_tasks').select('id').eq('patient_id',patientId).eq('source_type','care_plan').eq('source_id',recommendationId).maybeSingle();
      if(existing)return res.status(200).json({success:true,task_id:existing.id,already_exists:true});
      const {data:task,error}=await supabase.from('care_tasks').insert({patient_id:patientId,type:'follow_up',title:String(item.title||'پیگیری سلامت').slice(0,180),details:String(item.reason||'').slice(0,1500),due_at:dueAt,priority:['routine','soon','urgent'].includes(item.urgency)?item.urgency:'routine',source_type:'care_plan',source_id:recommendationId,status:'open'}).select('id,title,due_at,priority').single();if(error)throw error;
      return res.status(201).json({success:true,task});
    }
    if(action!=='generate')return res.status(400).json({success:false,error:'عملیات نامعتبر است'});
    if(!(await consent(session.sub,patientId)))return res.status(428).json({success:false,code:'AI_CONSENT_REQUIRED',error:'برای ساخت برنامه شخصی، رضایت پردازش هوش مصنوعی لازم است'});
    const client=avalaiClient();if(!client)return res.status(503).json({success:false,error:'سرویس برنامه شخصی هنوز تنظیم نشده است'});
    const [{data:user},{count:todayCount},episodes,conditions,allergies,meds,vitals,tests,screenings,vaccinations,tasks,encounters]=await Promise.all([
      supabase.from('users').select('plans(navigator_daily_limit,name)').eq('id',session.sub).single(),
      supabase.from('personalized_care_plans').select('id',{count:'exact',head:true}).eq('user_id',session.sub).gte('generated_at',dayStart()),
      supabase.from('care_episodes').select('title,kind,summary,goal,urgency,status,started_at').eq('patient_id',patientId).in('status',['open','monitoring']).order('updated_at',{ascending:false}).limit(20),
      supabase.from('patient_conditions').select('name,status,diagnosed_at,notes').eq('patient_id',patientId).eq('status','active').limit(30),
      supabase.from('patient_allergies').select('allergen,allergy_type,severity,reaction').eq('patient_id',patientId).limit(30),
      supabase.from('patient_medications').select('name,dose,frequency,route,instructions,status').eq('patient_id',patientId).eq('status','active').limit(40),
      supabase.from('patient_vitals').select('measured_at,weight_kg,systolic,diastolic,heart_rate,oxygen_saturation,temperature_c,glucose_mg_dl').eq('patient_id',patientId).order('measured_at',{ascending:false}).limit(20),
      supabase.from('test_results').select('created_at,status,status_reason,reason,structured_analysis').eq('patient_id',patientId).order('created_at',{ascending:false}).limit(12),
      supabase.from('preventive_screenings').select('screening_name,status,performed_at,next_due_at,result_summary').eq('patient_id',patientId).order('next_due_at',{ascending:true}).limit(30),
      supabase.from('patient_vaccinations').select('vaccine_name,dose_number,administered_at,next_due_at').eq('patient_id',patientId).order('next_due_at',{ascending:true}).limit(30),
      supabase.from('care_tasks').select('title,type,due_at,priority,status').eq('patient_id',patientId).eq('status','open').order('due_at',{ascending:true}).limit(30),
      supabase.from('encounters').select('occurred_at,encounter_type,chief_complaint,summary,assessment,plan,pregnancy_status').eq('patient_id',patientId).order('occurred_at',{ascending:false}).limit(8)
    ]);
    const dailyLimit=Math.max(0,Math.min(3,Number(user?.plans?.navigator_daily_limit??1)));if(Number(todayCount||0)>=dailyLimit)return res.status(429).json({success:false,error:'سقف ساخت برنامه شخصی امروز تمام شده است'});
    const record={patient,episodes:episodes.data||[],conditions:conditions.data||[],allergies:allergies.data||[],medications:meds.data||[],vitals:vitals.data||[],tests:(tests.data||[]).map(t=>({created_at:t.created_at,status:t.status,status_reason:t.status_reason,reason:t.reason,summary:t.structured_analysis?.summary||null,abnormal_items:safeArr(t.structured_analysis?.abnormal_items,20)})),screenings:screenings.data||[],vaccinations:vaccinations.data||[],tasks:tasks.data||[],encounters:encounters.data||[]};
    const system=`تو موتور برنامه مراقبت شخصی DrMan هستی. خروجی باید آموزشی، محافظه‌کارانه، عملی و بر اساس پرونده باشد؛ نه تشخیص و نه نسخه.
قواعد الزامی:
- هیچ تشخیص جدیدی قطعی اعلام نکن و هیچ داروی نسخه‌ای، شروع/قطع/تغییر دوز پیشنهاد نده.
- غذا یا فعالیت را فقط در حد راهنمای عمومی و کم‌ریسک شخصی‌سازی کن. ممنوعیت مطلق غذایی فقط برای حساسیت ثبت‌شده یا منع ایمنی واضح باشد؛ در بقیه موارد از «محدود کردن/بررسی» استفاده کن.
- فعالیت بدنی را متناسب با سن، توانایی و بیماری‌های ثبت‌شده پیشنهاد کن. اگر اطلاعات کافی نیست یا ریسک بالقوه وجود دارد، فعالیت سبک و ارزیابی حرفه‌ای را ترجیح بده؛ تمرین شدید یا تخصصی را خودکار تجویز نکن.
- گیاه دارویی و مکمل هرگز به شکل «مصرف کن» یا همراه دوز پیشنهاد نشود. فقط گزینه‌های evidence-aware برای «بررسی با پزشک/داروساز» بده. اگر داروی فعال، بارداری احتمالی/قطعی، بیماری کلیه/کبد، جراحی نزدیک، داروی رقیق‌کننده خون یا داده ناکافی وجود دارد، محافظه‌کار باش و ترجیحاً در avoid_or_review قرار بده.
- اگر تداخل را با اطمینان نمی‌دانی، عدم قطعیت را صریح بگو؛ طبیعی بودن را معادل بی‌خطر بودن فرض نکن.
- follow_up باید کار قابل انجام و موعد تقریبی داشته باشد؛ اگر موعد پزشکی مشخص نیست، محافظه‌کارانه و با عبارت «برای هماهنگی» بنویس.
- علائم هشدار فوری را کوتاه و روشن در red_flags قرار بده. در وضعیت اورژانسی توصیه کن منتظر AI یا نوبت آنلاین نماند و از خدمات اورژانسی محلی استفاده کند.
- از اطلاعاتی که در پرونده نیست چیزی اختراع نکن. کمبود اطلاعات را در data_gaps بنویس.
- پاسخ فارسی و قابل فهم باشد.`;
    const safetyIdentifier=crypto.createHash('sha256').update(`drman-care-plan:${session.sub}`).digest('hex').slice(0,32);
    const messages=[{role:'system',content:system},{role:'user',content:`زمان سیستم: ${new Date().toISOString()}\nپرونده سلامت:\n${JSON.stringify(record)}\n\nیک برنامه مراقبت شخصی کوتاه، اولویت‌بندی‌شده و قابل پیگیری بساز.`}];
    const {plan:raw,model,requestId}=await generate(client,messages,safetyIdentifier);const plan=addRecommendationIds(raw);
    await supabase.from('personalized_care_plans').update({status:'superseded'}).eq('user_id',session.sub).eq('patient_id',patientId).eq('status','active');
    const {data:saved,error}=await supabase.from('personalized_care_plans').insert({patient_id:patientId,user_id:session.sub,status:'active',plan,source_snapshot:snapshot(record),ai_model:model,ai_version:AI_VERSION,valid_until:days(14)}).select('id,patient_id,plan,ai_model,ai_version,generated_at,valid_until,status').single();if(error)throw error;
    await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:patientId,action:'ai.care_plan_generated',resource_type:'personalized_care_plan',resource_id:saved.id,metadata:{model,request_id:requestId}}).catch(()=>null);
    const articles=await relatedArticles();
    return res.status(201).json({success:true,care_plan:saved,articles,remaining_today:Math.max(0,dailyLimit-Number(todayCount||0)-1),disclaimer:'این برنامه آموزشی است و جای تشخیص، نسخه یا ارزیابی پزشک را نمی‌گیرد.'});
  }catch(error){console.error('care-plan',error);return res.status(500).json({success:false,error:'ساخت یا ذخیره برنامه مراقبت انجام نشد'})}
}
