// Reviewed patient guidance for an actual physician order; no model call or
// inferred diagnosis. Local laboratory instructions take precedence.
export const LAB_PREPARATION_VERSION = 'lab-preparation-v1';
export const LAB_PREPARATION_REVIEWED_AT = '2026-10-16';
const medline = (slug, label) => ({ label: `MedlinePlus · ${label}`, url: `https://medlineplus.gov/lab-tests/${slug}/` });
const sourceGeneral = medline('how-to-prepare-for-a-lab-test', 'آمادگی آزمایش');
const sourceFasting = medline('fasting-for-a-blood-test', 'ناشتایی');
const sourceGlucose = medline('blood-glucose-test', 'قند خون');
const library = [
  {
    key: 'prolactin', title: 'پرولاکتین (PRL)',
    aliases: ['پرولاکتین', 'پرولاکتین خون', 'پروﻻکتین', 'prl', 'prolactin', 'serum prolactin', 'prolactin prl', 'پرولاکتین prl', 'prl پرولاکتین'],
    steps: [
      'وقت نمونه‌گیری و نیاز به ناشتایی را با آزمایشگاه هماهنگ کنید؛ معمولاً نمونه چند ساعت پس از بیدار شدن گرفته می‌شود و زمان دقیق بین آزمایشگاه‌ها فرق دارد.',
      'پیش از خون‌گیری با آرامش بنشینید و از ورزش شدید و تحریک یا معاینه پستان خودداری کنید؛ استرس و این فعالیت‌ها می‌توانند پرولاکتین را موقتاً بالا ببرند. زمان استراحت را از آزمایشگاه بپرسید.',
      'بارداری، شیردهی، داروها و مکمل‌ها، به‌ویژه بیوتین، را به پزشک و آزمایشگاه اطلاع دهید. دارویی را خودسرانه قطع نکنید؛ تکرار آزمایش یا بررسی ماکروپرولاکتین را پزشک تعیین می‌کند.'
    ],
    sources: [medline('prolactin-levels', 'پرولاکتین'), { label: 'NHS · شرایط نمونه پرولاکتین', url: 'https://www.gloshospitals.nhs.uk/our-services/services-we-offer/pathology/tests-and-investigations/prolactin/' }]
  },
  {
    key: 'fasting_glucose', title: 'قند خون ناشتا (FBS / FPG)',
    aliases: ['fbs', 'fpg', 'fbg', 'fasting blood sugar', 'fasting blood glucose', 'fasting plasma glucose', 'قند ناشتا', 'قند خون ناشتا', 'گلوکز ناشتا'],
    steps: [
      'برای قند ناشتا معمولاً دست‌کم ۸ ساعت غذا و نوشیدنی کالری‌دار نخورید؛ مدت دقیق را از آزمایشگاه بپرسید. آب ساده معمولاً مجاز است، مگر پزشک برای خود شما محدودیت مایعات تعیین کرده باشد.',
      'در مدت ناشتایی آدامس نجوید، سیگار نکشید و ورزش نکنید. اگر دیابت، سابقه افت قند، بارداری یا داروی قند دارید، برنامه ناشتایی و زمان مصرف دارو را پیشاپیش با پزشک هماهنگ کنید؛ دارو را خودسرانه تغییر ندهید.'
    ], sources: [sourceGlucose, sourceFasting]
  },
  {
    key: 'glucose', title: 'قند خون',
    aliases: ['glucose', 'blood glucose', 'blood sugar', 'rbs', 'random glucose', 'random blood sugar', 'random blood glucose', 'قند خون', 'قند تصادفی', 'قند خون تصادفی'],
    steps: ['همه آزمایش‌های قند به ناشتایی نیاز ندارند. از آزمایشگاه بپرسید قند درخواستی ناشتاست یا تصادفی؛ برای قند تصادفی خودسرانه ناشتا نمانید.'], sources: [sourceGlucose]
  },
  {
    key: 'hba1c', title: 'میانگین قند سه‌ماهه (HbA1c)',
    aliases: ['hba1c', 'hb a1c', 'a1c', 'hemoglobin a1c', 'haemoglobin a1c', 'هموگلوبین a1c', 'هموگلوبین گلیکوزیله', 'قند سه ماهه', 'قند سه‌ماهه'],
    steps: ['HbA1c به‌تنهایی به ناشتایی نیاز ندارد؛ اگر آزمایش دیگری هم دارید، شرایط آن را جدا از آزمایشگاه بپرسید. داروهای مصرفی و بارداری را اطلاع دهید.'], sources: [sourceGlucose, medline('hemoglobin-a1c-hba1c-test', 'HbA1c')]
  },
  {
    key: 'lipids', title: 'چربی خون و تری‌گلیسرید',
    aliases: ['lipid panel', 'lipid profile', 'cholesterol', 'total cholesterol', 'triglycerides', 'triglyceride', 'tg', 'hdl', 'ldl', 'چربی خون', 'پروفایل چربی', 'کلسترول', 'تری گلیسرید', 'تری‌گلیسرید'],
    steps: ['نیاز به ناشتایی چربی خون به نوع درخواست و شرایط شما بستگی دارد. پیشاپیش از آزمایشگاه بپرسید؛ اگر ناشتا خواسته‌اند، ساعت دقیق شروع و پایان را هماهنگ کنید. آب ساده معمولاً مجاز است و داروها فقط با دستور پزشک تغییر می‌کنند.'], sources: [medline('cholesterol-levels', 'چربی خون'), sourceFasting]
  },
  {
    key: 'cbc', title: 'شمارش سلول‌های خون (CBC)',
    aliases: ['cbc', 'cbc diff', 'cbc differential', 'cbc with diff', 'cbc with differential', 'complete blood count', 'full blood count', 'fbc', 'شمارش سلول های خون', 'شمارش کامل خون', 'شمارش کامل سلول های خون'],
    steps: ['CBC به‌تنهایی معمولاً آمادگی ویژه یا ناشتایی نمی‌خواهد؛ آزمایش‌های همراه ممکن است شرایط دیگری داشته باشند. دستور آزمایشگاه را برای کل برگه بررسی کنید.'], sources: [medline('complete-blood-count-cbc', 'CBC')]
  },
  {
    key: 'tsh', title: 'هورمون تنظیم تیروئید (TSH)',
    aliases: ['tsh', 'thyroid stimulating hormone', 'thyrotropin', 'تی اس اچ', 'هورمون محرک تیروئید', 'هورمون تنظیم تیروئید'],
    steps: ['داروی تیروئید، سایر داروها و مکمل‌ها را به آزمایشگاه بگویید و زمان مصرف آن‌ها نسبت به خون‌گیری را از پزشک بپرسید؛ مصرف را خودسرانه قطع یا جابه‌جا نکنید. نیاز به ناشتایی را با توجه به آزمایش‌های همراه بررسی کنید.'], sources: [medline('tsh-thyroid-stimulating-hormone-test', 'TSH')]
  },
  {
    key: 'urine', title: 'آزمایش معمول یا کشت ادرار',
    aliases: ['ua', 'u a', 'urinalysis', 'urine analysis', 'urine culture', 'urine c s', 'کشت ادرار', 'آزمایش ادرار', 'آزمایش کامل ادرار'],
    steps: ['ظرف و روش جمع‌آوری را از آزمایشگاه بگیرید. برای نمونه تمیزِ وسط جریان، دست‌ها و محل را طبق آموزش آزمایشگاه تمیز کنید؛ ابتدای ادرار در توالت و بخش میانی در ظرف جمع می‌شود. داخل ظرف و در آن را لمس نکنید.', 'زمان و شیوه رساندن نمونه را از آزمایشگاه بپرسید؛ این راهنما برای ادرار ۲۴ساعته، نمونه نوزاد یا نمونه سوندی نیست.'],
    sources: [{ label: 'MedlinePlus · نمونه تمیز ادرار', url: 'https://medlineplus.gov/ency/article/007487.htm' }]
  }
];

export function normalizeLabTestName(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064b-\u065f\u0670\u200c\u200d]/g, ' ').replace(/[()[\]{}._:–—-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:آزمایش|تست|test)\s+/, '').replace(/\s+test$/, '').trim();
}
const byAlias = new Map(library.flatMap(test => test.aliases.map(alias => [normalizeLabTestName(alias), test])));
function matchItem(value) {
  const exact = byAlias.get(normalizeLabTestName(value));
  if (exact) return { tests: [exact], unknown: [] };
  const parts = value.split(/[,،؛;\n+]/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const results = parts.map(matchItem);
    return { tests: results.flatMap(result => result.tests), unknown: results.flatMap(result => result.unknown) };
  }
  // Slash-separated abbreviations are supported only when every part is a
  // known complete name. Never substring-match PRL receptors or 24h urine.
  const slash = value.split('/').map(part => part.trim()).filter(Boolean);
  if (slash.length > 1 && slash.every(part => byAlias.has(normalizeLabTestName(part)))) return { tests: slash.map(part => byAlias.get(normalizeLabTestName(part))), unknown: [] };
  return { tests: [], unknown: [value] };
}

export function labPreparationForOrder(order) {
  if (!order || order.order_type !== 'lab' || order.completed_at || !['ordered', 'pending', 'in_progress', 'scheduled'].includes(order.status || 'ordered')) return null;
  const items = Array.isArray(order.items) ? order.items.filter(value => typeof value === 'string' && value.trim()).slice(0, 50).map(value => value.trim().slice(0, 160)) : [];
  if (!items.length) return null;
  const matched = items.map(matchItem), unique = new Map(matched.flatMap(result => result.tests).map(test => [test.key, test]));
  return {
    version: LAB_PREPARATION_VERSION, reviewed_at: LAB_PREPARATION_REVIEWED_AT, title: 'آمادگی پیش از آزمایش',
    general: ['دستور اختصاصی پزشک و آزمایشگاهی که نمونه را می‌گیرد مقدم است؛ پیش از مراجعه شرایط کل برگه را با آن‌ها هماهنگ کنید.', 'دارو، ویتامین و مکمل را خودسرانه قطع نکنید و فهرست مصرفی را همراه ببرید. ناشتایی یا محدودیت نوشیدن آب برای همه آزمایش‌ها لازم نیست.'],
    general_sources: [{ ...sourceGeneral }], has_specific_guidance: unique.size > 0,
    tests: [...unique.values()].map(({ aliases, ...test }) => ({ ...test, steps: [...test.steps], sources: test.sources.map(source => ({ ...source })) })),
    unrecognized_items: [...new Set(matched.flatMap(result => result.unknown))]
  };
}
export function diagnosticOrderWithPreparation(order) { return { ...order, preparation: labPreparationForOrder(order) }; }
