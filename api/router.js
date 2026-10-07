export const config = { api: { bodyParser: false } };

const ROUTES = {
  "account": () => import("../server/api/account.js"),
  "account-deletion-request": () => import("../server/api/account-deletion-request.js"),
  "account-export": () => import("../server/api/account-export.js"),
  "admin-action": () => import("../server/api/admin-action.js"),
  "admin-content": () => import("../server/api/admin-content.js"),
  "admin-dashboard": () => import("../server/api/admin-dashboard.js"),
  "admin-doctor": () => import("../server/api/admin-doctor.js"),
  "admin-login": () => import("../server/api/admin-login.js"),
  "admin-organization": () => import("../server/api/admin-organization.js"),
  "admin-settings": () => import("../server/api/admin-settings.js"),
  "analyze-secure": () => import("../server/api/analyze-secure.js"),
  "appointments": () => import("../server/api/appointments.js"),
  "availability": () => import("../server/api/availability.js"),
  "biomarker-trends": () => import("../server/api/biomarker-trends.js"),
  "care-episodes": () => import("../server/api/care-episodes.js"),
  "care-plan": () => import("../server/api/care-plan.js"),
  "clinical-workspace": () => import("../server/api/clinical-workspace.js"),
  "consent": () => import("../server/api/consent.js"),
  "doctor-access": () => import("../server/api/doctor-access.js"),
  "doctor-dashboard": () => import("../server/api/doctor-dashboard.js"),
  "doctor-onboarding": () => import("../server/api/doctor-onboarding.js"),
  "doctor-page": () => import("../server/api/doctor-page.js"),
  "doctor-patient-record": () => import("../server/api/doctor-patient-record.js"),
  "doctors": () => import("../server/api/doctors.js"),
  "documents": () => import("../server/api/documents.js"),
  "emergency-card": () => import("../server/api/emergency-card.js"),
  "emergency-page": () => import("../server/api/emergency-page.js"),
  "get-plans": () => import("../server/api/get-plans.js"),
  "health-entry": () => import("../server/api/health-entry.js"),
  "health-navigator": () => import("../server/api/health-navigator.js"),
  "health-record": () => import("../server/api/health-record.js"),
  "learn-page": () => import("../server/api/learn-page.js"),
  "login": () => import("../server/api/login.js"),
  "logout": () => import("../server/api/logout.js"),
  "manage-plans": () => import("../server/api/manage-plans.js"),
  "messages": () => import("../server/api/messages.js"),
  "notifications": () => import("../server/api/notifications.js"),
  "patients": () => import("../server/api/patients.js"),
  "payment-callback": () => import("../server/api/payment-callback.js"),
  "payment-start": () => import("../server/api/payment-start.js"),
  "previsit-intake": () => import("../server/api/previsit-intake.js"),
  "register": () => import("../server/api/register.js"),
  "robots": () => import("../server/api/robots.js"),
  "session": () => import("../server/api/session.js"),
  "sitemap": () => import("../server/api/sitemap.js"),
  "support-chat": () => import("../server/api/support-chat.js"),
  "analyze-lab": () => import("../server/api/analyze-secure.js")
};

class BodyError extends Error {}

async function prepareBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.body != null) return;
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();

  // Multipart endpoints stream the original request directly to Busboy.
  if (contentType.startsWith('multipart/form-data')) return;

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) throw new BodyError('حجم درخواست بیش از حد مجاز است');
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    req.body = {};
    return;
  }

  if (contentType.includes('application/json')) {
    try { req.body = JSON.parse(raw); }
    catch { throw new BodyError('بدنه JSON معتبر نیست'); }
    return;
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    req.body = Object.fromEntries(new URLSearchParams(raw));
    return;
  }

  req.body = raw;
}

export default async function handler(req, res) {
  const rawRoute = String(req.query?.route || '').replace(/^\/+|\/+$/g, '');
  const route = rawRoute.split('/')[0];

  if (!route || !ROUTES[route]) {
    return res.status(404).json({ success: false, error: 'API route پیدا نشد' });
  }

  try {
    await prepareBody(req);
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'route')) delete req.query.route;
    const mod = await ROUTES[route]();
    const fn = mod?.default;
    if (typeof fn !== 'function') throw new Error('INVALID_HANDLER');
    return await fn(req, res);
  } catch (error) {
    if (error instanceof BodyError) return res.status(400).json({ success: false, error: error.message });
    console.error('api-router', route, error);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'خطای داخلی سرویس' });
  }
}
