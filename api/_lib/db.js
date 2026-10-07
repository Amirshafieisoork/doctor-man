import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) throw new Error('Supabase server configuration is missing (SUPABASE_URL + SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY)');

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});
