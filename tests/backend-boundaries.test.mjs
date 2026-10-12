import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createToken} from '../server/api/_lib/session.js';

// These tests never contact a real database, model provider or payment gateway.
process.env.SUPABASE_URL='https://backend-tests.invalid';
process.env.SUPABASE_SECRET_KEY='test-only-database-key';
process.env.SESSION_SECRET='test-only-session-secret-32-characters';
for(const key of ['DIGIPAY_CLIENT_ID','DIGIPAY_CLIENT_SECRET','DIGIPAY_USERNAME','DIGIPAY_PASSWORD'])process.env[key]='test-only-value';
const {supabase}=await import('../server/api/_lib/db.js');
const {default:healthEntry}=await import('../server/api/health-entry.js');
const {default:documents}=await import('../server/api/documents.js');
const {default:doctorRecord}=await import('../server/api/doctor-patient-record.js');
const {default:paymentCallback}=await import('../server/api/payment-callback.js');
const {default:paymentStatus}=await import('../server/api/payment-status.js');
const {default:paymentStart}=await import('../server/api/payment-start.js');
const userId='11111111-1111-4111-8111-111111111111',paymentId='22222222-2222-4222-8222-222222222222';
function request(method,body={},query={}){return {method,body,query,headers:{cookie:`drman_session=${createToken({sub:userId,role:'user'})}`}}}
function response(){return {statusCode:200,headers:{},status(n){this.statusCode=n;return this},json(body){this.body=body;return this},setHeader(k,v){this.headers[k]=v},getHeader(k){return this.headers[k]},end(){this.ended=true}}}
function stubDatabase(resolve){const calls=[];supabase.from=table=>{const operations=[];const query={};for(const name of ['select','eq','gte','lt','in','neq','order','limit','insert','update','delete'])query[name]=(...args)=>{operations.push([name,...args]);return query};const finish=async()=>{calls.push({table,operations});if(table==='users')return {data:{id:userId,status:'active'}};return resolve(table,operations)};query.maybeSingle=finish;query.single=finish;query.then=(a,b)=>finish().then(a,b);query.catch=b=>finish().catch(b);return query};return calls}
test('blank DigiPay settings refuse checkout without creating or cancelling payments',async()=>{
  const saved=process.env.DIGIPAY_CLIENT_ID;delete process.env.DIGIPAY_CLIENT_ID;
  const calls=stubDatabase(()=>{throw Error('unexpected payment database operation')});
  try{const res=response();await paymentStart(request('POST',{plan_id:paymentId}),res);assert.equal(res.statusCode,503);assert.equal(res.body.code,'DIGIPAY_NOT_CONFIGURED');assert.deepEqual(calls.map(call=>call.table),['users']);}
  finally{process.env.DIGIPAY_CLIENT_ID=saved;}
});
test('health writes cannot use another account patient ID',async()=>{const calls=stubDatabase(table=>({data:table==='patients'?null:[]})),res=response();await healthEntry(request('POST',{type:'condition',patient_id:'foreign-patient',name:'Test'}),res);assert.equal(res.statusCode,400);assert.equal(calls.some(c=>c.operations.some(([op])=>op==='insert')),false);const patientLookup=calls.find(c=>c.table==='patients');assert.ok(patientLookup.operations.some(([op,key,value])=>op==='eq'&&key==='owner_user_id'&&value===userId))});
test('private documents do not issue signed URLs without patient ownership',async()=>{stubDatabase(table=>({data:table==='medical_documents'?{id:'document',patient_id:'foreign-patient',storage_path:'private/path'}:null}));const storage=supabase.storage.from;let signed=false;supabase.storage.from=()=>({createSignedUrl(){signed=true;throw Error('unexpected signing')}});try{const res=response();await documents(request('GET',{}, {id:'document'}),res);assert.equal(res.statusCode,404);assert.equal(signed,false)}finally{supabase.storage.from=storage}});
test('messages-only doctor grant does not reveal clinical notes or demographics',async()=>{const calls=stubDatabase((table,ops)=>{if(table==='doctor_profiles')return {data:{id:'doctor',verification_status:'verified'}};if(table==='patient_access_grants')return {data:{id:'grant',status:'active',scope:['messages'],expires_at:null}};if(table==='patients'){const fields=ops.find(([op])=>op==='select')[1];assert.equal(fields,'id,display_name');return {data:{id:'patient',display_name:'Test patient'}}}return {data:[]}}),res=response();await doctorRecord(request('GET',{}, {patient_id:'patient'}),res);assert.equal(res.statusCode,200);assert.equal(res.body.record.patient.notes,undefined);assert.equal(calls.some(c=>c.table==='encounters'),false)});
test('forged callback nonce never reaches gateway verification or plan finalization',async()=>{const nonce='original-checkout-nonce';stubDatabase(table=>({data:table==='payments'?{id:paymentId,status:'redirected',checkout_nonce_hash:crypto.createHash('sha256').update(nonce).digest('hex'),amount_rial:2490000}:[]}));const actualFetch=globalThis.fetch,actualRpc=supabase.rpc;let finalizeCalls=0;globalThis.fetch=()=>{throw Error('unexpected gateway access')};supabase.rpc=()=>{finalizeCalls++;throw Error('unexpected finalize')};try{const res=response();await paymentCallback(request('POST',{providerId:paymentId,trackingCode:'fake-tracking',nonce:'forged'}),res);assert.equal(res.statusCode,303);assert.match(res.headers.Location,/status=failed/);assert.equal(finalizeCalls,0)}finally{globalThis.fetch=actualFetch;supabase.rpc=actualRpc}});
test('gateway response missing providerId cannot activate a paid plan',async()=>{stubDatabase(table=>({data:table==='payments'?{id:paymentId,status:'pending',amount_rial:2490000,tracking_code:'test-tracking'}:[]}));const actualFetch=globalThis.fetch,actualRpc=supabase.rpc;let finalizeCalls=0;globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('/oauth/token')?{access_token:'test-token'}:{result:{status:0},amount:2490000}),{status:200,headers:{'Content-Type':'application/json'}});supabase.rpc=()=>{finalizeCalls++;return {data:{ok:true}}};try{const res=response();await paymentStatus(request('GET',{}, {payment_id:paymentId}),res);assert.equal(res.statusCode,200);assert.equal(res.body.payment.status,'pending');assert.equal(finalizeCalls,0)}finally{globalThis.fetch=actualFetch;supabase.rpc=actualRpc}});

test('revoked, expired and messages-only grants never issue a document URL',async()=>{
  const grants=[null,{status:'revoked',scope:['documents'],expires_at:null},{status:'active',scope:['messages'],expires_at:null},{status:'active',scope:['documents'],expires_at:new Date(Date.now()-1000).toISOString()},{status:'active',scope:['documents'],expires_at:'invalid'}];
  const storage=supabase.storage.from;let signed=0;
  supabase.storage.from=()=>({createSignedUrl(){signed++;throw Error('unexpected signing')}});
  try{
    for(const grant of grants){
      const calls=stubDatabase(table=>{
        if(table==='medical_documents')return {data:{id:'document',patient_id:'patient',storage_path:'private/path'}};
        if(table==='patients')return {data:null};
        if(table==='doctor_profiles')return {data:{id:'doctor',verification_status:'verified'}};
        if(table==='patient_access_grants')return {data:grant};
        return {data:[]};
      });
      const res=response();await documents(request('GET',{}, {id:'document'}),res);
      assert.equal(res.statusCode,404);
      assert.equal(res.body.url,undefined);
      assert.match(res.headers['Cache-Control'],/no-store/);
      const lookup=calls.find(c=>c.table==='patient_access_grants');
      assert.ok(lookup.operations.some(([op,key,value])=>op==='eq'&&key==='patient_id'&&value==='patient'));
      assert.ok(lookup.operations.some(([op,key,value])=>op==='eq'&&key==='doctor_id'&&value==='doctor'));
    }
    assert.equal(signed,0);
  }finally{supabase.storage.from=storage}
});
test('verified doctor document URL stays private and never outlives consent expiry',async()=>{
  const grantExpiry=new Date(Date.now()+90000).toISOString();
  const calls=stubDatabase(table=>{
    if(table==='medical_documents')return {data:{id:'document',patient_id:'patient',storage_path:'private/path',title:'Shared document',mime_type:'application/pdf'}};
    if(table==='patients')return {data:null};
    if(table==='doctor_profiles')return {data:{id:'doctor',verification_status:'verified'}};
    if(table==='patient_access_grants')return {data:{id:'grant',status:'active',scope:['documents'],expires_at:grantExpiry}};
    return {data:[]};
  });
  const storage=supabase.storage.from;let ttl=0;
  supabase.storage.from=bucket=>({async createSignedUrl(path,seconds){assert.equal(bucket,'medical-documents');assert.equal(path,'private/path');ttl=seconds;return {data:{signedUrl:'https://backend-tests.invalid/private-signed-document'}}}});
  try{
    const res=response();await documents(request('GET',{}, {id:'document'}),res);
    assert.equal(res.statusCode,200);
    assert.ok(ttl>0&&ttl<=90);
    assert.equal(res.body.expires_in,ttl);
    assert.equal(res.body.mime_type,'application/pdf');
    assert.equal(res.body.storage_path,undefined);
    const audit=calls.find(c=>c.table==='audit_logs').operations.find(([op])=>op==='insert')[1];
    assert.equal(audit.actor_type,'doctor');assert.equal(audit.metadata.grant_id,'grant');
  }finally{supabase.storage.from=storage}
});
test('pending doctors and consent lookup failures cannot sign medical documents',async()=>{
  const storage=supabase.storage.from;let signed=0;supabase.storage.from=()=>({createSignedUrl(){signed++;throw Error('unexpected signing')}});
  try{
    for(const scenario of ['pending','lookup-error']){
      stubDatabase(table=>{
        if(table==='medical_documents')return {data:{id:'document',patient_id:'patient',storage_path:'private/path'}};
        if(table==='patients')return {data:null};
        if(table==='doctor_profiles')return {data:{id:'doctor',verification_status:scenario==='pending'?'pending':'verified'}};
        if(table==='patient_access_grants')return {data:null,error:new Error('query failure')};
        return {data:[]};
      });
      const res=response();await documents(request('GET',{}, {id:'document'}),res);
      assert.equal(res.statusCode,scenario==='pending'?404:503);
      assert.equal(res.body.url,undefined);
    }
    assert.equal(signed,0);
  }finally{supabase.storage.from=storage}
});
