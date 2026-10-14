(() => {
  let currentAISettings = null, loading = false, saving = false, testing = false;
  const form = document.getElementById('privateAIForm');
  if (!form) return;
  const element = id => document.getElementById(id);
  const keyInput = element('privateAIKey'), freeAccount = element('privateAIFreeAccount');

  function message(text, isError = false) {
    const target = element('privateAIFeedback');
    target.textContent = text;
    target.className = isError ? 'danger' : 'muted';
  }
  function controls() {
    const busy = loading || saving || testing;
    element('savePrivateAI').disabled = busy || !currentAISettings?.encryption_ready;
    element('clearPrivateAIKey').disabled = busy || !currentAISettings?.key_configured;
    element('reloadAISettings').disabled = busy;
    element('testPrivateAI').disabled = busy || !currentAISettings?.key_configured || !!keyInput.value.trim();
    keyInput.disabled = busy;
    freeAccount.disabled = busy;
    keyInput.required = !currentAISettings?.key_configured;
  }
  function render(settings) {
    currentAISettings = settings;
    keyInput.value = '';
    freeAccount.checked = settings.free_account_confirmed === true;
    element('privateAIKeyState').textContent = settings.key_configured
      ? 'کلید به‌صورت امن ذخیره شده است. اتصال هنگام تحلیل بررسی می‌شود.'
      : 'کلید Groq هنوز تنظیم نشده است.';
    element('privateAIKeyState').className = settings.key_configured ? 'success' : 'warning';
    if (!settings.encryption_ready) message('ذخیره امن کلید در سرور آماده نیست؛ تنظیمات رمزگذاری باید بررسی شود.', true);
    controls();
  }
  async function loadPrivateAISettings() {
    if (loading || saving || testing) return;
    loading = true;
    keyInput.value = '';
    message('در حال دریافت تنظیمات هوش مصنوعی…'); controls();
    try {
      const result = await jf('/api/admin-ai-settings');
      render(result.settings || {});
      if (currentAISettings?.encryption_ready) message('وضعیت کلید به‌روز است. ذخیره کلید به معنی تأیید اتصال نیست.');
    } catch (error) {
      currentAISettings = null;
      message(error.message || 'دریافت تنظیمات انجام نشد؛ دوباره تلاش کنید.', true);
    } finally { loading = false; controls(); }
  }
  async function save(clearKey = false) {
    if (saving || loading || testing) return;
    saving = true;
    const input = { provider: 'groq', free_only: true, free_account_confirmed: clearKey ? true : freeAccount.checked };
    if (clearKey) input.clear_key = true;
    else if (keyInput.value.trim()) input.api_key = keyInput.value.trim();
    controls(); message(clearKey ? 'در حال حذف کلید…' : 'در حال ذخیره امن کلید…');
    try {
      const result = await jf('/api/admin-ai-settings', { method: 'PUT', body: JSON.stringify(input) });
      render(result.settings || {});
      element('privateAITestFeedback').textContent = '';
      message(clearKey ? 'کلید ذخیره‌شده حذف شد.' : 'تنظیمات رایگان ذخیره شد. اکنون تحلیل یک تصویر آزمایشی را اجرا کنید.');
    } catch (error) {
      message(error.message || 'ذخیره تنظیمات انجام نشد؛ دوباره تلاش کنید.', true);
    } finally {
      keyInput.value = '';
      saving = false; controls();
    }
  }
  async function testConnection() {
    if (testing || saving || loading || !currentAISettings?.key_configured || keyInput.value.trim()) return;
    testing = true; controls();
    const button = element('testPrivateAI'), target = element('privateAITestFeedback');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 240000);
    button.textContent = 'در حال آزمون اتصال…';
    target.className = 'muted';
    target.textContent = 'تصویر ساختگی در حال خواندن و تفسیر است؛ این آزمون ممکن است چند دقیقه طول بکشد.';
    try {
      const result = await jf('/api/admin-ai-test', { method: 'POST', body: '{}', signal: controller.signal });
      if (result.success !== true || result.samples_checked !== 4 || result.checks_passed !== result.checks_total || result.checks_total !== 6) throw new Error('آزمون اتصال کامل تأیید نشد؛ دوباره تلاش کنید.');
      target.className = 'success';
      target.textContent = `آزمون موفق بود: هر چهار مقدار و پرچم درست خوانده شد و توضیح فارسی دریافت شد. ${result.checks_passed} بررسی موفق؛ زمان ${Math.ceil(Number(result.elapsed_ms || 0) / 1000)} ثانیه.`;
    } catch (error) {
      target.className = 'danger';
      target.textContent = controller.signal.aborted ? 'زمان آزمون پایان یافت. کمی بعد دوباره تلاش کنید.' : error.message || 'آزمون اتصال انجام نشد؛ دوباره تلاش کنید.';
    } finally {
      clearTimeout(timeout); testing = false;
      button.textContent = 'آزمون اتصال رایگان'; controls();
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (form.reportValidity()) save(); });
  element('clearPrivateAIKey').addEventListener('click', () => save(true));
  element('reloadAISettings').addEventListener('click', loadPrivateAISettings);
  element('testPrivateAI').addEventListener('click', testConnection);
  keyInput.addEventListener('input', () => { freeAccount.checked = false; controls(); });
  document.addEventListener('click', event => {
    const sectionButton = event.target.closest('[data-page]');
    if (sectionButton?.dataset.page === 'aiSettings') {
      if (location.hash !== '#ai-settings') history.replaceState(null, '', '#ai-settings');
      loadPrivateAISettings();
    } else if (sectionButton && location.hash === '#ai-settings') {
      history.replaceState(null, '', location.pathname + location.search);
    }
  });
  function openFromLink() {
    if (location.hash === '#ai-settings' && getComputedStyle(element('app')).display !== 'none' && !element('aiSettings').classList.contains('on')) {
      document.querySelector('[data-page="aiSettings"]').click();
    }
  }
  addEventListener('hashchange', openFromLink);
  const observer = new MutationObserver(openFromLink);
  observer.observe(element('app'), { attributes: true, attributeFilter: ['style'] });
  openFromLink();
})();
