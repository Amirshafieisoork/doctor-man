import crypto from 'node:crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};
  const configuredPassword = process.env.ADMIN_PASSWORD;

  if (!configuredPassword || typeof password !== 'string') {
    return res.status(503).json({ error: 'تنظیمات ورود مدیر کامل نیست' });
  }

  const supplied = Buffer.from(password);
  const expected = Buffer.from(configuredPassword);
  const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);

  if (!valid) {
    return res.status(401).json({ error: 'رمز اشتباه است' });
  }

  return res.status(200).json({
    success: true,
    token: crypto.randomBytes(32).toString('hex')
  });
}
