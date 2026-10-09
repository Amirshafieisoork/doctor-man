// Service-role storage signing must enforce the same consent boundary as the
// doctor's record view; possession of a document ID never grants access.
export async function documentAccess(database,userId,patientId,now=Date.now()){
  const {data:ownedPatient,error:ownerError}=await database.from('patients').select('id')
    .eq('id',patientId).eq('owner_user_id',userId).maybeSingle();
  if(ownerError)throw ownerError;
  if(ownedPatient)return {actorType:'user',grantId:null,expiresIn:300};
  const {data:doctor,error:doctorError}=await database.from('doctor_profiles').select('id,verification_status')
    .eq('user_id',userId).maybeSingle();
  if(doctorError)throw doctorError;
  if(!doctor||doctor.verification_status!=='verified')return null;
  const {data:grant,error:grantError}=await database.from('patient_access_grants').select('id,status,scope,expires_at')
    .eq('patient_id',patientId).eq('doctor_id',doctor.id).eq('status','active').maybeSingle();
  if(grantError)throw grantError;
  if(!grant||grant.status!=='active'||!Array.isArray(grant.scope)||!grant.scope.includes('documents'))return null;
  let expiresIn=300;
  if(grant.expires_at){
    const expiry=Date.parse(grant.expires_at);
    if(!Number.isFinite(expiry))return null;
    expiresIn=Math.min(300,Math.floor((expiry-now)/1000));
    if(expiresIn<1)return null;
  }
  return {actorType:'doctor',grantId:grant.id,expiresIn};
}
