(() => {
  function render(container, license) {
    container.replaceChildren();
    const append = (tag, value) => { const node = document.createElement(tag); node.textContent = value; container.appendChild(node); return node; };
    append('h3', 'مدرک حرفه‌ای و وضعیت بررسی');
    if (!license?.document) { append('p', 'هنوز تصویر مجوزی ثبت نشده است. برای بررسی عضویت، تصویر خوانای پروانه کار یا کارت نظام پزشکی را بارگذاری کنید.'); return; }
    const decision = license.review?.decision;
    append('p', decision === 'verified' ? 'مدرک توسط مدیر بررسی و عضویت حرفه‌ای تأیید شده است.' : decision === 'rejected' ? 'درخواست نیاز به اصلاح دارد.' : 'تصویر محفوظ است؛ تأیید نهایی عضویت در انتظار بررسی مدیر است.');
    if (license.review?.reason) append('p', 'نظر مدیر: ' + license.review.reason);
    const report = license.ai_report;
    if (report?.status === 'complete') {
      append('h4', 'بررسی اولیه هوش مصنوعی');
      append('p', report.summary || 'بررسی اولیه انجام شد.');
      const values = [['نام خوانده‌شده', report.extracted_name], ['شماره خوانده‌شده', report.license_number], ['نوع مدرک', report.document_type], ['تاریخ انقضا در تصویر', report.expiry_date]];
      for (const [label, value] of values) if (value) append('p', label + ': ' + value);
      if (report.flags?.length) { const list = document.createElement('ul'); for (const flag of report.flags) { const item = document.createElement('li'); item.textContent = flag; list.appendChild(item); } container.appendChild(list); }
    } else append('p', report?.summary || 'بررسی اولیه خودکار هنوز در دسترس نیست؛ مدیر می‌تواند مدرک محفوظ را بررسی کند.');
    append('p', 'بررسی تصویر، اصالت مجوز را به‌تنهایی تأیید نمی‌کند. تأیید نهایی با بررسی مرجع رسمی و مدیر انجام می‌شود.').style.fontSize = '12px';
    try {
      const url = new URL(license.document.image_url, location.origin);
      if (url.origin !== location.origin || url.pathname !== '/api/doctor-license' || url.searchParams.get('image') !== '1') throw new Error();
      const link = append('a', 'بازکردن تصویر محفوظ مجوز'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const image = document.createElement('img'); image.src = url.href; image.alt = 'تصویر خصوصی مدرک حرفه‌ای شما'; image.loading = 'lazy';
      image.style.cssText = 'display:block;max-width:100%;max-height:360px;margin-top:12px;object-fit:contain;border-radius:12px';
      image.addEventListener('error', () => { image.remove(); append('p', 'تصویر دریافت نشد. با لینک بالا دوباره تلاش کنید.'); }, { once: true });
      container.appendChild(image);
    } catch { append('p', 'لینک تصویر در دسترس نیست. صفحه را تازه کنید.'); }
  }
  window.DrManLicenseUI = { render };
})();
