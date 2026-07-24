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
      not_configured: 'The contact form is not configured yet. Please use the email addresses shown on this page.',
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
      not_configured: 'نموذج التواصل غير مفعّل بعد. يرجى استخدام عناوين البريد الظاهرة في هذه الصفحة.',
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
      not_configured: 'Le formulaire de contact n’est pas encore configuré. Veuillez utiliser les adresses e-mail indiquées sur cette page.',
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
