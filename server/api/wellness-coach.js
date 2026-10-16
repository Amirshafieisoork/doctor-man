import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { readEntitlement, planLimit } from './_lib/entitlements.js';
import { avalaiClient } from './_lib/ai-models.js';
import { wellnessCoach } from './_lib/wellness-program.js';
import { InputValidationError } from './_lib/validate.js';
import { safeErrorMetadata } from './_lib/errors.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({success:false,error:'این روش درخواست پشتیبانی نمی‌شود.'});
  }
  const session=await requireUser(req,res);if(!session)return;
  const input=req.method==='GET'?req.query:req.body;
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.patient_id!=='string'||!input.patient_id.trim()||input.patient_id.length>100||typeof input.kind!=='string')return res.status(400).json({success:false,error:'پرونده و نوع برنامه را انتخاب کنید.'});
  try {
    const silent={status(){return this;},json(){return this;},getHeader(){},setHeader(){}};
    const result=await wellnessCoach({database:supabase,userId:session.sub,patientId:input.patient_id.trim(),kind:input.kind,method:req.method,answers:input.answers,sessionVersion:session.ver??0,
      getClient:()=>avalaiClient(),getDailyLimit:async()=>planLimit((await readEntitlement(supabase,session.sub)).plan,'navigator_daily_limit'),
      verifySession:async()=>Boolean(await requireUser(req,silent))});
    if(!(await requireUser(req,res)))return;
    return res.status(result.status).json(result.body);
  }catch(error){
    if(error instanceof InputValidationError)return res.status(400).json({success:false,error:error.message});
    console.error('wellness-coach',safeErrorMetadata(error));
    return res.status(503).json({success:false,error:'برنامه فعلاً آماده نشد؛ اطلاعات پرونده حفظ شده و می‌توانید دوباره تلاش کنید.'});
  }
}
