import { requestDigiPayToken } from '../server/api/_lib/digipay.js';
import { readEffectiveDigiPaySettings } from '../server/api/_lib/private-digipay-settings.js';

const PREFIX = 'DRMAN_DIGIPAY_AUTH_CHECK';
const UAT_BASE = 'https://uat.mydigipay.info/digipay/api';
const PRODUCTION_BASE = 'https://api.mydigipay.com/digipay/api';

function report(result) {
  process.stdout.write(`${PREFIX} ${JSON.stringify(result)}\n`);
}

async function checkAuthentication() {
  let settings;
  try { settings = await readEffectiveDigiPaySettings(); }
  catch { report({ configured: false, authenticated: false, code: 'DIGIPAY_SETTINGS_UNAVAILABLE' }); return; }
  const missing = ['client_id','client_secret','username','password'].filter(field => !settings.credentials[field]);
  if (missing.length) {
    report({ configured: false, authenticated: false, missing, code: 'DIGIPAY_NOT_CONFIGURED' });
    return;
  }

  // Match the adapter's default and single trailing-slash normalization. Do
  // not allow other hosts, URL credentials, ports, queries or fragments.
  const base = settings.baseUrl;
  const environment = base === PRODUCTION_BASE ? 'production' : base === UAT_BASE ? 'uat' : null;
  if (!environment) {
    report({ configured: false, authenticated: false, code: 'DIGIPAY_NOT_CONFIGURED' });
    return;
  }

  const originalFetch = globalThis.fetch;
  try {
    // The standalone probe may call only OAuth. A redirect must never forward
    // its credentials to an unvalidated destination.
    globalThis.fetch = (input, options) => {
      const target = typeof input === 'string' ? input : input?.url;
      if (target !== `${base}/oauth/token` || options?.method !== 'POST') {
        throw new Error('DIGIPAY_NOT_CONFIGURED');
      }
      return originalFetch(input, { ...options, redirect: 'error' });
    };
    await requestDigiPayToken(settings);
    report({ configured: true, authenticated: true, environment, code: 'OK' });
  } catch (error) {
    const code = error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT'
      ? 'TIMEOUT' : error?.message === 'DIGIPAY_NOT_CONFIGURED'
        ? 'DIGIPAY_NOT_CONFIGURED' : error?.message === 'DIGIPAY_AUTH_FAILED'
          ? 'DIGIPAY_AUTH_FAILED' : 'NETWORK_ERROR';
    report({ configured: code !== 'DIGIPAY_NOT_CONFIGURED', authenticated: false, environment, code });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (process.env.DRMAN_DIGIPAY_AUTH_CHECK === '1') await checkAuthentication();
