import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function hash(t){return crypto.createHash('sha256').update(t).digest('hex')}
async function owned(userId,patientId){const {data}=await supabase.from('patients').select('id').eq('id',patientId).eq('owner_user_id',userId).maybeSingle();return !!data;}

export default async function handler(req,res){
 const session=await requireUser(req,res);if(!session)return;
 if(req.method==='GET'){
  const patientId=String(req.query?.patient_id||'');if(!(await owned(session.sub,patientId)))return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
  const {data}=await supabase.from('emergency_cards').select('id,enabled,show_blood_type,show_allergies,show_conditions,show_medications,show_emergency_contact,updated_at').eq('patient_id',patientId).maybeSingle();
  return res.status(200).json({success:true,card:data||null});
 }
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const b=req.body||{},patientId=String(b.patient_id||'');if(!(await owned(session.sub,patientId)))return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
 const enabled=b.enabled===true;let token=null,tokenHash=null;if(enabled){token=crypto.randomBytes(24).toString('base64url');tokenHash=hash(token)}
 const payload={patient_id:patientId,enabled,show_blood_type:b.show_blood_type!==false,show_allergies:b.show_allergies!==false,show_conditions:b.show_conditions!==false,show_medications:b.show_medications!==false,show_emergency_contact:b.show_emergency_contact!==false,token_hash:tokenHash,updated_at:new Date().toISOString()};
 const {data,error}=await supabase.from('emergency_cards').upsert(payload,{onConflict:'patient_id'}).select('id,enabled,show_blood_type,show_allergies,show_conditions,show_medications,show_emergency_contact,updated_at').single();if(error)return res.status(500).json({success:false,error:'تنظیم کارت اضطراری انجام نشد'});
 await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:patientId,action:enabled?'emergency_card.enabled':'emergency_card.disabled',resource_type:'emergency_card',resource_id:data.id});
 return res.status(200).json({success:true,card:data,url:token?`/emergency/${token}`:null,notice:token?'این لینک فقط همین بار نمایش داده می‌شود؛ برای لینک جدید کارت را دوباره فعال کنید.':null});
}
