import { requireUser } from './_lib/session.js';
import { diagnosticOrderWithPreparation } from './_lib/lab-preparation.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { archiveFilesFromRows, ARCHIVE_PAGE_SIZE } from './_lib/medical-archive.js';
async function getOwnedPatient(userId,patientId){let q=supabase.from('patients').select('*').eq('owner_user_id',userId);q=patientId?q.eq('id',patientId):q.eq('relation','self');const {data}=await q.maybeSingle();return data}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});const session=await requireUser(req,res);if(!session)return;
  const patient=await getOwnedPatient(session.sub,String(req.query?.patient_id||''));if(!patient)return res.status(404).json({success:false,error:'پرونده سلامت پیدا نشد'});const pid=patient.id;
  const [conditions,allergies,medications,vaccinations,vitals,tasks,documents,appointments,encounters,insurances,tests,access,procedures,familyHistory,screenings,prescriptions,orders,reports,messages,intakes]=await Promise.all([
    supabase.from('patient_conditions').select('*').eq('patient_id',pid).order('created_at',{ascending:false}),
    supabase.from('patient_allergies').select('*').eq('patient_id',pid).order('created_at',{ascending:false}),
    supabase.from('patient_medications').select('*,doctor_profiles(full_name,specialty)').eq('patient_id',pid).order('created_at',{ascending:false}),
    supabase.from('patient_vaccinations').select('*').eq('patient_id',pid).order('administered_at',{ascending:false}),
    supabase.from('patient_vitals').select('*').eq('patient_id',pid).order('measured_at',{ascending:false}).limit(100),
    supabase.from('care_tasks').select('*,doctor_profiles(full_name,specialty)').eq('patient_id',pid).order('due_at',{ascending:true,nullsFirst:false}).limit(100),
    supabase.from('medical_documents').select('id,patient_id,document_type,title,storage_path,mime_type,original_filename,size_bytes,document_date,ai_summary,created_at,organizations(name,type)').eq('patient_id',pid).order('created_at',{ascending:false}).limit(100),
    supabase.from('appointments').select('id,starts_at,ends_at,mode,status,reason,doctor_note,meeting_url,doctor_profiles(id,full_name,specialty,slug,avatar_url),organizations(name,city)').eq('patient_id',pid).order('starts_at',{ascending:false}).limit(100),
    supabase.from('encounters').select('id,occurred_at,encounter_type,chief_complaint,summary,assessment,plan,pregnancy_status,doctor_profiles(full_name,specialty),organizations(name)').eq('patient_id',pid).order('occurred_at',{ascending:false}).limit(100),
    supabase.from('patient_insurances').select('*').eq('patient_id',pid).order('is_primary',{ascending:false}),
    supabase.from('test_results').select('id,user_id,patient_id,image_paths,age,gender,reason,analysis,status,created_at').eq('patient_id',pid).order('created_at',{ascending:false}).limit(100),
    supabase.from('patient_access_grants').select('id,scope,status,expires_at,created_at,doctor_profiles(id,full_name,specialty,slug)').eq('patient_id',pid).order('created_at',{ascending:false}),
    supabase.from('patient_procedures').select('*,doctor_profiles(full_name,specialty),organizations(name)').eq('patient_id',pid).order('performed_at',{ascending:false}),
    supabase.from('patient_family_history').select('*').eq('patient_id',pid).order('created_at',{ascending:false}),
    supabase.from('preventive_screenings').select('*,doctor_profiles(full_name,specialty)').eq('patient_id',pid).order('next_due_at',{ascending:true,nullsFirst:false}),
    supabase.from('prescriptions').select('id,issued_at,notes,status,doctor_profiles(full_name,specialty),prescription_items(*)').eq('patient_id',pid).order('issued_at',{ascending:false}).limit(100),
    supabase.from('diagnostic_orders').select('id,order_type,items,clinical_note,priority,status,ordered_at,completed_at,doctor_profiles(full_name,specialty),organizations(name,type)').eq('patient_id',pid).order('ordered_at',{ascending:false}).limit(100),
    supabase.from('diagnostic_reports').select('id,order_id,report_type,title,structured_data,report_text,reported_at,verified_by,organizations(name,type)').eq('patient_id',pid).order('reported_at',{ascending:false}).limit(100),
    supabase.from('patient_messages').select('id,doctor_id,sender_type,body,created_at,read_at,doctor_profiles(full_name,specialty,slug)').eq('patient_id',pid).order('created_at',{ascending:false}).limit(100),
    // Pregnancy reported before a completed visit must also qualify BMI advice.
    // Include a small recent history so an unanswered newer form cannot erase
    // a known pregnancy. No clinical notes from an intake are needed here.
    supabase.from('visit_intakes').select('pregnancy_status,status,submitted_at,created_at,updated_at').eq('patient_id',pid).in('pregnancy_status',['yes','possible','no','not_applicable']).order('updated_at',{ascending:false}).limit(10)
  ]);
  const bad=[conditions,allergies,medications,vaccinations,vitals,tasks,documents,appointments,encounters,insurances,tests,access,procedures,familyHistory,screenings,prescriptions,orders,reports,messages,intakes].find(x=>x.error);if(bad?.error){console.error('health-record query',safeErrorMetadata(bad.error));return res.status(500).json({success:false,error:'دریافت بخشی از پرونده سلامت انجام نشد'})}
  const archive=archiveFilesFromRows(documents.data||[],tests.data||[],[patient]);
  const publicDocuments=(documents.data||[]).map(({storage_path,...row})=>row);
  const publicTests=(tests.data||[]).map(({image_paths,user_id,...row})=>({...row,image_count:archiveFilesFromRows([],[{...row,image_paths,user_id}],[patient]).length}));
  if(!(await requireUser(req,res)))return;
  await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:pid,action:'record.viewed',resource_type:'patient',resource_id:pid});
  return res.status(200).json({success:true,patient,record:{conditions:conditions.data||[],allergies:allergies.data||[],medications:medications.data||[],vaccinations:vaccinations.data||[],vitals:vitals.data||[],tasks:tasks.data||[],documents:publicDocuments,archive_files:archive.slice(0,ARCHIVE_PAGE_SIZE),archive_next_offset:archive.length>ARCHIVE_PAGE_SIZE?ARCHIVE_PAGE_SIZE:null,appointments:appointments.data||[],encounters:encounters.data||[],visit_intakes:intakes.data||[],insurances:insurances.data||[],tests:publicTests,doctor_access:access.data||[],procedures:procedures.data||[],family_history:familyHistory.data||[],screenings:screenings.data||[],prescriptions:prescriptions.data||[],diagnostic_orders:(orders.data||[]).map(diagnosticOrderWithPreparation),diagnostic_reports:reports.data||[],messages:messages.data||[]}})
}
