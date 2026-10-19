(() => {
  'use strict';
  async function mount() {
    if (document.getElementById('drmanAiChatButton')) return;
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/assets/ai-chat.css'; document.head.append(stylesheet);
    const launcher = document.createElement('button'); launcher.id = 'drmanAiChatButton'; launcher.type = 'button'; launcher.textContent = 'چت با هوش مصنوعی'; launcher.setAttribute('aria-haspopup', 'dialog');
    const dialog = document.createElement('dialog'); dialog.id = 'drmanAiChatDialog'; dialog.setAttribute('aria-labelledby', 'drmanAiChatTitle');
    dialog.innerHTML = `<div class="ai-chat-heading"><h2 id="drmanAiChatTitle">راهنمای هوشمند سلامت</h2><button type="button" data-chat-close aria-label="بستن گفت‌وگو">×</button></div><p class="ai-chat-intro">سؤال سلامت یا پرسش دربارهٔ نتیجهٔ آزمایش را اینجا بپرسید. این راهنما جای ویزیت پزشک را نمی‌گیرد؛ در وضعیت اضطراری با ۱۱۵ تماس بگیرید.</p><div data-chat-account></div><label class="ai-chat-patient">پروندهٔ مورد گفت‌وگو<select data-chat-patient aria-label="انتخاب پرونده برای گفت‌وگو" disabled></select></label><div data-chat-messages class="ai-chat-messages" role="log" aria-label="پیام‌های گفت‌وگو" aria-live="polite"></div><p data-chat-status class="ai-chat-status" role="status"></p><div data-chat-consent hidden></div><form class="ai-chat-form"><label for="drmanAiChatQuestion">سؤال شما</label><textarea id="drmanAiChatQuestion" maxlength="1800" rows="3" placeholder="مثلاً برای پیگیری نتیجهٔ آزمایشم چه بپرسم؟" required disabled></textarea><button type="submit" disabled>ارسال سؤال</button></form>`;
    document.body.append(launcher, dialog);
    const find = selector => dialog.querySelector(selector), select = find('[data-chat-patient]'), question = find('textarea'), submit = find('[type=submit]'), messages = find('[data-chat-messages]'), status = find('[data-chat-status]'), consent = find('[data-chat-consent]');
    let initialized = false, initialization = null, current = '', version = 0, busy = false, controller = null, turns = [];
    const active = (id, revision) => current === id && version === revision;
    function controls() { question.disabled = submit.disabled = busy || !current; select.disabled = busy || !select.options.length; }
    function reset(id) { controller?.abort(); controller = null; version++; current = id; turns = []; busy = false; messages.replaceChildren(); consent.hidden = true; consent.replaceChildren(); status.textContent = id ? 'پاسخ‌ها بر اساس همین پرونده تهیه می‌شوند.' : ''; controls(); }
    function sourceLink(source) {
      try {
        const url = new URL(source.url, location.origin), host = url.hostname;
        const trusted = ['medlineplus.gov', 'nhs.uk', 'cdc.gov', 'who.int', 'nih.gov', 'aad.org', 'fda.gov', 'myplate.gov'].some(domain => host === domain || host.endsWith('.' + domain));
        if (url.username || url.password || !(url.protocol === 'https:' && trusted || url.origin === location.origin && url.pathname.startsWith('/learn/'))) return null;
        const link = document.createElement('a'); link.href = url.href; link.textContent = source.label || 'منبع پزشکی'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; return link;
      } catch { return null; }
    }
    function showTurn(turn) {
      const entry = document.createElement('article'), asked = document.createElement('p'), answer = document.createElement('p');
      entry.className = 'ai-chat-turn'; asked.className = 'ai-chat-asked'; asked.textContent = turn.question; answer.className = 'ai-chat-answer'; answer.textContent = turn.answer || 'در حال بررسی سؤال…'; entry.append(asked, answer);
      const sources = document.createElement('div'); sources.className = 'ai-chat-sources';
      for (const source of turn.sources || []) { const link = sourceLink(source); if (link) sources.append(link); }
      if (sources.childNodes.length) entry.append(sources); messages.append(entry); return { entry, answer };
    }
    function paint() { messages.replaceChildren(); turns.forEach(showTurn); messages.scrollTop = messages.scrollHeight; }
    function initialize() {
      if (!initialization) initialization = loadProfiles().finally(() => { initialization = null; });
      return initialization;
    }
    async function loadProfiles() {
      status.textContent = 'در حال دریافت پرونده‌های شما…';
      try {
        const response = await fetch('/api/patients', { credentials: 'same-origin' });
        if (response.status === 401) {
          const paragraph = document.createElement('p'), link = document.createElement('a'); paragraph.textContent = 'برای گفت‌وگو دربارهٔ پروندهٔ خود وارد حساب شوید.';
          const returnPath = /^\/(?:emergency\/|auth(?:\.html)?$)/.test(location.pathname) ? '/health' : location.pathname;
          link.href = '/auth?next=' + encodeURIComponent(returnPath); link.textContent = 'ورود / ثبت‌نام'; link.className = 'ai-chat-login'; paragraph.append(' ', link); find('[data-chat-account]').replaceChildren(paragraph); status.textContent = ''; return;
        }
        const data = await response.json(); if (!response.ok || !data.success) throw Error('پرونده‌ها دریافت نشدند.');
        select.replaceChildren();
        for (const patient of data.patients || []) { const option = document.createElement('option'); option.value = patient.id; option.textContent = patient.display_name || 'پرونده سلامت'; select.append(option); }
        const selected = typeof currentPatient === 'string' ? currentPatient : '';
        if ([...select.options].some(option => option.value === selected)) select.value = selected;
        find('[data-chat-account]').replaceChildren(); reset(select.value); initialized = true;
        if (!current) status.textContent = 'ابتدا پروندهٔ سلامت خود را تکمیل کنید.';
      } catch { status.textContent = 'دریافت پرونده‌ها انجام نشد؛ گفت‌وگو را ببندید و دوباره باز کنید.'; }
    }
    async function transmit(turn) {
      const id = current, revision = version; busy = true; controls(); consent.hidden = true; status.textContent = 'در حال بررسی بر اساس اطلاعات پرونده و منابع پزشکی…';
      const requestController = new AbortController(); controller = requestController; const timer = setTimeout(() => requestController.abort(), 60000);
      try {
        const history = turns.filter(item => item !== turn && item.answer && item.succeeded).slice(-2).map(item => ({ question: item.question.slice(0, 700), answer: item.answer.slice(0, 1000) }));
        const response = await fetch('/api/health-navigator', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_id: id, question: turn.question, history }), signal: requestController.signal });
        const data = await response.json(); if (!active(id, revision)) return;
        if (response.status === 428 && data.code === 'AI_CONSENT_REQUIRED') {
          status.textContent = 'برای ادامه، اجازهٔ پردازش اطلاعات همین پرونده لازم است.';
          const note = document.createElement('p'), allow = document.createElement('button'); note.textContent = 'سؤال و اطلاعات لازم همین پرونده برای پاسخ‌گویی با سرویس هوش مصنوعی پردازش می‌شوند.'; allow.type = 'button'; allow.textContent = 'اجازه می‌دهم و ادامه می‌دهم'; consent.replaceChildren(note, allow); consent.hidden = false;
          allow.addEventListener('click', async () => {
            if (!active(id, revision) || busy) return; allow.disabled = true; busy = true; controls();
            try { const result = await fetch('/api/consent', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_id: id, consent_type: 'ai_processing', granted: true, version: '1' }) }); if (!result.ok) throw Error(); if (active(id, revision)) await transmit(turn); }
            catch { if (active(id, revision)) status.textContent = 'ثبت اجازه انجام نشد؛ دوباره تلاش کنید.'; }
            finally { allow.disabled = false; if (active(id, revision)) { busy = false; controls(); } }
          }); return;
        }
        if (!response.ok || !data.success) throw Error(data.error || 'پاسخ فعلاً آماده نشد؛ دوباره تلاش کنید.');
        turn.answer = String(data.answer || 'پاسخ کافی دریافت نشد؛ سؤال را روشن‌تر مطرح کنید.'); turn.sources = Array.isArray(data.sources) ? data.sources : []; turn.succeeded = true; paint(); status.textContent = 'پاسخ آموزشی است؛ برای تصمیم درمانی با پزشک هماهنگ کنید.';
      } catch (error) { if (active(id, revision)) { turn.answer = error.name === 'AbortError' ? 'پاسخ طول کشید؛ کمی بعد دوباره تلاش کنید.' : error.message; paint(); status.textContent = 'ارسال دوبارهٔ سؤال امکان‌پذیر است.'; } }
      finally { clearTimeout(timer); if (active(id, revision)) { busy = false; controller = null; controls(); } }
    }
    launcher.addEventListener('click', async () => { dialog.showModal(); if (!initialized) await initialize(); else controls(); if (!question.disabled) question.focus(); });
    find('[data-chat-close]').addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => launcher.focus());
    select.addEventListener('change', () => reset(select.value));
    find('form').addEventListener('submit', event => { event.preventDefault(); const text = question.value.trim(); if (busy || !current || !text) return; const turn = { question: text, answer: '' }; turns.push(turn); if (turns.length > 12) turns.shift(); question.value = ''; paint(); transmit(turn); });
    document.addEventListener('drman:health-record-loading', event => { if (event.detail?.patientId && current && event.detail.patientId !== current) { reset(''); select.replaceChildren(); initialized = false; if (dialog.open) initialize(); } });
    window.addEventListener('pagehide', () => { controller?.abort(); reset(''); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
