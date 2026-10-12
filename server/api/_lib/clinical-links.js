import { InputValidationError } from './validate.js';

// Foreign keys prove existence only. Explicitly bind referenced encounters to
// the same doctor and patient before writing clinical records with service access.
export async function encounterLinks(database,{patientId,doctorId,userId,doctorOrganizationId,appointmentId,intakeId,organizationId}){
  const out={appointment_id:appointmentId||null,intake_id:intakeId||null,organization_id:organizationId||null};
  if(out.intake_id){
    const {data,error}=await database.from('visit_intakes').select('id,appointment_id')
      .eq('id',out.intake_id).eq('patient_id',patientId).eq('doctor_id',doctorId).maybeSingle();
    if(error)throw error;
    if(!data||(out.appointment_id&&data.appointment_id!==out.appointment_id))throw new InputValidationError('شرح حال به این بیمار و نوبت متعلق نیست');
    out.appointment_id=out.appointment_id||data.appointment_id;
  }
  if(out.appointment_id){
    const {data,error}=await database.from('appointments').select('id,organization_id,status')
      .eq('id',out.appointment_id).eq('patient_id',patientId).eq('doctor_id',doctorId).maybeSingle();
    if(error)throw error;
    if(!data||['cancelled','no_show'].includes(data.status))throw new InputValidationError('نوبت به این بیمار و پزشک متعلق نیست یا لغو شده است');
    if(out.organization_id&&out.organization_id!==data.organization_id)throw new InputValidationError('مرکز درمانی باید با نوبت مطابقت داشته باشد');
    out.organization_id=out.organization_id||data.organization_id||null;
  }
  if(out.organization_id&&out.organization_id!==doctorOrganizationId){
    const {data,error}=await database.from('organization_members').select('id')
      .eq('organization_id',out.organization_id).eq('user_id',userId).eq('doctor_id',doctorId).eq('status','active').maybeSingle();
    if(error)throw error;
    if(!data)throw new InputValidationError('دسترسی پزشک به مرکز درمانی معتبر نیست');
  }
  return out;
}
