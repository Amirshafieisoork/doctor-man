import crypto from 'node:crypto';

const SETTINGS_KEY = 'private_ai';
const PROVIDERS = new Set(['groq']);
const SCHEMA_VERSION = 1;
const SECRET_PATTERN = /^[\x21-\x7e]{16,512}$/;

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) {
    const error = new Error('AI_SETTINGS_ENCRYPTION_UNAVAILABLE');
    error.code = 'AI_SETTINGS_ENCRYPTION_UNAVAILABLE';
    throw error;
  }
  // A distinct purpose key separates encryption from the session signature key.
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'drman-private-ai-v1', 'api-key-encryption', 32));
}

export function privateAIEncryptionReady() {
  try { encryptionKey(); return true; } catch { return false; }
}

function associatedData(provider) {
  return Buffer.from(`drman:${SETTINGS_KEY}:${SCHEMA_VERSION}:${provider}`, 'utf8');
}

export function encryptPrivateAIKey(apiKey, provider) {
  if (!PROVIDERS.has(provider) || typeof apiKey !== 'string' || !SECRET_PATTERN.test(apiKey)) {
    throw new Error('AI_SETTINGS_INVALID_KEY');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(associatedData(provider));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return {
    version: SCHEMA_VERSION,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  };
}

function decode(value, expectedSize) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 700) {
    throw new Error('AI_SETTINGS_INVALID_CIPHERTEXT');
  }
  const buffer = Buffer.from(value, 'base64url');
  if (buffer.toString('base64url') !== value || (expectedSize && buffer.length !== expectedSize)) {
    throw new Error('AI_SETTINGS_INVALID_CIPHERTEXT');
  }
  return buffer;
}

export function decryptPrivateAIKey(encryptedKey, provider) {
  if (!PROVIDERS.has(provider) || encryptedKey?.version !== SCHEMA_VERSION) {
    throw new Error('AI_SETTINGS_INVALID_CIPHERTEXT');
  }
  const iv = decode(encryptedKey.iv, 12), tag = decode(encryptedKey.tag, 16);
  const ciphertext = decode(encryptedKey.ciphertext);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(associatedData(provider));
  decipher.setAuthTag(tag);
  const apiKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  if (!SECRET_PATTERN.test(apiKey)) throw new Error('AI_SETTINGS_INVALID_KEY');
  return apiKey;
}

async function getDatabase(database) {
  return database || (await import('./db.js')).supabase;
}

async function readRow(database) {
  const db = await getDatabase(database);
  const { data, error } = await db.from('app_settings').select('value,updated_at').eq('key', SETTINGS_KEY).maybeSingle();
  if (error) throw error;
  return data;
}

function validateStored(value) {
  if (value?.version !== SCHEMA_VERSION || !PROVIDERS.has(value.provider) || value.free_only !== true || value.free_account_confirmed !== true) {
    throw new Error('AI_SETTINGS_INVALID_CONFIGURATION');
  }
}

// Only trusted server code may call this function. Never serialize its result.
export async function readPrivateAISettings(database) {
  const row = await readRow(database);
  if (!row) return null;
  validateStored(row.value);
  return {
    provider: row.value.provider,
    free_only: true,
    free_account_confirmed: true,
    api_key: row.value.encrypted_api_key ? decryptPrivateAIKey(row.value.encrypted_api_key, row.value.provider) : null
  };
}

export async function readPublicPrivateAISettings(database) {
  const row = await readRow(database);
  if (!row) return { provider: 'groq', free_only: true, key_configured: false, free_account_confirmed: false, encryption_ready: privateAIEncryptionReady(), updated_at: null };
  validateStored(row.value);
  // Do not report a corrupted/rotated key as configured.
  const configured = !!(row.value.encrypted_api_key && decryptPrivateAIKey(row.value.encrypted_api_key, row.value.provider));
  return {
    provider: row.value.provider,
    free_only: true,
    key_configured: configured,
    free_account_confirmed: true,
    encryption_ready: privateAIEncryptionReady(),
    updated_at: row.updated_at || null
  };
}

export async function savePrivateAISettings(input, database) {
  if (!input || !PROVIDERS.has(input.provider) || (input.free_only !== undefined && input.free_only !== true) || input.free_account_confirmed !== true) {
    const error = new Error('AI_SETTINGS_INVALID_CONFIGURATION'); error.status = 400; throw error;
  }
  if (input.api_key !== undefined && typeof input.api_key !== 'string') {
    const error = new Error('AI_SETTINGS_INVALID_KEY'); error.status = 400; throw error;
  }
  if (input.clear_key !== undefined && typeof input.clear_key !== 'boolean') {
    const error = new Error('AI_SETTINGS_INVALID_CONFIGURATION'); error.status = 400; throw error;
  }
  const apiKey = input.api_key?.trim() || '';
  if ((apiKey && !SECRET_PATTERN.test(apiKey)) || (apiKey && input.clear_key)) {
    const error = new Error('AI_SETTINGS_INVALID_KEY'); error.status = 400; throw error;
  }
  const db = await getDatabase(database);
  const previous = await readRow(db);
  let encryptedKey = null;
  if (apiKey) encryptedKey = encryptPrivateAIKey(apiKey, input.provider);
  else if (!input.clear_key && previous?.value?.provider === input.provider && previous.value.encrypted_api_key) {
    validateStored(previous.value);
    // Detect invalid ciphertext before preserving it; never silently use another provider.
    decryptPrivateAIKey(previous.value.encrypted_api_key, input.provider);
    // A blank field means no key change. Do not rewrite a stale ciphertext over
    // another administrator's newly rotated key between this read and a write.
    return { provider: input.provider, free_only: true, key_configured: true, free_account_confirmed: true, encryption_ready: true, updated_at: previous.updated_at || null };
  } else if (!input.clear_key) {
    const error = new Error('AI_SETTINGS_KEY_REQUIRED'); error.status = 400; throw error;
  }
  const updatedAt = new Date().toISOString();
  const { error } = await db.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: { version: SCHEMA_VERSION, provider: input.provider, free_only: true, free_account_confirmed: true, encrypted_api_key: encryptedKey },
    updated_at: updatedAt
  }, { onConflict: 'key' });
  if (error) throw error;
  return { provider: input.provider, free_only: true, key_configured: !!encryptedKey, free_account_confirmed: true, encryption_ready: privateAIEncryptionReady(), updated_at: updatedAt };
}
