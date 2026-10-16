import crypto from 'node:crypto';

const KEY = 'private_digipay', VERSION = 1;
export const DIGIPAY_BASES = Object.freeze({ production: 'https://api.mydigipay.com/digipay/api', uat: 'https://uat.mydigipay.info/digipay/api' });
export const DIGIPAY_FIELDS = Object.freeze(['client_id', 'client_secret', 'username', 'password']);
const ENV_FIELDS = ['DIGIPAY_CLIENT_ID', 'DIGIPAY_CLIENT_SECRET', 'DIGIPAY_USERNAME', 'DIGIPAY_PASSWORD'];
function failure(code, status) { const error = new Error(code); error.code = code; if (status) error.status = status; return error; }
function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) throw failure('DIGIPAY_ENCRYPTION_UNAVAILABLE');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'drman-private-digipay-v1', 'merchant-credentials-encryption', 32));
}
export function privateDigiPayEncryptionReady() { try { encryptionKey(); return true; } catch { return false; } }
function validCredential(value, field) { return typeof value === 'string' && value.length >= 1 && value.length <= 1024 && !/[\u0000-\u0020\u007f]/u.test(value) && !(field === 'client_id' && value.includes(':')); }
function associatedData(environment) { return Buffer.from(`drman:${KEY}:${VERSION}:${environment}`); }
export function encryptDigiPayCredentials(credentials, environment) {
  if (!Object.hasOwn(DIGIPAY_BASES, environment) || !DIGIPAY_FIELDS.every(field => validCredential(credentials?.[field], field))) throw failure('DIGIPAY_INVALID_CREDENTIALS', 400);
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(associatedData(environment));
  const plaintext = JSON.stringify(Object.fromEntries(DIGIPAY_FIELDS.map(field => [field, credentials[field]])));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { version: VERSION, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}
function decode(value, size) {
  if (typeof value !== 'string' || value.length > 10000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw failure('DIGIPAY_INVALID_CIPHERTEXT');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (size && bytes.length !== size)) throw failure('DIGIPAY_INVALID_CIPHERTEXT');
  return bytes;
}
export function decryptDigiPayCredentials(envelope, environment) {
  if (!Object.hasOwn(DIGIPAY_BASES, environment) || envelope?.version !== VERSION) throw failure('DIGIPAY_INVALID_CIPHERTEXT');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), decode(envelope.iv, 12));
  decipher.setAAD(associatedData(environment)); decipher.setAuthTag(decode(envelope.tag, 16));
  const parsed = JSON.parse(Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]).toString('utf8'));
  if (!DIGIPAY_FIELDS.every(field => validCredential(parsed?.[field], field))) throw failure('DIGIPAY_INVALID_CIPHERTEXT');
  return Object.fromEntries(DIGIPAY_FIELDS.map(field => [field, parsed[field]]));
}
async function database(db) { return db || (await import('./db.js')).supabase; }
async function readRow(db) {
  const { data, error } = await (await database(db)).from('app_settings').select('value,updated_at').eq('key', KEY).maybeSingle();
  if (error) throw error; return data;
}
export function environmentDigiPaySettings() {
  const base = String(process.env.DIGIPAY_BASE_URL || DIGIPAY_BASES.uat).replace(/\/$/, '');
  const environment = Object.keys(DIGIPAY_BASES).find(name => DIGIPAY_BASES[name] === base) || null;
  return { source: 'environment', environment, baseUrl: environment ? DIGIPAY_BASES[environment] : null, credentials: Object.fromEntries(DIGIPAY_FIELDS.map((field, index) => [field, process.env[ENV_FIELDS[index]] || ''])), revision: null, last_auth_check: null };
}
function storedSettings(row) {
  if (row.value?.version !== VERSION || !Object.hasOwn(DIGIPAY_BASES, row.value.environment)) throw failure('DIGIPAY_INVALID_CONFIGURATION');
  return { source: 'private', environment: row.value.environment, baseUrl: DIGIPAY_BASES[row.value.environment], credentials: decryptDigiPayCredentials(row.value.encrypted_credentials, row.value.environment), revision: row.updated_at, last_auth_check: row.value.last_auth_check || null };
}
// Server only. Never send credentials or this object's entire contents to clients.
export async function readEffectiveDigiPaySettings(db) { const row = await readRow(db); return row ? storedSettings(row) : environmentDigiPaySettings(); }
function publicSummary(settings) {
  const fields = Object.fromEntries(DIGIPAY_FIELDS.map(field => [field, validCredential(settings.credentials[field], field)]));
  const check = settings.last_auth_check;
  return { environment: settings.environment || 'production', source: settings.source, configured: !!settings.environment && Object.values(fields).every(Boolean), fields, encryption_ready: privateDigiPayEncryptionReady(), updated_at: settings.revision || null,
    last_auth_check: check && ['OK', 'DIGIPAY_AUTH_FAILED', 'DIGIPAY_RATE_LIMIT', 'DIGIPAY_UNAVAILABLE', 'DIGIPAY_TIMEOUT', 'DIGIPAY_NETWORK_ERROR'].includes(check.code) && Number.isFinite(Date.parse(check.checked_at)) ? { code: check.code, authenticated: check.code === 'OK', checked_at: check.checked_at } : null };
}
export async function readPublicDigiPaySettings(db) { return publicSummary(await readEffectiveDigiPaySettings(db)); }
export async function savePrivateDigiPaySettings(input, db) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(DIGIPAY_BASES, input.environment) || Object.keys(input).some(key => ![...DIGIPAY_FIELDS, 'environment'].includes(key))) throw failure('DIGIPAY_INVALID_CONFIGURATION', 400);
  const supplied = {};
  for (const field of DIGIPAY_FIELDS) {
    if (input[field] !== undefined && typeof input[field] !== 'string') throw failure('DIGIPAY_INVALID_CREDENTIALS', 400);
    const value = input[field]?.trim() || '';
    if (value && !validCredential(value, field)) throw failure('DIGIPAY_INVALID_CREDENTIALS', 400);
    if (value) supplied[field] = value;
  }
  const client = await database(db), previous = await readRow(client), existing = previous ? storedSettings(previous) : environmentDigiPaySettings();
  // Old environment fields may have been guesses. The first encrypted setup
  // must receive all four official values instead of silently preserving them.
  if (!previous && DIGIPAY_FIELDS.some(field => !supplied[field])) throw failure('DIGIPAY_CREDENTIALS_REQUIRED', 400);
  if (existing.environment !== input.environment && DIGIPAY_FIELDS.some(field => !supplied[field])) throw failure('DIGIPAY_ENVIRONMENT_CREDENTIALS_REQUIRED', 400);
  const credentials = { ...existing.credentials, ...supplied };
  if (!DIGIPAY_FIELDS.every(field => validCredential(credentials[field], field))) throw failure('DIGIPAY_CREDENTIALS_REQUIRED', 400);
  if (previous && !Object.keys(supplied).length && existing.environment === input.environment) return publicSummary(existing);
  const updatedAt = new Date(Math.max(Date.now(), (Date.parse(previous?.updated_at) || 0) + 1)).toISOString();
  const value = { version: VERSION, environment: input.environment, encrypted_credentials: encryptDigiPayCredentials(credentials, input.environment), last_auth_check: null };
  const result = previous
    ? await client.from('app_settings').update({ value, updated_at: updatedAt }).eq('key', KEY).eq('updated_at', previous.updated_at).select('updated_at').maybeSingle()
    : await client.from('app_settings').insert({ key: KEY, value, updated_at: updatedAt }).select('updated_at').single();
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw failure('DIGIPAY_SETTINGS_CHANGED', 409);
  if (result.error) throw result.error;
  return publicSummary({ source: 'private', environment: input.environment, credentials, revision: updatedAt, last_auth_check: null });
}
// The compare-and-swap stops a completed test from overwriting newly rotated credentials.
export async function recordDigiPayAuthCheck(settings, code, db) {
  if (settings.source !== 'private' || !settings.revision) return;
  const client = await database(db), row = await readRow(client);
  if (!row || row.updated_at !== settings.revision) return;
  const checkedAt = new Date(Math.max(Date.now(), Date.parse(settings.revision) + 1)).toISOString();
  const { error } = await client.from('app_settings').update({ value: { ...row.value, last_auth_check: { code, checked_at: checkedAt } }, updated_at: checkedAt }).eq('key', KEY).eq('updated_at', settings.revision);
  if (error) throw error;
}
