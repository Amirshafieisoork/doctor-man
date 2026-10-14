(() => {
  let saved;
  try { saved = localStorage.getItem('drman-theme'); } catch {}
  const brandMarks = { light: '/assets/drman-mark-v5.webp', dark: '/assets/drman-mark-v6.webp' };
  const logoSelector = 'img[data-drman-brandmark],img[src*="drman-mark-v5."],img[src*="drman-mark-v6."]';
  const elements = (root, selector) => [
    ...(root.matches?.(selector) ? [root] : []),
    ...root.querySelectorAll(selector)
  ];
  const syncAssets = (root, value) => {
    elements(root, 'source[data-theme-source]').forEach(source => {
      const media = source.dataset.themeSource === value ? 'all' : 'not all';
      if (source.media !== media) source.media = media;
    });
    elements(root, logoSelector).forEach(img => {
      img.dataset.drmanBrandmark = '';
      if (img.getAttribute('src') !== brandMarks[value]) img.src = brandMarks[value];
    });
  };
  const apply = value => {
    document.documentElement.dataset.theme = value;
    syncAssets(document, value);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = value === 'dark' ? '#07111e' : '#f4fbff';
  };
  apply(['light', 'dark'].includes(saved) ? saved : 'dark');

  const init = () => {
    apply(document.documentElement.dataset.theme);
    // Server-rendered and later-inserted brand images use the same active theme.
    new MutationObserver(records => {
      const theme = document.documentElement.dataset.theme;
      records.forEach(record => {
        if (record.type === 'attributes') syncAssets(record.target, theme);
        else record.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) syncAssets(node, theme);
        });
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-theme-source'] });
    const main = document.querySelector('main');
    if (main) {
      main.id ||= 'main-content';
      main.setAttribute('tabindex', '-1');
      const skip = document.createElement('a');
      skip.className = 'skip-link';
      skip.href = '#' + main.id;
      skip.textContent = 'رفتن به محتوای اصلی';
      document.body.prepend(skip);
    }

    const header = document.querySelector('header');
    const parent = document.querySelector('header .actions') || document.querySelector('header .toolbar') || document.querySelector('header .navrow') || header;
    if (parent) {
      const controls = document.createElement('div');
      controls.className = 'site-controls';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle';
      const refresh = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        const label = dark ? 'حالت روشن' : 'حالت تیره';
        button.innerHTML = '<span aria-hidden="true">' + (dark ? '☀' : '☾') + '</span><span class="theme-text">' + label + '</span>';
        button.setAttribute('aria-label', 'تغییر به ' + label);
        button.title = 'تغییر به ' + label;
      };
      button.addEventListener('click', () => {
        const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        apply(value);
        try { localStorage.setItem('drman-theme', value); } catch {}
        refresh();
      });
      refresh();
      controls.append(button);

      const menu = document.createElement('details');
      menu.className = 'site-menu';
      const summary = document.createElement('summary');
      summary.textContent = 'منو';
      summary.setAttribute('aria-label', 'فهرست بخش‌های دکتر من');
      const nav = document.createElement('nav');
      nav.className = 'site-menu-panel';
      nav.setAttribute('aria-label', 'بخش‌های دکتر من');
      const links = [['/', 'صفحه اصلی'], ['/health', 'پرونده سلامت'], ['/doctors', 'پزشکان'], ['/pricing', 'پلن‌ها'], ['/learn', 'مرکز دانش'], ['/support', 'راهنما و پشتیبانی'], ['/account', 'حساب کاربری']];
      const route = location.pathname.replace(/\/$/, '') || '/';
      links.forEach(([href, label]) => {
        const link = document.createElement('a');
        link.href = href;
        link.textContent = label;
        if (route === href) link.setAttribute('aria-current', 'page');
        link.addEventListener('click', () => { menu.open = false; });
        nav.append(link);
      });
      menu.append(summary, nav);
      controls.append(menu);
      parent.append(controls);
      document.addEventListener('click', event => {
        if (!menu.contains(event.target)) menu.open = false;
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && menu.open) {
          menu.open = false;
          summary.focus();
        }
      });
      const updateHeight = () => document.documentElement.style.setProperty('--drman-header-height', Math.ceil(header.getBoundingClientRect().height) + 'px');
      updateHeight();
      if ('ResizeObserver' in window) new ResizeObserver(updateHeight).observe(header);
    }

    document.querySelectorAll('nav:not([aria-label])').forEach(nav => nav.setAttribute('aria-label', 'ناوبری اصلی'));
    document.querySelectorAll('label:not([for])').forEach((label, index) => {
      if (label.querySelector('input,select,textarea')) return;
      const field = label.nextElementSibling;
      if (field?.matches('input,select,textarea')) {
        field.id ||= 'labelled-field-' + index;
        label.htmlFor = field.id;
      }
    });
    document.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(field => {
      if (field.labels?.length || field.hasAttribute('aria-label') || field.hasAttribute('aria-labelledby')) return;
      if (field.placeholder) field.setAttribute('aria-label', field.placeholder);
    });

    document.querySelectorAll('nav.tabs:not([role])').forEach(nav => {
      const tabs = [...nav.querySelectorAll('button[data-page]')];
      if (!tabs.length) return;
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-label', 'بخش‌های پرونده سلامت');
      const select = active => tabs.forEach(tab => {
        const selected = tab === active;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      tabs.forEach(tab => {
        const pane = document.getElementById(tab.dataset.page);
        if (!pane) return;
        tab.type = 'button';
        tab.id ||= pane.id + '-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', pane.id);
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-labelledby', tab.id);
        tab.addEventListener('click', () => select(tab));
      });
      select(tabs.find(tab => tab.classList.contains('on')) || tabs[0]);
      nav.addEventListener('keydown', event => {
        const tab = event.target.closest('[role="tab"]');
        if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].click();
        tabs[next].focus();
      });
    });

    // Keep keyboard users inside an open dialog, then return to the control that opened it.
    const focusable = dialog => [...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    document.querySelectorAll('.modal').forEach((modal, index) => {
      const dialog = modal.querySelector('.dialog') || modal;
      const title = dialog.querySelector('h1,h2,h3');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.tabIndex = -1;
      if (title) {
        title.id ||= 'dialog-title-' + index;
        dialog.setAttribute('aria-labelledby', title.id);
      }
      let opened = false;
      let previousFocus;
      const sync = () => {
        const visible = getComputedStyle(modal).display !== 'none';
        modal.setAttribute('aria-hidden', String(!visible));
        if (visible && !opened) {
          previousFocus = document.activeElement;
          (focusable(dialog)[0] || dialog).focus();
        } else if (!visible && opened && previousFocus?.isConnected) previousFocus.focus();
        opened = visible;
      };
      new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
      modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          const cancel = [...dialog.querySelectorAll('button')].find(el => /^(انصراف|بستن)$/.test(el.textContent.trim()));
          if (cancel) cancel.click();
          else modal.classList.remove('open');
          event.preventDefault();
        }
        if (event.key !== 'Tab') return;
        const items = focusable(dialog);
        if (!items.length) { event.preventDefault(); dialog.focus(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      sync();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
