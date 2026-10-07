import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function plusDays(n){return new Date(Date.now()+n*86400000)}
async function insertOnce(row){if(!row.dedupe_key)return;const {error}=await supabase.from('notifications').insert(row);if(error&&error.code!=='23505')console.error('notification sync',error)}
async function syncReminders(userId){
  const {data:patients}=await supabase.from('patients').select('id').eq('owner_user_id',userId);const ids=(patients||[]).map(x=>x.id);if(!ids.length)return;
  const now=new Date(),today=now.toISOString().slice(0,10);
  const [tasks,appts,vaccines,screens]=await Promise.all([
    supabase.from('care_tasks').select('id,patient_id,title,details,due_at,priority').in('patient_id',ids).eq('status','open').not('due_at','is',null).lte('due_at',plusDays(7).toISOString()).order('due_at',{ascending:true}).limit(100),
    supabase.from('appointments').select('id,patient_id,starts_at,mode,doctor_profiles(full_name)').in('patient_id',ids).in('status',['requested','confirmed']).gte('starts_at',now.toISOString()).lte('starts_at',plusDays(2).toISOString()).limit(50),
    supabase.from('patient_vaccinations').select('id,patient_id,vaccine_name,next_due_at').in('patient_id',ids).not('next_due_at','is',null).lte('next_due_at',plusDays(14).toISOString().slice(0,10)).gte('next_due_at',today).limit(100),
    supabase.from('preventive_screenings').select('id,patient_id,screening_name,next_due_at,status').in('patient_id',ids).not('next_due_at','is',null).neq('status','not_applicable').lte('next_due_at',plusDays(30).toISOString().slice(0,10)).gte('next_due_at',today).limit(100)
  ]);
  for(const x of tasks.data||[])await insertOnce({user_id:userId,patient_id:x.patient_id,type:'care_task_reminder',title:x.priority==='urgent'?'پیگیری مهم سلامت':'یادآوری پیگیری',body:x.title+(x.due_at?' · موعد '+new Date(x.due_at).toLocaleDateString('fa-IR'):''),action_url:'/health',dedupe_key:'task:'+x.id,source_type:'care_task',source_id:x.id});
  for(const x of appts.data||[])await insertOnce({user_id:userId,patient_id:x.patient_id,type:'appointment_reminder',title:'یادآوری نوبت',body:(x.doctor_profiles?.full_name||'پزشک')+' · '+new Date(x.starts_at).toLocaleString('fa-IR'),action_url:'/health',dedupe_key:'appointment:'+x.id,source_type:'appointment',source_id:x.id});
  for(const x of vaccines.data||[])await insertOnce({user_id:userId,patient_id:x.patient_id,type:'vaccine_reminder',title:'یادآوری واکسن',body:x.vaccine_name+' · موعد '+new Date(x.next_due_at+'T00:00:00Z').toLocaleDateString('fa-IR'),action_url:'/health',dedupe_key:'vaccine:'+x.id,source_type:'vaccination',source_id:x.id});
  for(const x of screens.data||[])await insertOnce({user_id:userId,patient_id:x.patient_id,type:'screening_reminder',title:'یادآوری غربالگری',body:x.screening_name+' · موعد '+new Date(x.next_due_at+'T00:00:00Z').toLocaleDateString('fa-IR'),action_url:'/health',dedupe_key:'screening:'+x.id,source_type:'screening',source_id:x.id});
}

export default async function handler(req,res){
  const session=requireUser(req,res); if(!session)return;
  if(req.method==='GET'){
    await syncReminders(session.sub).catch(e=>console.error('sync reminders',e));
    const {data,error}=await supabase.from('notifications').select('id,patient_id,type,title,body,action_url,read_at,scheduled_for,sent_at,created_at').eq('user_id',session.sub).or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`).order('created_at',{ascending:false}).limit(100);
    if(error)return res.status(500).json({success:false,error:'دریافت اعلان‌ها انجام نشد'});
    return res.status(200).json({success:true,notifications:data||[],unread:(data||[]).filter(x=>!x.read_at).length});
  }
  if(req.method==='PATCH'){
    const id=String(req.body?.id||''); const all=req.body?.all===true; const readAt=new Date().toISOString();
    let q=supabase.from('notifications').update({read_at:readAt}).eq('user_id',session.sub).is('read_at',null); if(!all)q=q.eq('id',id);
    const {error}=await q; if(error)return res.status(500).json({success:false,error:'بروزرسانی اعلان انجام نشد'});
    return res.status(200).json({success:true});
  }
  return res.status(405).json({error:'Method not allowed'});
}
