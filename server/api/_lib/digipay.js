import { DIGIPAY_BASES, readEffectiveDigiPaySettings } from './private-digipay-settings.js';
function safeGatewayUrl(value){
  const u=new URL(String(value||''));
  const h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||!(h==='mydigipay.com'||h.endsWith('.mydigipay.com')||h==='mydigipay.info'||h.endsWith('.mydigipay.info')))throw new Error('DIGIPAY_REDIRECT_INVALID');
  return u.toString();
}
async function timedFetch(url,options={},timeoutMs=12000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,redirect:'error',signal:controller.signal})}finally{clearTimeout(timer)}
}

export async function requestDigiPayToken(settings) {
  const { client_id: clientId, client_secret: clientSecret, username, password } = settings?.credentials || {};
  const baseUrl = settings?.baseUrl;
  if (!Object.values(DIGIPAY_BASES).includes(baseUrl) || !clientId || !clientSecret || !username || !password) {
    const error = new Error('DIGIPAY_NOT_CONFIGURED');
    error.publicMessage = 'درگاه دیجی‌پی هنوز توسط مدیر سایت فعال نشده است.';
    throw error;
  }
  const form = new FormData();
  form.append('username', username);
  form.append('password', password);
  form.append('grant_type', 'password');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await timedFetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 8192) {
    const error = new Error(response.status === 429 ? 'DIGIPAY_RATE_LIMIT' : response.status >= 500 ? 'DIGIPAY_UNAVAILABLE' : 'DIGIPAY_AUTH_FAILED');
    error.provider_status = response.status;
    throw error;
  }
  return { accessToken: data.access_token, baseUrl };
}

export async function getDigiPayToken() { return requestDigiPayToken(await readEffectiveDigiPaySettings()); }

export async function createDigiPayTicket({ amountRial, cellNumber, providerId, callbackUrl }) {
  const { accessToken, baseUrl } = await getDigiPayToken();
  const response = await timedFetch(`${baseUrl}/tickets/business?type=11`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      Agent: 'WEB',
      'Digipay-Version': '2022-02-02'
    },
    body: JSON.stringify({
      amount: amountRial,
      cellNumber,
      providerId,
      callbackUrl,
      additionalInfo: { preferredGateway: 2 }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.result?.status !== 0 || !data.redirectUrl || !data.ticket) {
    console.error('DigiPay ticket error', response.status);
    throw new Error('DIGIPAY_TICKET_FAILED');
  }
  return {...data,redirectUrl:safeGatewayUrl(data.redirectUrl)};
}

export async function verifyDigiPayPayment({ trackingCode, providerId }) {
  const { accessToken, baseUrl } = await getDigiPayToken();
  const verifyType = Number(process.env.DIGIPAY_VERIFY_TYPE || 0);
  const response = await timedFetch(`${baseUrl}/purchases/verify?type=${Number.isFinite(verifyType) ? verifyType : 0}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({ trackingCode, providerId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.result?.status !== 0) {
    console.error('DigiPay verify error', response.status);
    const error = new Error('DIGIPAY_VERIFY_FAILED');
    error.response = data;
    throw error;
  }
  return data;
}
