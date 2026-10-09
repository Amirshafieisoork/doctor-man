import { safeErrorMetadata } from './_lib/errors.js';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { InputValidationError, numberField } from './_lib/validate.js';

function text(v,max=1200){return v==null?'':String(v).trim().slice(0,max)}

export default async function handler(req,res){
  try{
    if(req.method==='GET'){
      const doctorId=text(req.query?.doctor_id,64);
      if(!doctorId)return res.status(400).json({success:false,error:'پزشک مشخص نشده است'});
      const {data,error}=await supabase.from('doctor_reviews')
        .select('id,rating,wait_time_rating,communication_rating,comment,verified_visit,created_at')
        .eq('doctor_id',doctorId).eq('status','published').eq('verified_visit',true)
        .order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      const rows=data||[],avg=rows.length?rows.reduce((s,x)=>s+Number(x.rating||0),0)/rows.length:null;
      return res.status(200).json({success:true,reviews:rows,rating:avg?Number(avg.toFixed(2)):null,count:rows.length});
    }

    const session=await requireUser(req,res);if(!session)return;
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const appointmentId=text(req.body?.appointment_id,64);
    if(!appointmentId)return res.status(400).json({success:false,error:'ویزیت مشخص نشده است'});

    const rating=numberField(req.body?.rating,{label:'امتیاز',min:1,max:5,integer:true,nullable:false});
    const wait=numberField(req.body?.wait_time_rating,{label:'امتیاز زمان انتظار',min:1,max:5,integer:true});
    const communication=numberField(req.body?.communication_rating,{label:'امتیاز ارتباط',min:1,max:5,integer:true});
    const comment=text(req.body?.comment,2000);

    const {data:patients}=await supabase.from('patients').select('id').eq('owner_user_id',session.sub);
    const ids=(patients||[]).map(x=>x.id);
    if(!ids.length)return res.status(403).json({success:false,error:'پرونده معتبری برای ثبت نظر ندارید'});

    const {data:appt}=await supabase.from('appointments')
      .select('id,doctor_id,patient_id,status,starts_at')
      .eq('id',appointmentId).in('patient_id',ids).maybeSingle();
    if(!appt)return res.status(404).json({success:false,error:'ویزیت پیدا نشد'});
    if(appt.status!=='completed')return res.status(409).json({success:false,error:'نظر فقط بعد از ویزیت تکمیل‌شده قابل ثبت است'});

    const {data:existing}=await supabase.from('doctor_reviews').select('id,status').eq('appointment_id',appointmentId).maybeSingle();
    if(existing)return res.status(409).json({success:false,error:'برای این ویزیت قبلاً نظر ثبت شده است'});

    const {data,error}=await supabase.from('doctor_reviews').insert({
      doctor_id:appt.doctor_id,user_id:session.sub,appointment_id:appointmentId,
      rating,wait_time_rating:wait,communication_rating:communication,
      comment:comment||null,verified_visit:true,status:'pending'
    }).select('id,status,created_at').single();
    if(error)throw error;

    await supabase.from('audit_logs').insert({
      actor_user_id:session.sub,actor_type:'user',patient_id:appt.patient_id,
      action:'doctor_review.submitted',resource_type:'doctor_review',resource_id:data.id,
      metadata:{doctor_id:appt.doctor_id,appointment_id:appointmentId,rating}
    }).catch(()=>null);

    return res.status(201).json({success:true,review:data,message:'نظر شما پس از بررسی منتشر می‌شود'});
  }catch(error){
    if(error instanceof InputValidationError)return res.status(400).json({success:false,error:error.message});
    console.error('doctor-reviews',safeErrorMetadata(error));
    return res.status(500).json({success:false,error:'ثبت یا دریافت نظر انجام نشد'});
  }
}
