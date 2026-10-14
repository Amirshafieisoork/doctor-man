// Explicitly gated deployment test. Synthetic images only; no account,
// Storage, quota, clinical-record, or payment writes.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { avalaiClient, configuredModels } from '../server/api/_lib/ai-models.js';
import { analyzeLabImages, labErrorResponse } from '../server/api/_lib/lab-ai.js';
import { safeErrorMetadata } from '../server/api/_lib/errors.js';

const expectedCommit = process.env.DRMAN_LAB_AI_PROBE || '';
const enabled = /^[a-f0-9]{40}$/.test(expectedCommit) && expectedCommit === process.env.VERCEL_GIT_COMMIT_SHA;
const report = value => console.log('DRMAN_LAB_AI_PROBE ' + JSON.stringify(value));

if (enabled) {
  try {
    const models = await configuredModels();
    assert.notEqual(models.provider, 'unconfigured');
    report({ stage: 'configuration', provider: models.provider, primary: models.lab, fallback: models.lab_fallback });
    const client = await avalaiClient();
    assert.ok(client);
    const run = async (name, file, model) => {
      const bytes = await readFile(new URL('../tests/fixtures/' + file, import.meta.url));
      const start = Date.now();
      const result = await analyzeLabImages(client, [
        { type: 'text', text: 'این تصویر فقط آزمون مصنوعی نرم‌افزار است. برای زن ۳۵ ساله، نام تست‌ها و اعداد و واحدهای چاپ‌شده را دقیق بخوان. نام انگلیسی چاپ‌شده تست‌ها را در items نگه دار و تفسیر آموزشی را فارسی بنویس. هیچ داده‌ای از تصویر ناخوانا حدس نزن.' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + bytes.toString('base64'), detail: 'high' } }
      ], 'drman-synthetic-release-test', [model]);
      assert.match(result.parsed.full_text, /[\u0600-\u06ff]/);
      report({ stage: name, model: result.model, elapsed_ms: Date.now() - start, read_quality: result.parsed.read_quality, item_count: result.parsed.items.length, usage: result.usage });
      return result.parsed;
    };
    const verifyClear = result => {
      assert.notEqual(result.read_quality, 'poor');
      const cases = [[/hemoglobin|\bhb\b/i, 10.2, 'low'], [/creatinine/i, .9, 'normal'], [/ldl/i, 162, 'high'], [/triglyceride/i, 140, 'normal']];
      for (const [name, value, flag] of cases) {
        const item = result.items.find(item => name.test(item.name));
        assert.ok(item, 'Missing printed synthetic test');
        assert.equal(Number(String(item.value).match(/\d+(?:\.\d+)?/)?.[0]), value, 'Changed printed synthetic value');
        assert.equal(item.flag, flag, 'Wrong synthetic reference-range flag');
      }
      assert.notEqual(result.status, 'danger');
    };
    verifyClear(await run('primary_clear', 'synthetic-lab-report.png', models.lab));
    const unreadable = await run('primary_unreadable', 'unreadable-lab.png', models.lab);
    assert.equal(unreadable.read_quality, 'poor');
    assert.equal(unreadable.items.length, 0, 'Invented a value on a blank image');
    if (models.lab_fallback !== models.lab) verifyClear(await run('fallback_clear', 'synthetic-lab-report.png', models.lab_fallback));
    report({ stage: 'complete', passed: true });
  } catch (error) {
    report({ stage: 'failed', passed: false, ...safeErrorMetadata(error), classification: labErrorResponse(error).code });
    process.exitCode = 1;
  }
}
