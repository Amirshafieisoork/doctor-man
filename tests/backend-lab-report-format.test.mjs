import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleLabReportSections, countPersianWords, formatLabReportSections } from '../server/api/_lib/lab-report-format.js';
import { syntheticLabSections } from './fixtures/nine-section-report.mjs';

test('a substantive report preserves all nine sections in canonical order without mutating the response', () => {
  const sections = syntheticLabSections().reverse();
  sections[0].content = `  ${sections[0].content}\n  `;
  const before = structuredClone(sections);
  const report = assembleLabReportSections(sections);
  assert.deepEqual(sections, before);
  assert.deepEqual([...report.matchAll(/^## (\d+)\. /gm)].map(match => Number(match[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const ordered = syntheticLabSections();
  assert.ok(report.startsWith('## 1. خلاصه کلی وضعیت سلامت\n'));
  assert.ok(report.includes('## 5. توصیه‌های تغذیه‌ای دقیق\n'));
  assert.ok(report.includes('## 7. گزینه‌های گیاهی و طب مکمل (با احتیاط)\n'));
  assert.ok(report.includes('## 9. نکته پایانی و دلگرمی\n'));
  for (const section of ordered) assert.ok(report.includes(section.content));
  for (let index = 1; index < ordered.length; index++) assert.ok(report.indexOf(ordered[index - 1].content) < report.indexOf(ordered[index].content));
});

test('missing, duplicate, invented or mistyped section IDs never produce a complete-looking report', () => {
  const invalid = [null, {}, [], syntheticLabSections().slice(1), [...syntheticLabSections(), { section_id: 1, content: 'تکراری' }]];
  for (const id of [0, -1, 10, 999, '1', true, 1.5, null]) {
    const sections = syntheticLabSections(); sections[0].section_id = id; invalid.push(sections);
  }
  const duplicate = syntheticLabSections(); duplicate[8].section_id = 1; invalid.push(duplicate);
  const missingId = syntheticLabSections(); delete missingId[0].section_id; invalid.push(missingId);
  for (const sections of invalid) assert.throws(() => assembleLabReportSections(sections), { code: 'AI_RESPONSE_INVALID' });
});

test('display sections receive server-controlled titles and retain their matching body after reordering', () => {
  const source = syntheticLabSections().reverse();
  const formatted = formatLabReportSections(source);
  assert.deepEqual(formatted.sections.map(section => section.section_id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(formatted.sections[4].title, 'توصیه‌های تغذیه‌ای دقیق');
  assert.equal(formatted.sections[6].title, 'گزینه‌های گیاهی و طب مکمل (با احتیاط)');
  assert.deepEqual(formatted.sections.map(section => section.content), syntheticLabSections().map(section => section.content));
  assert.equal(formatted.full_text, assembleLabReportSections(source));
  const untrustedTitle = syntheticLabSections(); untrustedTitle[0].title = 'Invented urgency';
  assert.throws(() => formatLabReportSections(untrustedTitle), { code: 'AI_RESPONSE_INVALID' });
});

test('malformed or empty section content fails before a report can be assembled', () => {
  for (const value of [null, [], {}, { section_id: 1 }, { section_id: 1, content: '' }, { section_id: 1, content: '\n \t' },
    { section_id: 1, content: 90 }, { section_id: 1, content: 'این عنوان بسیار کوتاه است' },
    { section_id: 1, content: syntheticLabSections()[0].content, extra: 'unexpected' }]) {
    const sections = syntheticLabSections(); sections[0] = value;
    assert.throws(() => assembleLabReportSections(sections), { code: 'AI_RESPONSE_INVALID' });
  }
});

test('the minimum report length counts Persian words rather than headings, English filler or punctuation', () => {
  const word = 'گزارش';
  const sections = Array.from({ length: 9 }, (_, index) => ({ section_id: index + 1, content: Array(50).fill(word).join(' ') }));
  assert.equal(countPersianWords(sections.map(section => section.content).join('\n')), 450);
  assert.doesNotThrow(() => assembleLabReportSections(sections));
  sections[0].content = Array(49).fill(word).join(' ');
  assert.throws(() => assembleLabReportSections(sections), { code: 'AI_RESPONSE_INVALID' });
  sections[0].content += ' 12345 !!! English-data '.repeat(100);
  assert.throws(() => assembleLabReportSections(sections), { code: 'AI_RESPONSE_INVALID' });
  const mixed = 'سلام نمونه‌ی ساخته‌شده\nبرای آزمون 1234 !!! English-only';
  assert.equal(countPersianWords(mixed), 5);
  assert.equal(countPersianWords(null), 0);
});

test('one empty-looking category cannot be hidden by a long report in the other categories', () => {
  const sections = syntheticLabSections();
  sections[0].content = 'برای نتیجه با پزشک مشورت کنید';
  assert.throws(() => assembleLabReportSections(sections), { code: 'AI_RESPONSE_INVALID' });
  sections[0].content = 'English-only explanation '.repeat(100);
  assert.throws(() => assembleLabReportSections(sections), { code: 'AI_RESPONSE_INVALID' });
});

test('unbounded section or report lengths are rejected rather than silently truncating medical guidance', () => {
  const tooLongSection = syntheticLabSections(); tooLongSection[0].content += ' گزارش'.repeat(2000);
  assert.throws(() => assembleLabReportSections(tooLongSection), { code: 'AI_RESPONSE_INVALID' });
  const tooLongReport = syntheticLabSections().map(section => ({ ...section, content: 'گزارش '.repeat(700) }));
  assert.ok(tooLongReport.every(section => section.content.length < 9000));
  assert.throws(() => assembleLabReportSections(tooLongReport), { code: 'AI_RESPONSE_INVALID' });
});
