import { InputValidationError } from './validate.js';

export const ARCHIVE_TTL_SECONDS = 120;
export const ARCHIVE_PAGE_SIZE = 50;
export const DOCUMENT_ARCHIVE_FIELDS = 'id,patient_id,document_type,title,storage_path,mime_type,document_date,created_at,original_filename,size_bytes';
export const LAB_ARCHIVE_FIELDS = 'id,user_id,patient_id,image_paths,reason,created_at';
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

export function archiveOffset(value) {
  const raw = String(value ?? '0');
  if (!/^\d{1,5}$/.test(raw) || Number(raw) > 10000) throw new InputValidationError('صفحه آرشیو معتبر نیست');
  return Number(raw);
}
export function archiveRequest(query = {}) {
  const source = String(query.source || ''), id = String(query.id || ''), rawPage = String(query.page ?? '0');
  if (!['document', 'lab'].includes(source) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !/^\d{1,2}$/.test(rawPage)) {
    throw new InputValidationError('فایل انتخاب‌شده معتبر نیست');
  }
  return { source, id, page: Number(rawPage), download: query.download === 'true' };
}
export function privateArchivePath(path, prefixes) {
  if (typeof path !== 'string' || !path || path.length > 1024 || /[\\%?#\u0000-\u001f\u007f]/.test(path)) return false;
  const segments = path.split('/');
  return segments.length >= 2 && segments.every(part => part && part !== '.' && part !== '..') && prefixes.filter(Boolean).includes(segments[0]);
}
function pathType(path) { return TYPES[String(path || '').split('.').at(-1).toLowerCase()] || null; }
export function archiveFilename(value, mime) {
  const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const name = String(value || 'سند پزشکی').replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '-').trim().slice(0,140) || 'سند پزشکی';
  const supplied = name.split('.').at(-1).toLowerCase();
  return TYPES[supplied] === mime ? name : `${name}.${extension}`;
}
function documentSpec(doc, patient) {
  const mime = pathType(doc.storage_path);
  if (!patient || !privateArchivePath(doc.storage_path, [patient.id]) || !mime || (doc.mime_type && doc.mime_type !== mime)) return null;
  return { source: 'document', id: doc.id, title: String(doc.title || 'سند پزشکی'), mime_type: mime,
    document_type: doc.document_type || 'other', document_date: doc.document_date || null, created_at: doc.created_at || null,
    original_filename: doc.original_filename || null, size_bytes: doc.size_bytes == null ? null : Number(doc.size_bytes),
    filename: archiveFilename(doc.original_filename || doc.title, mime), patient_id: patient.id,
    patient_name: patient.display_name || '', user_id: patient.owner_user_id, bucket: 'medical-documents', path: doc.storage_path };
}
function labSpecs(result, patient) {
  if (!patient || !result.user_id || result.user_id !== patient.owner_user_id) return [];
  return (Array.isArray(result.image_paths) ? result.image_paths.slice(0,4) : []).flatMap((path, page) => {
    const mime = pathType(path);
    if (!privateArchivePath(path, [result.user_id, patient.id]) || !mime?.startsWith('image/')) return [];
    return [{ source: 'lab', id: result.id, result_id: result.id, page_index: page,
      title: `تصویر تحلیل آزمایش · صفحه ${page + 1}`, mime_type: mime, document_type: 'lab', document_date: null,
      created_at: result.created_at || null, filename: archiveFilename(`آزمایش-${result.id}-${page + 1}`, mime),
      patient_id: patient.id, patient_name: patient.display_name || '', user_id: result.user_id, bucket: 'lab-images', path }];
  });
}
export function publicArchiveFile(file, admin = false) {
  const { bucket, path, user_id, ...metadata } = file;
  return admin ? { ...metadata, user_id } : metadata;
}
export function archiveFilesFromRows(documents, tests, patients, admin = false) {
  const byId = new Map(patients.map(patient => [patient.id, patient]));
  const selfByOwner = new Map(patients.filter(patient => patient.relation === 'self').map(patient => [patient.owner_user_id, patient]));
  const files = [...documents.flatMap(doc => { const file = documentSpec(doc, byId.get(doc.patient_id)); return file ? [file] : []; }),
    ...tests.flatMap(result => labSpecs(result, result.patient_id ? byId.get(result.patient_id) : selfByOwner.get(result.user_id)))];
  return files.sort((a,b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || String(a.id).localeCompare(String(b.id)) || (a.page_index || 0) - (b.page_index || 0))
    .map(file => publicArchiveFile(file, admin));
}
export async function ownedArchivePatient(database, userId, patientId = '') {
  let query = database.from('patients').select('id,owner_user_id,display_name,relation').eq('owner_user_id',userId);
  query = patientId ? query.eq('id',patientId) : query.eq('relation','self');
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}
export async function activeArchiveOwner(database, userId) {
  const { data, error } = await database.from('users').select('id,status').eq('id',userId).maybeSingle();
  if (error) throw error;
  return !!data && data.status === 'active';
}
export async function activeArchiveOwnerIds(database, ids) {
  const active = new Set();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await database.from('users').select('id').in('id',ids.slice(start,start + 200)).eq('status','active');
    if (error) throw error;
    for (const user of data || []) active.add(user.id);
  }
  return active;
}
export async function resolveArchiveFile(database, request, viewerUserId = null) {
  let row, patient;
  if (request.source === 'document') {
    const { data, error } = await database.from('medical_documents').select(DOCUMENT_ARCHIVE_FIELDS).eq('id',request.id).maybeSingle();
    if (error) throw error;
    row = data;
    if (!row || request.page !== 0) return null;
  } else {
    const { data, error } = await database.from('test_results').select(LAB_ARCHIVE_FIELDS).eq('id',request.id).maybeSingle();
    if (error) throw error;
    row = data;
    if (!row) return null;
  }
  if (row.patient_id) {
    const { data, error } = await database.from('patients').select('id,owner_user_id,display_name,relation').eq('id',row.patient_id).maybeSingle();
    if (error) throw error;
    patient = data;
  } else if (request.source === 'lab' && row.user_id) patient = await ownedArchivePatient(database,row.user_id);
  if (!patient || (viewerUserId && patient.owner_user_id !== viewerUserId) || !(await activeArchiveOwner(database,patient.owner_user_id))) return null;
  return request.source === 'document' ? documentSpec(row,patient) : labSpecs(row,patient).find(file => file.page_index === request.page) || null;
}
export async function signArchiveFile(database, file, download = false) {
  const { data, error } = await database.storage.from(file.bucket).createSignedUrl(file.path,ARCHIVE_TTL_SECONDS,download ? { download: file.filename } : undefined);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('ARCHIVE_SIGN_FAILED');
  return { success: true, url: data.signedUrl, title: file.title, mime_type: file.mime_type, filename: file.filename,
    expires_in: ARCHIVE_TTL_SECONDS, page_index: file.page_index ?? null };
}
export async function listArchive(database, { patient, patients = patient ? [patient] : [], offset = 0, admin = false }) {
  if (!patients.length) return { files: [], next_offset: null };
  const patientIds = patients.map(row => row.id), ownerIds = [...new Set(patients.map(row => row.owner_user_id))];
  const take = offset + ARCHIVE_PAGE_SIZE + 1;
  const docQuery = database.from('medical_documents').select(DOCUMENT_ARCHIVE_FIELDS).in('patient_id',patientIds)
    .not('storage_path','is',null).order('created_at',{ascending:false}).limit(take);
  let testQuery = database.from('test_results').select(LAB_ARCHIVE_FIELDS).in('user_id',ownerIds)
    .not('image_paths','is',null).neq('image_paths','{}').order('created_at',{ascending:false}).limit(take);
  if (patient) testQuery = patient.relation === 'self'
    ? testQuery.or(`patient_id.eq.${patient.id},patient_id.is.null`) : testQuery.eq('patient_id',patient.id);
  const [docs, tests] = await Promise.all([docQuery,testQuery]);
  if (docs.error) throw docs.error;
  if (tests.error) throw tests.error;
  const files = archiveFilesFromRows(docs.data || [],tests.data || [],patients,admin);
  return { files: files.slice(offset,offset + ARCHIVE_PAGE_SIZE), next_offset: files.length > offset + ARCHIVE_PAGE_SIZE ? offset + ARCHIVE_PAGE_SIZE : null };
}
