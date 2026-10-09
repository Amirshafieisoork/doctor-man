import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const directKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const proxyKey = process.env.SUPABASE_PROXY_KEY;

if (!url) throw new Error('Supabase URL is missing');

function proxyFetch(input, init = {}) {
  if (!proxyKey || !publishableKey) throw new Error('Supabase service proxy is not configured');
  const targetUrl = new URL(typeof input === 'string' ? input : input.url);
  if (targetUrl.origin !== new URL(url).origin) throw new Error('Unexpected Supabase target');
  if (!targetUrl.pathname.startsWith('/rest/v1/') && !targetUrl.pathname.startsWith('/storage/v1/')) {
    throw new Error('Unsupported Supabase proxy target');
  }

  const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers));
  headers.delete('authorization');
  headers.delete('apikey');
  headers.set('x-drman-proxy-key', proxyKey);
  headers.set('x-drman-target', targetUrl.pathname + targetUrl.search);

  return fetch(`${url}/functions/v1/drman-service-proxy`, {
    ...init,
    headers
  });
}

const key = directKey || publishableKey;
if (!key) throw new Error('Supabase server configuration is missing');

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(directKey ? {} : { global: { fetch: proxyFetch } })
});

export const usingSupabaseProxy = !directKey;
