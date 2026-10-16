(() => {
  'use strict';
  const root = document.getElementById('automaticHealthOverview');
  if (!root) return;
  let patientId = '', generation = 0, controller = null, retryTimer = null;
  const title = document.createElement('h2'); title.textContent = 'نگاهی به سلامت شما';
  const intro = document.createElement('p'); intro.className = 'health-overview-intro'; intro.textContent = 'جمع‌بندی پرونده و برنامهٔ قدم‌به‌قدم برای عادت‌های بهتر، بدون نیاز به پرسیدن سؤال.';
  const status = document.createElement('p'); status.className = 'health-overview-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const content = document.createElement('div'); content.className = 'health-overview-content';
  root.classList.add('health-overview'); root.replaceChildren(title, intro, status, content);
  function paragraph(value, className = '') { const node = document.createElement('p'); node.textContent = String(value || ''); if (className) node.className = className; return node; }
  function section(label, values, parent = content) {
    if (!Array.isArray(values) || !values.length) return;
    const box = document.createElement('section'), heading = document.createElement('h3'), items = document.createElement('ul');
    heading.textContent = label;
    for (const value of values.slice(0, 8)) { const item = document.createElement('li'); item.textContent = String(value); items.append(item); }
    box.append(heading, items); parent.append(box);
  }
  function lifestyle(plan, source) {
    if (!plan || typeof plan.goal !== 'string' || !Array.isArray(plan.first_week)) return;
    const box = document.createElement('section'), heading = document.createElement('h3');
    box.className = 'health-lifestyle-plan'; heading.textContent = 'برنامهٔ اصلاح سبک زندگی شما';
    box.append(heading, paragraph(plan.goal, 'health-lifestyle-goal'));
    section('چرا این برنامه برای من؟', plan.based_on, box);
    const week = document.createElement('div'); week.className = 'health-lifestyle-week';
    for (const block of plan.first_week.slice(0, 3)) {
      if (!block || typeof block.label !== 'string' || !Array.isArray(block.steps)) continue;
      section(block.label, block.steps, week);
    }
    box.append(week);
    const followup = document.createElement('div'); followup.className = 'health-lifestyle-followup';
    section('ادامه در هفته‌های بعد', plan.next_weeks, followup);
    section('خواب و آرامش', plan.sleep_and_stress, followup);
    section('چطور پیشرفتم را ببینم؟', plan.tracking, followup);
    section('متناسب با شرایط شما', plan.precautions, followup);
    box.append(followup);
    if (source === 'record') box.append(paragraph('این برنامه از اطلاعات ثبت‌شده و راهنمای عمومی تهیه شده است؛ برنامهٔ شخصی‌تر به اطلاعات کامل‌تر و ارزیابی درمانگر نیاز دارد.', 'health-overview-disclaimer'));
    const sources = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'مبنای توصیه‌های عمومی'; sources.className = 'health-lifestyle-sources'; sources.append(summary);
    for (const [label, url] of [
      ['سازمان جهانی بهداشت · فعالیت در حد توان', 'https://www.who.int/news-room/fact-sheets/detail/physical-activity/'],
      ['NIDDK · شخصی‌سازی تغذیه در بیماری کلیه', 'https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/healthy-eating-adults-chronic-kidney-disease'],
      ['CDC · عادت‌های خواب', 'https://www.cdc.gov/sleep/about/']
    ]) { const line = document.createElement('p'), link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = label; line.append(link); sources.append(line); }
    box.append(sources); content.append(box);
  }
  function clear(id) {
    generation++; patientId = id || ''; controller?.abort(); controller = null; clearTimeout(retryTimer); retryTimer = null;
    content.replaceChildren(); root.removeAttribute('aria-busy'); status.textContent = patientId ? 'در حال آماده‌کردن جمع‌بندی همین پرونده…' : 'ابتدا یک پرونده را انتخاب کنید.';
  }
  function render(data) {
    const overview = data.overview || {}; content.replaceChildren(paragraph(overview.overall, 'health-overview-summary'));
    section('از کجا شروع کنم؟', overview.next_steps);
    const habits = document.createElement('div'); habits.className = 'health-overview-habits'; content.append(habits);
    // Build sections with textContent only: clinical text is never HTML.
    section('چه بخورم؟', overview.nutrition); const nutrition = content.lastElementChild; if (nutrition?.tagName === 'SECTION') habits.append(nutrition);
    section('چطور فعال‌تر باشم؟', overview.movement); const movement = content.lastElementChild; if (movement?.tagName === 'SECTION') habits.append(movement);
    lifestyle(overview.lifestyle_plan, data.lifestyle_source);
    if (overview.seek_care) { const care = document.createElement('section'), h = document.createElement('h3'); care.className = 'health-overview-care'; h.textContent = 'چه زمانی کمک بگیرم؟'; care.append(h, paragraph(overview.seek_care)); content.append(care); }
    section('برای مراجعه بپرسم', overview.questions_for_doctor);
    section('چه اطلاعاتی هنوز لازم است؟', overview.data_limits);
    content.append(paragraph(data.disclaimer || 'این جمع‌بندی آموزشی است و جای ارزیابی پزشک را نمی‌گیرد.', 'health-overview-disclaimer'));
    if (data.state === 'consent_not_granted') status.textContent = 'جمع‌بندی از اطلاعات ثبت‌شده تهیه شد؛ تا وقتی رضایت پردازش هوش مصنوعی فعال نباشد، اطلاعات این پرونده به سرویس هوش مصنوعی ارسال نمی‌شود.';
    else if (data.stale) status.textContent = 'جمع‌بندی قبلی نمایش داده می‌شود. اطلاعات تازه هنوز در این جمع‌بندی لحاظ نشده است.';
    else if (data.source === 'local') status.textContent = 'مرور اطلاعات ثبت‌شده؛ جمع‌بندی هوشمند در حال حاضر آماده نیست.';
    else status.textContent = 'بر اساس پروندهٔ فعلی' + (data.generated_at ? ' · ' + (window.DrManJalali?.display(data.generated_at) || new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran' }).format(new Date(data.generated_at))) : '');
  }
  async function load(detail, pendingRetry = false) {
    const id = String(detail?.patientId || ''); if (!id || (!pendingRetry && !detail.record)) return;
    clear(id); const current = generation; const signalController = new AbortController(); controller = signalController;
    root.setAttribute('aria-busy', 'true'); const timeout = setTimeout(() => signalController.abort(), 60000);
    try {
      const response = await fetch('/api/health-navigator', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'overview', patient_id: id }), signal: signalController.signal });
      const data = await response.json(); if (current !== generation || patientId !== id) return;
      if (!response.ok || !data.success) throw Error('UNAVAILABLE');
      render(data);
      // Another tab may be doing the single server-side generation. One later
      // cache read is enough; never poll the provider or loop on rate limits.
      if (data.state === 'pending' && !pendingRetry) retryTimer = setTimeout(() => { if (current === generation && patientId === id) load({ patientId: id }, true); }, 10000);
    } catch (error) {
      if (current !== generation || patientId !== id) return;
      status.textContent = 'جمع‌بندی فعلاً دریافت نشد. اطلاعات و پیگیری‌های پرونده در بخش‌های زیر در دسترس است.';
    } finally { clearTimeout(timeout); if (current === generation) root.removeAttribute('aria-busy'); }
  }
  document.addEventListener('drman:health-record-loading', event => clear(String(event.detail?.patientId || '')));
  document.addEventListener('drman:health-record-loaded', event => load(event.detail));
  document.addEventListener('drman:health-profile-updated', event => load(event.detail));
  document.dispatchEvent(new CustomEvent('drman:health-record-request'));
})();
