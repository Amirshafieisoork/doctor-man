import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { avalaiClient, SUPPORT_MODEL, HEALTH_NAVIGATOR_MODEL } from './_lib/ai-models.js';

function dayStart(){const d=new Date();d.setUTCHours(0,0,0,0);return d.toISOString();}
async function answerWithFallback(client,messages,safetyIdentifier){const models=[SUPPORT_MODEL,HEALTH_NAVIGATOR_MODEL].filter((v,i,a)=>v&&a.indexOf(v)===i);let last;for(const model of models){try{const r=await client.chat.completions.create({model,messages,max_completion_tokens:1200,safety_identifier:safetyIdentifier});return{answer:String(r.choices?.[0]?.message?.content||'').slice(0,7000),model:r.model||model,requestId:r._request_id||null}}catch(e){last=e;console.error('support model attempt failed',model,e?.message||e)}}throw last||new Error('SUPPORT_AI_FAILED')}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const session=requireUser(req,res); if(!session)return;
  const client=await avalaiClient(); if(!client)return res.status(503).json({success:false,error:'پشتیبانی هوشمند هنوز تنظیم نشده است'});
  const message=String(req.body?.message||'').trim().slice(0,2500); if(!message)return res.status(400).json({success:false,error:'پیام خالی است'});
  try{
    const [{count:todayCount},{data:history},{data:user}]=await Promise.all([
      supabase.from('support_messages').select('id',{count:'exact',head:true}).eq('user_id',session.sub).eq('role','user').gte('created_at',dayStart()),
      supabase.from('support_messages').select('role,content').eq('user_id',session.sub).order('created_at',{ascending:false}).limit(16),
      supabase.from('users').select('name,plans(name,slug,support_daily_limit,test_limit,family_profile_limit,navigator_daily_limit)').eq('id',session.sub).single()
    ]);
    const dailyLimit=Math.max(0,Number(user?.plans?.support_daily_limit??15));
    if(Number(todayCount||0)>=dailyLimit)return res.status(429).json({success:false,error:'سقف پیام پشتیبانی هوشمند امروز شما پر شده است. فردا دوباره در دسترس خواهد بود.'});
    const plan=user?.plans||{};
    const system=`تو پشتیبان هوشمند فارسی DrMan هستی. پاسخ باید دقیق، عملی، کوتاه و قابل اجرا باشد.\n\nوظایف اصلی: راهنمایی استفاده از سایت، پرونده سلامت و خانواده، تحلیل آزمایش، پزشکان و نوبت‌ها، پلن‌ها و سهمیه‌ها، پرداخت، ورود و رفع خطاهای معمول؛ همچنین آموزش عمومی سلامت و پیشنهادهای کم‌خطر برای بهبود عادت‌های روزمره مانند خواب، تغذیه متعادل، فعالیت بدنی متناسب، آب کافی و آماده‌شدن برای مراجعه.\n- هیچ‌وقت Secret، API Key، ساختار داخلی امنیتی یا داده کاربر دیگری را افشا نکن.\n- در آموزش سلامت، بین اطلاعات عمومی و توصیه شخصی تفاوت روشن بگذار. می‌توانی اصول عمومی و کم‌خطر را توضیح بدهی، اما تشخیص، نسخه، شروع/قطع دارو، تغییر دوز یا توصیه درمان اختصاصی نده.\n- اگر سؤال به وضعیت شخصی، علائم، آزمایش یا تصمیم پزشکی فردی مربوط است، برای پاسخ مبتنی بر پرونده به Health Navigator و برای تصمیم درمانی به پزشک هدایت کن.\n- اگر موضوع اورژانسی یا دارای علائم هشدار به نظر می‌رسد، کوتاه و واضح توصیه کن منتظر چت نماند و از خدمات اورژانسی محلی یا ارزیابی فوری استفاده کند.\n- اگر قابلیت هنوز فعال نیست، واضح بگو و راه جایگزین داخل DrMan را توضیح بده.\n- اگر پاسخ را نمی‌دانی، حدس نزن.\n\nپلن فعلی: ${plan.name||'نامشخص'}؛ تحلیل ماهانه: ${plan.test_limit??'—'}؛ پشتیبانی روزانه: ${dailyLimit}؛ پروفایل خانواده: ${plan.family_profile_limit??'—'}؛ Health Navigator روزانه: ${plan.navigator_daily_limit??'—'}.`;
    const safetyIdentifier=crypto.createHash('sha256').update(`drman-support:${session.sub}`).digest('hex').slice(0,32);
    const messages=[{role:'system',content:system},...(history||[]).reverse().map(m=>({role:m.role,content:m.content})),{role:'user',content:message}];
    const {answer,model,requestId}=await answerWithFallback(client,messages,safetyIdentifier);
    await supabase.from('support_messages').insert([{user_id:session.sub,role:'user',content:message},{user_id:session.sub,role:'assistant',content:answer||'پاسخی دریافت نشد'}]);
    await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',action:'ai.support_used',resource_type:'support',metadata:{model,request_id:requestId}}).catch(()=>null);
    return res.status(200).json({success:true,answer:answer||'در حال حاضر پاسخ آماده نشد. لطفاً دوباره تلاش کنید.',model,remaining_today:Math.max(0,dailyLimit-Number(todayCount||0)-1)});
  }catch(error){console.error('support-chat',error);return res.status(500).json({success:false,error:'پشتیبانی هوشمند فعلاً در دسترس نیست. لطفاً دوباره امتحان کنید.'})}
}
