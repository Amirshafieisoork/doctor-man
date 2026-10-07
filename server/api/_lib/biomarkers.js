const ALIASES=new Map(Object.entries({
  hba1c:'hba1c',a1c:'hba1c',glycatedhemoglobin:'hba1c',hemoglobina1c:'hba1c',
  tsh:'tsh',thyroidstimulatinghormone:'tsh',
  t4:'t4',freet4:'free-t4',ft4:'free-t4',t3:'t3',freet3:'free-t3',ft3:'free-t3',
  fbs:'fasting-glucose',fastingbloodsugar:'fasting-glucose',fastingglucose:'fasting-glucose',
  glucose:'glucose',bloodglucose:'glucose',
  hemoglobin:'hemoglobin',hgb:'hemoglobin',hb:'hemoglobin',
  wbc:'wbc',whitebloodcell:'wbc',whitebloodcells:'wbc',
  rbc:'rbc',redbloodcell:'rbc',redbloodcells:'rbc',
  plt:'platelets',platelet:'platelets',platelets:'platelets',
  ldl:'ldl',ldlcholesterol:'ldl',hdl:'hdl',hdlcholesterol:'hdl',
  triglyceride:'triglycerides',triglycerides:'triglycerides',tg:'triglycerides',
  cholesterol:'total-cholesterol',totalcholesterol:'total-cholesterol',
  creatinine:'creatinine',cr:'creatinine',bun:'bun',urea:'urea',
  alt:'alt',sgpt:'alt',ast:'ast',sgot:'ast',alp:'alp',
  ferritin:'ferritin',iron:'iron',tibc:'tibc',
  vitamind:'vitamin-d',vitamind3:'vitamin-d','25ohvitamind':'vitamin-d',
  b12:'vitamin-b12',vitaminb12:'vitamin-b12',
  crp:'crp',esr:'esr',uricacid:'uric-acid'
}));
export function biomarkerKey(name){
  const compact=String(name||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'');
  if(!compact)return null;return ALIASES.get(compact)||compact.slice(0,80);
}
export function numericLabValue(value){
  const s=String(value??'').replace(/,/g,'').trim();
  if(!s||/[a-z]{3,}/i.test(s)&&!/e[+-]?\d+/i.test(s))return null;
  const m=s.match(/[-+]?\d+(?:\.\d+)?/);if(!m)return null;const n=Number(m[0]);return Number.isFinite(n)?n:null;
}
export async function saveBiomarkers(supabase,{testResultId,patientId,userId,items,confidence,observedAt}){
  if(!testResultId||!userId||!Array.isArray(items)||!items.length)return;
  const rows=items.slice(0,120).map(item=>{const key=biomarkerKey(item?.name);if(!key)return null;return{
    test_result_id:testResultId,patient_id:patientId||null,user_id:userId,name_raw:String(item.name||'').slice(0,180),name_key:key,
    value_text:String(item.value??'').slice(0,120),value_numeric:numericLabValue(item.value),unit:String(item.unit||'').slice(0,80)||null,
    reference_range:String(item.reference_range||'').slice(0,180)||null,flag:['normal','low','high','critical','unknown'].includes(item.flag)?item.flag:'unknown',
    observed_at:observedAt||new Date().toISOString(),confidence:Number.isFinite(Number(confidence))?Math.max(0,Math.min(1,Number(confidence))):null
  }}).filter(Boolean);
  if(!rows.length)return;const {error}=await supabase.from('lab_biomarkers').upsert(rows,{onConflict:'test_result_id,name_key,name_raw'});if(error)throw error;
}
