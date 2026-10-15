import { test, expect } from '@playwright/test';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const fixture = () => [
  { id: 'bmi-self', relation: 'self', sex: 'male', display_name: 'بزرگسال آزمون', birth_date: '1990-01-01', height_cm: 170, blood_type: 'A+' },
  { id: 'bmi-child', relation: 'child', sex: 'female', display_name: 'کودک آزمون', birth_date: '2016-01-01', height_cm: 110, blood_type: null }
];
async function setup(page, patients = fixture(), records = {}) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/patients') return json(route, { success: true, patients });
    if (url.pathname === '/api/health-record') { const patient = patients.find(item => item.id === url.searchParams.get('patient_id')); return json(route, { patient, record: records[patient.id] || {} }); }
    return json(route, { success: true, notifications: [], unread: 0 });
  });
  return { patients, records };
}
const openVital = async page => {
  await expect(page.getByRole('button', { name: 'ثبت قد، وزن و فشار خون', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'ثبت قد، وزن و فشار خون', exact: true }).click();
};
test('plain pressure labels and live BMI persist height on the patient and weight on the measurement', async ({ page }) => {
  const { patients, records } = await setup(page); let heightWrite, vitalWrite;
  await page.route('**/api/patients', async route => {
    if (route.request().method() === 'GET') return json(route, { patients });
    heightWrite = route.request().postDataJSON(); Object.assign(patients[0], heightWrite);
    return json(route, { success: true, patient: patients[0] });
  });
  await page.route('**/api/health-entry', route => {
    vitalWrite = route.request().postDataJSON(); records['bmi-self'] = { vitals: [{ id: 'new-weight', measured_at: '2026-10-15T09:00:00Z', ...vitalWrite }] };
    return json(route, { success: true });
  });
  await page.goto('/health'); await openVital(page);
  await expect(page.locator('#dynamicFields')).toContainText('فشار بالا (عدد بزرگ‌تر)');
  await expect(page.locator('#dynamicFields')).toContainText('در فشار ۱۲۰ روی ۸۰');
  await expect(page.locator('#dynamicFields [name="height_cm"]')).toHaveValue('170');
  await page.locator('[name="weight_kg"]').fill('80'); await page.locator('[name="height_cm"]').fill('180');
  await expect(page.locator('#liveBmi')).toContainText('۲۴٫۷');
  await page.locator('#addModal button.primary').click();
  await expect(page.locator('#addModal')).toBeHidden();
  expect(heightWrite).toEqual({ id: 'bmi-self', height_cm: 180 });
  expect(vitalWrite).toMatchObject({ patient_id: 'bmi-self', type: 'vital', weight_kg: '80' });
  expect(vitalWrite).not.toHaveProperty('height_cm');
  await expect(page.locator('#bodySummary')).toContainText('۲۴٫۷'); await expect(page.locator('#patientHeight')).toHaveValue('180');
});
test('a child uses its own height and growth guidance when editing a saved measurement', async ({ page }) => {
  await setup(page, fixture(), { 'bmi-child': { vitals: [{ id: 'child-vital', weight_kg: 20, measured_at: '2026-10-15T09:00:00Z' }] } });
  await page.goto('/health'); await expect(page.locator('#patientSexSave')).toBeEnabled();
  await page.locator('#patientSelect').selectOption('bmi-child'); await expect(page.locator('#bodySummary')).toContainText('نمودار رشد');
  await expect(page.locator('#bodySummary')).not.toContainText('بازه تقریبی وزن');
  await page.locator('#vitals .entry-actions button').first().click();
  await expect(page.locator('[name="height_cm"]')).toHaveValue('110');
  await expect(page.locator('[name="weight_kg"]')).toHaveValue('20');
  await expect(page.locator('#liveBmi')).toContainText('نمودار رشد');
});
test('missing age avoids adult weight targets; height alone can be saved without an empty vital record', async ({ page }) => {
  const patients = fixture(); patients[0].birth_date = null;
  await setup(page, patients); let vitalWrites = 0, heightWrite;
  await page.route('**/api/health-entry', route => { vitalWrites++; return json(route, { success: true }); });
  await page.route('**/api/patients', route => {
    if (route.request().method() === 'GET') return json(route, { patients });
    heightWrite = route.request().postDataJSON(); Object.assign(patients[0], heightWrite); return json(route, { patient: patients[0] });
  });
  await page.goto('/health'); await openVital(page);
  await page.locator('[name="weight_kg"]').fill('99'); await expect(page.locator('#liveBmi')).toContainText('تاریخ تولد');
  await page.locator('[name="weight_kg"]').fill(''); await expect(page.locator('#liveBmi')).toContainText('قد و وزن را کامل کنید');
  await page.locator('#addModal button.primary').click(); await expect(page.locator('#addModal [role="alert"]')).toContainText('وزن یا یکی');
  expect(heightWrite).toBeUndefined(); expect(vitalWrites).toBe(0);
  await page.locator('[name="height_cm"]').fill('171'); await page.locator('#addModal button.primary').click();
  await expect(page.locator('#addModal')).toBeHidden(); expect(heightWrite).toEqual({ id: 'bmi-self', height_cm: 171 }); expect(vitalWrites).toBe(0);
});
test('a pending height save cannot write vitals or replace a new family member form', async ({ page }) => {
  const { patients } = await setup(page); let resume, written, vitalWrites = 0;
  const pending = new Promise(resolve => resume = resolve);
  await page.route('**/api/patients', async route => {
    if (route.request().method() === 'GET') return json(route, { patients });
    written = route.request().postDataJSON(); await pending; Object.assign(patients[0], written); await json(route, { patient: patients[0] });
  });
  await page.route('**/api/health-entry', route => { vitalWrites++; return json(route, { success: true }); });
  await page.goto('/health'); await openVital(page); await page.locator('[name="height_cm"]').fill('180'); await page.locator('[name="weight_kg"]').fill('80');
  await page.locator('#addModal button.primary').click(); await expect.poll(() => written?.id).toBe('bmi-self');
  await page.locator('#patientSelect').evaluate(select => { select.value = 'bmi-child'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await openVital(page); await page.locator('[name="weight_kg"]').fill('21'); resume();
  await expect(page.locator('#addModal')).toBeVisible(); await expect(page.locator('[name="height_cm"]')).toHaveValue('110'); await expect(page.locator('[name="weight_kg"]')).toHaveValue('21'); await expect(page.locator('#addModal button.primary')).toBeEnabled();
  expect(vitalWrites).toBe(0); expect(patients[1].height_cm).toBe(110);
});
test('profile saves blood group, birth date and height for the selected family member', async ({ page }) => {
  const { patients } = await setup(page); let submitted;
  await page.route('**/api/patients', route => {
    if (route.request().method() === 'GET') return json(route, { patients });
    submitted = route.request().postDataJSON(); const patient = patients.find(item => item.id === submitted.id); Object.assign(patient, submitted); return json(route, { patient });
  });
  await page.goto('/health'); await expect(page.locator('#patientSexSave')).toBeEnabled();
  await page.locator('#patientSelect').selectOption('bmi-child'); await expect(page.locator('#patientSexSave')).toBeEnabled();
  await page.locator('#patientBloodType').selectOption('O-'); await page.locator('#patientBirthDate').fill('۱۳۹۵/۰۱/۱۴'); await page.locator('#patientHeight').fill('112');
  await page.locator('#patientSexSave').click(); await expect(page.locator('#patientSexStatus')).toContainText('ثبت شد');
  expect(submitted).toEqual({ id: 'bmi-child', sex: 'female', birth_date: '2016-04-02', height_cm: 112, blood_type: 'O-' });
  await page.locator('#patientSelect').selectOption('bmi-self'); await expect(page.locator('#patientBloodType')).toHaveValue('A+'); await expect(page.locator('#patientHeight')).toHaveValue('170');
});
test('a recent possible pregnancy intake suppresses adult targets and a later explicit no resolves old history', async ({ page }) => {
  const patients = fixture(); patients[0].sex = 'female';
  const records = { 'bmi-self': {
    vitals: [{ id: 'saved-weight', weight_kg: 99, measured_at: '2026-10-15T09:00:00Z' }],
    encounters: [{ pregnancy_status: 'yes', occurred_at: '2025-01-01T09:00:00Z' }],
    visit_intakes: [{ pregnancy_status: 'possible', status: 'submitted', submitted_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:00Z' }]
  } };
  await setup(page, patients, records); await page.goto('/health');
  await expect(page.locator('#bodySummary')).toContainText('بارداری');
  await expect(page.locator('#bodySummary')).not.toContainText('بازه تقریبی وزن');
  await openVital(page); await page.locator('[name="weight_kg"]').fill('99');
  await expect(page.locator('#liveBmi')).toContainText('بارداری');
  records['bmi-self'].visit_intakes[0].pregnancy_status = 'no';
  await page.reload(); await expect(page.locator('#bodySummary')).toContainText('بازه تقریبی وزن');
  await expect(page.locator('#bodySummary')).toContainText('وزن نیازمند پیگیری بیشتر');
});
