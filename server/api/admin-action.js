import { safeErrorMetadata } from './_lib/errors.js';
import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function text(v,max=1000){return v==null?'':String(v).trim().slice(0,max)}
async function audit(action,type,id,metadata={}){try{await supabase.from('audit_logs').insert({actor_type:'admin',action,resource_type:type,resource_id:id,metadata})}catch{}}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  const action = String(req.body?.action || '');
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ success: false, error: 'شناسه الزامی است' });

  try {
    if (action === 'process-deletion') {
      const { data: request } = await supabase.from('account_deletion_requests')
        .select('id,user_id,status,users(name,phone,account_type)').eq('id',id).maybeSingle();
      if(!request) return res.status(404).json({success:false,error:'درخواست حذف پیدا نشد'});
      if(!['requested','processing'].includes(request.status)) return res.status(409).json({success:false,error:'این درخواست قابل پردازش نیست'});
      if(request.users?.account_type!=='patient') return res.status(409).json({success:false,error:'حساب حرفه‌ای باید به‌صورت دستی و حقوقی بررسی شود'});

      const { data: ps } = await supabase.from('patients').select('id').eq('owner_user_id',request.user_id);
      const patientIds=(ps||[]).map(x=>x.id);
      const [{data:docs},{data:tests}]=await Promise.all([
        patientIds.length?supabase.from('medical_documents').select('storage_path').in('patient_id',patientIds):Promise.resolve({data:[]}),
        supabase.from('test_results').select('image_paths').eq('user_id',request.user_id)
      ]);
      const docPaths=(docs||[]).map(x=>x.storage_path).filter(Boolean);
      const labPaths=(tests||[]).flatMap(x=>Array.isArray(x.image_paths)?x.image_paths:[]).filter(Boolean);
      async function removeChunks(bucket,paths){
        for(let i=0;i<paths.length;i+=100){
          const {error}=await supabase.storage.from(bucket).remove(paths.slice(i,i+100));
          if(error) throw error;
        }
      }
      await removeChunks('medical-documents',docPaths);
      await removeChunks('lab-images',labPaths);
      const {data:result,error}=await supabase.rpc('process_patient_account_erasure',{p_request_id:id});
      if(error) throw error;
      await audit('account.erasure_processed','account_deletion_request',id,{user_id:request.user_id,documents_removed:docPaths.length,lab_images_removed:labPaths.length});
      return res.status(200).json({success:true,result});
    }
    if (action === 'reject-deletion') {
      const note=text(req.body?.note||'نیازمند بررسی دستی',1000);
      const {data,error}=await supabase.from('account_deletion_requests').update({status:'rejected',admin_note:note,processed_at:new Date().toISOString()}).eq('id',id).eq('status','requested').select('id,status').maybeSingle();
      if(error)throw error;if(!data)return res.status(409).json({success:false,error:'درخواست قابل رد نیست'});
      await audit('account.erasure_rejected','account_deletion_request',id,{note});return res.status(200).json({success:true,item:data});
    }
    if (['publish-review','reject-review','hide-review'].includes(action)) {
      const status=action==='publish-review'?'published':action==='reject-review'?'rejected':'hidden';
      const {data:review,error}=await supabase.from('doctor_reviews')
        .update({status,updated_at:new Date().toISOString()})
        .eq('id',id).select('id,doctor_id,user_id,appointment_id,rating,verified_visit,status').maybeSingle();
      if(error)throw error;if(!review)return res.status(404).json({success:false,error:'نظر پیدا نشد'});
      if(status==='published'&&!review.verified_visit)return res.status(409).json({success:false,error:'نظر بدون ویزیت تأییدشده قابل انتشار نیست'});
      await audit('doctor_review.'+status,'doctor_review',id,{doctor_id:review.doctor_id,appointment_id:review.appointment_id,rating:review.rating});
      return res.status(200).json({success:true,review});
    }
    if (action === 'block-user' || action === 'unblock-user') {
      const status = action === 'block-user' ? 'blocked' : 'active';
      const { error } = await supabase.from('users').update({ status }).eq('id', id); if (error) throw error;
      await audit(`user.${status}`,'user',id); return res.status(200).json({ success: true, status });
    }
    if (action === 'set-plan') {
      const planId = String(req.body?.plan_id || ''); if (!planId) return res.status(400).json({ success: false, error: 'پلن انتخاب نشده است' });
      const reason = text(req.body?.reason||'',500); if(reason.length<5)return res.status(400).json({success:false,error:'برای تغییر دستی پلن، دلیل حداقل ۵ حرفی لازم است'});
      const { data: plan } = await supabase.from('plans').select('id,duration_days,active,name,slug,price').eq('id', planId).single();
      if (!plan) return res.status(404).json({ success: false, error: 'پلن پیدا نشد' });
      if (!plan.active) return res.status(409).json({ success: false, error: 'پلن غیرفعال را نمی‌توان به کاربر اختصاص داد' });
      const now = new Date(), expires = new Date(now.getTime() + Number(plan.duration_days || 30) * 86400000);
      const { error } = await supabase.from('users').update({ plan_id: plan.id, plan_started_at: now.toISOString(), plan_expires_at: expires.toISOString() }).eq('id', id); if (error) throw error;
      await audit('user.plan_manual_grant','user',id,{plan_id:plan.id,plan_name:plan.name,plan_slug:plan.slug,plan_price:plan.price,reason}); return res.status(200).json({ success: true });
    }
    if (action === 'mark-payment-failed') {
      const { error } = await supabase.from('payments').update({ status: 'failed' }).eq('id', id).neq('status', 'paid'); if (error) throw error;
      await audit('payment.failed','payment',id); return res.status(200).json({ success: true });
    }
    if (['approve-doctor','reject-doctor','suspend-doctor','publish-doctor','hide-doctor'].includes(action)) {
      let patch={updated_at:new Date().toISOString()};
      if(action==='approve-doctor')patch={...patch,verification_status:'verified',public_profile:true};
      if(action==='reject-doctor')patch={...patch,verification_status:'rejected',public_profile:false};
      if(action==='suspend-doctor')patch={...patch,verification_status:'suspended',public_profile:false};
      if(action==='publish-doctor')patch.public_profile=true;
      if(action==='hide-doctor')patch.public_profile=false;
      const { data: doctor, error } = await supabase.from('doctor_profiles').update(patch).eq('id', id).select('id,user_id,full_name,specialty,verification_status,public_profile').single();
      if (error || !doctor) throw error || new Error('DOCTOR_NOT_FOUND');
      if (doctor.user_id && doctor.verification_status==='verified') await supabase.from('users').update({ account_type: 'doctor' }).eq('id', doctor.user_id);
      await audit(`doctor.${action}`,'doctor_profile',id,{doctor_name:doctor.full_name}); return res.status(200).json({ success: true, doctor });
    }
    if (action === 'verify-org' || action === 'unverify-org') {
      const verified=action==='verify-org'; const {data,error}=await supabase.from('organizations').update({verified}).eq('id',id).select('*').single(); if(error)throw error;
      await audit(`organization.${verified?'verified':'unverified'}`,'organization',id,{name:data.name}); return res.status(200).json({success:true,organization:data});
    }
    if (action === 'appointment-status') {
      const status=String(req.body?.status||''); if(!['requested','confirmed','completed','cancelled','no_show'].includes(status)) return res.status(400).json({success:false,error:'وضعیت نامعتبر است'});
      const patch={status,updated_at:new Date().toISOString()}; if(req.body?.cancellation_reason!==undefined)patch.cancellation_reason=text(req.body.cancellation_reason,1000);
      const {data,error}=await supabase.from('appointments').update(patch).eq('id',id).select('id,patient_id,doctor_id,status').single(); if(error)throw error;
      await audit(`appointment.${status}`,'appointment',id); return res.status(200).json({success:true,appointment:data});
    }
    if (action === 'task-status') {
      const status=String(req.body?.status||''); if(!['open','completed','cancelled'].includes(status))return res.status(400).json({success:false,error:'وضعیت نامعتبر است'});
      const {data,error}=await supabase.from('care_tasks').update({status,completed_at:status==='completed'?new Date().toISOString():null}).eq('id',id).select('*').single(); if(error)throw error;
      await audit(`care_task.${status}`,'care_task',id); return res.status(200).json({success:true,item:data});
    }
    if (action === 'order-status') {
      const status=String(req.body?.status||''); if(!['ordered','scheduled','in_progress','completed','cancelled'].includes(status))return res.status(400).json({success:false,error:'وضعیت نامعتبر است'});
      const {data,error}=await supabase.from('diagnostic_orders').update({status,completed_at:status==='completed'?new Date().toISOString():null}).eq('id',id).select('*').single(); if(error)throw error;
      await audit(`diagnostic_order.${status}`,'diagnostic_order',id); return res.status(200).json({success:true,item:data});
    }
    if (action === 'article-status') {
      const status=String(req.body?.status||''); if(!['draft','in_review','published','archived'].includes(status))return res.status(400).json({success:false,error:'وضعیت نامعتبر است'});
      if(status==='published'){
        const {data:a}=await supabase.from('medical_articles').select('id,title,risk_level,review_level,reviewer_doctor_id,doctor_profiles(verification_status)').eq('id',id).maybeSingle();
        if(!a)return res.status(404).json({success:false,error:'مقاله پیدا نشد'});
        const verified=a.doctor_profiles?.verification_status==='verified';
        if(a.review_level==='medical'&&!verified)return res.status(409).json({success:false,error:'مقاله با بازبینی پزشکی فقط پس از انتخاب پزشک تأییدشده قابل انتشار است'});
        if(a.risk_level!=='low'&&!verified)return res.status(409).json({success:false,error:'محتوای متوسط یا پرریسک بدون بازبینی پزشک تأییدشده قابل انتشار نیست'});
      }
      const now=new Date().toISOString();
      const patch={status,published_at:status==='published'?now:null,updated_at:now};
      if(status==='published')patch.reviewed_at=now;
      const {data,error}=await supabase.from('medical_articles').update(patch).eq('id',id).select('id,title,status,published_at,risk_level,review_level').single(); if(error)throw error;
      await audit(`article.${status}`,'medical_article',id,{title:data.title,risk_level:data.risk_level,review_level:data.review_level}); return res.status(200).json({success:true,item:data});
    }
    return res.status(400).json({ success: false, error: 'عملیات پشتیبانی نمی‌شود' });
  } catch (error) {
    console.error('admin-action', safeErrorMetadata(error)); return res.status(500).json({ success: false, error: 'عملیات مدیریت انجام نشد' });
  }
}
