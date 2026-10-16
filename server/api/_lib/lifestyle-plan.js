// Conservative, useful advice is available even when no AI consent/key exists.
// A lab flag identifies a reported finding, never a diagnosis or a treatment.
export const LIFESTYLE_VERSION = 'lifestyle-plan-v1';
const names = rows => (rows || []).map(row => row.name || '').join(' ');
const words = (value, expression) => expression.test(value.normalize('NFKC'));
export function lifestyleContext(record) {
  const conditions = names(record.conditions), labs = record.tests?.[0]?.items || [];
  const high = expression => labs.some(item => ['high', 'critical'].includes(item.flag) && words(item.name || '', expression));
  const kidney = words(conditions, /کلی[هوی]|دیالیز|renal|kidney|\bckd\b|dialysis/iu);
  const cardiac = words(conditions, /قلب|آنژین|نارسایی قلب|cardiac|heart|angina|coronary/iu);
  const diabetes = words(conditions, /دیابت|diabet/iu);
  const child = record.patient.age_years !== null && record.patient.age_years < 20;
  const ageUnknown = record.patient.age_years == null;
  const pregnancy = ['yes', 'possible'].includes(record.patient.pregnancy_status);
  const unknownPregnancy = record.patient.sex === 'female' && record.patient.pregnancy_status === 'unknown';
  const critical = labs.some(item => item.flag === 'critical');
  return { kidney, cardiac, diabetes, child, ageUnknown, pregnancy, unknownPregnancy, critical,
    lipids: high(/ldl|cholesterol|triglyceride|چربی|کلسترول|تری.?گلیسرید/iu),
    glucose: high(/glucose|hba1c|قند|هموگلوبین گلیک/iu),
    bloodPressure: (record.vitals || []).some(row => row.systolic >= 140 || row.diastolic >= 90) };
}

export function localLifestylePlan(record) {
  const context = lifestyleContext(record), based = [], precautions = [];
  if (context.lipids) based.push('در آزمایش ثبت‌شده، یکی از چربی‌های خون بالاتر از محدودهٔ گزارش شده است؛ این برنامه جای ارزیابی علت یا درمان را نمی‌گیرد.');
  if (context.glucose || context.diabetes) based.push('قند یا سابقهٔ دیابت در پرونده نیازمند توجه است؛ برنامه بر وعده‌های منظم و ثبت الگوی خوردن تمرکز دارد.');
  if (context.bloodPressure) based.push('در اندازه‌گیری‌های ثبت‌شده، فشار خون بالاتر دیده می‌شود؛ یک عدد به‌تنهایی تشخیص فشار خون بالا نیست.');
  if (context.kidney || context.cardiac) based.push('با توجه به سابقهٔ ' + (context.kidney ? 'کلیه' : 'قلب') + '، برنامهٔ غذا و فعالیت باید با محدودیت‌های پزشک هماهنگ باشد.');
  const allergies = (record.allergies || []).map(item => item.allergen).filter(Boolean).slice(0, 3);
  if (allergies.length) precautions.push('حساسیت ثبت‌شده به ' + allergies.join('، ') + ' را رعایت کنید؛ برچسب مواد غذایی و احتمال آلودگی متقاطع را بررسی کنید.');
  if (context.kidney) precautions.push('مقدار آب، پروتئین، پتاسیم و فسفر را خودسرانه زیاد یا کم نکنید؛ نمک جایگزین هم ممکن است مناسب شما نباشد. برنامهٔ اختصاصی کلیه را با متخصص تغذیه هماهنگ کنید.');
  if (context.cardiac) precautions.push('از محدودیت فعالیت و مایعات تجویزشده پیروی کنید؛ پیش از افزایش شدت ورزش با تیم درمان هماهنگ کنید.');
  if (context.diabetes) precautions.push('اگر انسولین یا داروی پایین‌آورندهٔ قند مصرف می‌کنید، وعده‌ای را حذف نکنید و تغییر فعالیت یا غذا را با برنامهٔ پیشگیری از افت قند هماهنگ کنید.');
  if (context.child) precautions.push('برای کودک و نوجوان هدف کاهش وزن، کالری یا BMI بزرگسال تعیین نمی‌شود؛ رشد، خواب و تحرک را با سرپرست و پزشک متناسب با سن پیگیری کنید.');
  if (context.ageUnknown) precautions.push('سن مشخص نیست؛ پیش از تعیین الگوی غذا، خواب یا فعالیت، تاریخ تولد را ثبت کنید. این برنامه هدف وزن یا ورزش تعیین نمی‌کند.');
  if (context.pregnancy) precautions.push('در بارداری یا احتمال آن، رژیم کاهش وزن و هدف وزن بزرگسال مناسب نیست؛ غذا و فعالیت را با ماما یا پزشک هماهنگ کنید.');
  else if (context.unknownPregnancy) precautions.push('اگر احتمال بارداری وجود دارد، پیش از هر برنامهٔ تغییر وزن آن را روشن کنید؛ این برنامه هدف کاهش وزن تعیین نمی‌کند.');
  if (context.critical) precautions.unshift('در گزارش علامت بحرانی وجود دارد؛ نخست فوراً برای بررسی نتیجه با مرکز درمانی تماس بگیرید. شروع یا افزایش ورزش را تا روشن‌شدن وضعیت به تعویق بیندازید.');
  const generalDiet = context.ageUnknown || (context.child && record.patient.age_years < 2)
    ? 'الگوی تغذیهٔ مناسب سن و توصیهٔ درمانگر را ادامه دهید؛ پیش از تغییر وعده‌ها یا نوع غذا، سن و محدودیت‌های تغذیه را روشن کنید.'
    : context.kidney
    ? 'از میان غذاهای مجاز برنامهٔ کلیه، یک انتخاب کمتر شور را جایگزین خوراکی فرآوری‌شده کنید؛ سهم غذا، میوه، حبوبات و پروتئین را خودسرانه تغییر ندهید.'
    : context.glucose || context.diabetes
      ? 'وعده‌های معمول را منظم نگه دارید و اگر نوشیدنی شیرین می‌خورید، یک وعدهٔ آن را با نوشیدنی بدون شکرِ مجاز خود جایگزین کنید؛ وعدهٔ غذایی را حذف نکنید.'
      : context.lipids
        ? 'در یک وعده، خوراک سرخ‌کرده یا گوشت فرآوری‌شده را با غذای خانگی کمتر سرخ‌شده و سازگار با حساسیت‌ها و محدودیت‌های خود عوض کنید.'
        : 'یک تغییر غذایی کوچک انتخاب کنید؛ مثلاً یک خوراکی بسیار شور یا نوشیدنی شیرین را با انتخاب کمتر شور یا بدون شکرِ سازگار با شرایط خود جایگزین کنید.';
  const movement = context.critical
    ? 'ابتدا نتیجهٔ بحرانی و فعالیت مجاز را با مرکز درمانی بررسی کنید؛ فعلاً افزایش فعالیت در این برنامه پیشنهاد نمی‌شود.'
    : context.ageUnknown
      ? 'سن و توان حرکتی را روشن کنید تا پیشنهاد متناسب با سن تهیه شود؛ فعلاً هدف پیاده‌روی یا افزایش ورزش تعیین نشده است.'
    : context.cardiac || context.kidney || context.pregnancy
      ? 'در حد فعالیت مجاز فعلی بمانید و برای تعیین زمان و شدت مناسب حرکت با تیم درمان هماهنگ کنید؛ فعلاً هدف ورزشی جدید تعیین نکنید.'
      : context.child
        ? 'با همراهی سرپرست، یک بازی یا حرکت دلخواه و متناسب با سن را به برنامهٔ روز اضافه کنید؛ رقابت بر سر وزن هدف این برنامه نیست.'
        : 'اگر منع پزشکی یا علامت غیرمعمول ندارید، یک نوبت حرکت سبک و کوتاه در حد توان انتخاب کنید؛ می‌توانید از چند دقیقه راه‌رفتن آرام شروع کنید.';
  const continuation = context.critical || context.cardiac || context.kidney || context.pregnancy || context.ageUnknown
    ? 'در هفتهٔ دوم، فقط عادت‌های قابل‌تحمل و تأییدشده را ادامه دهید؛ هدف غذا و فعالیت را همراه تیم درمان بازبینی کنید.'
    : 'در هفتهٔ دوم، اگر عادت‌ها بدون ناراحتی قابل انجام بودند، فقط یکی را کمی بیشتر کنید؛ هم‌زمان چند تغییر سخت ایجاد نکنید.';
  if (!based.length) based.push('برنامه از سن، سابقه‌ها و اندازه‌گیری‌های ثبت‌شده استفاده می‌کند؛ اطلاعات کم است و آمادگی جسمانی، خواب و الگوی غذای شما هنوز مشخص نیست.');
  if (!precautions.length) precautions.push('با درد قفسهٔ سینه، تنگی نفس غیرمعمول یا سرگیجه فعالیت را متوقف و ارزیابی کنید؛ برای علائم شدید با ۱۱۵ تماس بگیرید.');
  return {
    goal: context.critical ? 'اول پیگیری نتیجه، سپس ساختن عادت‌های ایمن' : 'این هفته، چند تغییر کوچک و قابل ادامه برای همین پرونده',
    based_on: based.slice(0, 4),
    first_week: [
      { label: 'روزهای ۱ و ۲ · شروع آسان', steps: [generalDiet, 'زمان تقریبی خواب و بیداری و یک عادت قابل‌تغییر را یادداشت کنید؛ قرار نیست همه‌چیز را یک‌باره عوض کنید.'] },
      { label: 'روزهای ۳ و ۴ · تکرار عادت', steps: [movement, 'همان تغییر غذایی را تکرار کنید و موانعش، مثل گرسنگی، خستگی، هزینه یا برنامهٔ کار را بنویسید.'] },
      { label: 'روزهای ۵ تا ۷ · مرور هفته', steps: ['ببینید در چند روز توانستید عادت انتخابی را انجام دهید؛ اگر سخت بود، قدم را کوچک‌تر کنید.', context.bloodPressure || context.glucose || context.diabetes ? 'فشار یا قند را فقط طبق روش و زمان‌بندی توصیه‌شدهٔ درمانگر ثبت کنید؛ از روی یک عدد دارو را تغییر ندهید.' : 'یک پرسش دربارهٔ نتیجهٔ آزمایش یا سابقهٔ خود برای مراجعه آماده کنید؛ زمان آزمایش مجدد را خودسرانه تعیین نکنید.'] }
    ],
    next_weeks: [continuation, 'پایان هفتهٔ دوم، انرژی، خواب و میزان پایبندی را مرور کنید و برای هفته‌های بعد یک عادت پایدار را نگه دارید؛ نتیجهٔ وزن یا آزمایش تضمین‌شده نیست.'],
    sleep_and_stress: ['برای خواب و بیداری زمان نسبتاً ثابتی انتخاب کنید؛ نزدیک خواب نور و استفاده از صفحه‌نمایش را کمتر کنید.', 'روزانه یک مکث کوتاه برای آرام‌سازی، تنفس راحت یا فعالیت آرام دلخواه بگذارید؛ اگر ناراحت شدید ادامه ندهید.'],
    tracking: ['فقط برای خودتان تعداد روزهای انجام عادت، کیفیت خواب و هر علامت تازه را یادداشت کنید؛ این صفحه بدون انتخاب شما چیزی به پرونده اضافه نمی‌کند.', 'سابقهٔ دارو، حساسیت‌ها و توصیه‌های درمانگر را به‌روز نگه دارید؛ برای برنامهٔ دقیق‌تر، الگوی معمول غذا، فعالیت و محدودیت‌ها را در مراجعه مطرح کنید.'],
    precautions: precautions.slice(0, 7)
  };
}
