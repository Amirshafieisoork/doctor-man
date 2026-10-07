const DEFAULT_STAGING = 'https://uat.mydigipay.info/digipay/api';

function config() {
  const baseUrl = String(process.env.DIGIPAY_BASE_URL || DEFAULT_STAGING).replace(/\/$/, '');
  const clientId = process.env.DIGIPAY_CLIENT_ID;
  const clientSecret = process.env.DIGIPAY_CLIENT_SECRET;
  const username = process.env.DIGIPAY_USERNAME;
  const password = process.env.DIGIPAY_PASSWORD;
  if (!clientId || !clientSecret || !username || !password) {
    const error = new Error('DIGIPAY_NOT_CONFIGURED');
    error.publicMessage = 'درگاه دیجی‌پی هنوز توسط مدیر سایت فعال نشده است.';
    throw error;
  }
  return { baseUrl, clientId, clientSecret, username, password };
}

export async function getDigiPayToken() {
  const c = config();
  const form = new FormData();
  form.append('username', c.username);
  form.append('password', c.password);
  form.append('grant_type', 'password');
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const response = await fetch(`${c.baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    console.error('DigiPay token error', response.status, data);
    throw new Error('DIGIPAY_AUTH_FAILED');
  }
  return { accessToken: data.access_token, baseUrl: c.baseUrl };
}

export async function createDigiPayTicket({ amountRial, cellNumber, providerId, callbackUrl }) {
  const { accessToken, baseUrl } = await getDigiPayToken();
  const response = await fetch(`${baseUrl}/tickets/business?type=11`, {
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
    console.error('DigiPay ticket error', response.status, data);
    throw new Error('DIGIPAY_TICKET_FAILED');
  }
  return data;
}

export async function verifyDigiPayPayment({ trackingCode, providerId }) {
  const { accessToken, baseUrl } = await getDigiPayToken();
  const verifyType = Number(process.env.DIGIPAY_VERIFY_TYPE || 0);
  const response = await fetch(`${baseUrl}/purchases/verify?type=${Number.isFinite(verifyType) ? verifyType : 0}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({ trackingCode, providerId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.result?.status !== 0) {
    console.error('DigiPay verify error', response.status, data);
    const error = new Error('DIGIPAY_VERIFY_FAILED');
    error.response = data;
    throw error;
  }
  return data;
}
