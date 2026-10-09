const base = () => String(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || 'https://drman.vercel.app').replace(/\/$/, '');

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');
  const text = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /doctor-portal\nDisallow: /health\nDisallow: /profile\nDisallow: /settings\nDisallow: /account\nDisallow: /auth\nDisallow: /support\nDisallow: /visit-intake\nDisallow: /payment-result\nDisallow: /emergency/\nDisallow: /api/\nSitemap: ${base()}/sitemap.xml\n`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(text);
}
