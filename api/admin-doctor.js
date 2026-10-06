import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const text=(v,max=500)=>v==null?'':String(v).trim().slice(0,max);
const bool=v=>v===true||v==='true'||v===1||v==='1';
const slug=v=>{const s=text(v,100).toLowerCase();return /^[a-z0-9-]{2,100}$/.test(s)?s:null};

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='PUT')return res.status(405).json({error:'Method not allowed'});
  try{
    const b=req.body||{},id=text(b.id,64); if(!id)return res.status(400).json({success:false,error:'شناسه پزشک لازم است'});
    const {data:current}=await supabase.from('doctor_profiles').select('id,verification_status').eq('id',id).maybeSingle(); if(!current)return res.status(404).json({success:false,error:'پزشک پیدا نشد'});
    const patch={updated_at:new Date().toISOString()};
    if(b.full_name!==undefined)patch.full_name=text(b.full_name,180);
    if(b.slug!==undefined){const s=slug(b.slug);if(!s)return res.status(400).json({success:false,error:'slug معتبر نیست'});patch.slug=s;}
    if(b.medical_license_number!==undefined)patch.medical_license_number=text(b.medical_license_number,120);
    if(b.specialty!==undefined)patch.specialty=text(b.specialty,160);
    if(b.sub_specialty!==undefined)patch.sub_specialty=text(b.sub_specialty,160)||null;
    if(b.city!==undefined)patch.city=text(b.city,120)||null;
    if(b.phone!==undefined)patch.phone=text(b.phone,40)||null;
    if(b.bio!==undefined)patch.bio=text(b.bio,3000)||null;
    if(b.consultation_fee!==undefined)patch.consultation_fee=Math.max(0,Math.min(100000000,Math.round(Number(b.consultation_fee)||0)));
    if(b.accepts_online!==undefined)patch.accepts_online=bool(b.accepts_online);
    if(b.accepts_in_person!==undefined)patch.accepts_in_person=bool(b.accepts_in_person);
    if(b.public_profile!==undefined)patch.public_profile=current.verification_status==='verified'?bool(b.public_profile):false;
    const {data,error}=await supabase.from('doctor_profiles').update(patch).eq('id',id).select('*').single(); if(error)throw error;
    await supabase.from('audit_logs').insert({actor_type:'admin',action:'doctor.profile_updated',resource_type:'doctor_profile',resource_id:id,metadata:{doctor_name:data.full_name}});
    return res.status(200).json({success:true,doctor:data});
  }catch(error){console.error('admin-doctor',error);if(error?.code==='23505')return res.status(409).json({success:false,error:'slug یا شماره نظام پزشکی تکراری است'});return res.status(500).json({success:false,error:'ویرایش پزشک انجام نشد'})}
}
