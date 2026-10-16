/* Only reviewed guidance attached by the order API is rendered. No medical
 * information is sent to a source website until the patient opens its link. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const sourceLink = source => {
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || !['medlineplus.gov', 'www.gloshospitals.nhs.uk'].includes(url.hostname)) return '';
      return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(source.label)}</a>`;
    } catch { return ''; }
  };
  const sources = rows => Array.isArray(rows) ? rows.map(sourceLink).filter(Boolean).join(' · ') : '';
  const list = rows => Array.isArray(rows) ? `<ul>${rows.map(row => `<li>${escape(row)}</li>`).join('')}</ul>` : '';
  function html(preparation) {
    if (!preparation || preparation.version !== 'lab-preparation-v1') return '';
    const tests = Array.isArray(preparation.tests) ? preparation.tests : [];
    const unknown = Array.isArray(preparation.unrecognized_items) ? preparation.unrecognized_items : [];
    let reviewed = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(preparation.reviewed_at || '')) {
      const date = new Date(`${preparation.reviewed_at}T12:00:00Z`);
      if (Number.isFinite(date.getTime())) reviewed = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year:'numeric', month:'long', day:'numeric', timeZone:'Asia/Tehran' }).format(date);
    }
    return `<details class="lab-preparation" open><summary>${escape(preparation.title || 'آمادگی پیش از آزمایش')}</summary><div class="lab-preparation-body">${list(preparation.general)}${tests.map(test => `<section class="lab-preparation-test"><h4>${escape(test.title)}</h4>${list(test.steps)}<p class="lab-preparation-sources">منبع: ${sources(test.sources)}</p></section>`).join('')}${unknown.length ? `<p class="lab-preparation-unknown">برای «${unknown.map(escape).join('، ')}» راهنمای اختصاصی تأییدشده در دسترس نیست؛ دستور آماده‌سازی را از پزشک یا آزمایشگاه بگیرید.</p>` : ''}<p class="lab-preparation-sources">${sources(preparation.general_sources)}${reviewed ? `<span> · بررسی منابع: ${escape(reviewed)}</span>` : ''}</p></div></details>`;
  }
  window.DrManLabPreparation = { html };
})();
