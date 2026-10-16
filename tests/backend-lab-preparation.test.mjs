import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticOrderWithPreparation, labPreparationForOrder, normalizeLabTestName } from '../server/api/_lib/lab-preparation.js';

const order = (items, other = {}) => ({ id:'synthetic-order', patient_id:'synthetic-patient', order_type:'lab', status:'ordered', items, ...other });
const keys = items => labPreparationForOrder(order(items)).tests.map(test => test.key);

test('exact English and Persian aliases match reviewed tests without substring guesses', () => {
  for (const value of ['PRL', 'Prolactin', 'prolactin (PRL)', 'پرولاکتین (PRL)', 'آزمایش پرولاکتین', 'تست پرولاکتین', 'پرولاكتين']) assert.deepEqual(keys([value]), ['prolactin'], value);
  for (const value of ['PRL receptor', 'پرولاکتینوما', 'پزشک گفت احتمال پرولاکتین بالا هست', 'macroprolactin', 'پانل هورمونی']) assert.deepEqual(keys([value]), [], value);
  assert.equal(normalizeLabTestName(null), '');
});
test('combined orders split complete names, deduplicate tests and retain unknown items', () => {
  const result = labPreparationForOrder(order(['CBC, FBS، PRL', 'prolactin', 'TSH/HbA1c', 'آزمایش ناشناخته', 'کورتیزول + TG']));
  assert.deepEqual(result.tests.map(test => test.key), ['cbc','fasting_glucose','prolactin','tsh','hba1c','lipids']);
  assert.deepEqual(result.unrecognized_items, ['آزمایش ناشناخته','کورتیزول']);
  assert.equal(result.has_specific_guidance, true);
});
test('fasting glucose is distinct from random glucose and HbA1c', () => {
  assert.deepEqual(keys(['FBS']), ['fasting_glucose']);
  assert.deepEqual(keys(['RBS', 'قند خون']), ['glucose']);
  const a1c = labPreparationForOrder(order(['HbA1c']));
  assert.match(a1c.tests[0].steps.join(' '), /به ناشتایی نیاز ندارد/);
  assert.match(labPreparationForOrder(order(['RBS'])).tests[0].steps.join(' '), /خودسرانه ناشتا نمانید/);
});
test('prolactin guidance explains variable timing, rest, exercise, medicines and laboratory authority', () => {
  const result = labPreparationForOrder(order(['PRL'])), text = result.tests[0].steps.join(' ');
  for (const phrase of ['بیدار','آرامش','ورزش شدید','استرس','بیوتین','خودسرانه قطع نکنید','پزشک تعیین می‌کند']) assert.ok(text.includes(phrase), phrase);
  assert.match(result.general.join(' '), /دستور اختصاصی پزشک.*مقدم است/);
  assert.doesNotMatch(text, /حتماً.*ناشتا|۲۴ ساعت|۴۸ ساعت/);
});
test('only pending actual lab orders receive preparation, not imaging, completed or cancelled orders', () => {
  for (const extra of [{order_type:'imaging'}, {order_type:'pathology'}, {status:'completed'}, {status:'cancelled'}, {status:'canceled'}, {completed_at:'2026-10-16T10:00:00Z'}]) assert.equal(labPreparationForOrder(order(['PRL'], extra)), null);
  assert.equal(labPreparationForOrder(order([])), null);
  assert.equal(labPreparationForOrder({order_type:'lab',items:[{name:'PRL'}]}), null);
  assert.equal(labPreparationForOrder(null), null);
});
test('unknown tests are labelled as unknown, with no invented preparation', () => {
  const result = labPreparationForOrder(order(['OGTT', 'ادرار ۲۴ ساعته', 'MRI']));
  assert.equal(result.has_specific_guidance, false);
  assert.deepEqual(result.tests, []);
  assert.deepEqual(result.unrecognized_items, ['OGTT','ادرار ۲۴ ساعته','MRI']);
  assert.match(result.general.join(' '), /ناشتایی یا محدودیت نوشیدن آب.*لازم نیست/);
});
test('guidance carries fixed reviewed version and direct HTTPS medical source links', () => {
  const result = labPreparationForOrder(order(['PRL','FBS','RBS','HbA1c','TG','CBC','TSH','UA']));
  assert.equal(result.version, 'lab-preparation-v1'); assert.equal(result.reviewed_at, '2026-10-16');
  assert.equal(result.tests.length, 8);
  for (const source of [...result.general_sources, ...result.tests.flatMap(test=>test.sources)]) {
    const url = new URL(source.url); assert.equal(url.protocol,'https:');
    assert.ok(['medlineplus.gov','www.gloshospitals.nhs.uk'].includes(url.hostname));
  }
});
test('guidance does not mutate the order or share mutable returned library arrays', () => {
  const original=order(['PRL']), before=structuredClone(original), enriched=diagnosticOrderWithPreparation(original);
  enriched.preparation.tests[0].steps.length=0;
  enriched.preparation.tests[0].sources[0].label='mutated';
  assert.deepEqual(original,before);assert.ok(labPreparationForOrder(original).tests[0].steps.length>0);
  assert.notEqual(labPreparationForOrder(original).tests[0].sources[0].label,'mutated');
});

process.env.SUPABASE_URL='https://lab-preparation-tests.invalid';
process.env.SUPABASE_SECRET_KEY='test-only-lab-preparation-key';
process.env.SESSION_SECRET='test-only-lab-preparation-session-secret';
const {supabase}=await import('../server/api/_lib/db.js');
const {createToken}=await import('../server/api/_lib/session.js');
const {default:healthRecord}=await import('../server/api/health-record.js');
const {default:doctorRecord}=await import('../server/api/doctor-patient-record.js');
const {default:clinical}=await import('../server/api/clinical-workspace.js');
function response(){return{statusCode:200,headers:{},status(code){this.statusCode=code;return this},json(body){this.body=body;return this},setHeader(key,value){this.headers[key]=value},getHeader(key){return this.headers[key]}}}
function services(t,{scope=['clinical_history'],denied=false,foreign=false}={}) {
  const from=supabase.from,calls=[];t.after(()=>{supabase.from=from});
  supabase.from=table=>{const operations=[],q={};for(const name of ['select','eq','in','order','limit','insert'])q[name]=(...args)=>{operations.push([name,...args]);return q};
    const finish=async single=>{calls.push({table,operations});
      if(table==='users')return{data:{id:'synthetic-owner',status:'active',session_version:0}};
      if(table==='patients')return{data:foreign?null:{id:'synthetic-patient',owner_user_id:'synthetic-owner',relation:'self'}};
      if(table==='doctor_profiles')return{data:{id:'synthetic-doctor',verification_status:'verified'}};
      if(table==='patient_access_grants')return{data:single?(denied?null:{id:'grant',scope,status:'active'}):[]};
      if(table==='diagnostic_orders'){const insert=operations.find(op=>op[0]==='insert');return{data:insert?{id:'new-order',...insert[1]}:[order(['PRL','CBC'])]}};
      return{data:single?null:[]};
    };q.maybeSingle=()=>finish(true);q.single=()=>finish(true);q.then=(resolve,reject)=>finish(false).then(resolve,reject);return q};return calls;
}
const request=(body={},query={})=>({method:Object.keys(body).length?'POST':'GET',body,query,headers:{cookie:'drman_session='+createToken({sub:'synthetic-owner',role:'user',ver:0})}});
test('owner health-record attaches preparation only after its owner-scoped patient query', async t=>{
 const calls=services(t),res=response();await healthRecord(request({}, {patient_id:'synthetic-patient'}),res);
 assert.equal(res.statusCode,200);assert.deepEqual(res.body.record.diagnostic_orders[0].preparation.tests.map(test=>test.key),['prolactin','cbc']);
 assert.ok(calls.find(call=>call.table==='patients').operations.some(op=>op[0]==='eq'&&op[1]==='owner_user_id'&&op[2]==='synthetic-owner'));
 assert.ok(calls.find(call=>call.table==='diagnostic_orders').operations.some(op=>op[0]==='eq'&&op[1]==='patient_id'&&op[2]==='synthetic-patient'));
});
test('unowned patients do not expose orders or preparation', async t=>{
 const calls=services(t,{foreign:true}),res=response();await healthRecord(request({}, {patient_id:'foreign'}),res);assert.equal(res.statusCode,404);assert.equal(calls.some(call=>call.table==='diagnostic_orders'),false);
});
test('a doctor receives preparation under clinical-history access only', async t=>{
 const calls=services(t),res=response();await doctorRecord(request({}, {patient_id:'synthetic-patient'}),res);assert.equal(res.statusCode,200);assert.ok(res.body.record.diagnostic_orders[0].preparation);
 assert.ok(calls.find(call=>call.table==='patient_access_grants').operations.some(op=>op[0]==='eq'&&op[1]==='doctor_id'&&op[2]==='synthetic-doctor'));
});
test('lab-only doctor access does not silently expand to physician orders', async t=>{
 const calls=services(t,{scope:['labs']}),res=response();await doctorRecord(request({}, {patient_id:'synthetic-patient'}),res);assert.equal(res.statusCode,200);assert.equal(Object.hasOwn(res.body.record,'diagnostic_orders'),false);assert.equal(calls.some(call=>call.table==='diagnostic_orders'),false);
});
test('new doctor orders return the same guidance immediately, without storing generated guidance', async t=>{
 const calls=services(t,{scope:['clinical_write']}),res=response();await clinical(request({patient_id:'synthetic-patient',action:'diagnostic_order',order_type:'lab',items:['PRL']}),res);
 assert.equal(res.statusCode,201);assert.equal(res.body.item.preparation.tests[0].key,'prolactin');
 const inserted=calls.find(call=>call.table==='diagnostic_orders').operations.find(op=>op[0]==='insert')[1];assert.equal(Object.hasOwn(inserted,'preparation'),false);assert.deepEqual(inserted.items,['PRL']);
 const notification=calls.find(call=>call.table==='notifications').operations.find(op=>op[0]==='insert')[1];assert.match(notification.body,/راهنمای آمادگی.*تاریخچه پزشکی/);
});
test('revoked doctor access blocks order creation and its preparation response', async t=>{
 const calls=services(t,{denied:true}),res=response();await clinical(request({patient_id:'synthetic-patient',action:'diagnostic_order',items:['PRL']}),res);assert.equal(res.statusCode,403);assert.equal(calls.some(call=>call.table==='diagnostic_orders'),false);
});
