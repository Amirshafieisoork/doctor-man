import { safeErrorMetadata } from './_lib/errors.js';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { InputValidationError, numberField, birthDateField } from './_lib/validate.js';
import { readEntitlement, planLimit } from './_lib/entitlements.js';

const RELATIONS=new Set(['self','child','parent','spouse','sibling','other']);
const SEX=new Set(['female','male','other','unknown']);
const BLOOD=new Set(['A+','A-','B+','B-','AB+','AB-','O+','O-','unknown']);
function clean(body={},partial=false,forcedRelation=null){
  const out={updated_at:new Date().toISOString()};
  if(forcedRelation!==null)out.relation=forcedRelation;
  else if(!partial||body.relation!==undefined)out.relation=RELATIONS.has(body.relation)?body.relation:'other';
  if(!partial||body.display_name!==undefined)out.display_name=String(body.display_name||'').trim().slice(0,120);
  if(!partial||body.birth_date!==undefined)out.birth_date=birthDateField(body.birth_date);
  if(!partial||body.sex!==undefined)out.sex=body.sex&&SEX.has(body.sex)?body.sex:null;
  if(!partial||body.blood_type!==undefined)out.blood_type=body.blood_type&&BLOOD.has(body.blood_type)?body.blood_type:null;
  if(!partial||body.height_cm!==undefined)out.height_cm=numberField(body.height_cm,{label:'قد',min:20,max:260});
  if(!partial||body.national_code!==undefined)out.national_code=body.national_code?String(body.national_code).replace(/\D/g,'').slice(0,10):null;
  if(!partial||body.emergency_contact_name!==undefined)out.emergency_contact_name=body.emergency_contact_name?String(body.emergency_contact_name).trim().slice(0,120):null;
  if(!partial||body.emergency_contact_phone!==undefined)out.emergency_contact_phone=body.emergency_contact_phone?String(body.emergency_contact_phone).trim().slice(0,30):null;
  if(!partial||body.notes!==undefined)out.notes=body.notes?String(body.notes).trim().slice(0,2000):null;
  return out;
}
async function ownedPatient(userId,id){const {data}=await supabase.from('patients').select('id,relation').eq('id',id).eq('owner_user_id',userId).maybeSingle();return data;}
export default async function handler(req,res){
  const session=await requireUser(req,res);if(!session)return;
  try{
    if(req.method==='GET'){const {data,error}=await supabase.from('patients').select('id,relation,display_name,birth_date,sex,blood_type,height_cm,emergency_contact_name,emergency_contact_phone,created_at,updated_at').eq('owner_user_id',session.sub).order('created_at',{ascending:true});if(error)throw error;return res.status(200).json({success:true,patients:data||[]})}
    if(req.method==='POST'){
      const input=clean(req.body||{},false);if(!input.display_name)return res.status(400).json({success:false,error:'نام پرونده الزامی است'});if(input.relation==='self')return res.status(400).json({success:false,error:'پرونده اصلی از قبل برای حساب ساخته شده است'});
      const [usage,{plan}]=await Promise.all([supabase.from('patients').select('id',{count:'exact',head:true}).eq('owner_user_id',session.sub),readEntitlement(supabase,session.sub)]);
      if(usage.error)throw usage.error;
      const limit=planLimit(plan,'family_profile_limit');if(Number(usage.count||0)>=limit)return res.status(403).json({success:false,code:'PLAN_LIMIT',error:`سقف پروفایل خانواده پلن شما ${limit.toLocaleString('fa-IR')} پرونده است. برای افزودن عضو بیشتر پلن را ارتقا دهید.`});
      const {data,error}=await supabase.from('patients').insert({...input,owner_user_id:session.sub}).select('id,relation,display_name,birth_date,sex,blood_type,height_cm').single();if(error)throw error;
      await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:data.id,action:'patient.created',resource_type:'patient',resource_id:data.id}).catch(()=>null);return res.status(201).json({success:true,patient:data});
    }
    if(req.method==='PATCH'){
      const id=String(req.body?.id||''),patient=await ownedPatient(session.sub,id);if(!patient)return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
      const input=clean(req.body||{},true,patient.relation);if(input.display_name!==undefined&&!input.display_name)return res.status(400).json({success:false,error:'نام پرونده الزامی است'});
      const {data,error}=await supabase.from('patients').update(input).eq('id',id).eq('owner_user_id',session.sub).select('id,relation,display_name,birth_date,sex,blood_type,height_cm,emergency_contact_name,emergency_contact_phone').single();if(error)throw error;
      await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:id,action:'patient.updated',resource_type:'patient',resource_id:id}).catch(()=>null);return res.status(200).json({success:true,patient:data});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){if(error instanceof InputValidationError)return res.status(400).json({success:false,error:error.message});console.error('patients',safeErrorMetadata(error));return res.status(500).json({success:false,error:'مدیریت پرونده انجام نشد'})}
}
