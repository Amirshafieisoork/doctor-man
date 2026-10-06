import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  try {
    const [usersRes, patientsRes, doctorsRes, appointmentsRes, testsRes, plansRes, paymentsRes, supportRes, orgsRes] = await Promise.all([
      supabase.from('users').select('id,name,phone,status,account_type,created_at,plan_id,plan_started_at,plan_expires_at,plans(name,slug)').order('created_at', { ascending: false }).limit(1000),
      supabase.from('patients').select('id,owner_user_id,relation,display_name,birth_date,sex,created_at').order('created_at',{ascending:false}).limit(1000),
      supabase.from('doctor_profiles').select('id,user_id,slug,full_name,medical_license_number,specialty,sub_specialty,city,phone,verification_status,public_profile,accepts_online,accepts_in_person,created_at,updated_at').order('created_at',{ascending:false}).limit(1000),
      supabase.from('appointments').select('id,patient_id,doctor_id,starts_at,mode,status,reason,created_at,doctor_profiles(full_name,specialty),patients(display_name)').order('starts_at',{ascending:false}).limit(1000),
      supabase.from('test_results').select('id,user_id,patient_id,age,gender,reason,status,created_at').order('created_at', { ascending: false }).limit(1000),
      supabase.from('plans').select('*').order('display_order', { ascending: true }),
      supabase.from('payments').select('id,user_id,plan_id,amount,status,tracking_code,created_at,paid_at,users(name,phone),plans(name,slug)').order('created_at', { ascending: false }).limit(1000),
      supabase.from('support_messages').select('id,user_id,role,content,created_at,users(name,phone)').order('created_at', { ascending: false }).limit(200),
      supabase.from('organizations').select('id,type,name,city,phone,verified,created_at').order('created_at',{ascending:false}).limit(500)
    ]);
    for (const r of [usersRes,patientsRes,doctorsRes,appointmentsRes,testsRes,plansRes,paymentsRes,supportRes,orgsRes]) if (r.error) throw r.error;
    const users=usersRes.data||[],patients=patientsRes.data||[],doctors=doctorsRes.data||[],appointments=appointmentsRes.data||[],tests=testsRes.data||[],payments=paymentsRes.data||[];
    const revenue=payments.filter(p=>p.status==='paid').reduce((sum,p)=>sum+Number(p.amount||0),0);
    return res.status(200).json({success:true,stats:{users:users.length,active_users:users.filter(u=>u.status==='active').length,patients:patients.length,doctors:doctors.length,pending_doctors:doctors.filter(d=>d.verification_status==='pending').length,appointments:appointments.length,tests:tests.length,danger_tests:tests.filter(t=>t.status==='danger').length,paid_payments:payments.filter(p=>p.status==='paid').length,revenue},users,patients,doctors,appointments,tests,plans:plansRes.data||[],payments,support:supportRes.data||[],organizations:orgsRes.data||[]});
  } catch (error) {
    console.error('admin-dashboard', error);
    return res.status(500).json({ success: false, error: 'بارگذاری اطلاعات مدیریت انجام نشد' });
  }
}
