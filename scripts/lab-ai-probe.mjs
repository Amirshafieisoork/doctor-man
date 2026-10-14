// Explicitly gated deployment test. Synthetic images only; no account,
// Storage, quota, clinical-record, or payment writes.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { avalaiClient, configuredModels } from '../server/api/_lib/ai-models.js';
import { analyzeLabImages, labErrorResponse } from '../server/api/_lib/lab-ai.js';
import { safeErrorMetadata } from '../server/api/_lib/errors.js';
import { createAdminAITestHandler } from '../server/api/admin-ai-test.js';
import { createToken } from '../server/api/_lib/session.js';
import { countPersianWords } from '../server/api/_lib/lab-report-format.js';

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
    // This client is used exclusively with the two synthetic fixtures below.
    // Record metadata only; never log keys, headers or report content.
    const create = client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create = async (body, options) => {
      let response;
      try { response = await create(body, options); }
      catch (error) {
        // This explicitly gated client processes synthetic fixtures only.
        const redact = value => String(value || '').replace(/(?:gsk_|sk-)[A-Za-z0-9_-]+/g, '[redacted]');
        report({ stage: 'synthetic_request_rejected', schema: body.response_format?.json_schema?.name,
          model: body.model, ...safeErrorMetadata(error), classification: labErrorResponse(error).code,
          diagnostic: redact(error?.error?.message).slice(0, 2500), generation: redact(error?.error?.failed_generation).slice(0, 9000) });
        throw error;
      }
      report({ stage: 'synthetic_response', schema: body.response_format?.json_schema?.name,
        model: response.model, finish_reason: response.choices?.[0]?.finish_reason });
      return response;
    };
    const run = async (name, file) => {
      const bytes = await readFile(new URL('../server/api/_fixtures/' + file, import.meta.url));
      const start = Date.now();
      const result = await analyzeLabImages(client, [
        { type: 'text', text: 'این برگه کاملاً ساختگی و فقط برای آزمون اتصال است و اطلاعات بیمار واقعی ندارد. مقادیر چاپ‌شده را بخوان و تفسیر آموزشی فارسی ارائه بده.' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + bytes.toString('base64'), detail: 'high' } }
      ], 'drman-synthetic-release-test');
      assert.match(result.parsed.full_text, /[\u0600-\u06ff]/);
      report({ stage: name, model: result.model, elapsed_ms: Date.now() - start, read_quality: result.parsed.read_quality, item_count: result.parsed.items.length, usage: result.usage });
      return result.parsed;
    };
    // Execute the exact owner-only connection handler with a short-lived,
    // in-memory server session. Neither the cookie nor its secret is logged.
    const ownerHandler = createAdminAITestHandler({ getClient: async () => client, analyze: async (...args) => {
      const result = await analyzeLabImages(...args);
      report({ stage: 'synthetic_report', section_count: result.parsed.sections?.length || 0,
        sections: (result.parsed.sections || []).map(section => ({ id: section.section_id,
          words: countPersianWords(section.content), excerpt: section.content.slice(0, 600) })) });
      return result;
    } });
    let ownerStatus, ownerBody;
    const ownerResponse = {
      setHeader() {},
      status(value) { ownerStatus = value; return this; },
      json(value) { ownerBody = value; return this; }
    };
    await ownerHandler({ method: 'POST', headers: { cookie: 'drman_admin=' + createToken({ sub: 'admin', role: 'admin' }, 60) } }, ownerResponse);
    report({ stage: 'owner_checks', status: ownerStatus, passed: ownerBody?.success === true,
      checks_passed: ownerBody?.checks_passed, checks_total: ownerBody?.checks_total,
      samples_checked: ownerBody?.samples_checked, report_sections: ownerBody?.report_sections,
      report_words: ownerBody?.report_words, code: ownerBody?.code });
    assert.equal(ownerStatus, 200, 'Owner connection handler did not pass');
    assert.equal(ownerBody?.success, true);
    assert.equal(ownerBody?.checks_passed, 6);
    assert.equal(ownerBody?.report_sections, 9);
    assert.ok(ownerBody?.report_words >= 450);
    const unreadable = await run('unreadable', 'unreadable-lab.png');
    assert.equal(unreadable.read_quality, 'poor');
    assert.equal(unreadable.items.length, 0, 'Invented a value on a blank image');
    report({ stage: 'complete', passed: true });
  } catch (error) {
    report({ stage: 'failed', passed: false, ...safeErrorMetadata(error), classification: labErrorResponse(error).code });
    process.exitCode = 1;
  }
}
