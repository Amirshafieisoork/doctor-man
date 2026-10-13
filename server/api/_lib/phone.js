export function normalizeIranianMobile(value) {
  let phone = String(value ?? '').trim()
    .replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/[\s()\u200b-\u200f\u202a-\u202e\u2066-\u2069-]/g, '');
  if (/^(?:\+98|0098|98)9\d{9}$/.test(phone)) phone = '0' + phone.slice(-10);
  else if (/^9\d{9}$/.test(phone)) phone = '0' + phone;
  return phone;
}
