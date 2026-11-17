/* OuglSoft site behaviour: theme, menu, reveal, gallery, lightbox */
(function () {
  'use strict';
  var root = document.documentElement;
  var lang = (root.getAttribute('lang') || 'en').slice(0, 2);
  var rtl = root.getAttribute('dir') === 'rtl';

  /* theme toggle */
  var themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      if (!current) current = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('ougl-theme', next); } catch (e) {}
      var meta = document.querySelector('meta[name="theme-color"]:not([media])');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#07140f' : '#faf7f0');
    });
  }

  /* header state + mobile menu */
  var header = document.querySelector('.site-header');
  function onScroll() { if (header) header.classList.toggle('is-scrolled', window.scrollY > 8); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('mainNav');
  function setMenu(open) {
    if (!toggle || !nav) return;
    nav.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    var o = toggle.querySelector('.i-open'), c = toggle.querySelector('.i-close');
    if (o && c) { o.style.display = open ? 'none' : ''; c.style.display = open ? '' : 'none'; }
  }
  if (toggle && nav) {
    toggle.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 960) setMenu(false); });
  }

  /* reveal on scroll */
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (i) { io.observe(i); });
  } else {
    items.forEach(function (i) { i.classList.add('visible'); });
  }

  /* gallery buttons */
  var shots = document.querySelector('.shots');
  if (shots) {
    var prev = document.querySelector('[data-shots="prev"]');
    var next = document.querySelector('[data-shots="next"]');
    var dir = rtl ? -1 : 1;
    function step() { var f = shots.querySelector('.shot'); return f ? f.getBoundingClientRect().width + 22 : 260; }
    function update() {
      if (!prev || !next) return;
      var max = shots.scrollWidth - shots.clientWidth - 2;
      var pos = Math.abs(shots.scrollLeft);
      prev.disabled = pos <= 2;
      next.disabled = pos >= max;
    }
    if (prev) prev.addEventListener('click', function () { shots.scrollBy({ left: -dir * step() * 2, behavior: 'smooth' }); });
    if (next) next.addEventListener('click', function () { shots.scrollBy({ left: dir * step() * 2, behavior: 'smooth' }); });
    shots.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* screenshot lightbox: shows one frame of a screenshot strip */
  var imgs = document.querySelectorAll('img[data-lightbox]');
  if (imgs.length) {
    var labels = {
      ar: ['عرض لقطة الشاشة', 'إغلاق'],
      fr: ['Aperçu de la capture', 'Fermer'],
      en: ['Screenshot preview', 'Close']
    }[lang] || ['Screenshot preview', 'Close'];
    var overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', labels[0]);
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', labels[1]);
    close.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    var box = document.createElement('div');
    box.className = 'lb-shot';
    var big = document.createElement('img');
    big.alt = '';
    box.appendChild(big);
    overlay.appendChild(close);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    var opener = null;
    function openBox(img) {
      opener = img;
      box.style.setProperty('--ar', img.getAttribute('data-ar') || '0.489');
      big.style.setProperty('--i', img.getAttribute('data-i') || '0');
      big.style.setProperty('--n', img.getAttribute('data-n') || '6');
      big.src = img.currentSrc || img.src;
      big.alt = img.alt || '';
      overlay.classList.add('is-open');
      document.body.classList.add('lightbox-open');
      close.focus();
    }
    function closeBox() {
      overlay.classList.remove('is-open');
      document.body.classList.remove('lightbox-open');
      big.removeAttribute('src');
      if (opener) opener.focus();
    }
    imgs.forEach(function (img) {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.addEventListener('click', function () { openBox(img); });
      img.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBox(img); } });
    });
    close.addEventListener('click', closeBox);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeBox(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeBox(); });
  }
})();

/* ---- contact form (runs only on the contact page) ---- */
(function () {
  'use strict';

  var FALLBACKS = {
    en: {
      sending: 'Sending…',
      success: 'Your message has been sent successfully.',
      missing_fields: 'Please complete all required fields.',
      invalid_email: 'Please enter a valid email address.',
      too_fast: 'Please wait a few seconds before sending the form.',
      too_large: 'The message is too large. Please shorten it and try again.',
      not_configured: 'The contact form is not configured yet. Please use the email address shown on this page.',
      send_failed: 'The message could not be sent. Please try again later or use email directly.',
      invalid_request: 'The message could not be processed. Please check the fields and try again.',
      network: 'A network error occurred. Please try again or use email directly.',
      generic: 'The message could not be sent. Please try again later.'
    },
    ar: {
      sending: 'جارٍ إرسال الرسالة…',
      success: 'تم إرسال رسالتكم بنجاح.',
      missing_fields: 'يرجى إكمال جميع الحقول المطلوبة.',
      invalid_email: 'يرجى إدخال بريد إلكتروني صحيح.',
      too_fast: 'يرجى الانتظار بضع ثوانٍ قبل إرسال النموذج.',
      too_large: 'الرسالة طويلة جدا. يرجى اختصارها ثم المحاولة مرة أخرى.',
      not_configured: 'نموذج التواصل غير مفعّل بعد. يرجى استخدام عنوان البريد الظاهر في هذه الصفحة.',
      send_failed: 'تعذر إرسال الرسالة. يرجى المحاولة لاحقا أو استخدام البريد الإلكتروني مباشرة.',
      invalid_request: 'تعذرت معالجة الرسالة. يرجى مراجعة الحقول والمحاولة مرة أخرى.',
      network: 'حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى أو استخدام البريد الإلكتروني مباشرة.',
      generic: 'تعذر إرسال الرسالة. يرجى المحاولة لاحقا.'
    },
    fr: {
      sending: 'Envoi du message…',
      success: 'Votre message a été envoyé avec succès.',
      missing_fields: 'Veuillez remplir tous les champs obligatoires.',
      invalid_email: 'Veuillez saisir une adresse e-mail valide.',
      too_fast: 'Veuillez patienter quelques secondes avant d’envoyer le formulaire.',
      too_large: 'Le message est trop long. Veuillez le raccourcir puis réessayer.',
      not_configured: 'Le formulaire de contact n’est pas encore configuré. Veuillez utiliser l’adresse e-mail indiquée sur cette page.',
      send_failed: 'Le message n’a pas pu être envoyé. Veuillez réessayer plus tard ou utiliser l’e-mail directement.',
      invalid_request: 'Le message n’a pas pu être traité. Veuillez vérifier les champs puis réessayer.',
      network: 'Une erreur réseau est survenue. Veuillez réessayer ou utiliser l’e-mail directement.',
      generic: 'Le message n’a pas pu être envoyé. Veuillez réessayer plus tard.'
    }
  };

  function lang() {
    var value = document.documentElement.getAttribute('lang') || 'en';
    return FALLBACKS[value] ? value : 'en';
  }

  function t(code) {
    return (FALLBACKS[lang()] && FALLBACKS[lang()][code]) || FALLBACKS.en[code] || FALLBACKS.en.generic;
  }

  function value(form, name) {
    var field = form.elements[name];
    return field && typeof field.value === 'string' ? field.value.trim() : '';
  }

  function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('is-success', 'is-error', 'is-loading');
    if (type) el.classList.add('is-' + type);
  }

  function init() {
    var form = document.getElementById('contactForm');
    if (!form) return;
    var status = document.getElementById('contactStatus');
    var submit = form.querySelector('button[type="submit"]');
    var started = document.getElementById('contactStartedAt');
    if (started) started.value = String(Date.now());

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var payload = {
        name: value(form, 'name'),
        email: value(form, 'email'),
        subject: value(form, 'subject'),
        message: value(form, 'message'),
        website: value(form, 'website'),
        startedAt: value(form, 'startedAt'),
        lang: lang(),
        page: location.href
      };

      if (!payload.name || !payload.email || !payload.subject || !payload.message) {
        setStatus(status, t('missing_fields'), 'error');
        return;
      }

      try {
        if (submit) submit.disabled = true;
        setStatus(status, t('sending'), 'loading');
        var response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=UTF-8', accept: 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
          credentials: 'same-origin'
        });
        var data = null;
        try { data = await response.json(); } catch (_) { data = null; }
        if (response.ok && data && data.ok) {
          form.reset();
          if (started) started.value = String(Date.now());
          setStatus(status, t('success'), 'success');
          return;
        }
        setStatus(status, t((data && data.code) || 'generic'), 'error');
      } catch (_) {
        setStatus(status, t('network'), 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

/* Keeps version, size and checksum in sync with /assets/downloads/releases.json */
(function () {
  'use strict';
  var nodes = document.querySelectorAll('[data-dl-app][data-dl-field]');
  if (!nodes.length) return;
  fetch('/assets/downloads/releases.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (manifest) {
      if (!manifest || !manifest.apps) return;
      nodes.forEach(function (el) {
        var app = manifest.apps[el.getAttribute('data-dl-app')];
        if (!app) return;
        var value = app[el.getAttribute('data-dl-field')];
        if (value === undefined || value === null || value === '') return;
        el.textContent = value;
      });
    })
    .catch(function () {});
})();
