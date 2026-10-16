import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://wellness-handler-tests.invalid';
process.env.SUPABASE_SECRET_KEY='synthetic-only-database-key';
process.env.SESSION_SECRET='synthetic-only-wellness-handler-session-secret';
const{default:handler}=await import('../server/api/wellness-coach.js');
const{supabase}=await import('../server/api/_lib/db.js');
const{createToken}=await import('../server/api/_lib/session.js');
const owner='synthetic-owner',patientId='synthetic-patient';
const answers={goal:'maintain',dietary_pattern:'balanced',budget:'economy',cooking_time:'quick',activity_level:'low'};
function response(){return{statusCode:200,headers:{},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},setHeader(name,value){this.headers[name]=value;},getHeader(name){return this.headers[name];}};}
function request(method='GET',body={},query={patient_id:patientId,kind:'nutrition'},authenticated=true){return{method,body,query,headers:authenticated?{cookie:'drman_session='+createToken({sub:owner,role:'user',ver:2})}:{}};}
function services(t,options={}){
 const state={consent:true,sessionVersion:2,owned:true,calls:[],...options},original=supabase.from;t.after(()=>supabase.from=original);
 supabase.from=table=>{const operations=[],q={};for(const name of ['select','eq','order','limit'])q[name]=(...args)=>{operations.push([name,...args]);return q;};
 const finish=async()=>{state.calls.push({table,operations});if(table==='users')return{data:{id:owner,status:'active',session_version:state.sessionVersion}};
  if(table==='patients')return{data:state.owned?{id:patientId,birth_date:'1990-01-01',height_cm:170,sex:'male'}:null};
  if(table==='consent_records')return{data:{granted:state.consent}};
  if(table==='patient_wellness_programs'){if(state.error)throw new Error('synthetic secret must not be sent to browser');if(state.revokeAfterCache)state.sessionVersion++;return{data:null};}
  return{data:[]};};q.maybeSingle=finish;q.then=(yes,no)=>finish().then(yes,no);return q;};return state;
}
test('wellness handler rejects anonymous requests before any medical reads',async t=>{const state=services(t),res=response();await handler(request('GET',{},undefined,false),res);assert.equal(res.statusCode,401);assert.equal(state.calls.length,0);assert.equal(res.headers['Cache-Control'],'private, no-store');});
test('wellness handler exposes only GET and POST',async()=>{const res=response();await handler(request('DELETE'),res);assert.equal(res.statusCode,405);assert.equal(res.headers.Allow,'GET, POST');});
test('wellness handler validates file/array/missing profile input rather than coercing it',async t=>{services(t);for(const body of [null,[],{}, {patient_id:[],kind:'nutrition'},{patient_id:patientId,kind:[]}]){const res=response();await handler(request('POST',body),res);assert.equal(res.statusCode,400);}});
test('wellness handler first GET uses a live owner session and returns the questionnaire DTO',async t=>{const state=services(t),res=response();await handler(request(),res);assert.equal(res.statusCode,200);assert.equal(res.body.state,'not_started');assert.equal(res.body.kind,'nutrition');assert.match(res.body.disclaimer,/آموزشی/);assert.ok(state.calls.filter(call=>call.table==='patients').every(call=>call.operations.some(op=>op[0]==='eq'&&op[1]==='owner_user_id'&&op[2]===owner)));assert.ok(state.calls.filter(call=>call.table==='users').length>=2);});
test('wellness handler hides foreign patient rows before loading any private questionnaire',async t=>{const state=services(t,{owned:false}),res=response();await handler(request(),res);assert.equal(res.statusCode,404);assert.equal(state.calls.some(call=>call.table==='patient_wellness_programs'),false);});
test('wellness handler returns useful consent-free local program without entitlement or provider configuration',async t=>{const state=services(t,{consent:false}),res=response();await handler(request('POST',{patient_id:patientId,kind:'nutrition',answers}),res);assert.equal(res.statusCode,200);assert.equal(res.body.source,'local');assert.equal(res.body.state,'consent_not_granted');assert.equal(res.body.program.weekly_menu.length,3);assert.equal(state.calls.some(call=>['app_settings','subscription_plans','user_subscriptions','audit_logs'].includes(call.table)),false);});
test('wellness handler converts validation failures into plain Persian 400 responses',async t=>{services(t);const res=response();await handler(request('POST',{patient_id:patientId,kind:'nutrition',answers:{...answers,goal:'starvation'}}),res);assert.equal(res.statusCode,400);assert.equal(res.body.success,false);assert.match(res.body.error,/پرسشنامه/);});
test('wellness handler fails closed after live session revocation during a record read',async t=>{services(t,{revokeAfterCache:true});const res=response();await handler(request(),res);assert.equal(res.statusCode,401);assert.equal(res.body.code,'SESSION_REVOKED');assert.equal(res.body.program,undefined);assert.equal(res.body.questionnaire,undefined);});
test('wellness handler does not expose raw database/provider failure text',async t=>{services(t,{error:true});const res=response();await handler(request(),res);assert.equal(res.statusCode,503);assert.doesNotMatch(JSON.stringify(res.body),/synthetic secret/);});
