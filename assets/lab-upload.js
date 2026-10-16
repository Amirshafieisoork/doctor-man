(() => {
function createLabUploader(root = document, context = {}) {
  const MAX_PAGES = 4, MAX_INPUT = 4 * 1024 * 1024, PAGE_BUDGET = 900 * 1024;
  const ARCHIVE_TIMEOUT = 65000, ANALYSIS_TIMEOUT = 240000;
  const $ = id => root === document ? document.getElementById(id) : root.querySelector('[data-lab-id="' + id + '"]');
  let disposed = false, completed = false;
  const controllers = new Set();
  const current = () => !disposed && (!context.isCurrent || context.isCurrent());
  const stopIfStale = () => { if (!current()) throw new DOMException('The upload context changed', 'AbortError'); };
  const nextUrl = context.embedded ? '/health' : '/#lab';
  const controller = () => { const value = new AbortController(); controllers.add(value); return value; };
  const files = [], originals = [], previewUrls = [], patientProfiles = new Map();
  let activePage = 0, account = null, accountFailed = false, busy = false, preparing = false;
  const fa = n => Number(n).toLocaleString('fa-IR');
  const picker = $('picker'), slots = $('slots'), analyze = $('analyze');
  if (!picker || !slots || !analyze) return null;
  picker.setAttribute('aria-label', 'انتخاب تصاویر آزمایش از گالری یا فایل‌ها');
  picker.setAttribute('title', 'انتخاب از گالری');
  picker.accept = 'image/*'; picker.removeAttribute('capture');
  const cameraPicker = document.createElement('input'); cameraPicker.type = 'file'; cameraPicker.accept = 'image/*'; cameraPicker.setAttribute('capture', 'environment'); cameraPicker.hidden = true; cameraPicker.dataset.labCamera = 'true'; cameraPicker.setAttribute('aria-label', 'گرفتن عکس آزمایش با دوربین');
  (root === document ? document.body : root).append(cameraPicker);
  function clear() { $('error').classList.remove('show'); $('result').classList.remove('show'); }
  function error(message) { $('error').textContent = message; $('error').classList.add('show'); }
  function updateButton() {
    analyze.classList.toggle('show', files.length > 0);
    analyze.disabled = busy || preparing || !files.length || (context.embedded && completed);
    analyze.textContent = context.embedded && completed ? 'تفسیر این آزمایش ثبت شد' : busy ? 'در حال تفسیر…' : preparing ? 'در حال آماده‌سازی تصاویر…' : account ? 'تفسیر با هوش مصنوعی' : 'ورود و تفسیر آزمایش';
    picker.disabled = busy || preparing; cameraPicker.disabled = busy || preparing;
  }
  function render() {
    previewUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
    slots.replaceChildren(); slots.className = 'lab-gallery';
    $('count').textContent = fa(files.length) + ' از ۴';
    if (files.length) {
      const preview = document.createElement('div'); preview.className = 'lab-preview';
      const img = document.createElement('img'); img.src = URL.createObjectURL(files[activePage]);
      previewUrls.push(img.src); img.alt = 'پیش‌نمایش صفحه ' + fa(activePage + 1) + ' آزمایش';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove';
      remove.textContent = '×'; remove.disabled = busy || preparing;
      remove.setAttribute('aria-label', 'حذف صفحه ' + fa(activePage + 1));
      remove.onclick = () => { completed = false; files.splice(activePage, 1); originals.splice(activePage, 1); activePage = Math.max(0, Math.min(activePage, files.length - 1)); clear(); render(); };
      preview.append(img, remove); slots.append(preview);
    }
    const strip = document.createElement('div'); strip.className = 'lab-thumbnails';
    files.forEach((file, index) => {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'lab-thumbnail' + (index === activePage ? ' selected' : '');
      button.setAttribute('aria-label', 'نمایش صفحه ' + fa(index + 1));
      button.setAttribute('aria-pressed', String(index === activePage));
      const img = document.createElement('img'); img.src = URL.createObjectURL(file); previewUrls.push(img.src); img.alt = '';
      const label = document.createElement('span'); label.textContent = 'صفحه ' + fa(index + 1);
      button.append(img, label);
      button.onclick = () => { activePage = index; render(); slots.querySelectorAll('.lab-thumbnail')[index]?.focus(); };
      strip.append(button);
    });
    if (files.length < MAX_PAGES) {
      const add = document.createElement('button'); add.type = 'button'; add.className = 'lab-add';
      add.textContent = files.length ? '+ افزودن صفحه از گالری' : 'انتخاب از گالری'; add.disabled = busy || preparing;
      add.onclick = () => picker.click();
      const camera = document.createElement('button'); camera.type = 'button'; camera.className = 'lab-add lab-camera'; camera.textContent = 'گرفتن عکس با دوربین'; camera.disabled = busy || preparing; camera.onclick = () => cameraPicker.click();
      strip.append(add, camera);
    }
    slots.append(strip); updateButton();
  }
  async function prepareImage(file) {
    if (file.size <= PAGE_BUDGET) return file;
    const bitmap = await createImageBitmap(file);
    try {
      let scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
      for (const quality of [0.9, 0.82, 0.74]) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= PAGE_BUDGET) return new File([blob], 'lab-page.jpg', { type: 'image/jpeg' });
        scale *= 0.86;
      }
      throw Error('این تصویر برای ارسال بزرگ است؛ نسخه کم‌حجم‌تر و خوانای آن را انتخاب کنید.');
    } finally { bitmap.close(); }
  }
  picker.onchange = cameraPicker.onchange = async event => {
    const selected = [...(event.target.files || [])]; event.target.value = ''; if (!selected.length || !current()) return; completed = false; clear(); preparing = true; updateButton();
    try {
      for (const file of selected) {
        if (!current()) break;
        if (files.length >= MAX_PAGES) { error('حداکثر چهار صفحه از یک نوبت آزمایش را می‌توانید اضافه کنید.'); break; }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { error('تصاویر JPG، PNG یا WebP را انتخاب کنید.'); continue; }
        if (file.size > MAX_INPUT) { error('حجم هر تصویر ورودی باید حداکثر ۴ مگابایت باشد.'); continue; }
        try { const prepared = await prepareImage(file); stopIfStale(); files.push(prepared); originals.push({file,archives:new Map()}); } catch (e) { if (current()) error(e.message || 'تصویر خوانده نشد؛ یک تصویر واضح دیگر انتخاب کنید.'); }
      }
      activePage = Math.max(0, files.length - 1);
    } finally { preparing = false; if (current()) render(); }
  };
  async function loadPatients() {
    if (context.embedded) {
      stopIfStale();
      const patient = context.patient;
      patientProfiles.clear(); patientProfiles.set(patient.id, patient);
      $('patient').replaceChildren(new Option(patient.display_name || 'پرونده انتخاب‌شده', patient.id));
      $('patient').value = patient.id; $('patient').disabled = true;
      syncPatientGender();
      const birth = patient.birth_date ? new Date(patient.birth_date + 'T12:00:00Z') : null;
      const now = new Date();
      const age = birth && Number.isFinite(birth.getTime()) ? now.getFullYear() - birth.getUTCFullYear() - ((now.getMonth() < birth.getUTCMonth() || (now.getMonth() === birth.getUTCMonth() && now.getDate() < birth.getUTCDate())) ? 1 : 0) : null;
      $('age').value = age !== null && age >= 0 && age <= 120 ? age : '';
      $('age').readOnly = $('age').value !== '';
      $('gender').disabled = ['female', 'male'].includes(patient.sex);
      return;
    }
    const response = await fetch('/api/patients', { credentials: 'include' });
    if (!response.ok) throw Error('پرونده‌ها بارگذاری نشدند؛ صفحه را دوباره باز کنید.');
    const data = await response.json();
    stopIfStale();
    if (data.patients?.length) {
      const previous=$('patient').value;patientProfiles.clear();data.patients.forEach(p=>patientProfiles.set(p.id,p));
      $('patient').replaceChildren(...data.patients.map(p => new Option(p.display_name + (p.relation === 'self' ? ' (من)' : ''), p.id)));
      if(patientProfiles.has(previous))$('patient').value=previous;
      syncPatientGender();
    }
  }
  function syncPatientGender(){const gender=patientProfiles.get($('patient').value)?.sex;$('gender').value=['female','male'].includes(gender)?gender:'';}
  $('patient').addEventListener('change',syncPatientGender);
  async function archiveSelectedFiles(patientId,signal){
    for(let index=0;index<originals.length;index++){
      stopIfStale();
      const source=originals[index];if(source.archives.has(patientId))continue;
      $('loading').textContent='در حال ثبت تصویر '+fa(index+1)+' از '+fa(originals.length)+' در پرونده سلامت…';
      const form=new FormData();form.append('file',source.file);form.append('patient_id',patientId);form.append('document_type','lab');form.append('title',source.file.name||'برگه آزمایش');
      const response=await fetch('/api/documents',{method:'POST',credentials:'include',body:form,signal});
      const data=await response.json().catch(()=>({}));
      stopIfStale();
      if(response.status===401)throw Error('AUTH_REQUIRED');
      if(!response.ok||!data.success||!data.document?.id)throw Error(data.error||'ثبت تصویر در پرونده انجام نشد؛ دوباره تلاش کنید.');
      source.archives.set(patientId,data.document.id);
      context.onArchiveSaved?.({ patientId, document: data.document });
    }
  }
  async function loadAccount() {
    accountFailed = false;
    try {
      const request = controller();
      const response = await fetch('/api/account', { credentials: 'include', signal: request.signal });
      stopIfStale();
      if (response.status === 401) { account = null; return; }
      const data = await response.json();
      stopIfStale();
      if (!response.ok || !data.success) throw Error('بارگذاری حساب انجام نشد.');
      account = data;
      $('welcome').textContent = 'سلام ' + (data.user.name || 'دوست عزیز');
      $('planText').textContent = 'پلن ' + (data.subscription.plan?.name || 'رایگان');
      $('quotaText').href = '/pricing'; $('quotaText').textContent = fa(Math.max(0, Number(data.subscription.remaining || 0))) + ' تحلیل باقی‌مانده';
      $('accountLink').href = '/health'; $('accountLink').textContent = 'پرونده سلامت';
      await loadPatients();
    } catch { if (!current()) return; accountFailed = true; $('planText').textContent = 'ارتباط با حساب برقرار نشد؛ دوباره تلاش کنید.'; }
    finally { if (current()) updateButton(); }
  }
  const accountReady = loadAccount();
  analyze.onclick = async () => {
    if (!current() || busy || preparing || !files.length || (context.embedded && completed)) return;
    // Lock before account loading yields, so rapid clicks cannot submit twice.
    busy = true; render();
    let timeout, stage = 'account', patientId = '';
    try {
      await accountReady; stopIfStale();
      if (accountFailed) await loadAccount();
      stopIfStale();
      if (accountFailed) return error('حساب یا پرونده بارگذاری نشد؛ لطفاً کمی بعد دوباره تلاش کنید.');
      if (!account) { location.href = '/auth?next=' + encodeURIComponent(nextUrl); return; }
      if (!$('age').reportValidity()) return;
      if (!['female','male'].includes($('gender').value)) { $('gender').reportValidity(); return error('جنسیت را زن یا مرد انتخاب کنید.'); }
      patientId = context.embedded ? context.patient.id : $('patient').value;
      if (!patientId) return error('ابتدا پرونده سلامت را انتخاب کنید.');
      if (files.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024) return error('مجموع تصاویر بیش از حد مجاز است؛ تصاویر کم‌حجم‌تر انتخاب کنید.');
      clear(); render(); $('loading').classList.add('show'); $('loading').setAttribute('aria-busy', 'true');
      const form = new FormData(); files.forEach(file => form.append('images', file));
      form.append('patient_id', patientId);
      for (const name of ['age', 'gender', 'reason']) form.append(name, $(name).value);
      form.append('ai_consent', 'true');
      stage = 'archive';
      const archiveController = controller();
      timeout=setTimeout(()=>archiveController.abort(),ARCHIVE_TIMEOUT);
      await archiveSelectedFiles(patientId,archiveController.signal);
      clearTimeout(timeout); stopIfStale();
      stage = 'analysis';
      const analysisController = controller();
      timeout=setTimeout(()=>analysisController.abort(),ANALYSIS_TIMEOUT);
      $('loading').textContent='در حال خواندن صفحات آزمایش و بررسی مقادیر…';
      const response = await fetch('/api/analyze-lab', { method: 'POST', credentials: 'include', body: form, signal: analysisController.signal });
      const data = await response.json().catch(() => ({}));
      stopIfStale();
      if (response.status === 401) { location.href = '/auth?next=' + encodeURIComponent(nextUrl); return; }
      if (!response.ok || !data.success) throw Error(data.error || (response.status === 413 ? 'تصاویر بیش از حد مجاز هستند؛ نسخه کم‌حجم‌تر انتخاب کنید.' : response.status === 504 ? 'پاسخ تحلیل طول کشید؛ نتیجه را در پرونده سلامت بررسی کنید و سپس دوباره تلاش کنید.' : 'تفسیر انجام نشد؛ دوباره تلاش کنید.'));
      clearTimeout(timeout); timeout = undefined;
      const result = $('result'); result.replaceChildren();
      const meta = document.createElement('div'); meta.className = 'resultMeta';
      meta.textContent = ({ good: 'کیفیت خواندن مناسب', partial: 'بخشی از برگه خوانا نیست', poor: 'کیفیت تصویر کافی نیست' }[data.read_quality] || 'نتیجه تفسیر');
      const text = document.createElement('div');
      const sections = data.structured?.sections;
      if (Array.isArray(sections) && sections.length === 9 && sections.every((section, index) =>
        section?.section_id === index + 1 && typeof section.title === 'string' && typeof section.content === 'string')) {
        for (const section of sections) {
          const block = document.createElement('section'); block.className = 'lab-report-section';
          const heading = document.createElement('h3'); heading.textContent = `${section.section_id}. ${section.title}`;
          const body = document.createElement('p'); body.textContent = section.content;
          block.append(heading, body); text.append(block);
        }
      } else { text.textContent = data.analysis || ''; }
      const history = document.createElement(context.embedded ? 'button' : 'a'); history.className = 'btn lab-result-history';
      if (context.embedded) { history.type = 'button'; history.textContent = 'دیدن نتیجه و تصاویر در همین پرونده'; history.onclick = () => context.onHistory?.(); }
      else { history.href = '/health'; history.textContent = 'مشاهده در پرونده سلامت'; }
      result.append(meta, text, history); result.classList.add('show'); result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      completed = true;
      context.onComplete?.({ patientId, result: data });
      if (!context.embedded) await loadAccount();
    } catch (e) {
      if (!current()) return;
      if(e.message==='AUTH_REQUIRED'){location.href='/auth?next='+encodeURIComponent(nextUrl);return;}
      let message=e.name==='AbortError'
        ? stage==='archive' ? 'ذخیره تصویر طول کشید. پرونده سلامت را بررسی کنید و سپس دوباره تلاش کنید.' : 'تحلیل طول کشید. نتیجه را در پرونده سلامت بررسی کنید و سپس دوباره تلاش کنید.'
        : e.name==='TypeError' ? 'ارتباط با سرویس برقرار نشد؛ دوباره تلاش کنید.' : e.message;
      const archived=patientId&&originals.some(source=>source.archives.has(patientId));
      if(archived)message+=' تصویرهای ثبت‌شده در پرونده سلامت شما موجودند.';
      error(message);
      if(archived){const history=document.createElement(context.embedded?'button':'a');history.className='btn';history.textContent='مشاهده تصاویر در پرونده سلامت';if(context.embedded){history.type='button';history.onclick=()=>context.onHistory?.('documentsPage');}else history.href='/health';$('error').append(document.createTextNode(' '),history);}
    }
    finally { clearTimeout(timeout); busy = false; if(current()){render(); $('loading').classList.remove('show'); $('loading').setAttribute('aria-busy', 'false'); context.onSettled?.({ patientId });} }
  };
  function dispose() { disposed = true; cameraPicker.remove(); window.removeEventListener('pagehide', dispose); $('patient').removeEventListener('change', syncPatientGender); controllers.forEach(value => value.abort()); controllers.clear(); previewUrls.splice(0).forEach(url => URL.revokeObjectURL(url)); files.length = 0; originals.length = 0; }
  window.addEventListener('pagehide', dispose, { once: true });
  render();
  return { dispose, get busy() { return busy || preparing; }, get completed() { return completed; } };
}
window.DrManLabUploader = { create: createLabUploader };
if (document.getElementById('picker')) createLabUploader();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
})();
