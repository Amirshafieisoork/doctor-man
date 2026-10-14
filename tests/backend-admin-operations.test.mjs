import test from 'node:test';
import assert from 'node:assert/strict';
import { createToken, requireUser } from '../server/api/_lib/session.js';
process.env.SUPABASE_URL='https://admin-tests.invalid';
process.env.SUPABASE_SECRET_KEY='synthetic-only-service-key';
process.env.SESSION_SECRET='synthetic-only-session-secret-at-least-32';
const {supabase}=await import('../server/api/_lib/db.js');
const {default:adminAction}=await import('../server/api/admin-action.js');
const {default:adminOperations}=await import('../server/api/admin-operations.js');
const {default:adminContact}=await import('../server/api/admin-user-contact.js');
const userId='11111111-1111-4111-8111-111111111111',planId='22222222-2222-4222-8222-222222222222',recordId='33333333-3333-4333-8333-333333333333';
const operation=(ops,name)=>ops.find(([op])=>op===name);
function request(method,body={},query={},admin=true){return{method,body,query,headers:{cookie:admin?`drman_admin=${createToken({sub:'admin',role:'admin'})}`:`drman_session=${createToken({sub:userId,role:'user'})}`}}}
function response(){return{statusCode:200,headers:{},status(n){this.statusCode=n;return this},json(value){this.body=value;return this},setHeader(key,value){this.headers[key]=value},getHeader(key){return this.headers[key]}}}
function database(resolve){
  const calls=[];supabase.from=table=>{const operations=[],query={};for(const method of ['select','eq','neq','in','order','limit','update','insert','upsert','delete'])query[method]=(...args)=>{operations.push([method,...args]);return query};const finish=async()=>{calls.push({table,operations});return resolve(table,operations)};query.then=(a,b)=>finish().then(a,b);query.single=finish;query.maybeSingle=finish;return query};return calls;
}

test('a supplied short Persian plan reason is accepted and audited instead of falsely rejected',async()=>{
  const calls=database((table,ops)=>({data:table==='users'?{id:userId,phone:'09120000000',status:'active',plan_id:recordId}:table==='plans'?{id:planId,active:true,name:'همراه',slug:'plus',price:249000,duration_days:30}:[]}));
  const res=response();await adminAction(request('POST',{action:'set-plan',id:userId,plan_id:planId,reason:'تست'}),res);
  assert.equal(res.statusCode,200);
  const update=calls.find(call=>call.table==='users'&&operation(call.operations,'update'));assert.equal(operation(update.operations,'update')[1].plan_id,planId);assert.ok(update.operations.some(([op,key,value])=>op==='eq'&&key==='id'&&value===userId));
  const audit=operation(calls.find(call=>call.table==='audit_logs').operations,'insert')[1];assert.equal(audit.metadata.reason,'تست');assert.equal(audit.metadata.previous_plan_id,recordId);
});
test('blank plan reason, inactive plans and nonexistent users cannot grant a plan',async()=>{
  for(const scenario of ['blank','inactive','missing']){
    const calls=database(table=>({data:table==='users'?(scenario==='missing'?null:{id:userId,phone:'09120000000'}):table==='plans'?{id:planId,active:false}:[]}));
    const res=response();await adminAction(request('POST',{action:'set-plan',id:userId,plan_id:planId,reason:scenario==='blank'?'   ':'تست'}),res);
    assert.equal(res.statusCode,scenario==='blank'?400:scenario==='inactive'?409:404);assert.equal(calls.some(call=>operation(call.operations,'update')),false);
  }
});
test('ordinary user sessions cannot read clinical operations, notes or perform admin erasure',async()=>{
  const calls=database(()=>{throw Error('unauthorized database access')});
  for(const [handler,req]of[[adminOperations,request('GET',{}, {},false)],[adminContact,request('GET',{}, {user_id:userId},false)],[adminAction,request('POST',{action:'delete-user',id:userId}, {},false)]]){const res=response();await handler(req,res);assert.equal(res.statusCode,401)}assert.deepEqual(calls,[]);
});
test('clinical editor rejects identity transfer, financial edits, invented fields and missing audit reason before RPC',async t=>{
  const original=supabase.rpc;t.after(()=>{supabase.rpc=original});let mutations=0;supabase.rpc=async()=>{mutations++;return{data:{}}};const calls=database(()=>({data:{id:recordId,patient_id:userId,status:'open'}}));
  for(const body of [{patch:{patient_id:userId},reason:'تست'},{patch:{user_id:userId},reason:'تست'},{patch:{status:'paid'},reason:'تست'},{patch:{title:'عنوان'},reason:' '},{patch:{status:'completed'},reason:'تست'},{patch:{details:'x'.repeat(3001)},reason:'تست'}]){const res=response();await adminOperations(request('PATCH',{kind:'task',id:recordId,...body}),res);assert.equal(res.statusCode,400)}assert.equal(mutations,0);assert.deepEqual(calls,[]);
});
test('completing a care task uses actual database done status and atomic reason-bearing update RPC',async t=>{
  const original=supabase.rpc;t.after(()=>{supabase.rpc=original});let rpc;
  supabase.rpc=async(name,args)=>{rpc={name,args};return{data:{id:recordId,status:'done'}}};
  database(()=>({data:{id:recordId,patient_id:userId,status:'open'}}));const res=response();await adminOperations(request('PATCH',{kind:'task',id:recordId,patch:{status:'done',details:'زمان پیگیری اصلاح شد'},reason:'اصلاح'}),res);
  assert.equal(res.statusCode,200);assert.equal(rpc.name,'admin_update_clinical_record');assert.equal(rpc.args.p_id,recordId);assert.equal(rpc.args.p_patch.status,'done');assert.ok(rpc.args.p_patch.completed_at);assert.equal(rpc.args.p_reason,'اصلاح');
});
test('missing clinical records and database failures never report a successful edit',async t=>{
  const original=supabase.rpc;t.after(()=>{supabase.rpc=original});let mutations=0;supabase.rpc=async()=>{mutations++;return{data:null,error:{code:'DB_FAILURE'}}};
  database(()=>({data:null}));let res=response();await adminOperations(request('PATCH',{kind:'order',id:recordId,patch:{status:'completed'},reason:'اصلاح'}),res);assert.equal(res.statusCode,404);assert.equal(mutations,0);
  database(()=>({data:{id:recordId}}));res=response();await adminOperations(request('PATCH',{kind:'order',id:recordId,patch:{status:'completed'},reason:'اصلاح'}),res);assert.equal(res.statusCode,503);assert.equal(res.body.success,false);
});
test('doctor approval cannot bypass private license review and pending doctors cannot be published',async()=>{
  const calls=database(()=>({data:{id:recordId,verification_status:'pending'}}));
  for(const action of ['approve-doctor','publish-doctor']){const res=response();await adminAction(request('POST',{action,id:recordId}),res);assert.equal(res.statusCode,409)}assert.equal(calls.some(call=>operation(call.operations,'update')),false);
});
test('incorrect erasure confirmation and professional accounts cannot erase files or records',async t=>{
  const original=supabase.rpc,storage=supabase.storage.from;t.after(()=>{supabase.rpc=original;supabase.storage.from=storage});supabase.rpc=()=>{throw Error('unexpected erasure')};supabase.storage.from=()=>{throw Error('unexpected storage access')};
  for(const scenario of ['wrong-phone','doctor']){const calls=database(()=>({data:{id:userId,phone:'09120000000',account_type:scenario==='doctor'?'doctor':'patient'}}));const res=response();await adminAction(request('POST',{action:'delete-user',id:userId,reason:'ثبت‌نام دوباره',confirm_phone:scenario==='wrong-phone'?'09129999999':'09120000000'}),res);assert.equal(res.statusCode,scenario==='doctor'?409:400);assert.equal(calls.some(call=>operation(call.operations,'insert')||operation(call.operations,'update')),false)}
});
test('admin erasure freezes old identity, removes private files and keeps financial audit rows intact',async t=>{
  const original=supabase.rpc,storage=supabase.storage.from;t.after(()=>{supabase.rpc=original;supabase.storage.from=storage});const events=[];let state='active';
  const calls=database((table,ops)=>{
    if(table==='users'){if(operation(ops,'update'))state='blocked';return{data:{id:userId,phone:state==='deleted'?'deleted-'+userId:'09120000000',status:state==='active'?'active':'blocked',account_type:'patient'}}}
    if(table==='account_deletion_requests')return{data:operation(ops,'insert')?{id:recordId}:operation(ops,'update')?{id:recordId}:ops.some(([op,key])=>op==='eq'&&key==='user_id')?null:{id:recordId,user_id:userId,status:'requested',users:{account_type:'patient'}}};
    if(table==='patients')return{data:[{id:planId}]};if(table==='medical_documents')return{data:[{storage_path:'private/mri.pdf'}]};if(table==='test_results')return{data:[{image_paths:['private/lab.jpg']}]};return{data:[]};
  });
  supabase.storage.from=bucket=>({async remove(paths){assert.equal(state,'blocked');events.push({bucket,paths});return{data:paths}}});supabase.rpc=async(name,args)=>{assert.equal(state,'blocked');events.push({name,args});state='deleted';return{data:{ok:true,user_id:userId}}};
  const res=response();await adminAction(request('POST',{action:'delete-user',id:userId,reason:'ثبت‌نام دوباره',confirm_phone:'09120000000'}),res);assert.equal(res.statusCode,200);assert.equal(res.body.can_register_again,true);assert.equal(calls.some(call=>call.table==='payments'),false);assert.equal(events.at(-1).name,'process_patient_account_erasure');
  const sessionResponse=response();const session=await requireUser(request('GET',{}, {},false),sessionResponse,supabase);assert.equal(session,null);assert.equal(sessionResponse.statusCode,403);
});
test('a deleted identity cannot be reactivated or granted a new plan by admin',async()=>{
  const calls=database(()=>({data:{id:userId,phone:'deleted-'+userId,status:'blocked'}}));for(const body of[{action:'unblock-user'},{action:'set-plan',plan_id:planId,reason:'اصلاح'}]){const res=response();await adminAction(request('POST',{id:userId,...body}),res);assert.equal(res.statusCode,404)}assert.equal(calls.some(call=>operation(call.operations,'update')),false);
});
test('private notes lookup is restricted to its target account key and messages only',async()=>{
  const calls=database(table=>({data:table==='users'?{id:userId,phone:'09120000000',status:'active'}:table==='app_settings'?{value:{note:'یادداشت داخلی',labels:['پیگیری']}}:[]}));const res=response();await adminContact(request('GET',{}, {user_id:userId}),res);assert.equal(res.statusCode,200);assert.equal(res.body.note,'یادداشت داخلی');const note=calls.find(call=>call.table==='app_settings');assert.ok(note.operations.some(([op,key,value])=>op==='eq'&&key==='key'&&value==='admin_user_'+userId));const messages=calls.find(call=>call.table==='notifications');assert.ok(messages.operations.some(([op,key,value])=>op==='eq'&&key==='user_id'&&value===userId));assert.equal(res.body.user.password,undefined);
});
test('notification sending uses an atomic target-specific RPC and refuses blocked accounts',async t=>{
  const original=supabase.rpc;t.after(()=>{supabase.rpc=original});const events=[];supabase.rpc=async(name,args)=>{events.push({name,args});return{data:{id:recordId,title:args.p_title}}};
  database(()=>({data:{id:userId,phone:'09120000000',status:'active'}}));let res=response();await adminContact(request('POST',{user_id:userId,title:'پاسخ مدیریت',message:'لطفاً تصویر خوانا بارگذاری کنید',reason:'رفع اشکال'}),res);assert.equal(res.statusCode,201);assert.equal(events[0].name,'admin_send_user_message');assert.equal(events[0].args.p_user_id,userId);assert.equal(events[0].args.p_reason,'رفع اشکال');
  database(()=>({data:{id:userId,phone:'09120000000',status:'blocked'}}));res=response();await adminContact(request('POST',{user_id:userId,title:'پیام',message:'تست',reason:'رفع اشکال'}),res);assert.equal(res.statusCode,409);assert.equal(events.length,1);
});
