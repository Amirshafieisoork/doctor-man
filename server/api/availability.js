import { safeErrorMetadata } from './_lib/errors.js';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { validateSchedule, zonedDate, localDate } from './_lib/availability.js';
import { dateField, InputValidationError } from './_lib/validate.js';

function text(v,max=200){return v==null?'':String(v).trim().slice(0,max)}
function dayIndex(dateStr){return new Date(`${dateStr}T12:00:00Z`).getUTCDay()}
function addDay(dateStr){const d=new Date(`${dateStr}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
function mins(t){const [h,m]=String(t).slice(0,5).split(':').map(Number);return h*60+m}function hhmm(n){return`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
async function slotsForDate(doctor,schedule,date){
  const tz=doctor.timezone||'Asia/Tehran',weekday=dayIndex(date,tz),rows=(schedule||[]).filter(x=>Number(x.weekday)===weekday);
  const dayStart=zonedDate(date,'00:00',tz).toISOString(),dayEnd=zonedDate(addDay(date),'00:00',tz).toISOString();
  const {data:appointments,error}=await supabase.from('appointments').select('starts_at,ends_at,status').eq('doctor_id',doctor.id).gte('starts_at',dayStart).lt('starts_at',dayEnd).neq('status','cancelled');
  if(error)throw error;
  const slots=[];
  for(const r of rows){const start=mins(r.start_time),end=mins(r.end_time),step=Math.max(10,Math.min(180,Number(r.slot_minutes)||30));for(let n=start;n+step<=end;n+=step){const local=hhmm(n),s=zonedDate(date,local,tz),e=new Date(s.getTime()+step*60000),busy=(appointments||[]).some(a=>{const as=new Date(a.starts_at),ae=a.ends_at?new Date(a.ends_at):new Date(as.getTime()+step*60000);return s<ae&&e>as});if(!busy&&s.getTime()>Date.now()+5*60000)slots.push({starts_at:s.toISOString(),ends_at:e.toISOString(),local_time:local,mode:r.mode,organization_id:r.organization_id,slot_minutes:step})}}
  return [...new Map(slots.sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).map(s=>[s.starts_at+'|'+s.mode,s])).values()];
}
export async function nextAvailable(doctor,schedule,days=14){
  const today=localDate(new Date(),doctor.timezone||'Asia/Tehran');let date=today;
  for(let i=0;i<days;i++){const slots=await slotsForDate(doctor,schedule,date);if(slots.length)return {...slots[0],date};date=addDay(date)}
  return null;
}

async function doctorForUser(userId){const {data}=await supabase.from('doctor_profiles').select('id,slug,full_name,specialty,city,timezone,verification_status,public_profile').eq('user_id',userId).maybeSingle();return data}

export default async function handler(req,res){
 try{
  if(req.method==='GET'){
    if(String(req.query?.mine||'')==='1'){
      const session=await requireUser(req,res);if(!session)return;const doctor=await doctorForUser(session.sub);if(!doctor)return res.status(403).json({success:false,error:'پروفایل پزشک پیدا نشد'});
      const {data,error}=await supabase.from('doctor_availability').select('*').eq('doctor_id',doctor.id).order('weekday').order('start_time');if(error)return res.status(500).json({success:false,error:'برنامه دریافت نشد'});return res.status(200).json({success:true,doctor,schedule:data||[]});
    }
    const doctorId=text(req.query?.doctor_id,64),slug=text(req.query?.slug,120),date=text(req.query?.date,10);if(!doctorId&&!slug)return res.status(400).json({success:false,error:'پزشک مشخص نشده است'});
    let q=supabase.from('doctor_profiles').select('id,slug,full_name,specialty,city,timezone,verification_status,public_profile').eq('verification_status','verified').eq('public_profile',true);q=doctorId?q.eq('id',doctorId):q.eq('slug',slug);
    const {data:doctor}=await q.maybeSingle();if(!doctor)return res.status(404).json({success:false,error:'پزشک پیدا نشد'});
    const {data:schedule,error}=await supabase.from('doctor_availability').select('*').eq('doctor_id',doctor.id).eq('active',true).order('weekday').order('start_time');if(error)return res.status(500).json({success:false,error:'برنامه پزشک دریافت نشد'});
    if(!date){const next_available=await nextAvailable(doctor,schedule||[],14);return res.status(200).json({success:true,doctor,schedule:schedule||[],next_available});}
    dateField(date);
    const slots=await slotsForDate(doctor,schedule||[],date);
    return res.status(200).json({success:true,doctor,date,slots});
  }
  const session=await requireUser(req,res);if(!session)return;const doctor=await doctorForUser(session.sub);if(!doctor)return res.status(403).json({success:false,error:'حساب پزشک پیدا نشد'});const body=req.body&&typeof req.body==='object'?req.body:{};
  if(req.method==='POST'){
    const schedule=validateSchedule(body);
    const {data,error}=await supabase.from('doctor_availability').insert({doctor_id:doctor.id,organization_id:body.organization_id||null,...schedule}).select('*').single();
    if(error)throw error;return res.status(201).json({success:true,item:data});
  }
  if(req.method==='PATCH'){
    const id=text(body.id,64);if(!id)return res.status(400).json({success:false,error:'شناسه لازم است'});
    const {data:existing,error:lookupError}=await supabase.from('doctor_availability').select('*').eq('id',id).eq('doctor_id',doctor.id).maybeSingle();
    if(lookupError)throw lookupError;if(!existing)return res.status(404).json({success:false,error:'برنامه پیدا نشد'});
    const schedule=validateSchedule({...existing,...body});
    const {data,error}=await supabase.from('doctor_availability').update(schedule).eq('id',id).eq('doctor_id',doctor.id).select('*').maybeSingle();
    if(error)throw error;if(!data)return res.status(404).json({success:false,error:'برنامه پیدا نشد'});
    return res.status(200).json({success:true,item:data});
  }
  if(req.method==='DELETE'){const id=text(body.id,64);const {error}=await supabase.from('doctor_availability').delete().eq('id',id).eq('doctor_id',doctor.id);if(error)return res.status(500).json({success:false,error:'حذف انجام نشد'});return res.status(200).json({success:true})}
  return res.status(405).json({error:'Method not allowed'});
 }catch(error){
  if(error instanceof InputValidationError)return res.status(400).json({success:false,error:error.message});
  console.error('availability',safeErrorMetadata(error));return res.status(503).json({success:false,error:'دریافت یا ذخیره برنامه پزشک انجام نشد'});
 }
}
