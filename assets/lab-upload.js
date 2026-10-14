(() => {
  const MAX_PAGES = 4, MAX_INPUT = 4 * 1024 * 1024, PAGE_BUDGET = 900 * 1024;
  const ARCHIVE_TIMEOUT = 65000, ANALYSIS_TIMEOUT = 240000;
  const $ = id => document.getElementById(id);
  const files = [], originals = [], previewUrls = [], patientProfiles = new Map();
  let activePage = 0, account = null, accountFailed = false, busy = false, preparing = false;
  const fa = n => Number(n).toLocaleString('fa-IR');
  const picker = $('picker'), slots = $('slots'), analyze = $('analyze');
  function clear() { $('error').classList.remove('show'); $('result').classList.remove('show'); }
  function error(message) { $('error').textContent = message; $('error').classList.add('show'); }
  function updateButton() {
    analyze.classList.toggle('show', files.length > 0);
    analyze.disabled = busy || preparing || !files.length;
    analyze.textContent = busy ? 'در حال تفسیر…' : preparing ? 'در حال آماده‌سازی تصاویر…' : account ? 'تفسیر با هوش مصنوعی' : 'ورود و تفسیر آزمایش';
    picker.disabled = busy || preparing;
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
      remove.onclick = () => { files.splice(activePage, 1); originals.splice(activePage, 1); activePage = Math.max(0, Math.min(activePage, files.length - 1)); clear(); render(); };
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
      add.textContent = files.length ? '+ افزودن صفحه' : 'انتخاب تصاویر آزمایش'; add.disabled = busy || preparing;
      add.onclick = () => picker.click(); strip.append(add);
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
  picker.onchange = async event => {
    const selected = [...(event.target.files || [])]; picker.value = ''; clear(); preparing = true; updateButton();
    try {
      for (const file of selected) {
        if (files.length >= MAX_PAGES) { error('حداکثر چهار صفحه از یک نوبت آزمایش را می‌توانید اضافه کنید.'); break; }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { error('تصاویر JPG، PNG یا WebP را انتخاب کنید.'); continue; }
        if (file.size > MAX_INPUT) { error('حجم هر تصویر ورودی باید حداکثر ۴ مگابایت باشد.'); continue; }
        try { files.push(await prepareImage(file)); originals.push({file,archives:new Map()}); } catch (e) { error(e.message || 'تصویر خوانده نشد؛ یک تصویر واضح دیگر انتخاب کنید.'); }
      }
      activePage = Math.max(0, files.length - 1);
    } finally { preparing = false; render(); }
  };
  async function loadPatients() {
    const response = await fetch('/api/patients', { credentials: 'include' });
    if (!response.ok) throw Error('پرونده‌ها بارگذاری نشدند؛ صفحه را دوباره باز کنید.');
    const data = await response.json();
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
      const source=originals[index];if(source.archives.has(patientId))continue;
      $('loading').textContent='در حال ثبت تصویر '+fa(index+1)+' از '+fa(originals.length)+' در پرونده سلامت…';
      const form=new FormData();form.append('file',source.file);form.append('patient_id',patientId);form.append('document_type','lab');form.append('title',source.file.name||'برگه آزمایش');
      const response=await fetch('/api/documents',{method:'POST',credentials:'include',body:form,signal});
      const data=await response.json().catch(()=>({}));
      if(response.status===401)throw Error('AUTH_REQUIRED');
      if(!response.ok||!data.success||!data.document?.id)throw Error(data.error||'ثبت تصویر در پرونده انجام نشد؛ دوباره تلاش کنید.');
      source.archives.set(patientId,data.document.id);
    }
  }
  async function loadAccount() {
    accountFailed = false;
    try {
      const response = await fetch('/api/account', { credentials: 'include' });
      if (response.status === 401) { account = null; return; }
      const data = await response.json();
      if (!response.ok || !data.success) throw Error('بارگذاری حساب انجام نشد.');
      account = data;
      $('welcome').textContent = 'سلام ' + (data.user.name || 'دوست عزیز');
      $('planText').textContent = 'پلن ' + (data.subscription.plan?.name || 'رایگان');
      $('quotaText').href = '/pricing'; $('quotaText').textContent = fa(Math.max(0, Number(data.subscription.remaining || 0))) + ' تحلیل باقی‌مانده';
      $('accountLink').href = '/health'; $('accountLink').textContent = 'پرونده سلامت';
      await loadPatients();
    } catch { accountFailed = true; $('planText').textContent = 'ارتباط با حساب برقرار نشد؛ دوباره تلاش کنید.'; }
    finally { updateButton(); }
  }
  const accountReady = loadAccount();
  analyze.onclick = async () => {
    if (busy || preparing || !files.length) return;
    // Lock before account loading yields, so rapid clicks cannot submit twice.
    busy = true; render();
    let timeout, stage = 'account', patientId = '';
    try {
      await accountReady;
      if (accountFailed) await loadAccount();
      if (accountFailed) return error('حساب یا پرونده بارگذاری نشد؛ لطفاً کمی بعد دوباره تلاش کنید.');
      if (!account) { location.href = '/auth?next=' + encodeURIComponent('/#lab'); return; }
      if (!$('age').reportValidity()) return;
      if (!['female','male'].includes($('gender').value)) { $('gender').reportValidity(); return error('جنسیت را زن یا مرد انتخاب کنید.'); }
      patientId = $('patient').value;
      if (!patientId) return error('ابتدا پرونده سلامت را انتخاب کنید.');
      if (files.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024) return error('مجموع تصاویر بیش از حد مجاز است؛ تصاویر کم‌حجم‌تر انتخاب کنید.');
      clear(); render(); $('loading').classList.add('show'); $('loading').setAttribute('aria-busy', 'true');
      const form = new FormData(); files.forEach(file => form.append('images', file));
      form.append('patient_id', patientId);
      for (const name of ['age', 'gender', 'reason']) form.append(name, $(name).value);
      form.append('ai_consent', 'true');
      stage = 'archive';
      const archiveController = new AbortController();
      timeout=setTimeout(()=>archiveController.abort(),ARCHIVE_TIMEOUT);
      await archiveSelectedFiles(patientId,archiveController.signal);
      clearTimeout(timeout);
      stage = 'analysis';
      const analysisController = new AbortController();
      timeout=setTimeout(()=>analysisController.abort(),ANALYSIS_TIMEOUT);
      $('loading').textContent='در حال خواندن صفحات آزمایش و بررسی مقادیر…';
      const response = await fetch('/api/analyze-lab', { method: 'POST', credentials: 'include', body: form, signal: analysisController.signal });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { location.href = '/auth?next=' + encodeURIComponent('/#lab'); return; }
      if (!response.ok || !data.success) throw Error(data.error || (response.status === 413 ? 'تصاویر بیش از حد مجاز هستند؛ نسخه کم‌حجم‌تر انتخاب کنید.' : response.status === 504 ? 'پاسخ تحلیل طول کشید؛ نتیجه را در پرونده سلامت بررسی کنید و سپس دوباره تلاش کنید.' : 'تفسیر انجام نشد؛ دوباره تلاش کنید.'));
      clearTimeout(timeout); timeout = undefined;
      const result = $('result'); result.replaceChildren();
      const meta = document.createElement('div'); meta.className = 'resultMeta';
      meta.textContent = ({ good: 'کیفیت خواندن مناسب', partial: 'بخشی از برگه خوانا نیست', poor: 'کیفیت تصویر کافی نیست' }[data.read_quality] || 'نتیجه تفسیر');
      const text = document.createElement('div'); text.textContent = data.analysis || '';
      const history = document.createElement('a'); history.className = 'btn'; history.href = '/health'; history.textContent = 'مشاهده در پرونده سلامت';
      result.append(meta, text, history); result.classList.add('show'); result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await loadAccount();
    } catch (e) {
      if(e.message==='AUTH_REQUIRED'){location.href='/auth?next='+encodeURIComponent('/#lab');return;}
      let message=e.name==='AbortError'
        ? stage==='archive' ? 'ذخیره تصویر طول کشید. پرونده سلامت را بررسی کنید و سپس دوباره تلاش کنید.' : 'تحلیل طول کشید. نتیجه را در پرونده سلامت بررسی کنید و سپس دوباره تلاش کنید.'
        : e.name==='TypeError' ? 'ارتباط با سرویس برقرار نشد؛ دوباره تلاش کنید.' : e.message;
      const archived=patientId&&originals.some(source=>source.archives.has(patientId));
      if(archived)message+=' تصویرهای ثبت‌شده در پرونده سلامت شما موجودند.';
      error(message);
      if(archived){const history=document.createElement('a');history.className='btn';history.href='/health';history.textContent='مشاهده تصاویر در پرونده سلامت';$('error').append(document.createTextNode(' '),history);}
    }
    finally { clearTimeout(timeout); busy = false; render(); $('loading').classList.remove('show'); $('loading').setAttribute('aria-busy', 'false'); }
  };
  window.addEventListener('pagehide', () => previewUrls.forEach(url => URL.revokeObjectURL(url)));
  render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
})();
