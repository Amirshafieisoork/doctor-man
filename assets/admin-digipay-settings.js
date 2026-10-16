(() => {
  const form = document.getElementById('privateDigiPayForm');
  if (!form) return;
  const get = id => document.getElementById(id);
  const fields = { client_id: 'digiPayClientId', client_secret: 'digiPayClientSecret', username: 'digiPayUsername', password: 'digiPayPassword' };
  let current = null, loading = false, saving = false, testing = false;
  const dirty = () => Object.values(fields).some(id => !!get(id).value.trim()) || !!current && get('digiPayEnvironment').value !== current.environment;
  function clearInputs() { for (const id of Object.values(fields)) get(id).value = ''; }
  function message(text, error = false) { get('digiPaySettingsFeedback').textContent = text; get('digiPaySettingsFeedback').className = error ? 'danger' : 'muted'; }
  function controls() {
    const busy = loading || saving || testing, changedEnvironment = !!current && get('digiPayEnvironment').value !== current.environment;
    get('saveDigiPaySettings').disabled = busy || !current?.encryption_ready;
    get('testDigiPayConnection').disabled = busy || !current?.configured || dirty();
    get('reloadDigiPaySettings').disabled = busy;
    get('digiPayEnvironment').disabled = busy;
    for (const [field, id] of Object.entries(fields)) { get(id).disabled = busy; get(id).required = changedEnvironment || current?.source !== 'private' || !current?.fields?.[field]; }
  }
  function render(settings) {
    current = settings; clearInputs();
    get('digiPayEnvironment').value = settings.environment === 'uat' ? 'uat' : 'production';
    for (const [field, id] of Object.entries(fields)) get(id + 'State').textContent = settings.source !== 'private' ? 'برای اولین ثبت امن، مقدار فنی دریافتی از دیجی‌پی را وارد کنید.' : settings.fields?.[field] ? 'اطلاعات امن موجود است؛ کادر خالی آن را حفظ می‌کند.' : 'این مورد هنوز تنظیم نشده است.';
    get('digiPaySettingsState').textContent = settings.configured
      ? settings.source === 'private' ? 'هر چهار مورد امن ذخیره شده است. ذخیره اطلاعات به معنی تأیید اتصال نیست؛ آزمون اتصال را اجرا کنید.' : 'اطلاعات قبلی سرور موجود است؛ اتصال تأیید نشده است. برای ثبت امن، هر چهار مقدار رسمی دیجی‌پی را دوباره وارد کنید.'
      : 'اطلاعات اتصال کامل نیست؛ هر چهار مورد فنی را تکمیل کنید.';
    get('digiPaySettingsState').className = settings.configured ? 'success' : 'warning';
    const check = settings.last_auth_check;
    get('digiPayLastCheck').textContent = check ? `آخرین آزمون: ${check.authenticated ? 'موفق' : 'ناموفق'} · ${dt(check.checked_at)}` : 'هنوز آزمونی برای اطلاعات ذخیره‌شده ثبت نشده است.';
    controls();
  }
  async function loadSettings() {
    if (loading || saving || testing) return;
    loading = true; clearInputs(); message('در حال دریافت وضعیت اتصال…'); controls();
    try {
      const result = await jf('/api/admin-digipay-settings');
      render(result.settings || {});
      message(current.encryption_ready ? 'اطلاعات ذخیره‌شده برای امنیت نمایش داده نمی‌شوند.' : 'ذخیره امن اطلاعات در سرور آماده نیست؛ تنظیمات رمزگذاری باید بررسی شود.', !current.encryption_ready);
    } catch (error) { current = null; message(error.message || 'دریافت وضعیت انجام نشد.', true); }
    finally { loading = false; controls(); }
  }
  async function save() {
    if (loading || saving || testing || !form.reportValidity()) return;
    saving = true;
    const input = { environment: get('digiPayEnvironment').value };
    for (const [field, id] of Object.entries(fields)) if (get(id).value.trim()) input[field] = get(id).value.trim();
    controls(); message('در حال ذخیره امن اطلاعات…');
    try {
      const result = await jf('/api/admin-digipay-settings', { method: 'PUT', body: JSON.stringify(input) });
      render(result.settings || {}); get('digiPayTestFeedback').textContent = '';
      message('اطلاعات به‌صورت رمزگذاری‌شده ذخیره شد. اکنون آزمون اتصال دیجی‌پی را اجرا کنید.');
    } catch (error) { message(error.message || 'ذخیره امن اطلاعات انجام نشد.', true); }
    finally { clearInputs(); saving = false; controls(); }
  }
  async function testConnection() {
    if (loading || saving || testing || !current?.configured || dirty()) return;
    testing = true; controls();
    const target = get('digiPayTestFeedback'), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    target.className = 'muted'; target.textContent = 'در حال بررسی ورود فنی به دیجی‌پی…';
    try {
      const result = await jf('/api/admin-digipay-test', { method: 'POST', body: '{}', signal: controller.signal });
      if (result.authenticated !== true) throw new Error('اتصال دیجی‌پی تأیید نشد؛ اطلاعات فنی را بررسی کنید.');
      target.className = 'success'; target.textContent = result.message || 'اتصال فنی تأیید شد؛ هیچ پرداختی ایجاد نشد.';
    } catch (error) { target.className = 'danger'; target.textContent = controller.signal.aborted ? 'آزمون در زمان مجاز پاسخ نداد؛ دوباره تلاش کنید.' : error.message || 'اتصال دیجی‌پی تأیید نشد.'; }
    finally { clearTimeout(timer); testing = false; controls(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); save(); });
  for (const id of Object.values(fields)) get(id).addEventListener('input', controls);
  get('digiPayEnvironment').addEventListener('change', controls);
  get('reloadDigiPaySettings').addEventListener('click', loadSettings);
  get('testDigiPayConnection').addEventListener('click', testConnection);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-page]');
    if (button?.dataset.page === 'paymentSettings') {
      if (location.hash !== '#payment-settings') history.replaceState(null, '', '#payment-settings');
      loadSettings();
    } else if (button) {
      clearInputs(); controls();
      if (location.hash === '#payment-settings') history.replaceState(null, '', location.pathname + location.search);
    }
  });
  function openFromLink() {
    const app = get('app');
    if (getComputedStyle(app).display === 'none') { clearInputs(); current = null; controls(); return; }
    if (location.hash === '#payment-settings' && !get('paymentSettings').classList.contains('on')) document.querySelector('[data-page="paymentSettings"]').click();
  }
  addEventListener('hashchange', openFromLink);
  new MutationObserver(openFromLink).observe(get('app'), { attributes: true, attributeFilter: ['style'] });
  openFromLink();
})();
