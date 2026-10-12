import { clearUserSession, clearAdminSession } from './_lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  clearUserSession(res);
  clearAdminSession(res);
  return res.status(200).json({ success: true });
}
