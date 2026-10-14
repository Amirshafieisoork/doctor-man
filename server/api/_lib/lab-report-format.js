function immutable(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export const LAB_REPORT_SECTIONS = immutable([
  { id: 1, title: 'خلاصه کلی وضعیت سلامت' },
  { id: 2, title: 'بررسی تک‌تک مقادیر آزمایش' },
  { id: 3, title: 'توضیح تفصیلی موارد غیرنرمال' },
  { id: 4, title: 'هشدارهای مهم پزشکی' },
  { id: 5, title: 'توصیه‌های تغذیه‌ای دقیق' },
  { id: 6, title: 'سبک زندگی و فعالیت بدنی' },
  { id: 7, title: 'گزینه‌های گیاهی و طب مکمل (با احتیاط)' },
  { id: 8, title: 'کِی به پزشک مراجعه کند و چه تخصصی' },
  { id: 9, title: 'نکته پایانی و دلگرمی' }
]);
export const LAB_REPORT_MIN_PERSIAN_WORDS = 450;
export const LAB_REPORT_MIN_SECTION_WORDS = 8;

export const LAB_REPORT_SECTIONS_SCHEMA = immutable({
  type: 'array', minItems: LAB_REPORT_SECTIONS.length, maxItems: LAB_REPORT_SECTIONS.length,
  items: {
    type: 'object', additionalProperties: false, required: ['section_id', 'content'],
    properties: {
      section_id: { type: 'integer', enum: LAB_REPORT_SECTIONS.map(section => section.id) },
      content: { type: 'string', minLength: 20, maxLength: 9000 }
    }
  }
});

export const LAB_REPORT_SECTIONS_PROMPT = `Write nine substantive sections in Persian: aim for 600–900 useful words, minimum 450. Return sections [{section_id,content}], IDs 1–9 once each. Do not repeat headings; the server adds these titles:
${LAB_REPORT_SECTIONS.map(section => `${section.id}: ${section.title}`).join('\n')}
1: Summarize readable findings and missing clinical context.
2: Explain each row and its printed range; unreadable rows stay uninterpreted. Keep items.explanation to one sentence; detail belongs here.
3: Explain abnormalities, possible non-diagnostic reasons and follow-up; never invent an abnormality.
4: Separate routine follow-up from urgent symptoms; mild abnormalities alone do not imply emergency.
5: Give practical eat-more/eat-less actions with Iranian food examples, grounded in readable findings. No restrictive diet or fluid target without clinical context.
6: Suggest feasible activity, sleep and stress actions; qualify exercise for unknown symptoms or limitations.
7: Discuss limited herbal/complementary evidence and medication interactions; culinary herbs are allowed. Never prescribe a medicinal herb, supplement, drug or therapeutic dose, or replace medical care. Explain when to ask a physician/pharmacist.
8: Say when to review results and which relevant clinician to start with; avoid unnecessary specialist lists.
9: Give grounded encouragement and a concrete next-step plan.
Use readable data only: no absent tests, diagnoses, patient facts or reference values. Be specific; no repeated cautions or filler. All recommendations are educational.`;

export function countPersianWords(text) {
  if (typeof text !== 'string') return 0;
  // Count whitespace-delimited words containing Arabic-script letters, not
  // numbers, punctuation, English labels or the server-generated headings.
  return text.trim().split(/\s+/u).filter(word => /[\u0621-\u063a\u0641-\u064a\u066e-\u06d3\u06fa-\u06fc]/u.test(word)).length;
}

function invalidReport() { return Object.assign(new Error('AI_RESPONSE_INVALID'), { code: 'AI_RESPONSE_INVALID' }); }

export function formatLabReportSections(sections) {
  if (!Array.isArray(sections) || sections.length !== LAB_REPORT_SECTIONS.length) throw invalidReport();
  const byId = new Map();
  let words = 0, characters = 0;
  for (const section of sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)
      || Object.keys(section).length !== 2 || !Object.hasOwn(section, 'section_id') || !Object.hasOwn(section, 'content')
      || !Number.isSafeInteger(section.section_id) || !LAB_REPORT_SECTIONS.some(expected => expected.id === section.section_id)
      || byId.has(section.section_id) || typeof section.content !== 'string') throw invalidReport();
    const content = section.content.trim();
    const sectionWords = countPersianWords(content);
    if (!content || content.length > 9000 || sectionWords < LAB_REPORT_MIN_SECTION_WORDS) throw invalidReport();
    words += sectionWords;
    characters += content.length;
    byId.set(section.section_id, content);
  }
  if (words < LAB_REPORT_MIN_PERSIAN_WORDS || characters > 28000) throw invalidReport();
  const ordered = LAB_REPORT_SECTIONS.map(section => ({ section_id: section.id, title: section.title, content: byId.get(section.id) }));
  return { sections: ordered, full_text: ordered.map(section => `## ${section.section_id}. ${section.title}\n${section.content}`).join('\n\n') };
}

export function assembleLabReportSections(sections) { return formatLabReportSections(sections).full_text; }
