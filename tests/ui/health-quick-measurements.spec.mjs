import { test, expect } from '@playwright/test';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function setup(page) {
  const patients = [
    { id: 'quick-adult', relation: 'self', display_name: 'فرد ساختگی', sex: 'male', birth_date: '1990-01-01', height_cm: 170, blood_type: 'A+' },
    { id: 'quick-child', relation: 'child', display_name: 'عضو ساختگی', sex: 'female', birth_date: '2016-01-01', height_cm: 110 }
  ];
  const records = {
    'quick-adult': { vitals: [
      { id: 'old-glucose', glucose_mg_dl: 95, measured_at: '2026-10-15T09:00:00Z' },
      { id: 'old-weight', weight_kg: 70, systolic: 120, diastolic: 80, heart_rate: 72, oxygen_saturation: 98, temperature_c: 36.5, measured_at: '2026-10-14T09:00:00Z' }
    ] },
    'quick-child': { vitals: [{ id: 'child-weight', weight_kg: 20, glucose_mg_dl: 91, measured_at: '2026-10-15T09:00:00Z' }] }
  };
  const writes = { profiles: [], measurements: [], families: [] };
  await page.route('**/*', route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') {
      if (method === 'GET') return json(route, { patients });
      const body = route.request().postDataJSON();
      if (method === 'POST') { writes.families.push(body); return json(route, { patient: { id: 'new-family', ...body } }, 201); }
      writes.profiles.push(body); const patient = patients.find(item => item.id === body.id); Object.assign(patient, body); return json(route, { patient });
    }
    if (url.pathname === '/api/health-record') { const patient = patients.find(item => item.id === url.searchParams.get('patient_id')); return json(route, { patient, record: records[patient.id] }); }
    if (url.pathname === '/api/health-entry') {
      const body = route.request().postDataJSON(); writes.measurements.push(body);
      records[body.patient_id].vitals.unshift({ id: 'new-measurement', measured_at: '2026-10-15T12:00:00Z', ...body });
      return json(route, { success: true }, 201);
    }
    return json(route, { success: true, notifications: [], unread: 0 });
  });
  await page.goto('/health'); await expect(page.locator('#patientSexSave')).toBeEnabled();
  return { patients, records, writes };
}
test('top fields keep weight and glucose beside height, show BMI, and append measurements without losing history', async ({ page }) => {
  const { writes, records } = await setup(page);
  await expect(page.locator('#patientWeight')).toHaveValue('70'); await expect(page.locator('#patientGlucose')).toHaveValue('95');
  await expect(page.locator('#patientBirthDate')).toHaveValue('1368/10/11');
  await expect(page.locator('#profileBmi')).toBeVisible(); await expect(page.locator('#profileBmi')).toContainText('BMI');
  await expect(page.locator('#profileBmi')).toContainText('۲۴٫۲');
  await page.locator('#patientHeight').fill('180'); await page.locator('#patientWeight').fill('80'); await page.locator('#patientGlucose').fill('105');
  await expect(page.locator('#profileBmi')).toContainText('۲۴٫۷'); await page.locator('#patientSexSave').click();
  await expect(page.locator('#patientSexStatus')).toContainText('ثبت شد');
  expect(writes.profiles).toEqual([{ id: 'quick-adult', sex: 'male', height_cm: 180 }]);
  expect(writes.measurements).toEqual([{ type: 'vital', patient_id: 'quick-adult', weight_kg: 80, glucose_mg_dl: 105 }]);
  expect(records['quick-adult'].vitals).toHaveLength(3);
  await expect(page.locator('#vitals')).toContainText('فشار بالا ۱۲۰'); await expect(page.locator('#vitals')).toContainText('قند خون ۹۵');
  await page.reload(); await expect(page.locator('#patientWeight')).toHaveValue('80'); await expect(page.locator('#patientGlucose')).toHaveValue('105'); await expect(page.locator('#profileBmi')).toContainText('۲۴٫۷');
  await page.getByRole('button', { name: 'ثبت فشار خون، نبض و سایر اندازه‌ها', exact: true }).click();
  for (const name of ['weight_kg', 'height_cm', 'systolic', 'diastolic', 'heart_rate', 'oxygen_saturation', 'glucose_mg_dl', 'temperature_c']) await expect(page.locator('#dynamicFields [name="' + name + '"]')).toBeVisible();
});
test('editing demographics and clearing quick fields never duplicates or deletes measurements', async ({ page }) => {
  const { writes, records } = await setup(page);
  await page.locator('#patientBloodType').selectOption('O-'); await page.locator('#patientSexSave').click();
  await expect(page.locator('#patientSexStatus')).toContainText('ثبت شد'); expect(writes.measurements).toHaveLength(0);
  await page.locator('#patientWeight').fill(''); await page.locator('#patientGlucose').fill(''); await page.locator('#patientSexSave').click();
  await expect(page.locator('#patientWeight')).toHaveValue('70'); await expect(page.locator('#patientGlucose')).toHaveValue('95');
  expect(writes.measurements).toHaveLength(0); expect(records['quick-adult'].vitals).toHaveLength(2);
});
test('invalid non-leap Shamsi DOB can be corrected and saved with Persian digits', async ({ page }) => {
  const { writes } = await setup(page);
  await page.locator('#patientBirthDate').fill('۱۴۰۰/۱۲/۳۰'); await page.locator('#patientSexSave').click();
  expect(writes.profiles).toHaveLength(0);
  expect(await page.locator('#patientBirthDate').evaluate(input => input.validationMessage)).toContain('تقویم شمسی');
  await page.locator('#patientBirthDate').fill('۱۳۹۹۱۲۳۰'); await page.locator('#patientSexSave').click();
  await expect(page.locator('#patientSexStatus')).toContainText('ثبت شد');
  expect(writes.profiles[0]).toEqual({ id: 'quick-adult', sex: 'male', birth_date: '2021-03-20' });
  await expect(page.locator('#patientBirthDate')).toHaveValue('1399/12/30');
  await expect(page.locator('#profileBmi')).toContainText('نمودار رشد');
});
test('family creation accepts a Shamsi birthday and sends the unchanged canonical API date', async ({ page }) => {
  const { writes } = await setup(page);
  await page.getByRole('button', { name: '+ عضو خانواده', exact: true }).click();
  await page.locator('#fName').fill('عضو آزمون'); await page.locator('#fBirth').fill('١٣٩٥/٠١/١٤'); await page.locator('#fSex').selectOption('female');
  await page.getByRole('button', { name: 'ساخت پرونده', exact: true }).click();
  await expect(page.locator('#familyModal')).toBeHidden();
  expect(writes.families[0]).toMatchObject({ display_name: 'عضو آزمون', birth_date: '2016-04-02', sex: 'female', relation: 'child' });
});
test('a pending top profile save cannot write the former patient measurements after a family switch', async ({ page }) => {
  const { patients, writes } = await setup(page); let resume, submitted;
  const pending = new Promise(resolve => resume = resolve);
  await page.route('**/api/patients', async route => {
    if (route.request().method() === 'GET') return json(route, { patients });
    submitted = route.request().postDataJSON(); await pending; Object.assign(patients[0], submitted); return json(route, { patient: patients[0] });
  });
  await page.locator('#patientWeight').fill('85'); await page.locator('#patientHeight').fill('180'); await page.locator('#patientSexSave').click();
  await expect.poll(() => submitted?.id).toBe('quick-adult'); await page.locator('#patientSelect').selectOption('quick-child');
  await expect(page.locator('#patientWeight')).toHaveValue('20'); resume();
  await expect(page.locator('#patientHeight')).toHaveValue('110'); await expect(page.locator('#patientGlucose')).toHaveValue('91');
  expect(writes.measurements).toHaveLength(0); await expect(page.locator('#profileBmi')).toContainText('نمودار رشد');
});
test('a vital service failure reports the saved profile clearly and allows retrying the unsaved measurement', async ({ page }) => {
  const { writes } = await setup(page); let failures = 0;
  await page.route('**/api/health-entry', route => {
    if (!failures++) return json(route, { error: 'خطای موقت ذخیره اندازه‌گیری' }, 503);
    return route.fallback();
  });
  await page.locator('#patientHeight').fill('180'); await page.locator('#patientWeight').fill('80'); await page.locator('#patientSexSave').click();
  await expect(page.locator('#patientSexStatus')).toContainText('مشخصات ثبت شد؛ اندازه‌گیری‌ها ذخیره نشدند.');
  await expect(page.locator('#patientWeight')).toHaveValue('80'); await expect(page.locator('#patientSexSave')).toBeEnabled();
  await page.locator('#patientSexSave').click(); await expect(page.locator('#patientSexStatus')).toContainText('پرونده ثبت شد');
  expect(writes.measurements).toEqual([{ type: 'vital', patient_id: 'quick-adult', weight_kg: 80 }]);
});
