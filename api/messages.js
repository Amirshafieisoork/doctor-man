import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function text(v,max=3000){return v==null?'':String(v).trim().slice(0,max)}
async function doctorForUser(userId){const {data}=await supabase.from('doctor_profiles').select('id,user_id,full_name,verification_status').eq('user_id',userId).maybeSingle();return data}
async function grant(patientId,doctorId){const {data}=await supabase.from('patient_access_grants').select('id,status,expires_at').eq('patient_id',patientId).eq('doctor_id',doctorId).eq('status','active').maybeSingle();if(!data)return null;if(data.expires_at&&new Date(data.expires_at).getTime()<Date.now())return null;return data}

export default async function handler(req,res){
  const session=requireUser(req,res); if(!session)return;
  const body=req.body&&typeof req.body==='object'?req.body:{};
  const role=String(req.query?.role||body.role||'patient');
  if(req.method==='GET'){
    const patientId=text(req.query?.patient_id,64), doctorId=text(req.query?.doctor_id,64);
    if(role==='doctor'){
      const doctor=await doctorForUser(session.sub); if(!doctor||doctor.verification_status!=='verified')return res.status(403).json({success:false,error:'حساب پزشک معتبر نیست'});
      if(!patientId||!(await grant(patientId,doctor.id)))return res.status(403).json({success:false,error:'دسترسی فعال به بیمار وجود ندارد'});
      const {data,error}=await supabase.from('patient_messages').select('id,patient_id,doctor_id,sender_type,body,created_at,read_at,patients(display_name)').eq('patient_id',patientId).eq('doctor_id',doctor.id).order('created_at',{ascending:true}).limit(300);
      if(error)return res.status(500).json({success:false,error:'دریافت پیام‌ها انجام نشد'});
      await supabase.from('patient_messages').update({read_at:new Date().toISOString()}).eq('patient_id',patientId).eq('doctor_id',doctor.id).eq('sender_type','patient').is('read_at',null);
      return res.status(200).json({success:true,messages:data||[]});
    }
    const {data:patient}=await supabase.from('patients').select('id,owner_user_id,display_name').eq('id',patientId).eq('owner_user_id',session.sub).maybeSingle();
    if(!patient)return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
    let q=supabase.from('patient_messages').select('id,patient_id,doctor_id,sender_type,body,created_at,read_at,doctor_profiles(full_name,specialty,slug)').eq('patient_id',patientId).order('created_at',{ascending:true}).limit(300);
    if(doctorId)q=q.eq('doctor_id',doctorId);
    const {data,error}=await q; if(error)return res.status(500).json({success:false,error:'دریافت پیام‌ها انجام نشد'});
    await supabase.from('patient_messages').update({read_at:new Date().toISOString()}).eq('patient_id',patientId).eq('sender_type','doctor').is('read_at',null);
    return res.status(200).json({success:true,messages:data||[]});
  }

  if(req.method==='POST'){
    const patientId=text(body.patient_id,64), message=text(body.message,3000); if(!patientId||!message)return res.status(400).json({success:false,error:'متن پیام لازم است'});
    if(role==='doctor'){
      const doctor=await doctorForUser(session.sub); if(!doctor||doctor.verification_status!=='verified'||!(await grant(patientId,doctor.id)))return res.status(403).json({success:false,error:'دسترسی فعال به بیمار وجود ندارد'});
      const {data:patient}=await supabase.from('patients').select('owner_user_id,display_name').eq('id',patientId).maybeSingle(); if(!patient)return res.status(404).json({success:false,error:'بیمار پیدا نشد'});
      const {data,error}=await supabase.from('patient_messages').insert({patient_id:patientId,doctor_id:doctor.id,sender_type:'doctor',sender_user_id:session.sub,body:message}).select('*').single();
      if(error)return res.status(500).json({success:false,error:'ارسال پیام انجام نشد'});
      await supabase.from('notifications').insert({user_id:patient.owner_user_id,patient_id:patientId,type:'doctor_message',title:`پیام جدید از ${doctor.full_name||'پزشک'}`,body:message.slice(0,180),action_url:'/health'});
      return res.status(201).json({success:true,message:data});
    }
    const doctorId=text(body.doctor_id,64); const {data:patient}=await supabase.from('patients').select('id,display_name').eq('id',patientId).eq('owner_user_id',session.sub).maybeSingle();
    if(!patient||!doctorId||!(await grant(patientId,doctorId)))return res.status(403).json({success:false,error:'ارتباط فعال با پزشک وجود ندارد'});
    const {data:doctor}=await supabase.from('doctor_profiles').select('user_id,full_name').eq('id',doctorId).maybeSingle(); if(!doctor)return res.status(404).json({success:false,error:'پزشک پیدا نشد'});
    const {data,error}=await supabase.from('patient_messages').insert({patient_id:patientId,doctor_id:doctorId,sender_type:'patient',sender_user_id:session.sub,body:message}).select('*').single();
    if(error)return res.status(500).json({success:false,error:'ارسال پیام انجام نشد'});
    if(doctor.user_id)await supabase.from('notifications').insert({user_id:doctor.user_id,patient_id:patientId,type:'patient_message',title:`پیام جدید از ${patient.display_name}`,body:message.slice(0,180),action_url:'/doctor-portal'});
    return res.status(201).json({success:true,message:data});
  }
  return res.status(405).json({error:'Method not allowed'});
}
