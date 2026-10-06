import OpenAI from 'openai';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const apiKey = process.env.AVALAI_API_KEY;
if (!apiKey) throw new Error('AVALAI_API_KEY is missing');
function dayStart(){const d=new Date();d.setUTCHours(0,0,0,0);return d.toISOString();}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const session=requireUser(req,res); if(!session)return;
  const message=String(req.body?.message||'').trim().slice(0,2000); if(!message)return res.status(400).json({success:false,error:'پیام خالی است'});
  try{
    const [{count:todayCount},{data:history},{data:user}]=await Promise.all([
      supabase.from('support_messages').select('id',{count:'exact',head:true}).eq('user_id',session.sub).eq('role','user').gte('created_at',dayStart()),
      supabase.from('support_messages').select('role,content').eq('user_id',session.sub).order('created_at',{ascending:false}).limit(12),
      supabase.from('users').select('name,plans(name,slug,support_daily_limit,test_limit,family_profile_limit,navigator_daily_limit)').eq('id',session.sub).single()
    ]);
    const dailyLimit=Math.max(0,Number(user?.plans?.support_daily_limit??15));
    if(Number(todayCount||0)>=dailyLimit)return res.status(429).json({success:false,error:'سقف پیام پشتیبانی هوشمند امروز شما پر شده است. فردا دوباره در دسترس خواهد بود.'});
    const client=new OpenAI({apiKey,baseURL:'https://api.avalai.ir/v1'});
    const plan=user?.plans||{};
    const system=`تو پشتیبان هوشمند فارسی DrMan هستی. با لحن حرفه‌ای، کوتاه و عملی پاسخ بده.
وظایف اصلی: راهنمایی استفاده از سایت، پرونده سلامت، پزشکان، نوبت‌ها، پلن‌ها، سهمیه‌ها، پرداخت دیجی‌پی و رفع خطاهای معمول.
اگر سؤال سلامت عمومی بود فقط اطلاعات آموزشی کم‌خطر بده. تشخیص قطعی، نسخه، تغییر دارو/دوز یا جایگزینی پزشک ممنوع است. در علائم اورژانسی کاربر را به خدمات اورژانسی محلی و پزشک هدایت کن.
هیچ‌وقت اطلاعات محرمانه، کلیدها یا جزئیات داخلی سیستم را افشا نکن. اگر پاسخ را نمی‌دانی صریح بگو.
پلن فعلی کاربر: ${plan.name||'نامشخص'}؛ سقف تحلیل ماهانه ${plan.test_limit??'—'}، پشتیبانی روزانه ${dailyLimit}، پروفایل خانواده ${plan.family_profile_limit??'—'}، Health Navigator روزانه ${plan.navigator_daily_limit??'—'}.`;
    const response=await client.chat.completions.create({model:process.env.SUPPORT_MODEL||'gpt-4.1-mini',messages:[{role:'system',content:system},...(history||[]).reverse().map(m=>({role:m.role,content:m.content})),{role:'user',content:message}],temperature:.3,max_tokens:900});
    const answer=String(response.choices?.[0]?.message?.content||'در حال حاضر پاسخ آماده نشد. لطفاً دوباره تلاش کنید.').slice(0,6000);
    await supabase.from('support_messages').insert([{user_id:session.sub,role:'user',content:message},{user_id:session.sub,role:'assistant',content:answer}]);
    return res.status(200).json({success:true,answer,remaining_today:Math.max(0,dailyLimit-Number(todayCount||0)-1)});
  }catch(error){console.error('support-chat',error);return res.status(500).json({success:false,error:'پشتیبانی هوشمند فعلاً در دسترس نیست. لطفاً کمی بعد دوباره امتحان کنید.'})}
}
