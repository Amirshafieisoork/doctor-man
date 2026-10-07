import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

async function rows(query){const {data,error}=await query;if(error)throw error;return data||[]}
export default async function handler(req,res){
  const session=requireUser(req,res);if(!session)return;if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{
    const {data:user,error}=await supabase.from('users').select('id,name,phone,status,account_type,created_at,plan_started_at,plan_expires_at,plans(name,slug)').eq('id',session.sub).single();if(error||!user)return res.status(404).json({success:false,error:'حساب پیدا نشد'});
    const patients=await rows(supabase.from('patients').select('id,relation,display_name,birth_date,sex,blood_type,height_cm,emergency_contact_name,emergency_contact_phone,notes,created_at,updated_at').eq('owner_user_id',session.sub).order('created_at'));
    const ids=patients.map(x=>x.id);
    const byPatient=async(table,select='*',order='created_at')=>ids.length?rows(supabase.from(table).select(select).in('patient_id',ids).order(order,{ascending:false})):[];

    const [conditions,allergies,medications,vaccinations,vitals,procedures,familyHistory,screenings,tasks,documents,tests,appointments,encounters,prescriptions,orders,reports,episodes,carePlans,consents,payments]=await Promise.all([
      byPatient('patient_conditions'),byPatient('patient_allergies'),byPatient('patient_medications'),byPatient('patient_vaccinations'),
      byPatient('patient_vitals','*','measured_at'),byPatient('patient_procedures'),byPatient('patient_family_history'),byPatient('preventive_screenings'),
      byPatient('care_tasks'),byPatient('medical_documents','id,patient_id,document_type,title,mime_type,document_date,ai_summary,created_at'),
      rows(supabase.from('test_results').select('id,patient_id,age,gender,reason,analysis,status,status_reason,structured_analysis,ai_model,ai_version,ai_confidence,created_at').eq('user_id',session.sub).order('created_at',{ascending:false})),
      byPatient('appointments'),byPatient('encounters'),byPatient('prescriptions','id,patient_id,doctor_id,encounter_id,issued_at,signed_at,clinical_basis,notes,status,prescription_items(*)','issued_at'),
      byPatient('diagnostic_orders'),byPatient('diagnostic_reports'),byPatient('care_episodes'),rows(supabase.from('personalized_care_plans').select('id,patient_id,status,plan,source_snapshot,ai_model,ai_version,generated_at,valid_until').eq('user_id',session.sub).order('generated_at',{ascending:false})),
      rows(supabase.from('consent_records').select('patient_id,consent_type,granted,version,granted_at').eq('user_id',session.sub).order('granted_at',{ascending:false})),
      rows(supabase.from('payments').select('id,amount,provider,status,tracking_code,created_at,paid_at,plans(name,slug)').eq('user_id',session.sub).order('created_at',{ascending:false}))
    ]);
    const payload={exported_at:new Date().toISOString(),format_version:'drman-export-v1',account:user,patients,data:{conditions,allergies,medications,vaccinations,vitals,procedures,family_history:familyHistory,screenings,tasks,documents,tests,appointments,encounters,prescriptions,diagnostic_orders:orders,diagnostic_reports:reports,health_topics:episodes,personalized_care_plans:carePlans,consents,payments}};
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="drman-health-export-${new Date().toISOString().slice(0,10)}.json"`);
    await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',action:'account.data_exported',resource_type:'user',resource_id:session.sub}).catch(()=>null);
    return res.status(200).send(JSON.stringify(payload,null,2));
  }catch(error){console.error('account-export',error);return res.status(500).json({success:false,error:'آماده‌سازی خروجی اطلاعات انجام نشد'})}
}
