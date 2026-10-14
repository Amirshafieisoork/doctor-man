// Storage objects must be removed through the Storage API before the database
// erasure transaction. A failed cleanup leaves a blocked account for safe retry.
export async function erasePatientAccount(database, requestId) {
  const { data: request, error: requestError } = await database.from('account_deletion_requests')
    .select('id,user_id,status,users(name,phone,account_type)').eq('id', requestId).maybeSingle();
  if (requestError) throw requestError;
  if (!request) return { status: 404, error: 'درخواست حذف پیدا نشد' };
  if (!['requested', 'processing'].includes(request.status)) return { status: 409, error: 'این درخواست قابل پردازش نیست' };
  if (request.users?.account_type !== 'patient') return { status: 409, error: 'حساب حرفه‌ای باید به‌صورت دستی و حقوقی بررسی شود' };
  if (request.status === 'requested') {
    const { data: claimed, error } = await database.from('account_deletion_requests')
      .update({ status: 'processing' }).eq('id', requestId).eq('status', 'requested').select('id').maybeSingle();
    if (error) throw error;
    if (!claimed) return { status: 409, error: 'وضعیت درخواست حذف تغییر کرده است؛ صفحه را تازه کنید' };
  }
  const { data: blocked, error: blockError } = await database.from('users').update({ status: 'blocked' })
    .eq('id', request.user_id).eq('account_type', 'patient').select('id,status').maybeSingle();
  if (blockError) throw blockError;
  if (!blocked || blocked.status !== 'blocked') throw new Error('ACCOUNT_ERASURE_FREEZE_NOT_CONFIRMED');
  const { data: patients, error: patientError } = await database.from('patients').select('id').eq('owner_user_id', request.user_id);
  if (patientError) throw patientError;
  const patientIds = (patients || []).map(patient => patient.id);
  const [documents, tests] = await Promise.all([
    patientIds.length ? database.from('medical_documents').select('storage_path').in('patient_id', patientIds) : Promise.resolve({ data: [] }),
    database.from('test_results').select('image_paths').eq('user_id', request.user_id)
  ]);
  if (documents.error) throw documents.error;
  if (tests.error) throw tests.error;
  const docPaths = [...new Set((documents.data || []).map(document => document.storage_path).filter(Boolean))];
  const labPaths = [...new Set((tests.data || []).flatMap(test => Array.isArray(test.image_paths) ? test.image_paths : []).filter(Boolean))];
  for (const [bucket, paths] of [['medical-documents', docPaths], ['lab-images', labPaths]]) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await database.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (error) throw error;
    }
  }
  // These are owner-only annotations, not financial records.
  const { error: notesError } = await database.from('app_settings').delete().eq('key', `admin_user_${request.user_id}`);
  if (notesError) throw notesError;
  // Anonymization keeps the user UUID for financial records, so these private
  // support and recovery rows do not disappear through the user foreign key.
  for (const table of ['support_tickets','password_reset_requests','password_reset_tokens']) {
    const { error } = await database.from(table).delete().eq('user_id', request.user_id);
    if (error) throw error;
  }
  const { data: result, error } = await database.rpc('process_patient_account_erasure', { p_request_id: requestId });
  if (error) throw error;
  if (result?.ok !== true) throw new Error('ACCOUNT_ERASURE_NOT_CONFIRMED');
  return { result, user_id: request.user_id, documents_removed: docPaths.length, lab_images_removed: labPaths.length };
}
