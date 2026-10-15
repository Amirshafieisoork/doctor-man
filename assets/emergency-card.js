/* QR generation, previews and downloads stay on this device; links are never sent to a QR service. */
(() => {
  const links = new Map(); // Raw tokens live only in this page's memory, never localStorage/sessionStorage.
  const scopeInputs = { show_blood_type: 'eBlood', show_allergies: 'eAllergy', show_conditions: 'eConditions', show_medications: 'eMeds', show_emergency_contact: 'eContact' };
  let selected = null, operation = 0, busy = false;
  const byId = id => document.getElementById(id);
  const validSelection = state => !!state && recordReady() && selectedRecordIs(state.patientId, state.version) && byId('emergencyModal').dataset.patientId === state.patientId;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const status = (text, error = false) => { const node = byId('emergencyLink'); node.textContent = text; node.dataset.error = String(error); };
  function controls(value) { busy = value; byId('emergencyModal').querySelectorAll('[data-emergency-action], .emergency-choices input').forEach(node => node.disabled = value); }
  function initialize() {
    const modal = byId('emergencyModal');
    if (modal.dataset.emergencyReady) return;
    modal.dataset.emergencyReady = 'true';
    modal.querySelector('.dialog').innerHTML = `<h2>کارت اضطراری سلامت</h2><p class="emergency-intro">کارت را در گوشی ذخیره یا چاپ کنید. هر کس کد QR را اسکن کند، فقط اطلاعاتی را می‌بیند که اینجا انتخاب کرده‌اید. با ساخت کارت جدید یا غیرفعال‌سازی، QR قبلی دیگر کار نمی‌کند.</p><div class="emergency-choices"><label class="emergency-scope-label"><input id="eBlood" type="checkbox" checked>گروه خونی</label><label class="emergency-scope-label"><input id="eAllergy" type="checkbox" checked>حساسیت‌ها</label><label class="emergency-scope-label"><input id="eConditions" type="checkbox" checked>بیماری‌های فعال</label><label class="emergency-scope-label"><input id="eMeds" type="checkbox" checked>داروهای فعال</label><label class="emergency-scope-label"><input id="eContact" type="checkbox" checked>تماس اضطراری</label></div><div class="emergency-actions"><button class="primary" type="button" id="emergencyCreate" data-emergency-action>ساخت کارت و لینک جدید</button><button type="button" id="emergencyDisable" data-emergency-action>غیرفعال‌سازی کارت</button></div><p id="emergencyLink" class="emergency-status" role="status" aria-live="polite"></p><div id="emergencyPreview" hidden></div><div class="emergency-actions" id="emergencyExportActions" hidden><button type="button" id="emergencyDownload" data-emergency-action>ذخیره کارت در گوشی (PNG)</button><button type="button" id="emergencyPrint" data-emergency-action>چاپ کارت</button><a id="emergencyOpen" class="btn" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">باز کردن کارت آنلاین</a></div><div class="emergency-actions"><button id="emergencyClose" type="button">بستن</button></div>`;
    byId('emergencyCreate').addEventListener('click', () => window.enableEmergency());
    byId('emergencyDisable').addEventListener('click', () => window.disableEmergency());
    byId('emergencyDownload').addEventListener('click', download);
    byId('emergencyPrint').addEventListener('click', print);
    byId('emergencyClose').addEventListener('click', () => closeModal('emergencyModal'));
    for (const id of Object.values(scopeInputs)) byId(id).addEventListener('change', () => { hidePreview(); status('انتخاب‌ها تغییر کرد. برای اعمال آن‌ها «ساخت کارت و لینک جدید» را بزنید؛ QR قبلی باطل می‌شود.'); });
  }
  function hidePreview() { byId('emergencyPreview').hidden = true; byId('emergencyPreview').replaceChildren(); byId('emergencyExportActions').hidden = true; byId('emergencyOpen').removeAttribute('href'); }
  function visibleText(rows, key, activeOnly = false) {
    const items = (rows || []).filter(row => !activeOnly || row.status === 'active').map(row => String(row[key] || '').trim()).filter(Boolean);
    return items.length ? items.slice(0, 2).join('، ') + (items.length > 2 ? '؛ موارد بیشتر با اسکن QR' : '') : 'موردی ثبت نشده';
  }
  function viewData(card) {
    const patient = patients.find(item => item.id === selected.patientId) || {};
    const lines = [];
    if (card.show_blood_type) lines.push(['گروه خونی ثبت‌شده', patient.blood_type || 'ثبت نشده']);
    if (card.show_allergies) lines.push(['حساسیت‌ها', visibleText(record?.allergies, 'allergen')]);
    if (card.show_conditions) lines.push(['بیماری‌های فعال', visibleText(record?.conditions, 'name', true)]);
    if (card.show_medications) lines.push(['داروهای فعال', visibleText(record?.medications, 'name', true)]);
    if (card.show_emergency_contact) lines.push(['تماس اضطراری', [patient.emergency_contact_name, patient.emergency_contact_phone].filter(Boolean).join(' · ') || 'ثبت نشده']);
    return { name: patient.display_name || 'پرونده سلامت', lines };
  }
  function drawQR(canvas, url, size = 560) {
    const qr = window.DrManEmergencyQR?.create(url, { errorCorrectionLevel: 'M' });
    if (!qr) throw new Error('ساخت کد QR انجام نشد؛ صفحه را تازه‌سازی کنید.');
    const modules = qr.modules, margin = 4, scale = Math.max(1, Math.floor(size / (modules.size + margin * 2)));
    canvas.width = canvas.height = (modules.size + margin * 2) * scale;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#0b2946';
    for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    return canvas;
  }
  function render(link) {
    if (!validSelection(selected)) return;
    const data = viewData(link.card), card = el('article', 'emergency-glass-card'); card.setAttribute('aria-label', 'پیش‌نمایش کارت اضطراری');
    const brand = el('div', 'emergency-card-brand'); brand.append(el('span', '', 'DrMan · دکتر من'), el('span', 'emergency-card-chip', 'کارت اضطراری سلامت'));
    card.append(brand, el('h2', '', data.name), el('p', 'emergency-card-subtitle', 'اطلاعات ضروری برای کمک سریع‌تر'));
    const content = el('div', 'emergency-card-content'), details = el('div', 'emergency-card-details');
    for (const [label, value] of data.lines) { const line = el('p'); const valueNode = el('strong', '', value); if (label === 'گروه خونی ثبت‌شده') { valueNode.dir = 'ltr'; valueNode.style.display = 'block'; valueNode.style.textAlign = 'right'; } line.append(el('span', 'emergency-card-label', label), valueNode); details.append(line); }
    if (!data.lines.length) details.append(el('p', '', 'اطلاعات پزشکی برای نمایش انتخاب نشده است.'));
    const qr = el('div', 'emergency-card-qr'), canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'کد QR برای باز کردن اطلاعات اضطراری انتخاب‌شده'); drawQR(canvas, link.url);
    qr.append(canvas, el('span', '', 'برای مشاهده اطلاعات ضروری، اسکن کنید'));
    content.append(details, qr); card.append(content, el('p', 'emergency-card-note', 'اورژانس: ۱۱۵ · اطلاعات ثبت‌شده توسط صاحب پرونده است؛ صحت آن هنگام رسیدگی بررسی شود. گروه خونی جای آزمایش تطبیق خون را نمی‌گیرد.'));
    byId('emergencyPreview').replaceChildren(card); byId('emergencyPreview').hidden = false; byId('emergencyExportActions').hidden = false; byId('emergencyOpen').href = link.url;
  }
  window.openEmergency = async function () {
    if (!recordReady()) return;
    initialize(); const id = ++operation; selected = { patientId: currentPatient, version: recordLoadVersion }; const state = selected;
    byId('emergencyModal').dataset.patientId = state.patientId; byId('emergencyModal').classList.add('open'); hidePreview(); controls(true); status('در حال دریافت تنظیمات کارت…');
    try {
      const result = await api('/api/emergency-card?patient_id=' + encodeURIComponent(state.patientId));
      if (operation !== id || !validSelection(state)) return;
      for (const [key, input] of Object.entries(scopeInputs)) byId(input).checked = result.card ? result.card[key] === true : true;
      const saved = links.get(state.patientId);
      if (saved && result.card?.enabled && result.card.updated_at === saved.card.updated_at) { status('کارت آماده است؛ می‌توانید آن را ذخیره یا چاپ کنید.'); render(saved); }
      else { links.delete(state.patientId); status(result.card?.enabled ? 'کارت فعال است. برای دریافت دوباره تصویر کارت، لینک جدید بسازید؛ QR کارت قبلی باطل می‌شود.' : 'کارت هنوز فعال نیست. اطلاعات قابل نمایش را انتخاب کنید و کارت بسازید.'); }
    } catch (error) { if (operation === id && validSelection(state)) status(error.message || 'دریافت تنظیمات انجام نشد.', true); }
    finally { if (operation === id && validSelection(state)) controls(false); }
  };
  window.enableEmergency = async function () {
    if (busy || !validSelection(selected)) return;
    const state = selected, id = ++operation, scopes = Object.fromEntries(Object.entries(scopeInputs).map(([key, input]) => [key, byId(input).checked])); controls(true); status('در حال ساخت کارت…');
    try {
      const result = await api('/api/emergency-card', { method: 'POST', body: JSON.stringify({ patient_id: state.patientId, enabled: true, ...scopes }) });
      links.delete(state.patientId);
      if (!/^\/emergency\/[A-Za-z0-9_-]{32}$/.test(result.url || '') || !result.card?.enabled) throw new Error('لینک کارت معتبر دریافت نشد؛ دوباره تلاش کنید.');
      const link = { url: new URL(result.url, location.origin).href, card: result.card }; links.set(state.patientId, link);
      if (operation !== id || !validSelection(state)) return;
      status(result.notice || 'کارت آماده شد. اکنون آن را ذخیره یا چاپ کنید.'); render(link);
    } catch (error) { if (operation === id && validSelection(state)) { hidePreview(); status(error.message || 'ساخت کارت انجام نشد.', true); } }
    finally { if (operation === id && validSelection(state)) controls(false); }
  };
  window.disableEmergency = async function () {
    if (busy || !validSelection(selected)) return;
    const state = selected, id = ++operation; controls(true); status('در حال غیرفعال‌سازی…');
    try {
      await api('/api/emergency-card', { method: 'POST', body: JSON.stringify({ patient_id: state.patientId, enabled: false }) }); links.delete(state.patientId);
      if (operation !== id || !validSelection(state)) return;
      hidePreview(); status('کارت غیرفعال شد. لینک و QR قبلی دیگر اطلاعاتی نشان نمی‌دهند.');
    } catch (error) { if (operation === id && validSelection(state)) status(error.message || 'غیرفعال‌سازی انجام نشد.', true); }
    finally { if (operation === id && validSelection(state)) controls(false); }
  };
  function currentLink() { const link = validSelection(selected) && !byId('emergencyPreview').hidden && links.get(selected.patientId); return link || null; }
  function rounded(context, x, y, width, height, radius) { context.beginPath(); context.roundRect(x, y, width, height, radius); }
  function canvasLines(context, text, x, y, width, lineHeight, maxLines = 2) {
    const words = String(text).split(/\s+/), lines = []; let line = '';
    for (const word of words) { const next = line ? line + ' ' + word : word; if (context.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next; }
    if (line) lines.push(line); for (const [index, value] of lines.slice(0, maxLines).entries()) context.fillText(value + (index === maxLines - 1 && lines.length > maxLines ? '…' : ''), x, y + index * lineHeight, width);
    return Math.min(lines.length, maxLines) * lineHeight;
  }
  async function download() {
    const state = selected, link = currentLink(); if (!link || busy) return; const data = viewData(link.card); controls(true);
    try {
      await document.fonts?.ready;
      if (!validSelection(state) || currentLink() !== link) return;
      const dark = document.documentElement.dataset.theme === 'dark', canvas = document.createElement('canvas'); canvas.width = 1500; canvas.height = 1020;
      const c = canvas.getContext('2d'), ink = dark ? '#f3f8ff' : '#102943', muted = dark ? '#bdd2e6' : '#405d75', accent = dark ? '#77e7e0' : '#006f7c';
      const gradient = c.createLinearGradient(0, 0, 1500, 1020); gradient.addColorStop(0, dark ? '#18364d' : '#ffffff'); gradient.addColorStop(1, dark ? '#0a2339' : '#def5f8'); c.fillStyle = gradient; rounded(c, 0, 0, 1500, 1020, 55); c.fill(); c.strokeStyle = dark ? '#4b758c' : '#a8c8d8'; c.lineWidth = 4; rounded(c, 3, 3, 1494, 1014, 53); c.stroke();
      c.direction = 'rtl'; c.textAlign = 'right'; c.fillStyle = accent; c.font = 'bold 30px Tahoma, Arial, sans-serif'; c.fillText('DrMan · دکتر من', 1420, 90); c.textAlign = 'left'; c.font = '25px Tahoma, Arial, sans-serif'; c.fillText('کارت اضطراری سلامت', 75, 90); c.textAlign = 'right'; c.fillStyle = ink; c.font = 'bold 58px Tahoma, Arial, sans-serif'; c.fillText(data.name, 1420, 190, 1320); c.fillStyle = muted; c.font = '27px Tahoma, Arial, sans-serif'; c.fillText('اطلاعات ضروری برای کمک سریع‌تر', 1420, 245);
      let y = 320;
      for (const [label, value] of data.lines) { c.fillStyle = muted; c.font = '24px Tahoma, Arial, sans-serif'; c.fillText(label, 1420, y); y += 43; c.fillStyle = ink; c.font = 'bold 30px Tahoma, Arial, sans-serif'; c.direction = label === 'گروه خونی ثبت‌شده' ? 'ltr' : 'rtl'; y += canvasLines(c, value, 1420, y, 825, 40, 1) + 20; c.direction = 'rtl'; }
      c.fillStyle = '#fff'; rounded(c, 65, 315, 420, 460, 32); c.fill(); const qr = drawQR(document.createElement('canvas'), link.url, 700); c.imageSmoothingEnabled = false; c.drawImage(qr, 85, 330, 380, 380); c.fillStyle = '#12334e'; c.font = 'bold 21px Tahoma, Arial, sans-serif'; c.textAlign = 'center'; c.fillText('اسکن برای اطلاعات ضروری', 275, 745, 370); c.textAlign = 'right'; c.fillStyle = muted; c.font = '25px Tahoma, Arial, sans-serif'; c.fillText('اورژانس: ۱۱۵', 1420, 930); c.font = '21px Tahoma, Arial, sans-serif'; c.fillText('صحت اطلاعات هنگام رسیدگی بررسی شود؛ گروه خونی جای آزمایش تطبیق را نمی‌گیرد.', 1420, 980, 1320);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('ذخیره تصویر کارت انجام نشد.')), 'image/png'));
      if (!validSelection(state) || currentLink() !== link) return;
      const objectURL = URL.createObjectURL(blob), a = document.createElement('a'); a.href = objectURL; a.download = 'DrMan-emergency-card.png'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(objectURL), 1000); status('تصویر کارت برای ذخیره در گوشی آماده شد. آن را فقط با افراد مورد اعتماد به اشتراک بگذارید.');
    } catch (error) { if (validSelection(state)) status(error.message || 'ذخیره تصویر کارت انجام نشد.', true); }
    finally { if (validSelection(state)) controls(false); }
  }
  function print() {
    const link = currentLink(); if (!link || busy) return;
    document.querySelector('.emergency-print-root')?.remove(); const root = el('div', 'emergency-print-root'), source = byId('emergencyPreview').firstElementChild, copy = source.cloneNode(true);
    drawQR(copy.querySelector('canvas'), link.url); root.append(copy); document.body.append(root); document.body.classList.add('emergency-printing');
    const cleanup = () => { document.body.classList.remove('emergency-printing'); root.remove(); };
    window.addEventListener('afterprint', cleanup, { once: true }); window.print();
  }
})();
