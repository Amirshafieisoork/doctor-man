// Exact-commit opt-in release check. Fixtures are synthetic in memory. This
// performs configuration reads and two Free model calls only: no patient,
// ticket, payment, session, cache or quota record is read or written.
import assert from 'node:assert/strict';
import { avalaiClient, configuredModels, HEALTH_NAVIGATOR_MODEL } from '../server/api/_lib/ai-models.js';
import { medicalEvidenceForQuestion, medicalEvidenceFallback, validGroundedText } from '../server/api/_lib/medical-evidence.js';
import { navigatorMessages, runNavigator, renderNavigatorAnswer } from '../server/api/health-navigator.js';
import { supportEvidence, generateSupportAnswer } from '../server/api/_lib/support-evidence.js';
import { safeErrorMetadata } from '../server/api/_lib/errors.js';
const expected=process.env.DRMAN_MEDICAL_EVIDENCE_PROBE||'';
const enabled=/^[a-f0-9]{40}$/.test(expected)&&expected===process.env.VERCEL_GIT_COMMIT_SHA;
const report=value=>console.log('DRMAN_MEDICAL_EVIDENCE_PROBE '+JSON.stringify(value));
if(enabled){
 try{
  const models=await configuredModels();assert.equal(models.provider,'groq-free');assert.equal(models.free_only,true);
  const client=await avalaiClient();assert.ok(client);const calls=[];
  const original=client.chat.completions.create.bind(client.chat.completions);client.chat.completions.create=async(body,options)=>{assert.equal(body.model,HEALTH_NAVIGATOR_MODEL);calls.push(body.model);return original(body,options);};
  const question='این یک مثال ساختگی آموزشی است: پرولاکتین برگه‌ای بالاست. آیا این به تنهایی یعنی تومور؟ برای مرور نتیجه و آماده شدن چه چیزهایی را با پزشک و آزمایشگاه بررسی کنم؟ تشخیص و دوز دارو نمی‌خواهم.';
  const pack=medicalEvidenceForQuestion(question);
  const record={patient:{birth_date:'1990-01-01',sex:'female',height_cm:170},conditions:[],allergies:[],medications:[],recent_vitals:[],recent_tests:[{status:'warning',created_at:new Date().toISOString(),summary:'نمونه کاملاً ساختگی؛ پرولاکتین بیرون بازه برگه نوشته شده ولی واحد و مقدار ارائه نشده است.'}],open_tasks:[],upcoming_appointments:[],recent_encounters:[]};
  const start=Date.now(),result=await runNavigator(client,navigatorMessages(record,question,[],pack),'drman-synthetic-evidence-test',pack),text=renderNavigatorAnswer(result.parsed);
  assert.ok(result.sources.some(source=>source.url==='https://medlineplus.gov/lab-tests/prolactin-levels/'));
  assert.ok(validGroundedText(text,12000));assert.match(text,/پرولاکتین/);assert.match(text,/پزشک|آزمایشگاه/);assert.ok(result.parsed.data_limits.length);
  report({stage:'medical_navigator',passed:true,model:result.model,sources:result.sources.length,characters:text.length,elapsed_ms:Date.now()-start});
  const siteQuestion='رمز حساب را فراموش کرده‌ام. از کجا درخواست بازیابی بدهم؟ رمز یا اطلاعات شخصی نمی‌فرستم.';
  const support=await generateSupportAnswer(client,siteQuestion,'drman-synthetic-support-test');
  assert.equal(support.evidence_mode,'verified_site_help');assert.equal(support.search_performed,false);assert.ok(support.sources.every(source=>source.url.startsWith('https://drman.vercel.app/')));assert.match(support.answer,/بازیابی|فراموش/);
  const medicalLocal=supportEvidence('پرولاکتین بالا یعنی تومور؟');assert.equal(medicalLocal.kind,'medical');assert.ok(medicalLocal.local.sources.length);
  const unknown=medicalEvidenceFallback(medicalEvidenceForQuestion('درمان بیماری ساختگی زوفاپلازی چیست؟'),{unknown:true});assert.deepEqual(unknown.sources,[]);assert.equal(unknown.search_performed,false);
  assert.equal(calls.length,2);report({stage:'complete',passed:true,provider:'groq-free',free_only:true,external_calls:calls.length,site_sources:support.sources.length,medical_ticket_external_calls:0,unknown_topic_limited:true});
 }catch(error){report({stage:'failed',passed:false,...safeErrorMetadata(error)});process.exitCode=1;}
}
