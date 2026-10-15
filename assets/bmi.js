// Pure calculations shared by the health page and its regression tests.
export function measurement(value, min, max) {
  if (value === '' || value == null || !['number', 'string'].includes(typeof value)) return null;
  const text = String(value).trim().replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/٫/g, '.');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function unroundedBMI(weightKg, heightCm) {
  const weight = measurement(weightKg, .2, 500), height = measurement(heightCm, 20, 260);
  return weight == null || height == null ? null : weight / ((height / 100) ** 2);
}
export function calculateBMI(weightKg, heightCm) {
  const value = unroundedBMI(weightKg, heightCm);
  return value == null ? null : Math.round(value * 10) / 10;
}
export function ageInYears(birthDate, now = new Date()) {
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const birth = new Date(birthDate + 'T00:00:00Z');
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== birthDate || birth > now) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age <= 125 ? age : null;
}
const pregnancyPositive = status => ['yes', 'possible', 'pregnant', 'باردار'].includes(status);
export function pregnancyContext(patient = {}, record = {}) {
  const positive = pregnancyPositive;
  const explicit = status => positive(status) || ['no', 'not_applicable'].includes(status);
  const result = (status, detail) => ({ status: status === 'pregnant' || status === 'باردار' ? 'yes' : status, detail });
  // A current active diagnosis still needs pregnancy-specific weight advice.
  if ((record.conditions || []).some(item => item.status !== 'resolved' && item.status !== 'inactive' && /باردار|pregnan/i.test(item.name || ''))) return result('yes', 'active_condition');
  if (explicit(patient.pregnancy_status)) return result(patient.pregnancy_status, 'current_profile');
  const observations = [
    ...(record.encounters || []).map(item => ({ status: item.pregnancy_status, at: item.occurred_at, source: 'encounter' })),
    ...(record.visit_intakes || []).map(item => ({
      status: item.pregnancy_status, source: 'visit_intake',
      // Reviewing an old intake updates its row, not the date on which the
      // patient reported pregnancy. A fresh draft/submission may change it.
      at: item.status === 'reviewed' ? item.submitted_at || item.created_at : item.updated_at || item.submitted_at || item.created_at
    }))
  ].filter(item => explicit(item.status)).map(item => ({ ...item, time: Number.isFinite(Date.parse(item.at)) ? Date.parse(item.at) : 0 }));
  observations.sort((a, b) => b.time - a.time || Number(positive(b.status)) - Number(positive(a.status)));
  // Unknown/missing answers do not undo a known pregnancy. A later explicit
  // "no" does resolve historical pregnancy instead of blocking BMI forever.
  return observations.length ? result(observations[0].status, observations[0].source) : result('unknown', 'not_recorded');
}
export function hasPregnancyContext(patient = {}, record = {}) {
  return pregnancyPositive(pregnancyContext(patient, record).status);
}
export function bmiGuidance({ weightKg, heightCm, birthDate, pregnancy = false, now = new Date() } = {}) {
  const rawBMI = unroundedBMI(weightKg, heightCm), bmi = rawBMI == null ? null : Math.round(rawBMI * 10) / 10, age = ageInYears(birthDate, now);
  if (bmi == null) return { bmi: null, category: 'incomplete', title: 'قد و وزن را کامل کنید', advice: ['برای محاسبه تناسب قد و وزن، هر دو مقدار را وارد کنید.'] };
  if (age == null) return { bmi, category: 'age-needed', title: 'برای توضیح این عدد، تاریخ تولد را ثبت کنید', advice: ['بدون سن نمی‌توان محدوده بزرگسالان را به این عدد نسبت داد.'] };
  if (age < 2) return { bmi, category: 'infant', title: 'ارزیابی رشد شیرخوار', advice: ['در زیر ۲ سال، رشد با نمودار وزن نسبت به طول بدن و نظر پزشک بررسی می‌شود؛ این عدد هدف وزن تعیین نمی‌کند.'] };
  if (age < 20) return { bmi, category: 'child', title: 'نیاز به نمودار رشد متناسب با سن', advice: ['در کودکان و نوجوانان، این عدد باید با نمودار رشدِ متناسب با سن و جنس بررسی شود؛ محدوده بزرگسالان کاربرد ندارد.', 'وعده‌های منظم، بازی و تحرک روزانه و خواب کافی را پیگیری کنید؛ رژیم کاهش وزن خودسرانه مناسب نیست.'] };
  if (pregnancy) return { bmi, category: 'pregnancy', title: 'وزن در بارداری نیاز به بررسی جداگانه دارد', advice: ['در بارداری یا احتمال آن، این عدد و محدوده معمول بزرگسالان برای هدف‌گذاری وزن کافی نیست. افزایش وزن مناسب را با ماما یا پزشک بررسی کنید؛ رژیم کاهش وزن خودسرانه نگیرید.'] };
  if (rawBMI < 10 || rawBMI > 80) return { bmi, category: 'check', title: 'قد و وزن را دوباره بررسی کنید', advice: ['واحد قد باید سانتی‌متر و وزن کیلوگرم باشد. اگر اندازه‌ها درست‌اند، برای ارزیابی با پزشک مشورت کنید.'] };
  // Only the displayed number is rounded; rounding must not change a clinical band.
  const category = rawBMI < 18.5 ? 'underweight' : rawBMI < 25 ? 'healthy' : rawBMI < 30 ? 'overweight' : 'obesity';
  const titles = { underweight: 'وزن پایین‌تر از محدوده معمول', healthy: 'در محدوده معمول بزرگسالان', overweight: 'وزن بالاتر از محدوده معمول', obesity: 'وزن نیازمند پیگیری بیشتر' };
  const advice = {
    underweight: ['وعده‌های منظم و میان‌وعده‌های مغذی مثل ماست، تخم‌مرغ یا مغزهای بدون نمک را در صورت نداشتن حساسیت و در حد تحمل اضافه کنید.', 'برای تقویت عضله، فعالیت قدرتی سبک را به‌تدریج شروع کنید. کاهش وزن ناخواسته، بی‌اشتهایی یا ضعف را با پزشک بررسی کنید.'],
    healthy: ['برای حفظ وزن، وعده‌های متعادل، سبزی، حبوبات و منابع پروتئین را در برنامه روزانه نگه دارید.', 'فعالیت متناسب با توان، خواب منظم و بررسی دوره‌ای وزن کمک‌کننده‌اند.'],
    overweight: ['تغییرهای کوچک را ماندگار کنید: نوشیدنی شیرین را با نوشیدنی بدون شکر جایگزین کنید و سهم سبزی و حبوبات را بیشتر کنید.', 'از پیاده‌روی کوتاه شروع کنید و در حد توان زمان آن را کم‌کم بیشتر کنید؛ کاهش وزن تدریجی و قابل‌حفظ بهتر از رژیم سخت است.'],
    obesity: ['برای برنامه شخصی و بررسی فشار خون، قند و عوامل زمینه‌ای با پزشک یا متخصص تغذیه مشورت کنید.', 'از همین هفته نوشیدنی‌های شیرین را کمتر کنید، وعده‌ها را منظم نگه دارید و تحرک کوتاه و متناسب با توان را بیشتر کنید؛ هدف اولیه، تغییرهای کوچک و ماندگار است.']
  }[category];
  const height = measurement(heightCm, 20, 260) / 100;
  return { bmi, category, title: titles[category], range: { min: Math.round(18.5 * height ** 2 * 10) / 10, max: Math.round(24.9 * height ** 2 * 10) / 10 }, advice: [...advice, 'این شاخص به‌تنهایی وضعیت سلامت یا ترکیب عضله و چربی را مشخص نمی‌کند. در بارداری، سالمندی، ورزش حرفه‌ای یا بیماری زمینه‌ای، برنامه وزن باید شخصی‌سازی شود.'] };
}
