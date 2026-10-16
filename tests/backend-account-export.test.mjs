import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL='https://account-export-tests.invalid';
process.env.SUPABASE_SECRET_KEY='synthetic-only-export-database-key';
process.env.SESSION_SECRET='synthetic-only-export-session-secret-at-least-32';
const {supabase}=await import('../server/api/_lib/db.js');
const {createToken}=await import('../server/api/_lib/session.js');
const {default:exportAccount}=await import('../server/api/account-export.js');
const userId='synthetic-export-owner',otherUser='synthetic-other-owner';
const patientId='synthetic-owned-patient',familyId='synthetic-owned-family',foreignId='synthetic-foreign-patient';
const overviewFields=['patient_id','overview','generated_at','ai_model','ai_version'];
const wellnessFields=['patient_id','kind','questionnaire','program','source','generated_at','ai_model','program_version'];

function response(){return{statusCode:200,headers:{},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},setHeader(key,value){this.headers[key]=value;},getHeader(key){return this.headers[key];}};}
function request(signed=true){return{method:'GET',query:{user_id:otherUser,patient_id:foreignId},headers:signed?{cookie:'drman_session='+createToken({sub:userId,role:'user',ver:0})}:{}};}
function database(t,{noPatients=false,revoke=false,failedTable=null}={}){
  const original=supabase.from,calls=[];let version=0;
  t.after(()=>{supabase.from=original;});
  const records={
    patients:noPatients?[]:[{id:patientId,owner_user_id:userId,national_code:'1234567806'},{id:familyId,owner_user_id:userId,national_code:null},{id:foreignId,owner_user_id:otherUser,national_code:'foreign-private-code'}],
    patient_insurances:[{id:'base',patient_id:patientId,coverage_type:'base',provider_name:'بیمه ساختگی پایه'},{id:'supplementary',patient_id:patientId,coverage_type:'supplementary',provider_name:'بیمه ساختگی تکمیلی'},{id:'family',patient_id:familyId,coverage_type:'none'},{id:'foreign',patient_id:foreignId,coverage_type:'supplementary',policy_number:'foreign-private-policy'}],
    patient_wellness_programs:[
      {patient_id:patientId,user_id:userId,kind:'nutrition',questionnaire:{preferences:'غذای خانگی'},program:{title:'برنامه ساختگی'},source:'local',generated_at:'2026-10-16T12:00:00Z',ai_model:null,program_version:'wellness-v1',claim_token:'private-lease-token',daily_attempts:1},
      {patient_id:foreignId,user_id:otherUser,kind:'skin_hair',program:{title:'foreign-private-program'}}
    ],
    patient_health_overviews:[
      {patient_id:patientId,user_id:userId,overview:{overall:'جمع‌بندی ساختگی آزمون'},generated_at:'2026-10-15T12:00:00Z',ai_model:'openai/gpt-oss-120b',ai_version:'health-overview-v1',claim_token:'private-lease-token',record_fingerprint:'private-fingerprint',lease_until:'2026-10-15T12:01:00Z',daily_attempts:1},
      {patient_id:foreignId,user_id:otherUser,overview:{overall:'foreign-private-overview'}}
    ]
  };
  supabase.from=table=>{
    const operations=[],q={};
    for(const method of ['select','eq','in','order','insert'])q[method]=(...args)=>{operations.push([method,...args]);return q;};
    async function finish(single=false){
      calls.push({table,operations});
      if(table===failedTable)return{data:null,error:{code:'SYNTHETIC_DATABASE_FAILURE'}};
      if(table==='users')return{data:{id:userId,name:'حساب ساختگی',status:'active',session_version:version}};
      let data=structuredClone(records[table]||[]);
      for(const [method,key,value]of operations){if(method==='eq')data=data.filter(row=>row[key]===value);if(method==='in')data=data.filter(row=>value.includes(row[key]));}
      const select=operations.find(([method])=>method==='select')?.[1];
      if(select&&select!=='*')data=data.map(row=>Object.fromEntries(select.split(',').map(key=>[key,row[key]])));
      if(table==='patient_health_overviews'&&revoke)version=1;
      return{data:single?(data[0]||null):data};
    }
    q.single=()=>finish(true);q.maybeSingle=()=>finish(true);q.then=(resolve,reject)=>finish().then(resolve,reject);return q;
  };
  return calls;
}

test('portable export includes national code, base and supplementary insurance, and safe derived summaries for owned profiles only',async t=>{
  const calls=database(t),res=response();await exportAccount(request(),res);
  assert.equal(res.statusCode,200);const body=JSON.parse(res.body);
  assert.deepEqual(body.patients.map(patient=>patient.id),[patientId,familyId]);
  assert.equal(body.patients[0].national_code,'1234567806');
  assert.deepEqual(body.data.insurances.map(insurance=>insurance.id),['base','supplementary','family']);
  assert.deepEqual(body.data.health_overviews.map(overview=>Object.keys(overview)),[overviewFields]);
  assert.match(body.data.health_overviews[0].overview.overall,/ساختگی/);
  assert.deepEqual(body.data.wellness_programs.map(program=>Object.keys(program)),[wellnessFields]);
  assert.equal(body.data.wellness_programs[0].questionnaire.preferences,'غذای خانگی');
  for(const privateValue of ['foreign-private','private-lease-token','private-fingerprint','claim_token','lease_until','daily_attempts'])assert.equal(res.body.includes(privateValue),false,privateValue);
  const ownedPatients=calls.find(call=>call.table==='patients');
  assert.ok(ownedPatients.operations.some(([op,key,value])=>op==='eq'&&key==='owner_user_id'&&value===userId));
  for(const table of ['patient_insurances','patient_health_overviews','patient_wellness_programs']){
    const query=calls.find(call=>call.table===table);
    assert.deepEqual(query.operations.find(([op])=>op==='in'),['in','patient_id',[patientId,familyId]]);
    if(table==='patient_health_overviews'){
      assert.ok(query.operations.some(([op,key,value])=>op==='eq'&&key==='user_id'&&value===userId));
      assert.equal(query.operations.find(([op])=>op==='select')[1],overviewFields.join(','));
    }
    if(table==='patient_wellness_programs'){
      assert.ok(query.operations.some(([op,key,value])=>op==='eq'&&key==='user_id'&&value===userId));
      assert.equal(query.operations.find(([op])=>op==='select')[1],wellnessFields.join(','));
    }
  }
  assert.match(res.headers['Content-Disposition'],/attachment; filename="drman-health-export-/);
  assert.equal(calls.at(-1).table,'users');
});

test('profiles absent from the owned patient list never trigger unscoped insurance or overview reads',async t=>{
  const calls=database(t,{noPatients:true}),res=response();await exportAccount(request(),res);
  assert.equal(res.statusCode,200);const body=JSON.parse(res.body);
  assert.deepEqual(body.patients,[]);assert.deepEqual(body.data.insurances,[]);assert.deepEqual(body.data.health_overviews,[]);assert.deepEqual(body.data.wellness_programs,[]);
  assert.equal(calls.some(call=>['patient_insurances','patient_health_overviews','patient_wellness_programs'].includes(call.table)),false);
});

test('a password reset during export preparation revokes the response before private JSON or download headers are sent',async t=>{
  const calls=database(t,{revoke:true}),res=response();await exportAccount(request(),res);
  assert.equal(res.statusCode,401);assert.equal(res.body.code,'SESSION_REVOKED');
  assert.equal(res.headers['Content-Disposition'],undefined);assert.equal(res.headers['Content-Type'],undefined);
  assert.equal(calls.at(-1).table,'users');assert.equal(JSON.stringify(res.body).includes('جمع‌بندی'),false);
});

test('failed overview reads cannot silently produce an incomplete successful health export',async t=>{
  database(t,{failedTable:'patient_health_overviews'});const original=console.error;t.after(()=>{console.error=original;});console.error=()=>{};
  const res=response();await exportAccount(request(),res);assert.equal(res.statusCode,500);assert.equal(res.body.success,false);assert.equal(res.headers['Content-Disposition'],undefined);
});

test('missing authentication blocks every account export database read',async t=>{
  const calls=database(t),res=response();await exportAccount(request(false),res);assert.equal(res.statusCode,401);assert.deepEqual(calls,[]);
});
