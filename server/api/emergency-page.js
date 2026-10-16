import crypto from 'node:crypto';
import { supabase } from './_lib/db.js';
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const telephone = value => String(value).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[^+\d]/g, '');
const severity = { severe: 'شدید', moderate: 'متوسط', mild: 'خفیف', unknown: '' };

export function createEmergencyPageHandler({ database = supabase } = {}) {
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (req.method !== 'GET') return res.status(405).end('Method not allowed');
    const token = String(req.query?.token || '').trim();
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return res.status(404).end('کارت پیدا نشد یا غیرفعال شده است.');
    try {
      const found = await database.from('emergency_cards').select('patient_id,enabled,show_blood_type,show_allergies,show_conditions,show_medications,show_emergency_contact').eq('token_hash', hash(token)).eq('enabled', true).maybeSingle();
      if (found.error) throw found.error;
      const card = found.data;
      if (!card) return res.status(404).end('کارت پیدا نشد یا غیرفعال شده است.');
      const patient = await database.from('patients').select('display_name,blood_type,emergency_contact_name,emergency_contact_phone').eq('id', card.patient_id).maybeSingle();
      if (patient.error) throw patient.error;
      if (!patient.data) return res.status(404).end('کارت پیدا نشد یا غیرفعال شده است.');
      const p = patient.data;
      const sections = await Promise.all([
        card.show_allergies ? database.from('patient_allergies').select('allergen,severity,reaction').eq('patient_id', card.patient_id).limit(30) : Promise.resolve({ data: [] }),
        card.show_conditions ? database.from('patient_conditions').select('name,status').eq('patient_id', card.patient_id).eq('status', 'active').limit(30) : Promise.resolve({ data: [] }),
        card.show_medications ? database.from('patient_medications').select('name,dose,frequency').eq('patient_id', card.patient_id).eq('status', 'active').limit(30) : Promise.resolve({ data: [] })
      ]);
      if (sections.some(section => section.error)) throw new Error('EMERGENCY_FIELDS_UNAVAILABLE');
      const list = (title, visible, rows, render) => visible ? `<section class="emergency-public-section"><h2>${title}</h2>${rows?.length ? rows.map(render).join('') : '<p class="emergency-muted">اطلاعاتی ثبت نشده است.</p>'}</section>` : '';
      const contact = card.show_emergency_contact && p.emergency_contact_phone ? `<div class="emergency-contact"><span>تماس اضطراری</span><strong>${esc(p.emergency_contact_name || 'فرد مورد اعتماد')}</strong><a dir="ltr" href="tel:${esc(telephone(p.emergency_contact_phone))}">${esc(p.emergency_contact_phone)}</a></div>` : '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).end(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="color-scheme" content="light dark"><title>کارت اضطراری سلامت | DrMan</title><link rel="stylesheet" href="/assets/emergency-card.css"></head><body class="emergency-public-page"><main class="emergency-public-wrap"><article class="emergency-glass-card"><div class="emergency-card-brand"><span>DrMan · دکتر من</span><span class="emergency-card-chip">کارت اضطراری سلامت</span></div><h1>${esc(p.display_name)}</h1><p class="emergency-card-subtitle">اطلاعات ضروری برای کمک سریع‌تر</p><div class="emergency-public-basics">${card.show_blood_type ? `<div class="emergency-blood"><span>گروه خونی ثبت‌شده</span><strong dir="ltr">${esc(p.blood_type || 'ثبت نشده')}</strong><small>پیش از تزریق خون باید آزمایش تطبیق انجام شود.</small></div>` : ''}${contact}</div><p class="emergency-muted">این اطلاعات را صاحب پرونده برای شرایط اضطراری به اشتراک گذاشته است. ممکن است کامل یا به‌روز نباشد؛ صحت آن باید هنگام رسیدگی بررسی شود.</p></article>${list('حساسیت‌ها', card.show_allergies, sections[0].data, item => `<div class="emergency-public-item"><strong class="${item.severity === 'severe' ? 'emergency-danger' : ''}">${esc(item.allergen)}</strong><p>${esc([severity[item.severity] || '', item.reaction].filter(Boolean).join(' · '))}</p></div>`)}${list('بیماری‌های فعال', card.show_conditions, sections[1].data, item => `<div class="emergency-public-item"><strong>${esc(item.name)}</strong></div>`)}${list('داروهای فعال', card.show_medications, sections[2].data, item => `<div class="emergency-public-item"><strong>${esc(item.name)}</strong><p>${esc([item.dose, item.frequency].filter(Boolean).join(' · '))}</p></div>`)}<footer class="emergency-public-footer"><a href="/">ورود به دکتر من</a><button type="button" id="emergencyPublicPrint">چاپ اطلاعات ضروری</button><p>در وضعیت اضطراری با اورژانس ۱۱۵ تماس بگیرید.</p></footer></main><script src="/assets/emergency-public.js" defer></script><script src="/assets/ai-chat.js" defer></script></body></html>`);
    } catch {
      return res.status(503).end('نمایش اطلاعات اضطراری موقتاً ممکن نیست؛ دوباره تلاش کنید.');
    }
  };
}
export default createEmergencyPageHandler();
