import { InputValidationError } from './validate.js';

const UNINSURED = /^(?:none|uninsured|بدون\s*بیمه|بیمه\s*ندارم|ندارم|فاقد\s*بیمه)$/i;
export function normalizeNationalCode(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new InputValidationError('کد ملی را با ۱۰ رقم وارد کنید');
  const code = value.trim().replace(/[۰-۹]/g, c => String(c.charCodeAt(0)-1776))
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0)-1632)).replace(/[\s-]/g, '');
  if (!code) return null;
  if (!validNationalCode(code)) throw new InputValidationError('کد ملی معتبر نیست؛ ۱۰ رقم روی کارت ملی را بررسی کنید');
  return code;
}
export function validNationalCode(code) {
  if (typeof code !== 'string' || !/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)
    || /^(?:0123456789|1234567891|9876543210)$/.test(code) || /^000/.test(code) || /^\d{3}0{6}\d$/.test(code)) return false;
  const sum = [...code.slice(0,9)].reduce((total,digit,index) => total + Number(digit)*(10-index),0), remainder = sum%11;
  return Number(code[9]) === (remainder < 2 ? remainder : 11-remainder);
}
function iranDate(now) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const part = key => parts.find(item=>item.type===key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function activeBaseInsurance(insurance, now = Date.now()) {
  const today = iranDate(now), name = String(insurance?.provider_name || '').trim();
  return Boolean(insurance && (insurance.coverage_type || 'base') === 'base' && name && !UNINSURED.test(name)
    && (!insurance.valid_from || insurance.valid_from <= today) && (!insurance.valid_until || insurance.valid_until >= today));
}
export function prescriptionRegistration(patient, insurances, now = Date.now()) {
  let valid = false;
  try { valid = Boolean(normalizeNationalCode(patient?.national_code)); } catch { /* Existing incomplete records remain readable. */ }
  const today=iranDate(now),rows=insurances||[],insured=rows.some(row=>activeBaseInsurance(row,now));
  const uninsured=rows.some(row=>row.coverage_type==='none'&&(!row.valid_from||row.valid_from<=today)&&(!row.valid_until||row.valid_until>=today));
  const conflict=insured&&uninsured,missing=[];
  if (!valid) missing.push('کد ملی معتبر');
  if(conflict)missing.push('رفع تناقض وضعیت بیمه: بیمه پایه و «بدون بیمه» هم‌زمان ثبت شده‌اند');
  else if (!insured) missing.push('بیمه پایه با اعتبار فعلی');
  return { national_code_valid:valid, base_insurance_ready:insured&&!conflict, insurance_conflict:conflict, prescription_ready:valid&&insured&&!conflict, missing };
}
export async function readPrescriptionRegistration(database, patientId) {
  const [patientResult, insuranceResult] = await Promise.all([
    database.from('patients').select('id,national_code').eq('id',patientId).maybeSingle(),
    database.from('patient_insurances').select('id,provider_name,coverage_type,valid_from,valid_until').eq('patient_id',patientId)
  ]);
  if (patientResult.error) throw patientResult.error;
  if (insuranceResult.error) throw insuranceResult.error;
  return prescriptionRegistration(patientResult.data,insuranceResult.data);
}
