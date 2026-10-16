// Exact-commit opt-in content review. Every profile, history and answer in this
// report is generated from fixed SYNTHETIC fixtures. Never use patient/ticket
// reads or clinical writes here. Only private provider configuration is read.
import assert from 'node:assert/strict';
import { avalaiClient, configuredModels, LAB_PRIMARY_MODEL } from '../server/api/_lib/ai-models.js';
import { overviewRecord } from '../server/api/_lib/health-overview.js';
import { wellnessAnswers, generateWellnessProgram, wellnessRequestEstimate } from '../server/api/_lib/wellness-program.js';
import { medicalEvidenceForQuestion, medicalEvidenceFallback } from '../server/api/_lib/medical-evidence.js';
import { navigatorMessages, runNavigator, renderNavigatorAnswer } from '../server/api/health-navigator.js';
import { safeErrorMetadata } from '../server/api/_lib/errors.js';

const expected=process.env.DRMAN_AI_QUALITY_PROBE||'';
const enabled=/^[a-f0-9]{40}$/.test(expected)&&expected===process.env.VERCEL_GIT_COMMIT_SHA;
const report=value=>console.log('DRMAN_AI_QUALITY '+JSON.stringify({synthetic_only:true,...value}));
function reportAnswer(value){const raw=JSON.stringify(value),size=1100,total=Math.ceil(raw.length/size);for(let index=0;index<total;index++)report({stage:'answer_chunk',kind:value.kind,index,total,text:raw.slice(index*size,(index+1)*size)});}
const measuredAt='2026-10-16T08:00:00.000Z';
export function qualityFixture(kind){
 const patient={birth_date:'1990-01-01',sex:kind==='skin'?'female':'male',height_cm:178};
 const sections={conditions:[],medications:[],allergies:kind==='nutrition'?[{allergen:'عدم تحمل لاکتوز؛ شیر و لبنیات معمولی',severity:'mild',reaction:'نفخ و دل‌پیچه'}]:[],
  vitals:[{measured_at:measuredAt,weight_kg:94,systolic:138,diastolic:86}],tests:[],encounters:[],tasks:[],visit_intakes:[{pregnancy_status:'no',status:'submitted',submitted_at:measuredAt,updated_at:measuredAt}]};
 const answers=kind==='nutrition'?wellnessAnswers('nutrition',{goal:'gradual_loss',dietary_pattern:'vegetarian',budget:'economy',cooking_time:'quick',activity_level:'low',preferences:'غذای خانگی ایرانی؛ برنج و خوراک حبوبات. وقت آشپزی طولانی ندارم و غذای گران نمی‌خواهم.',dislikes:'قارچ',meal_schedule:'شیفت شب کار می‌کنم؛ ساعت ۱۷ بیدارم، ساعت ۲۳ استراحت غذا دارم و ساعت ۸ صبح می‌خوابم.',target_weight_kg:84,medical_restrictions:'',additional_allergies:'',pregnancy_status:'unknown'}):kind==='skin'?wellnessAnswers('skin_hair',{skin_type:'oily',scalp_type:'dry',skin_sensitivity:'yes',urgent_symptoms:'none',skin_concerns:'پوست صورتم چرب و جوش‌های ریز معمولی دارد؛ علامت شدید ندارم. روتین ارزان و کم‌مرحله می‌خواهم.',hair_scalp_concerns:'پوست سر خشک است و نوک موها خشک و وز می‌شود؛ ریزش ناگهانی ندارم.',current_products:'هر شب اسکراب می‌زنم؛ بعدش کمی می‌سوزد. شوینده ساده و مرطوب‌کننده دارم ولی ضدآفتاب ندارم.',duration:'حدود سه ماه',pregnancy_status:'no'}):null;
 return {patient,sections,record:overviewRecord(patient,sections),answers};
}
export function qualityChatFixture(kind='chat'){
 const record={patient:{birth_date:'1990-01-01',sex:'male',height_cm:178},conditions:[],allergies:[],medications:[],recent_vitals:[{measured_at:measuredAt,weight_kg:94,systolic:138,diastolic:86}],recent_tests:[{created_at:measuredAt,status:'warning',summary:'نمونه ساختگی: LDL برابر ۱۶۲ و بالاتر از بازه برگه؛ قند ناشتا ۹۴ در بازه همان برگه است.',items:[{name:'LDL',value:'162',unit:'mg/dL',reference_range:'<130',flag:'high'}]}],open_tasks:[],upcoming_appointments:[],recent_encounters:[]};
 return {record,question:kind==='followup'?'عدس نفخم می‌دهد، جای آن چی بخورم؟':'چربی خونم بالاست، یعنی دیگر برنج نخورم؟ شیفت شب کار می‌کنم و پول مواد غذایی گران ندارم؛ برای امشب دو غذای دم‌دستی بگو.',history:kind==='followup'?[{question:'برای ناهار سر کار چه غذای ساده‌ای ببرم؟',answer:'برای یک نمونه معمول، عدسی و نان سبوس‌دار یا برنج همراه خوراک خانگی می‌تواند انتخاب ساده‌ای باشد؛ مقدار را با شرایط خود هماهنگ کنید.'}]:[]};
}
if(enabled){
 try{
  const kind=process.env.DRMAN_AI_QUALITY_CASE;
  assert.ok(['chat','followup','nutrition','environmental_nutrition','skin','candidate_chat'].includes(kind));
  const config=await configuredModels();assert.equal(config.provider,'groq-free');assert.equal(config.free_only,true);
  const client=await avalaiClient();assert.ok(client);const start=Date.now();
  if(kind==='nutrition'||kind==='environmental_nutrition'||kind==='skin'){
   const fixture=qualityFixture(kind==='environmental_nutrition'?'nutrition':kind),programKind=kind==='skin'?'skin_hair':'nutrition';
   if(kind==='environmental_nutrition'){fixture.sections.allergies=[{allergen:'گرده چمن',allergy_type:'environmental',severity:'moderate'}];fixture.sections.tests=[{created_at:measuredAt,status:'warning',structured_analysis:{summary:'گزارش کاملاً ساختگی بررسی حساسیت',items:[{name:'Total IgE',value:'480',unit:'IU/mL',flag:'critical'}]}}];fixture.record=overviewRecord(fixture.patient,fixture.sections);fixture.answers=wellnessAnswers('nutrition',{...fixture.answers,dietary_pattern:'balanced',dislikes:'',additional_allergies:''});}
   const estimate=wellnessRequestEstimate(programKind,fixture.record,fixture.answers);
   report({stage:'input',kind,commit:expected,profile:fixture.record.patient,questionnaire:fixture.answers,request_estimate:estimate});
   assert.ok(estimate<=7800,'Quality request must fit the Free rate allowance');
   const result=await generateWellnessProgram(client,programKind,fixture.record,fixture.answers,'synthetic-content-review');
   reportAnswer({stage:'answer',kind,model:result.model,source:result.source,guard_reasons:result.guard_reasons||[],program:result.program,elapsed_ms:Date.now()-start});
  }else{
   const fixture=qualityChatFixture(kind),pack=medicalEvidenceForQuestion(fixture.question,{history:fixture.history});
   if(kind==='candidate_chat'){
    const create=client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create=(body,options)=>create({...body,model:LAB_PRIMARY_MODEL},options);
   }
   report({stage:'input',kind,commit:expected,question:fixture.question,history:fixture.history,topic_ids:pack.topics.map(topic=>topic.id)});
   if(!pack.supported){reportAnswer({stage:'answer',kind,source:'local',...medicalEvidenceFallback(pack,{unknown:true})});}
   else{try{const result=await runNavigator(client,navigatorMessages(fixture.record,fixture.question,fixture.history,pack),'synthetic-content-review',pack);reportAnswer({stage:'answer',kind,model:result.model,source:'ai',answer:renderNavigatorAnswer(result.parsed),sources:result.sources,elapsed_ms:Date.now()-start});}catch(error){report({stage:'generation_rejected',kind,...safeErrorMetadata(error),...(typeof error?.message==='string'&&/^[A-Z][A-Z_]{3,100}$/.test(error.message)?{classification:error.message}:{})});reportAnswer({stage:'answer',kind,source:'local',...medicalEvidenceFallback(pack),elapsed_ms:Date.now()-start});}}
  }
 }catch(error){report({stage:'failed',...safeErrorMetadata(error),...(typeof error?.message==='string'&&/^[A-Z][A-Z_]{3,100}$/.test(error.message)?{classification:error.message}:{})});process.exitCode=1;}
}
