// Explicit SHA-gated release checks use synthetic in-memory data only. Each
// feature has its own flag so the release can respect Groq Free token windows.
// No patient, cache, quota, session or medical-record rows are read or written.
import assert from 'node:assert/strict';
import { avalaiClient,configuredModels,HEALTH_NAVIGATOR_MODEL } from '../server/api/_lib/ai-models.js';
import { overviewRecord } from '../server/api/_lib/health-overview.js';
import { generateWellnessProgram,wellnessAnswers,wellnessRequestEstimate } from '../server/api/_lib/wellness-program.js';
import { safeErrorMetadata } from '../server/api/_lib/errors.js';

const sha=process.env.VERCEL_GIT_COMMIT_SHA||'';
const flags={nutrition:process.env.DRMAN_WELLNESS_NUTRITION_PROBE,skin_hair:process.env.DRMAN_WELLNESS_SKIN_HAIR_PROBE};
const enabled=Object.keys(flags).filter(kind=>/^[a-f0-9]{40}$/.test(flags[kind]||'')&&flags[kind]===sha);
const report=value=>console.log('DRMAN_WELLNESS_PROBE '+JSON.stringify(value));
function providerDiagnostic(error){
 const knownCodes=new Set(['json_validate_failed','invalid_request_error','rate_limit_exceeded','context_length_exceeded','schema_validation_error','tool_use_failed']);
 const code=error?.code||error?.error?.code, message=String(error?.message||'').toLowerCase();
 const category=/failed to generate json|json validation|json_validate/.test(message)?'json_generation':/schema/.test(message)?'schema':/max_completion_tokens|maximum.*token|too many tokens|request too large/.test(message)?'token_limit':/rate.limit/.test(message)?'rate_limit':'other';
 return{category,...(knownCodes.has(code)?{provider_code:code}:{}),failed_generation_chars:typeof error?.error?.failed_generation==='string'?error.error.failed_generation.length:0};
}
export function syntheticWellnessFixture(kind){
 const measuredAt=new Date().toISOString();
 const record=overviewRecord({birth_date:'1990-01-01',sex:'male',height_cm:178},{
  conditions:[],medications:[],allergies:kind==='nutrition'?[{allergen:'بادام زمینی',severity:'severe',reaction:'کهیر'}]:[],
  vitals:[{measured_at:measuredAt,weight_kg:82,systolic:120,diastolic:80}],tests:[],encounters:[],tasks:[]
 });
 const answers=wellnessAnswers(kind,kind==='nutrition'?{goal:'maintain',dietary_pattern:'vegetarian',budget:'economy',cooking_time:'quick',activity_level:'low',preferences:'غذای خانگی ایرانی، عدسی و برنج',dislikes:'قارچ',meal_schedule:'سه وعده؛ صبحانه ساعت ۸ و ناهار ساعت ۱۳',target_weight_kg:null}:{skin_type:'dry',scalp_type:'dry',skin_sensitivity:'yes',urgent_symptoms:'none',skin_concerns:'خشکی خفیف پوست در هوای سرد، بدون زخم یا خونریزی',hair_scalp_concerns:'موها خشک هستند؛ ریزش ناگهانی ندارم',current_products:'شوینده ملایم و مرطوب‌کننده ساده',duration:'چند هفته'});
 return{record,answers};
}
if(enabled.length){
 try{
  assert.equal(enabled.length,1,'Run one wellness feature per Free rate window');
  const kind=enabled[0],models=await configuredModels();assert.equal(models.provider,'groq-free');assert.equal(models.free_only,true);assert.equal(models.navigator,HEALTH_NAVIGATOR_MODEL);
  const{record,answers}=syntheticWellnessFixture(kind);assert.ok(wellnessRequestEstimate(kind,record,answers)<=7800,'Synthetic request must fit normal Free allowance');
  const client=await avalaiClient();assert.ok(client);const create=client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create=async(body,options)=>{assert.equal(body.model,HEALTH_NAVIGATOR_MODEL);try{const response=await create(body,options);report({stage:'synthetic_response',kind,model:response.model,finish_reason:response.choices?.[0]?.finish_reason});return response;}catch(error){report({stage:'provider_diagnostic',kind,...safeErrorMetadata(error),...providerDiagnostic(error)});throw error;}};
  const started=Date.now(),result=await generateWellnessProgram(client,kind,record,answers,'drman-synthetic-wellness-test');
  assert.equal(result.source,'ai','Response must pass grounded output and clinical guards');assert.equal(result.model,HEALTH_NAVIGATOR_MODEL);assert.ok(result.program.source_ids.length>0);
  if(kind==='nutrition'){
   assert.equal(result.program.weekly_menu.length,3);assert.ok(result.program.shopping_list.length>0);assert.ok(result.program.habits.length>=2);
   const meals=result.program.weekly_menu.flatMap(row=>['breakfast','lunch','dinner','snacks'].map(field=>row[field])).join(' ');
   assert.doesNotMatch(meals.replace(/تخم[\s\u200c]*مرغ/g,''),/بادام|مرغ|گوشت|ماهی|قارچ/);
  }else for(const field of ['morning_steps','evening_steps','weekly_steps','hair_steps','avoid'])assert.ok(result.program[field].length>=1,field);
  report({stage:'complete',passed:true,kind,model:result.model,elapsed_ms:Date.now()-started,section_count:Object.keys(result.program).length,approved_source_count:result.program.source_ids.length,request_estimate:wellnessRequestEstimate(kind,record,answers)});
 }catch(error){report({stage:'failed',passed:false,...safeErrorMetadata(error)});process.exitCode=1;}
}
