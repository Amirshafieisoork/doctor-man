import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';
import { createToken } from '../server/api/_lib/session.js';

process.env.SUPABASE_URL='https://archive-tests.invalid';
process.env.SUPABASE_SECRET_KEY='test-only-key';
process.env.SESSION_SECRET='test-only-session-secret-32-characters';
const {supabase}=await import('../server/api/_lib/db.js');
const {default:archive}=await import('../server/api/medical-archive.js');
const {default:file}=await import('../server/api/medical-file.js');
const {default:adminArchive}=await import('../server/api/admin-medical-archive.js');
const {default:documents}=await import('../server/api/documents.js');
const {default:patients}=await import('../server/api/patients.js');
const {default:healthRecord}=await import('../server/api/health-record.js');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),foreign=id(2),self=id(3),child=id(4),otherPatient=id(5),docId=id(6),childDoc=id(7),foreignDoc=id(8),resultId=id(9),legacyId=id(10),doctorId=id(11);
const pdf=Buffer.from('%PDF-1.7\noriginal bytes for local test\n');

function request(query={},role='user',body,method='GET'){
  const token=createToken(role==='admin'?{sub:'admin',role:'admin'}:{sub:owner,role:'user',ver:0});
  return {method,query,body,headers:{cookie:`${role==='admin'?'drman_admin':'drman_session'}=${token}`}};
}
function response(){return {statusCode:200,headers:{},sent:0,status(n){this.statusCode=n;return this},json(body){assert.equal(++this.sent,1);this.body=body;return this},setHeader(k,v){this.headers[k]=v},getHeader(k){return this.headers[k]}}}
function json(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}})}
function services(t,{onSign,onTable,failTable}={}){
  const state={
    users:[{id:owner,status:'active',session_version:0,plans:{active:true,family_profile_limit:10}},{id:foreign,status:'active',session_version:0}],
    patients:[{id:self,owner_user_id:owner,display_name:'پرونده من',relation:'self',sex:'female'},
      {id:child,owner_user_id:owner,display_name:'فرزند',relation:'child',sex:'unknown'},
      {id:otherPatient,owner_user_id:foreign,display_name:'پرونده دیگر',relation:'self',sex:'male'}],
    medical_documents:[{id:docId,patient_id:self,title:'گزارش MRI',document_type:'imaging',mime_type:'application/pdf',storage_path:`${self}/report.pdf`,original_filename:'MRI-original.pdf',size_bytes:pdf.length,created_at:'2026-10-13T09:00:00Z'},
      {id:childDoc,patient_id:child,title:'رادیوگرافی',document_type:'imaging',mime_type:'image/png',storage_path:`${child}/xray.png`,created_at:'2026-10-12T09:00:00Z'},
      {id:foreignDoc,patient_id:otherPatient,title:'سند دیگر',document_type:'other',mime_type:'application/pdf',storage_path:`${otherPatient}/private.pdf`,created_at:'2026-10-13T09:00:00Z'}],
    test_results:[{id:resultId,user_id:owner,patient_id:self,image_paths:[`${owner}/day/page-1.png`,`${owner}/day/page-2.jpg`],created_at:'2026-10-11T09:00:00Z',analysis:'تفسیر'},
      {id:legacyId,user_id:owner,patient_id:null,image_paths:[`${owner}/day/legacy.webp`],created_at:'2026-10-10T09:00:00Z'}],
    doctor_profiles:[{id:doctorId,user_id:owner,verification_status:'verified'}],
    patient_access_grants:[{id:id(12),patient_id:otherPatient,doctor_id:doctorId,status:'active',scope:['documents'],expires_at:new Date(Date.now()+90000).toISOString()}]
  };
  const calls=[];
  function matches(row,query){
    for(const [key,value]of query){
      if(['select','order','limit','offset'].includes(key))continue;
      if(key==='or'){
        const pid=value.match(/patient_id\.eq\.([^,)]+)/)?.[1];
        if(row.patient_id!==pid&&row.patient_id!=null)return false;
      }else if(value.startsWith('eq.')&&String(row[key])!==value.slice(3))return false;
      else if(value.startsWith('in.(')&&!value.slice(4,-1).split(',').includes(String(row[key])))return false;
      else if(value==='not.is.null'&&row[key]==null)return false;
      else if(value==='neq.{}'&&Array.isArray(row[key])&&!row[key].length)return false;
    }
    return true;
  }
  const client=createClient('https://archive-tests.invalid','test-only-client-key',{auth:{persistSession:false,autoRefreshToken:false},global:{async fetch(input,init){
    const req=new Request(input,init),url=new URL(req.url);
    assert.equal(url.origin,'https://archive-tests.invalid');
    if(url.pathname.startsWith('/storage/')){
      const signing=url.pathname.includes('/object/sign/');
      const body=signing||req.method==='DELETE'?await req.json():Buffer.from(await req.arrayBuffer());
      calls.push({storage:true,method:req.method,path:url.pathname,body});
      if(signing){await onSign?.(state);return json({signedURL:url.pathname.replace('/storage/v1','')+'?token=synthetic'})}
      return json({Key:'saved',Id:'object'},200);
    }
    const table=url.pathname.split('/').at(-1),body=['GET','HEAD'].includes(req.method)?null:await req.json();
    calls.push({table,method:req.method,query:url.searchParams,body});
    await onTable?.(table,req.method,state);
    if(table===failTable)return json({code:'TEST_DB_ERROR',message:'private error'},500);
    let rows=(state[table]||[]).filter(row=>matches(row,url.searchParams));
    if(req.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Range':`*/${rows.length}`}});
    if(req.method==='POST'){
      const inserted=(Array.isArray(body)?body:[body]).map(row=>({...row,id:row.id||id(100),created_at:'2026-10-13T10:00:00Z'}));
      if(!state[table])state[table]=[];state[table].push(...inserted);rows=inserted;
    }else if(req.method==='PATCH'){for(const row of rows)Object.assign(row,body)}
    if(url.searchParams.has('order'))rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||rows.length);
    rows=rows.slice(offset,offset+limit);
    return json(req.headers.get('accept')?.includes('vnd.pgrst.object')?rows[0]||null:rows,req.method==='POST'?201:200);
  }}});
  const from=supabase.from,storage=supabase.storage.from;
  supabase.from=client.from.bind(client);supabase.storage.from=client.storage.from.bind(client.storage);
  t.after(()=>{supabase.from=from;supabase.storage.from=storage});
  return {state,calls};
}
const signedCalls=calls=>calls.filter(call=>call.storage&&call.path.includes('/object/sign/'));
async function run(handler,req){const res=response();await handler(req,res);return res}

test('owner archive combines original documents and all historical lab pages without raw paths or public URLs',async t=>{
  const {calls}=services(t);const res=await run(archive,request({patient_id:self}));
  assert.equal(res.statusCode,200);assert.equal(res.body.files.length,4);
  assert.equal(res.body.files[0].original_filename,'MRI-original.pdf');
  assert.deepEqual(res.body.files.filter(x=>x.id===resultId).map(x=>x.page_index),[0,1]);
  assert.ok(res.body.files.some(x=>x.id===legacyId));
  assert.doesNotMatch(JSON.stringify(res.body),/storage_path|image_paths|bucket|https:|00000000-0000-4000-8000-000000000002/);
  assert.equal(signedCalls(calls).length,0);assert.match(res.headers['Cache-Control'],/no-store/);
});

test('family archives are scoped separately and another owner patient cannot be listed',async t=>{
  const {calls}=services(t);let res=await run(archive,request({patient_id:child}));
  assert.equal(res.statusCode,200);assert.deepEqual(res.body.files.map(x=>x.id),[childDoc]);
  res=await run(archive,request({patient_id:otherPatient}));assert.equal(res.statusCode,404);assert.equal(signedCalls(calls).length,0);
});

test('owner document download and second lab page sign only their fixed private buckets for 120 seconds',async t=>{
  const {calls}=services(t);
  let res=await run(file,request({source:'document',id:docId,download:'true',bucket:'doctor-licenses',path:'foreign/license.png'}));
  assert.equal(res.statusCode,200);assert.equal(res.body.mime_type,'application/pdf');assert.equal(res.body.filename,'MRI-original.pdf');
  assert.match(res.body.url,/download=MRI-original.pdf/);assert.equal(res.body.expires_in,120);
  res=await run(file,request({source:'lab',id:resultId,page:'1'}));assert.equal(res.statusCode,200);assert.equal(res.body.mime_type,'image/jpeg');
  const signs=signedCalls(calls);assert.equal(signs.length,2);assert.ok(signs[0].path.includes('/medical-documents/'));assert.ok(signs[1].path.endsWith('/page-2.jpg'));
  assert.ok(signs.every(call=>call.body.expiresIn===120));assert.ok(signs.every(call=>!call.path.includes('doctor-licenses')));
});

test('foreign documents, missing lab pages and license source cannot issue signed URLs',async t=>{
  const {calls}=services(t);
  for(const [query,status]of [[{source:'document',id:foreignDoc},404],[{source:'lab',id:resultId,page:'3'},404],[{source:'license',id:docId},400],[{source:'lab',id:resultId,page:'-1'},400]]){
    const res=await run(file,request(query));assert.equal(res.statusCode,status);assert.equal(res.body.url,undefined);
  }
  assert.equal(signedCalls(calls).length,0);
});

test('a lab row cannot borrow an owned patient ID to expose another user files',async t=>{
  const {state,calls}=services(t);state.test_results.push({id:id(13),user_id:foreign,patient_id:self,image_paths:[`${foreign}/secret.png`]});
  const res=await run(file,request({source:'lab',id:id(13),page:'0'}));assert.equal(res.statusCode,404);assert.equal(signedCalls(calls).length,0);
});

test('archive pagination retains older files without duplicates between pages',async t=>{
  const {state}=services(t);
  for(let n=0;n<70;n++)state.medical_documents.push({id:id(1000+n),patient_id:self,title:'فایل ذخیره‌شده',document_type:'other',mime_type:'application/pdf',storage_path:`${self}/file-${n}.pdf`,created_at:new Date(Date.parse('2026-10-13T12:00:00Z')-n*1000).toISOString()});
  const first=await run(archive,request({patient_id:self,offset:'0'})),second=await run(archive,request({patient_id:self,offset:'50'}));
  assert.equal(first.body.files.length,50);assert.equal(first.body.next_offset,50);assert.equal(second.body.files.length,24);assert.equal(second.body.next_offset,null);
  const key=row=>`${row.source}:${row.id}:${row.page_index??0}`;
  assert.equal(new Set([...first.body.files,...second.body.files].map(key)).size,74);
  assert.ok(second.body.files.some(row=>row.id===legacyId));
});

test('traversal, cross-owner prefixes and executable files are excluded even when row ownership matches',async t=>{
  const {state,calls}=services(t);
  for(const path of [`${self}/../private.pdf`,`${self}/%2e%2e/private.pdf`,`${otherPatient}/secret.pdf`,`${self}/page.html`,'doctor-licenses/license.png']){
    state.medical_documents[0].storage_path=path;
    const res=await run(file,request({source:'document',id:docId}));assert.equal(res.statusCode,404);
  }
  assert.equal(signedCalls(calls).length,0);
});

test('user cookies cannot enter the separate admin archive API; admins can view active owner files',async t=>{
  const {calls}=services(t);let res=await run(adminArchive,request({}));assert.equal(res.statusCode,401);assert.equal(calls.length,0);
  res=await run(adminArchive,request({user_id:foreign},'admin'));assert.equal(res.statusCode,200);assert.deepEqual(res.body.files.map(x=>x.id),[foreignDoc]);assert.equal(res.body.files[0].user_id,foreign);
  res=await run(adminArchive,request({source:'document',id:foreignDoc},'admin'));assert.equal(res.statusCode,200);assert.equal(signedCalls(calls).length,1);
});

test('blocked and deleted target owners cannot mint admin URLs or remain in admin lists',async t=>{
  const {state,calls}=services(t);
  for(const deleted of [false,true]){
    state.users=deleted?state.users.filter(x=>x.id!==foreign):state.users.map(x=>x.id===foreign?{...x,status:'blocked'}:x);
    const res=await run(adminArchive,request({source:'document',id:foreignDoc},'admin'));assert.equal(res.statusCode,404);
    const list=await run(adminArchive,request({user_id:foreign},'admin'));assert.deepEqual(list.body.files,[]);
  }
  assert.equal(signedCalls(calls).length,0);
});

test('account suspension during signing withholds the newly signed URL',async t=>{
  services(t,{onSign:state=>{state.users.find(x=>x.id===owner).status='blocked'}});
  const res=await run(file,request({source:'document',id:docId}));assert.equal(res.statusCode,403);assert.equal(res.body.url,undefined);
});

test('admin listing drops metadata when the target owner is suspended during archive reads',async t=>{
  services(t,{onTable:(table,method,state)=>{if(table==='medical_documents'&&method==='GET')state.users.find(x=>x.id===foreign).status='blocked'}});
  const res=await run(adminArchive,request({user_id:foreign},'admin'));assert.equal(res.statusCode,200);assert.deepEqual(res.body.files,[]);
});

test('revoked doctor consent and a blocked owner prevent the legacy document viewer from signing',async t=>{
  const {state,calls}=services(t);
  state.patient_access_grants[0].status='revoked';let res=await run(documents,request({id:foreignDoc}));assert.equal(res.statusCode,404);
  state.patient_access_grants[0].status='active';state.users.find(x=>x.id===foreign).status='blocked';res=await run(documents,request({id:foreignDoc}));assert.equal(res.statusCode,404);
  assert.equal(signedCalls(calls).length,0);
});

test('verified doctors retain consent-scoped document viewing with a short expiry',async t=>{
  const {calls}=services(t);const res=await run(documents,request({id:foreignDoc}));
  assert.equal(res.statusCode,200);assert.equal(res.body.mime_type,'application/pdf');
  assert.ok(res.body.expires_in>0&&res.body.expires_in<=85);assert.equal(signedCalls(calls).length,1);
});

test('revoking doctor consent while its URL is being signed withholds the link',async t=>{
  services(t,{onSign:state=>{state.patient_access_grants[0].status='revoked'}});
  const res=await run(documents,request({id:foreignDoc}));assert.equal(res.statusCode,404);assert.equal(res.body.url,undefined);
});

test('health records include private file metadata and page counts while stripping storage paths',async t=>{
  services(t);const res=await run(healthRecord,request({patient_id:self}));
  assert.equal(res.statusCode,200);assert.equal(res.body.record.archive_files.length,3);assert.equal(res.body.record.tests[0].image_count,2);
  assert.doesNotMatch(JSON.stringify(res.body.record),/storage_path|image_paths|bucket|https:/);
});

function uploadRequest(bytes=pdf,mime='application/pdf'){
  const boundary='medical-archive-test';const buffer=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${self}\r\n--${boundary}\r\nContent-Disposition: form-data; name="document_type"\r\n\r\nimaging\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="original-report.pdf"\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const req=Readable.from([buffer]);Object.assign(req,request({},'user',undefined,'POST'));req.headers['content-type']=`multipart/form-data; boundary=${boundary}`;return req;
}
test('document archive preserves original bytes and filename without AI consent or a model call',async t=>{
  const {calls}=services(t);const res=await run(documents,uploadRequest());assert.equal(res.statusCode,201);
  const upload=calls.find(call=>call.storage&&!call.path.includes('/sign/'));assert.deepEqual(upload.body,pdf);
  const insert=calls.find(call=>call.table==='medical_documents'&&call.method==='POST');
  assert.equal(insert.body.original_filename,'original-report.pdf');assert.equal(insert.body.size_bytes,pdf.length);
  assert.equal(calls.some(call=>call.table==='consent_records'),false);
});

test('forged document MIME and oversized originals fail before any storage write',async t=>{
  const {calls}=services(t);
  for(const [bytes,mime]of [[Buffer.from('<script>private</script>'),'application/pdf'],[Buffer.concat([pdf,Buffer.alloc(4*1024*1024)]),'application/pdf'],[pdf,'text/html']]){
    const res=await run(documents,uploadRequest(bytes,mime));assert.equal(res.statusCode,400);
  }
  assert.equal(calls.some(call=>call.storage),false);
});

test('sex writes accept only explicit female/male and preserve old unknown values on unrelated edits',async t=>{
  const {state,calls}=services(t);
  for(const sex of ['unknown','other','',null]){
    const res=await run(patients,request({},'user',{id:child,sex},'PATCH'));assert.equal(res.statusCode,400);
  }
  assert.equal(calls.some(call=>call.table==='patients'&&call.method==='PATCH'),false);
  let res=await run(patients,request({},'user',{id:child,display_name:'نام اصلاح‌شده'},'PATCH'));assert.equal(res.statusCode,200);assert.equal(state.patients.find(x=>x.id===child).sex,'unknown');
  res=await run(patients,request({},'user',{id:child,sex:'male'},'PATCH'));assert.equal(res.statusCode,200);assert.equal(state.patients.find(x=>x.id===child).sex,'male');
  res=await run(patients,request({},'user',{relation:'child',display_name:'جدید'},'POST'));assert.equal(res.statusCode,400);
});

test('archive database failures fail closed without creating signed URLs',async t=>{
  const {calls}=services(t,{failTable:'medical_documents'});const res=await run(archive,request({patient_id:self}));
  assert.equal(res.statusCode,503);assert.equal(signedCalls(calls).length,0);assert.doesNotMatch(res.body.error,/private/);
});
