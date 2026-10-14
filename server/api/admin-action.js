import { safeErrorMetadata } from './_lib/errors.js';
import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { erasePatientAccount } from './_lib/account-erasure.js';

function text(v,max=1000){return v==null?'':String(v).trim().slice(0,max)}
async function audit(action,type,id,metadata={}){try{await supabase.from('audit_logs').insert({actor_type:'admin',action,resource_type:type,resource_id:id,metadata})}catch{}}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  const action = String(req.body?.action || '');
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ success: false, error: 'شناسه الزامی است' });

  try {
    if (action === 'delete-user' || action === 'process-deletion') {
      let requestId = id;
      if (action === 'delete-user') {
        const reason = text(req.body?.reason, 500);
        if (!reason) return res.status(400).json({ success: false, error: 'دلیل حذف حساب لازم است' });
        const { data: user, error: userError } = await supabase.from('users').select('id,name,phone,account_type,status').eq('id', id).maybeSingle();
        if (userError) throw userError;
        if (!user || user.phone?.startsWith('deleted-')) return res.status(404).json({ success: false, error: 'حساب پیدا نشد یا قبلاً حذف شده است' });
        if (text(req.body?.confirm_phone, 40) !== user.phone) return res.status(400).json({ success: false, error: 'برای تأیید حذف، شماره موبایل همین حساب را دقیق وارد کنید' });
        if (user.account_type !== 'patient') return res.status(409).json({ success: false, error: 'حذف حساب پزشک یا همکار نیاز به تعیین تکلیف سوابق حرفه‌ای دارد؛ می‌توانید حساب را مسدود کنید' });
        const { data: open, error: openError } = await supabase.from('account_deletion_requests').select('id').eq('user_id', id).in('status',['requested','processing']).maybeSingle();
        if (openError) throw openError;
        if (open) requestId = open.id;
        else {
          const { data: request, error } = await supabase.from('account_deletion_requests').insert({ user_id: id, reason, admin_note: reason, status: 'requested' }).select('id').single();
          if (error) throw error;
          requestId = request.id;
        }
        await audit('account.erasure_admin_requested','user',id,{request_id:requestId,reason});
      }
      const erased = await erasePatientAccount(supabase, requestId);
      if (erased.error) return res.status(erased.status).json({ success: false, error: erased.error });
      await audit('account.erasure_processed','account_deletion_request',requestId,{user_id:erased.user_id,documents_removed:erased.documents_removed,lab_images_removed:erased.lab_images_removed});
      return res.status(200).json({ success: true, result: erased.result, can_register_again: true });
    }
    if (action === 'reject-deletion') {
      const note=text(req.body?.note||'نیازمند بررسی دستی',1000);
      const {data,error}=await supabase.from('account_deletion_requests').update({status:'rejected',admin_note:note,processed_at:new Date().toISOString()}).eq('id',id).eq('status','requested').select('id,status').maybeSingle();
      if(error)throw error;if(!data)return res.status(409).json({success:false,error:'درخواست قابل رد نیست'});
      await audit('account.erasure_rejected','account_deletion_request',id,{note});return res.status(200).json({success:true,item:data});
    }
    if (['publish-review','reject-review','hide-review'].includes(action)) {
      const status=action==='publish-review'?'published':action==='reject-review'?'rejected':'hidden';
      const {data:existing,error:lookupError}=await supabase.from('doctor_reviews')
        .select('id,verified_visit').eq('id',id).maybeSingle();
      if(lookupError)throw lookupError;if(!existing)return res.status(404).json({success:false,error:'نظر پیدا نشد'});
      if(status==='published'&&!existing.verified_visit)return res.status(409).json({success:false,error:'نظر بدون ویزیت تأییدشده قابل انتشار نیست'});
      let update=supabase.from('doctor_reviews').update({status,updated_at:new Date().toISOString()}).eq('id',id);
      if(status==='published')update=update.eq('verified_visit',true);
      const {data:review,error}=await update.select('id,doctor_id,user_id,appointment_id,rating,verified_visit,status').maybeSingle();
      if(error)throw error;if(!review)return res.status(404).json({success:false,error:'نظر پیدا نشد'});
      await audit('doctor_review.'+status,'doctor_review',id,{doctor_id:review.doctor_id,appointment_id:review.appointment_id,rating:review.rating});
      return res.status(200).json({success:true,review});
    }
    if (action === 'block-user' || action === 'unblock-user') {
      const status = action === 'block-user' ? 'blocked' : 'active';
      const { data: user, error: lookupError } = await supabase.from('users').select('id,phone').eq('id',id).maybeSingle();
      if(lookupError)throw lookupError;if(!user||user.phone?.startsWith('deleted-'))return res.status(404).json({success:false,error:'حساب پیدا نشد یا حذف شده است'});
      const { error } = await supabase.from('users').update({ status }).eq('id', id); if (error) throw error;
      await audit(`user.${status}`,'user',id); return res.status(200).json({ success: true, status });
    }
    if (action === 'set-plan') {
      const planId = String(req.body?.plan_id || ''); if (!planId) return res.status(400).json({ success: false, error: 'پلن انتخاب نشده است' });
      const reason = text(req.body?.reason||'',500); if(!reason)return res.status(400).json({success:false,error:'برای تغییر دستی پلن، دلیل لازم است'});
      const {data:user,error:userError}=await supabase.from('users').select('id,phone,plan_id,status').eq('id',id).maybeSingle();
      if(userError)throw userError;if(!user||user.phone?.startsWith('deleted-'))return res.status(404).json({success:false,error:'کاربر پیدا نشد'});
      const { data: plan, error: planError } = await supabase.from('plans').select('id,duration_days,active,name,slug,price').eq('id', planId).single();
      if (planError) throw planError;
      if (!plan) return res.status(404).json({ success: false, error: 'پلن پیدا نشد' });
      if (!plan.active) return res.status(409).json({ success: false, error: 'پلن غیرفعال را نمی‌توان به کاربر اختصاص داد' });
      const now = new Date(), expires = new Date(now.getTime() + Number(plan.duration_days || 30) * 86400000);
      const { error } = await supabase.from('users').update({ plan_id: plan.id, plan_started_at: now.toISOString(), plan_expires_at: expires.toISOString() }).eq('id', id); if (error) throw error;
      await audit('user.plan_manual_grant','user',id,{plan_id:plan.id,plan_name:plan.name,plan_slug:plan.slug,plan_price:plan.price,previous_plan_id:user.plan_id,reason}); return res.status(200).json({ success: true });
    }
    if (action === 'mark-payment-failed') {
      const { error } = await supabase.from('payments').update({ status: 'failed' }).eq('id', id).neq('status', 'paid'); if (error) throw error;
      await audit('payment.failed','payment',id); return res.status(200).json({ success: true });
    }
    if (['approve-doctor','reject-doctor','suspend-doctor','publish-doctor','hide-doctor'].includes(action)) {
      let patch={updated_at:new Date().toISOString()};
      if(action==='approve-doctor')return res.status(409).json({success:false,error:'تأیید پزشک فقط پس از بررسی تصویر مجوز و استعلام مستقل در بخش بررسی مجوز انجام می‌شود'});
      const {data:existing,error:lookupError}=await supabase.from('doctor_profiles').select('id,verification_status').eq('id',id).maybeSingle();
      if(lookupError)throw lookupError;if(!existing)return res.status(404).json({success:false,error:'پزشک پیدا نشد'});
      if(action==='publish-doctor'&&existing.verification_status!=='verified')return res.status(409).json({success:false,error:'فقط پزشک تأییدشده قابل انتشار است'});
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
      const reason=text(req.body?.reason,500);if(!reason)return res.status(400).json({success:false,error:'دلیل تغییر وضعیت نوبت لازم است'});
      const status=String(req.body?.status||''); if(!['requested','confirmed','completed','cancelled','no_show'].includes(status)) return res.status(400).json({success:false,error:'وضعیت نامعتبر است'});
      const patch={status,updated_at:new Date().toISOString()}; if(req.body?.cancellation_reason!==undefined)patch.cancellation_reason=text(req.body.cancellation_reason,1000);
      const {data,error}=await supabase.from('appointments').update(patch).eq('id',id).select('id,patient_id,doctor_id,status').single(); if(error)throw error;
      await audit(`appointment.${status}`,'appointment',id,{reason}); return res.status(200).json({success:true,appointment:data});
    }
    if (action === 'task-status') {
      const rawStatus=String(req.body?.status||''); const status=({completed:'done',cancelled:'dismissed'})[rawStatus]||rawStatus; if(!['open','done','dismissed'].includes(status))return res.status(400).json({success:false,error:'وضعیت نامعتبر است'});
      const {data,error}=await supabase.from('care_tasks').update({status,completed_at:status==='done'?new Date().toISOString():null}).eq('id',id).select('*').single(); if(error)throw error;
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
