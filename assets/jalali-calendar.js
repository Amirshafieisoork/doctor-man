// Visible dates use the Persian calendar. Native controls keep their original
// Gregorian values, names and event handlers for the existing API contracts.
(() => {
  if (globalThis.DrManCalendar) return;
  let sequence = 0;
  const states = new WeakMap();
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const selector = 'input[type="date"],input[type="datetime-local"]';
  const labelText = input => input.getAttribute('aria-label') || [...(input.labels || [])].map(label => label.textContent.trim()).join(' ') || 'تاریخ';
  function enhanceInput(input) {
    if (states.has(input) || input.dataset.calendar === 'native') return;
    const calendar = globalThis.DrManJalali, datetime = input.type === 'datetime-local';
    const wrapper = document.createElement('span');
    wrapper.className = 'jalali-control' + (datetime ? ' jalali-control-datetime' : '');
    const date = document.createElement('input');
    date.type = 'text'; date.inputMode = 'numeric'; date.dir = 'ltr';
    date.id = 'jalali-' + (input.id || 'date-' + ++sequence);
    date.placeholder = '۱۴۰۵/۰۱/۱۵'; date.autocomplete = 'off';
    date.className = 'jalali-date-input'; date.dataset.jalaliInput = '';
    date.setAttribute('aria-label', labelText(input) + ' (شمسی)');
    const help = document.createElement('small');
    help.id = date.id + '-help'; help.className = 'jalali-date-help';
    help.textContent = 'تاریخ شمسی · سال / ماه / روز';
    date.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), help.id].filter(Boolean).join(' '));
    wrapper.append(date);
    let time;
    if (datetime) {
      time = document.createElement('input'); time.type = 'time';
      time.className = 'jalali-time-input'; time.id = date.id + '-time';
      time.setAttribute('aria-label', labelText(input) + ' · ساعت');
      time.dir = 'ltr'; time.step = input.step || '60'; wrapper.append(time);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      help.textContent += ' · ساعت محلی' + (timezone === 'Asia/Tehran' ? ' ایران' : ' دستگاه');
    }
    wrapper.append(help);
    input.insertAdjacentElement('afterend', wrapper);
    input.classList.add('jalali-source'); input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    const explicitLabels = [...(input.labels || [])].filter(label => label.htmlFor === input.id);
    explicitLabels.forEach(label => { label.htmlFor = date.id; });
    const state = { input, date, time, wrapper, sync, validate };
    states.set(input, state);
    function sync() {
      const value = nativeValue.get.call(input), [day, clock] = value.split('T');
      date.value = calendar.persianDigits(calendar.format(day));
      if (time) time.value = clock || '';
      date.disabled = input.disabled; date.readOnly = input.readOnly; date.required = input.required;
      if (time) { time.disabled = input.disabled; time.readOnly = input.readOnly; time.required = input.required; }
      date.setCustomValidity('');
      if (time) time.setCustomValidity('');
      validate(false);
    }
    function validate(show = false) {
      date.setCustomValidity('');
      if (time) time.setCustomValidity('');
      if (input.disabled) return true;
      try {
        let value = '';
        if (date.value.trim()) value = datetime && time.value ? calendar.toLocalDateTime(date.value, time.value) : calendar.toGregorian(date.value);
        if (datetime && date.value.trim() && !time.value) throw Error('ساعت را هم وارد کنید.');
        if (datetime && !date.value.trim() && time.value) throw Error('تاریخ شمسی را هم وارد کنید.');
        if (!value && input.required) throw Error('تاریخ شمسی را وارد کنید.');
        if (value && input.min && value < input.min) throw Error('تاریخ نباید پیش از ' + calendar.persianDigits(calendar.format(input.min.slice(0, 10))) + (datetime && input.min.includes('T') ? ' ساعت ' + calendar.persianDigits(input.min.split('T')[1]) : '') + ' باشد.');
        if (value && input.max && value > input.max) throw Error('تاریخ نباید پس از ' + calendar.persianDigits(calendar.format(input.max.slice(0, 10))) + (datetime && input.max.includes('T') ? ' ساعت ' + calendar.persianDigits(input.max.split('T')[1]) : '') + ' باشد.');
        nativeValue.set.call(input, value);
        if (value && input.validity.stepMismatch) throw Error('زمان واردشده با فاصلهٔ زمانی مجاز سازگار نیست.');
        return true;
      } catch (error) {
        nativeValue.set.call(input, '');
        date.setCustomValidity(error.message || 'تاریخ شمسی معتبر نیست.');
        if (show) { date.focus(); date.reportValidity(); }
        return false;
      }
    }
    // Observe only this control's value. Global Date, JSON and API behavior is untouched.
    Object.defineProperty(input, 'value', { configurable: true, get() { return nativeValue.get.call(input); }, set(value) { nativeValue.set.call(input, value); sync(); } });
    for (const field of [date, time].filter(Boolean)) {
      field.addEventListener('input', () => {
        validate(false);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      field.addEventListener('change', () => {
        if (!validate(true)) return;
        date.value = calendar.persianDigits(calendar.format(nativeValue.get.call(input).slice(0, 10)));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    input.addEventListener('change', () => { if (nativeValue.get.call(input)) sync(); });
    input.addEventListener('invalid', event => { event.preventDefault(); validate(true); });
    if (input.form) input.form.addEventListener('reset', () => queueMicrotask(sync));
    new MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly', 'required', 'min', 'max', 'step', 'value'] });
    sync();
  }
  function enhance(root = document) {
    if (root.matches?.(selector)) enhanceInput(root);
    root.querySelectorAll?.(selector).forEach(enhanceInput);
  }
  function validate(root = document) {
    enhance(root);
    for (const input of root.querySelectorAll(selector)) {
      const state = states.get(input);
      if (state && !state.validate(true)) return false;
    }
    return true;
  }
  async function start() {
    if (typeof globalThis.DrManJalali?.toLocalDateTime !== 'function') await import('/assets/jalali-date.js');
    if (typeof globalThis.DrManJalali?.persianDigits !== 'function' || typeof globalThis.DrManJalali?.toLocalDateTime !== 'function') return;
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    globalThis.DrManCalendar = Object.freeze({ enhance, validate, refresh(input) { states.get(input)?.sync(); } });
    enhance();
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE) enhance(node); }))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('submit', event => { if (!validate(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    document.dispatchEvent(new Event('drman:calendar-ready'));
  }
  start().catch(() => { /* Existing native controls stay usable if a resource cannot load. */ });
})();
