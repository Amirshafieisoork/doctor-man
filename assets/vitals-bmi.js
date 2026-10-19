import { bmiGuidance, hasPregnancyContext, measurement } from './bmi.js';

const selectedPatient = () => patients.find(patient => patient.id === currentPatient) || {};
const localNumber = value => Number(value).toLocaleString('fa-IR', { maximumFractionDigits: 1 });
function guidance(weight, height) {
  const patient = selectedPatient();
  return bmiGuidance({ weightKg: weight, heightCm: height, birthDate: patient.birth_date, pregnancy: hasPregnancyContext(patient, record || {}) });
}
function latestMeasurement(key, min, max) {
  return [...(record?.vitals || [])]
    .filter(item => measurement(item[key], min, max) != null)
    .sort((a, b) => new Date(b.measured_at || 0) - new Date(a.measured_at || 0))[0];
}
let profileBaseline = { patientId: null, weight: null, glucose: null };
function updateProfileBMI() {
  const container = document.getElementById('profileBmi');
  if (!container) return;
  container.replaceChildren();
  if (!record || recordPatientId !== currentPatient) { container.hidden = true; return; }
  container.hidden = false;
  const result = guidance($('patientWeight').value, $('patientHeight').value);
  appendGuidance(container, result, { preview: true });
  if (['healthy', 'underweight', 'overweight', 'obesity'].includes(result.category) && result.advice?.[0]) {
    const note = document.createElement('p');
    note.textContent = result.advice[0];
    container.append(note);
  }
}
function renderProfile() {
  const ready = !!record && recordPatientId === currentPatient;
  const weight = ready ? latestMeasurement('weight_kg', .2, 500) : null;
  const glucose = ready ? latestMeasurement('glucose_mg_dl', 1, 1500) : null;
  profileBaseline = { patientId: ready ? currentPatient : null, weight: weight?.weight_kg ?? null, glucose: glucose?.glucose_mg_dl ?? null };
  $('patientWeight').value = weight?.weight_kg ?? '';
  $('patientGlucose').value = glucose?.glucose_mg_dl ?? '';
  $('patientWeightDate').textContent = weight?.measured_at ? 'آخرین ثبت: ' + fmt(weight.measured_at) : 'وزن جدید به تاریخچه افزوده می‌شود.';
  $('patientGlucoseDate').textContent = glucose?.measured_at ? 'آخرین ثبت: ' + fmt(glucose.measured_at) : 'قند جدید به تاریخچه افزوده می‌شود.';
  updateProfileBMI();
}
function profileChanges() {
  if (profileBaseline.patientId !== currentPatient) throw Error('ابتدا پرونده انتخاب‌شده را بارگذاری کنید.');
  const changes = {};
  for (const [id, key, baseline, min, max] of [
    ['patientWeight', 'weight_kg', profileBaseline.weight, .2, 500],
    ['patientGlucose', 'glucose_mg_dl', profileBaseline.glucose, 1, 1500]
  ]) {
    const raw = $(id).value;
    // Clearing a quick field never deletes a saved measurement or its history.
    if (raw === '') continue;
    const value = measurement(raw, min, max);
    if (value == null) throw Error('وزن و قند خون را با عدد و واحد نوشته‌شده وارد کنید.');
    if (value !== measurement(baseline, min, max)) changes[key] = value;
  }
  return Object.keys(changes).length ? changes : null;
}
function bmiBadgeClass(category) {
  if (category === 'healthy') return 'bmi-badge';
  if (category === 'underweight' || category === 'overweight') return 'bmi-badge warn';
  if (category === 'obesity' || category === 'check') return 'bmi-badge alert';
  return 'bmi-badge';
}
const plainStatus = result => ({
  healthy: 'وزن متناسب',
  underweight: 'کم‌وزنی',
  overweight: 'اضافه‌وزن',
  obesity: 'وزن در محدودهٔ چاقی'
}[result.category] || result.title);
function appendGuidance(container, result, { preview = false } = {}) {
  container.dataset.bmiCategory = result.category;
  const heading = document.createElement('strong');
  heading.className = 'bmi-status-title';
  heading.textContent = plainStatus(result);
  container.append(heading);
  if (result.bmi != null) {
    const row = document.createElement('div');
    row.className = 'bmi-value-row';

    const ring = document.createElement('div');
    ring.className = 'bmi-ring';
    const inner = document.createElement('div');
    inner.className = 'bmi-ring-inner';
    const value = document.createElement('b');
    value.textContent = localNumber(result.bmi);
    const unit = document.createElement('span');
    unit.textContent = 'BMI';
    inner.append(value, unit);
    ring.append(inner);

    const meta = document.createElement('div');
    meta.className = 'bmi-meta';
    const explanation = document.createElement('p');
    explanation.className = 'bmi-explanation';
    explanation.textContent = ({ healthy: 'وزن شما نسبت به قدتان در محدودهٔ معمول بزرگسالان است.', underweight: 'وزن شما نسبت به قدتان از محدودهٔ معمول بزرگسالان کمتر است.', overweight: 'وزن شما نسبت به قدتان از محدودهٔ معمول بزرگسالان بیشتر است.', obesity: 'این نسبت قد و وزن در محدودهٔ چاقیِ بزرگسالان قرار می‌گیرد؛ با قدم‌های تدریجی شروع کنید.' })[result.category] || 'این عدد به‌تنهایی وضعیت سلامت یا هدف وزن را مشخص نمی‌کند.';
    const badge = document.createElement('span');
    badge.className = bmiBadgeClass(result.category);
    badge.textContent = result.title;
    meta.append(explanation);
    if (['healthy', 'underweight', 'overweight', 'obesity'].includes(result.category)) meta.append(badge);
    if (result.range) {
      const range = document.createElement('p');
      range.className = 'bmi-range';
      range.textContent = 'بازه تقریبی وزن مناسب برای این قد: ' + localNumber(result.range.min) + ' تا ' + localNumber(result.range.max) + ' کیلوگرم';
      meta.append(range);
    }
    row.append(ring, meta);
    container.append(row);
  }

  if (preview) {
    if (['incomplete', 'age-needed', 'child', 'infant', 'pregnancy', 'check'].includes(result.category)) {
      const note = document.createElement('p');
      note.textContent = result.advice[0];
      container.append(note);
    }
    return;
  }

  if (result.bmi == null && result.range) {
    const range = document.createElement('p');
    range.className = 'bmi-range';
    range.textContent = 'بازه تقریبی وزن برای این قد در بزرگسالان: ' + localNumber(result.range.min) + ' تا ' + localNumber(result.range.max) + ' کیلوگرم؛ هدف شخصی وزن ممکن است متفاوت باشد.';
    container.append(range);
  }
  const list = document.createElement('ul');
  list.className = 'bmi-next-steps';
  for (const advice of result.advice) {
    const item = document.createElement('li');
    item.textContent = advice;
    list.append(item);
  }
  container.append(list);
  if (['healthy', 'underweight', 'overweight', 'obesity'].includes(result.category)) {
    const note = document.createElement('p');
    note.className = 'bmi-limit';
    note.textContent = 'این توضیح دربارهٔ نسبت قد و وزن است؛ ترکیب بدن و سلامت کلی را به‌تنهایی نشان نمی‌دهد.';
    container.append(note);
    const nutrition = document.querySelector('[data-page="nutritionCoach"]');
    if (nutrition) {
      const action = document.createElement('button');
      action.type = 'button'; action.className = 'bmi-action';
      action.textContent = 'برنامه غذایی متناسب با من';
      action.addEventListener('click', () => { nutrition.click(); document.getElementById('nutritionCoach')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      container.append(action);
    }
  }
}
function renderBodySummary() {
  const container = document.getElementById('bodySummary');
  if (!container) return;
  container.replaceChildren();
  if (!record || recordPatientId !== currentPatient) { container.hidden = true; return; }
  container.hidden = false;
  const patient = selectedPatient();
  const measured = latestMeasurement('weight_kg', .2, 500);
  const values = document.createElement('p'); values.className = 'body-measurements';
  values.textContent = 'قد: ' + (patient.height_cm != null ? localNumber(patient.height_cm) + ' سانتی‌متر' : 'ثبت نشده') + ' · آخرین وزن: ' + (measured ? localNumber(measured.weight_kg) + ' کیلوگرم' : 'ثبت نشده');
  container.append(values);
  if (measured?.measured_at) { const date = document.createElement('p'); date.className = 'body-measurement-date'; date.textContent = 'تاریخ وزن: ' + fmt(measured.measured_at) + '؛ محاسبه بر اساس آخرین قد ثبت‌شده است.'; container.append(date); }
  const summary = document.createElement('div'); summary.className = 'bmi-summary';
  appendGuidance(summary, guidance(measured?.weight_kg, patient.height_cm)); container.append(summary);
}
function updateLiveBMI() {
  const container = document.getElementById('liveBmi'); if (!container) return;
  container.replaceChildren();
  const weight = document.querySelector('#dynamicFields [name="weight_kg"]')?.value;
  const height = document.querySelector('#dynamicFields [name="height_cm"]')?.value;
  appendGuidance(container, guidance(weight, height), { preview: true });
}
function prepareFields() {
  if ($('entryType').value !== 'vital') return;
  const height = document.querySelector('#dynamicFields [name="height_cm"]');
  if (height) height.value = selectedPatient().height_cm ?? '';
  $('dynamicFields').querySelectorAll('[name="weight_kg"],[name="height_cm"]').forEach(input => input.addEventListener('input', updateLiveBMI));
  updateLiveBMI();
}
const baseRenderFields = renderFields;
renderFields = function() { baseRenderFields(); prepareFields(); };
const baseRender = render;
render = function() { baseRender(); renderBodySummary(); };

window.DrManVitals = {
  renderProfile,
  profileChanges,
  afterEdit() { if ($('entryType').value === 'vital') { const height = document.querySelector('#dynamicFields [name="height_cm"]'); if (height) height.value = selectedPatient().height_cm ?? ''; updateLiveBMI(); } },
  async prepareSave(body, { patientId, version, editing }) {
    if (body.type !== 'vital') return {};
    const inputHeight = body.height_cm;
    delete body.height_cm; // Height belongs to patients, never to patient_vitals.
    const height = measurement(inputHeight, 20, 260);
    if (inputHeight !== '' && inputHeight != null && height == null) throw Error('قد را به سانتی‌متر و بین ۲۰ تا ۲۶۰ وارد کنید.');
    if (body.systolic !== '' && body.diastolic !== '' && Number(body.systolic) <= Number(body.diastolic)) throw Error('فشار بالا (عدد بزرگ‌تر) باید از فشار پایین بیشتر باشد.');
    const measures = ['weight_kg', 'systolic', 'diastolic', 'heart_rate', 'oxygen_saturation', 'temperature_c', 'glucose_mg_dl'];
    const hasMeasures = measures.some(key => body[key] !== '' && body[key] != null);
    const patient = patients.find(item => item.id === patientId);
    const changed = height != null && height !== measurement(patient?.height_cm, 20, 260);
    if (!editing && !hasMeasures && !changed) throw Error('وزن یا یکی از اندازه‌گیری‌ها را وارد کنید؛ برای تغییر قد هم می‌توانید از مشخصات پرونده استفاده کنید.');
    if (!changed) return {};
    const response = await api('/api/patients', { method: 'PATCH', body: JSON.stringify({ id: patientId, height_cm: height }) });
    if (patient) Object.assign(patient, { height_cm: height }, response.patient || {});
    if (!selectedRecordIs(patientId, version)) return { stale: true, savedHeight: true };
    renderPatientSex(); renderBodySummary(); dispatchHealthRecord('drman:health-profile-updated');
    return { savedHeight: true, skipEntry: !editing && !hasMeasures };
  }
};
document.addEventListener('drman:health-profile-updated', renderBodySummary);
for (const id of ['patientWeight', 'patientHeight']) $(id).addEventListener('input', updateProfileBMI);
for (const id of ['patientBirthDate', 'fBirth']) $(id).addEventListener('input', event => event.target.setCustomValidity(''));
renderProfile();
renderBodySummary();
