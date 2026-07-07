(function () {
  var Common = window.ZCommon || {};
  var qs = typeof Common.qs === "function" ? Common.qs : function(sel, root) { return (root || document).querySelector(sel); };
  var qsa = typeof Common.qsa === "function" ? Common.qsa : function(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var GAME_LOOP = 0;
  var GAME_LAYOUT_OBSERVER = null;
  var GAME_RESIZE_OBSERVER = null;
  var MOBILE_PAGES = { auth: 1, mode: 1, lobby: 1, dashboard: 1, game: 1 };

  /* Page detection */

  function pathName() {
    return String(location.pathname || '').toLowerCase();
  }

  function pageType() {
    var path = pathName();
    if (path.endsWith('/index.html') || path === '/' || path.endsWith('/')) return 'auth';
    if (path.indexOf('/mode') !== -1) return 'mode';
    if (path.indexOf('/loby') !== -1) return 'lobby';
    if (path.indexOf('/dashboard') !== -1) return 'dashboard';
    if (path.indexOf('/game') !== -1) return 'game';
    return 'generic';
  }

/* Shared helpers */

  function baseHref() {
    return pathName().indexOf('/pages/') !== -1 ? '..' : '.';
  }

  function currentLang() {
    try {
      if (typeof Common.getLang === 'function') return Common.getLang() || document.documentElement.lang || 'ar';
    } catch (_) {}
    return document.documentElement.lang || 'ar';
  }

  function activityLogTitle() {
    var lang = currentLang();
    if (lang === 'fr') return 'Journal des activités';
    if (lang === 'en') return 'Activity log';
    return 'سجل الأنشطة';
  }

  function isLandscape() {
    return (window.innerWidth || 0) > (window.innerHeight || 0);
  }

  function isPhone() {
    try {
      if (typeof Common.isPhoneLike === 'function') return Common.isPhoneLike();
    } catch (_) {}
    return false;
  }

  function hasRegisteredSession() {
    try {
      var s = window.ZAuth && typeof window.ZAuth.readSession === 'function' ? window.ZAuth.readSession() : null;
      return !!(s && s.kind === 'registered' && s.uid);
    } catch (_) {}
    return false;
  }

  function publicLinks() {
    try { return window.ZShell.getPublicLinks(baseHref()) || []; } catch (_) { return []; }
  }

  function shortLinkLabel(item) {
    return window.I18N.translate(item.shortKey || item.key, null, window.I18N.translate(item.key, null, String(item.key || ''), currentLang()), currentLang());
  }

  function rightsText() {
    try { return window.ZShell.getFooterText() || ''; } catch (_) { return ''; }
  }

  function createSharedStartPlayButton() {
    return window.ZShell.createStartPlayButton(baseHref());
  }

  function backTarget() {
    var type = pageType();
    var registered = hasRegisteredSession();
    var base = baseHref();
    if (type === 'mode') return registered ? base + '/pages/dashboard.html' : base + '/index.html';
    if (type === 'lobby') return base + '/pages/mode.html';
    return '';
  }

  function setLanguage(lang) {
    var nextLang = lang || 'ar';
    var sel = qs('#authLangSel') || qs('#langSel');
    var applied = false;

    if (sel) {
      try {
        sel.value = nextLang;
        try {
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {
          var ev = document.createEvent('Event');
          ev.initEvent('change', true, true);
          sel.dispatchEvent(ev);
        }
        applied = true;
      } catch (_) {}
    }

    if (!applied) {
      try {
        window.ZShell.setLang(nextLang);
        applied = true;
      } catch (_) {}
    }

    if (!applied) return;
    refreshMobileText();
    syncGameLayout();
  }

  /* Shared mobile chrome */

  function ensureLanguageMenu(menuClass) {
    var menu = document.createElement('div');
    menu.className = menuClass;
    menu.hidden = true;
    ['ar', 'en', 'fr'].forEach(function (lang) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-lang', lang);
      btn.addEventListener('click', function () {
        menu.hidden = true;
        setLanguage(lang);
      });
      menu.appendChild(btn);
    });
    menu.addEventListener('click', function (event) { event.stopPropagation(); });
    return menu;
  }

  function positionLangMenu(button, menu) {
    if (!button || !menu) return;
    try {
      menu.style.position = 'fixed';
      menu.style.right = 'auto';
      var rect = button.getBoundingClientRect();
      menu.hidden = false;
      var width = Math.max(menu.offsetWidth || 0, 132);
      var viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
      var left = rect.left + (rect.width / 2) - (width / 2);
      var maxLeft = Math.max(8, viewportW - width - 8);
      if (left < 8) left = 8;
      if (left > maxLeft) left = maxLeft;
      menu.style.left = left + 'px';
      menu.style.top = (rect.bottom + 6) + 'px';
    } catch (_) {}
  }

  function bindLangButton(button, menu) {
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var willOpen = !!menu.hidden;
      menu.hidden = !menu.hidden;
      if (willOpen) positionLangMenu(button, menu);
    });
    window.addEventListener('resize', function () {
      if (!menu.hidden) positionLangMenu(button, menu);
    });
    document.addEventListener('click', function (event) {
      if (!menu.hidden && !menu.contains(event.target) && event.target !== button) menu.hidden = true;
    });
  }

  function createShell(options) {
    var root = document.createElement('div');
    var menuClass = options.menuClass;

    root.className = options.rootClass;

    var bar = document.createElement('div');
    bar.className = options.innerClass;

    var langBtn = document.createElement('button');
    langBtn.type = 'button';
    langBtn.className = 'z-mobile-shell-btn is-lang';
    langBtn.innerHTML = '<img src="' + baseHref() + '/assets/icons/globe.svg" alt="" aria-hidden="true">';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'z-mobile-shell-btn is-back';
    backBtn.setAttribute('data-shell-action', options.backAction || 'back');
    backBtn.innerHTML = '<img src="' + baseHref() + '/assets/icons/' + (options.backIcon || 'chevron-left.svg') + '" alt="" aria-hidden="true">';
    if (options.hideBack) backBtn.hidden = true;
    backBtn.addEventListener('click', options.onBack);

    var menu = ensureLanguageMenu(menuClass);
    bindLangButton(langBtn, menu);

    bar.appendChild(langBtn);
    bar.appendChild(backBtn);
    root.appendChild(bar);
    root.appendChild(menu);
    return root;
  }

  async function handleDashboardMobileLogout(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    try {
      if (window.ZAuth && typeof window.ZAuth.confirmLogoutAndRedirect === 'function') {
        await window.ZAuth.confirmLogoutAndRedirect(baseHref() + '/index.html');
        return;
      }
    } catch (_) {}
    try {
      if (window.ZAuth && typeof window.ZAuth.logoutAndRedirect === 'function') {
        await window.ZAuth.logoutAndRedirect(baseHref() + '/index.html');
        return;
      }
    } catch (_) {}
    location.href = baseHref() + '/index.html';
  }

  function ensureShell() {
    if (!document.body || !document.body.classList.contains('z-mobile-on')) return;
    if (pageType() === 'generic' || pageType() === 'game' || qs('.z-mobile-shell')) return;

    var dashboardPage = pageType() === 'dashboard';
    var shell = createShell({
      rootClass: 'z-mobile-shell',
      innerClass: 'z-mobile-shell-spacer',
      menuClass: 'z-mobile-shell-menu',
      hideBack: pageType() === 'auth',
      backAction: dashboardPage ? 'logout' : 'back',
      backIcon: dashboardPage ? 'logout.svg' : 'chevron-left.svg',
      onBack: function (event) {
        if (dashboardPage) {
          handleDashboardMobileLogout(event);
          return;
        }
        var target = backTarget();
        if (!target) return;
        event.preventDefault();
        location.href = target;
      }
    });

    document.body.appendChild(shell);
  }

  async function requestLandscape() {
    try {
      var el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen();
    } catch (_) {}
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (_) {}
  }

  async function requestPortrait() {
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (_) {}
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    } catch (_) {}
  }

function ensureOrientButton() {
  if (pageType() === 'generic' || qs('.z-mobile-orient')) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'z-mobile-orient';
  btn.innerHTML = '<span class="z-mobile-orient-ico" aria-hidden="true"></span>';
  btn.addEventListener('click', function () {
    if (isLandscape()) requestPortrait();
    else requestLandscape();
  });
  document.body.appendChild(btn);
}

  function createFooter(variant) {
    var footer = document.createElement('div');
    footer.className = 'z-mobile-footer';
    footer.setAttribute('data-variant', variant);

    var nav = document.createElement('div');
    nav.className = 'z-mobile-footer-nav';
    publicLinks().forEach(function (item) {
      var link = document.createElement('a');
      link.href = item.href;
      if (item.external && item.legalKind) link.setAttribute('data-ouglsoft-link', item.legalKind);
      link.setAttribute('data-link-key', item.key);
      nav.appendChild(link);
    });

    var rights = document.createElement('div');
    rights.className = 'z-mobile-footer-rights';

    footer.appendChild(nav);
    footer.appendChild(rights);
    return footer;
  }

  function viewportHeight() {
    var vv = window.visualViewport;
    var h = Math.round((vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 0);
    return Math.max(0, h);
  }

  function syncViewportMetrics() {
    if (!document.body) return;
    var height = viewportHeight();
    if (height > 0) document.body.style.setProperty('--m-vh', height + 'px');
  }

  function syncFooterMetrics() {
    if (!document.body) return;
    var footer = qs('.z-mobile-footer');
    if (!footer) {
      document.body.style.removeProperty('--m-footer-actual-h');
      return;
    }
    var height = footer.offsetHeight || 0;
    if (height > 0) document.body.style.setProperty('--m-footer-actual-h', height + 'px');
  }

  function ensureFooter() {
    var variant = (pageType() === 'auth') ? 'full' : '';
    var footer = qs('.z-mobile-footer');
    if (!variant) {
      if (footer) footer.remove();
      syncFooterMetrics();
      return;
    }
    if (!footer) {
      footer = createFooter(variant);
      document.body.appendChild(footer);
    }
    footer.setAttribute('data-variant', variant);
    requestAnimationFrame(syncFooterMetrics);
  }

  /* Shared page scaffolding */

  function restoreModeHead() {
    if (pageType() !== 'mode') return;
    var inner = qs('.z-page-inner');
    var box = qs('.z-mobile-head-box', inner);
    if (!inner || !box) return;
    var title = qs('.z-page-title', box);
    var sub = qs('.z-mode-sub', box);
    if (title && title.parentNode !== inner) inner.insertBefore(title, inner.firstChild || null);
    if (sub && sub.parentNode !== inner) inner.insertBefore(sub, title ? title.nextSibling : inner.firstChild || null);
    if (!box.children.length) box.remove();
  }

  function ensureModeHead() {
    if (pageType() !== 'mode' || !document.body || !document.body.classList.contains('z-mobile-on')) return;
    var inner = qs('.z-page-inner');
    var title = qs('.z-page-title', inner);
    var sub = qs('.z-mode-sub', inner);
    if (!inner || !title || !sub || qs('.z-mobile-head-box', inner)) return;
    var box = document.createElement('div');
    box.className = 'z-mobile-head-box';
    box.appendChild(title);
    box.appendChild(sub);
    inner.insertBefore(box, inner.firstChild);
  }

  function restoreLobbyHead() {
    if (pageType() !== 'lobby') return;
    var inner = qs('.z-lobby-inner');
    var head = qs('.z-lobby-head', inner);
    var center = qs('.z-lobby-head-center', head);
    var box = qs('.z-mobile-head-box', inner);
    var bottom = qs('.z-lobby-bottom', inner);
    var lbBtn = qs('#btnShowLeaderboardLobby');
    var inviteToggle = qs('#inviteReceiveToggleRow');
    if (!inner || !head || !center) return;
    var title = box ? qs('.z-page-title', box) : null;
    var sub = box ? qs('.z-lobby-subtitle', box) : null;
    if (title && title.parentNode !== center) center.insertBefore(title, center.firstChild || null);
    if (sub && sub.parentNode !== center) center.appendChild(sub);
    if (lbBtn && bottom && lbBtn.parentNode !== bottom) bottom.insertBefore(lbBtn, bottom.firstChild || null);
    if (inviteToggle && bottom && inviteToggle.parentNode !== bottom) {
      var back = qs('.z-lobby-back', bottom);
      bottom.insertBefore(inviteToggle, back || null);
    }
    if (inviteToggle) inviteToggle.classList.remove('is-mobile-portrait', 'is-mobile-landscape');
    if (box && !box.children.length) box.remove();
  }

  function placeLobbyInviteToggle(box, lbBtn) {
    var row = qs('#inviteReceiveToggleRow');
    if (!row) return;
    row.classList.remove('is-mobile-portrait', 'is-mobile-landscape');
    row.hidden = false;
    row.removeAttribute('aria-hidden');
    if (isLandscape()) {
      row.classList.add('is-mobile-landscape');
      if (box && row.parentNode !== box) box.appendChild(row);
      return;
    }
    row.classList.add('is-mobile-portrait');
    var shellBar = qs('.z-mobile-shell .z-mobile-shell-spacer');
    var backBtn = shellBar ? qs('.z-mobile-shell-btn.is-back', shellBar) : null;
    if (shellBar) {
      shellBar.classList.add('has-invite-receive-toggle');
      if (row.parentNode !== shellBar) shellBar.insertBefore(row, backBtn || null);
      return;
    }
    if (box && row.parentNode !== box) box.appendChild(row);
  }

  function ensureLobbyHead() {
    if (pageType() !== 'lobby' || !document.body || !document.body.classList.contains('z-mobile-on')) return;
    var inner = qs('.z-lobby-inner');
    var head = qs('.z-lobby-head', inner);
    if (!inner || !head) return;
    var title = qs('.z-page-title', head) || qs('.z-page-title', inner);
    var sub = qs('.z-lobby-subtitle', head) || qs('.z-lobby-subtitle', inner);
    if (!title || !sub) return;
    var box = qs('.z-mobile-head-box', inner);
    if (!box) {
      box = document.createElement('div');
      box.className = 'z-mobile-head-box';
      inner.insertBefore(box, head);
    }
    var bar = qs('.z-mobile-lobby-headbar', box);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'z-mobile-lobby-headbar';
      box.appendChild(bar);
    }
    var texts = qs('.z-mobile-lobby-headtexts', box);
    if (!texts) {
      texts = document.createElement('div');
      texts.className = 'z-mobile-lobby-headtexts';
    }
    if (title.parentNode !== texts) texts.appendChild(title);
    if (sub.parentNode !== texts) texts.appendChild(sub);

    var lbBtn = qs('#btnShowLeaderboardLobby');
    if (lbBtn) {
      lbBtn.classList.add('z-mobile-lobby-rank-btn');
      var label = window.I18N.text('dashboard.showLeaderboard', null, currentLang());
      lbBtn.setAttribute('aria-label', label);
      lbBtn.setAttribute('title', label);
    var icon = qs('.z-mobile-lobby-rank-ico', lbBtn);
if (!icon) {
  icon = document.createElement('span');
  icon.className = 'z-mobile-lobby-rank-ico';
  icon.setAttribute('aria-hidden', 'true');
  lbBtn.insertBefore(icon, lbBtn.firstChild);
}
    }

    if (isLandscape()) {
      if (texts.parentNode !== box) box.insertBefore(texts, box.firstChild || null);
      if (lbBtn && lbBtn.parentNode !== box) box.appendChild(lbBtn);
    } else {
      if (texts.parentNode !== bar) bar.insertBefore(texts, bar.firstChild || null);
      if (lbBtn && lbBtn.parentNode !== bar) bar.appendChild(lbBtn);
    }
    placeLobbyInviteToggle(box, lbBtn);
  }

  function buildAuthLoginLinks() {
    var links = document.createElement('div');
    links.className = 'z-mobile-auth-links';
    links.innerHTML = [
      '<a data-go="register" href="#"><span data-i18n="auth.toRegister">إنشاء حساب</span></a>',
      '<a data-go="recover" href="#"><span data-i18n="auth.toRecover">نسيت كلمة المرور؟</span></a>'
    ].join('');
    return links;
  }

  function ensureAuthLoginLayout() {
    if (pageType() !== 'auth') return;
    var section = qs('section[data-auth-view="login"]');
    if (!section) return;

    var grid = qs('.z-auth-grid', section);
    var emailRow = qs('#loginEmail') ? qs('#loginEmail').closest('.z-auth-row') : null;
    var passRow = qs('#loginPass') ? qs('#loginPass').closest('.z-auth-row') : null;
    var loginBtn = qs('#btnLogin');
    var guestBtn = qs('#btnGuest');
    var googleBtn = qs('#btnLoginGoogle');
    if (!grid || !emailRow || !passRow || !loginBtn || !guestBtn || !googleBtn) return;

    var wrap = qs('.z-mobile-auth-login', section);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'z-mobile-auth-login';
    }

    var fields = qs('.z-mobile-auth-fields', wrap);
    if (!fields) {
      fields = document.createElement('div');
      fields.className = 'z-mobile-auth-fields';
    }
    if (emailRow.parentNode !== fields) fields.appendChild(emailRow);
    if (passRow.parentNode !== fields) fields.appendChild(passRow);
    if (loginBtn.parentNode !== fields) fields.appendChild(loginBtn);

    var social = qs('.z-mobile-auth-social', wrap);
    if (!social) {
      social = document.createElement('div');
      social.className = 'z-mobile-auth-social';
    }
    if (googleBtn.parentNode !== social) social.appendChild(googleBtn);
    if (guestBtn.parentNode !== social) social.appendChild(guestBtn);

    var links = qs('.z-mobile-auth-links', wrap) || qs('.z-mobile-auth-links', section) || qs('.z-auth-links', section);
    if (!links) links = buildAuthLoginLinks();
    links.className = 'z-mobile-auth-links';

    if (fields.parentNode !== wrap) wrap.appendChild(fields);
    if (social.parentNode !== wrap) wrap.appendChild(social);
    if (links.parentNode !== wrap) wrap.appendChild(links);
    if (wrap.parentNode !== grid) grid.appendChild(wrap);
  }

  function ensureAuthRegisterLayout() {
    if (pageType() !== 'auth') return;
    var section = qs('section[data-auth-view="register"]');
    if (!section) return;
    var title = qs('h2', section);
    var grid = qs('#regEmailForm', section) || qs('.z-auth-grid', section);
    var rows = qsa('.z-auth-row', grid);
    var submit = qs('#btnRegister', section);
    var back = qs('[data-go="login"]', section);
    if (!title || !grid || rows.length < 4 || !submit || !back) return;

    var wrap = qs('.z-mobile-auth-register', section);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'z-mobile-auth-register';
    }

    var titleWrap = qs('.z-mobile-auth-register-title', wrap);
    if (!titleWrap) {
      titleWrap = document.createElement('div');
      titleWrap.className = 'z-mobile-auth-register-title';
    }
    if (title.parentNode !== titleWrap) titleWrap.appendChild(title);

    var line1 = qs('.z-mobile-auth-register-line.is-line1', wrap);
    if (!line1) {
      line1 = document.createElement('div');
      line1.className = 'z-mobile-auth-register-line is-line1';
    }
    if (rows[0].parentNode !== line1) line1.appendChild(rows[0]);
    if (rows[1].parentNode !== line1) line1.appendChild(rows[1]);

    var line2 = qs('.z-mobile-auth-register-line.is-line2', wrap);
    if (!line2) {
      line2 = document.createElement('div');
      line2.className = 'z-mobile-auth-register-line is-line2';
    }
    if (rows[2].parentNode !== line2) line2.appendChild(rows[2]);
    if (rows[3].parentNode !== line2) line2.appendChild(rows[3]);

    var submitWrap = qs('.z-mobile-auth-register-submit', wrap);
    if (!submitWrap) {
      submitWrap = document.createElement('div');
      submitWrap.className = 'z-mobile-auth-register-submit';
    }
    if (submit.parentNode !== submitWrap) submitWrap.appendChild(submit);

    var backWrap = qs('.z-mobile-auth-register-back', wrap);
    if (!backWrap) {
      backWrap = document.createElement('div');
      backWrap.className = 'z-mobile-auth-register-back';
    }
    if (back.parentNode !== backWrap) backWrap.appendChild(back);

    if (titleWrap.parentNode !== wrap) wrap.appendChild(titleWrap);
    if (line1.parentNode !== wrap) wrap.appendChild(line1);
    if (line2.parentNode !== wrap) wrap.appendChild(line2);
    if (submitWrap.parentNode !== wrap) wrap.appendChild(submitWrap);
    if (backWrap.parentNode !== wrap) wrap.appendChild(backWrap);
    if (wrap.parentNode !== grid) grid.appendChild(wrap);
  }

  var AUTH_CARD_RAF = 0;

  function updateAuthCardHeight() {
    if (pageType() !== 'auth' || !document.body || !document.body.classList.contains('z-mobile-on')) return;
    var activeEl = document.activeElement;
    if (activeEl) {
      var tag = String(activeEl.tagName || '').toLowerCase();
      if ((tag === 'input' || tag === 'textarea' || tag === 'select') && qs('#authRoot') && qs('#authRoot').contains(activeEl)) return;
    }
    var card = qs('.z-auth-card');
    if (!card) return;
    if (document.body.getAttribute('data-mobile-orientation') !== 'portrait') {
      card.style.removeProperty('--m-auth-card-h-auto');
      return;
    }

    var active = qs('section[data-auth-view]:not([style*="display:none"])', card);
    if (!active) {
      var root = qs('#authRoot');
      var current = root ? root.getAttribute('data-auth-current') : '';
      if (current) active = qs('section[data-auth-view="' + current + '"]', card);
    }
    if (!active) active = qs('section[data-auth-view]', card);
    if (!active) return;

    var cardWidth = Math.max(280, (card.clientWidth || 0) - 28);
    var prev = {
      display: active.style.display,
      position: active.style.position,
      visibility: active.style.visibility,
      pointerEvents: active.style.pointerEvents,
      left: active.style.left,
      top: active.style.top,
      width: active.style.width,
      height: active.style.height,
      minHeight: active.style.minHeight
    };

    active.style.display = 'flex';
    active.style.position = 'absolute';
    active.style.visibility = 'hidden';
    active.style.pointerEvents = 'none';
    active.style.left = '-10000px';
    active.style.top = '0';
    active.style.width = cardWidth + 'px';
    active.style.height = 'auto';
    active.style.minHeight = '0';

    var contentHeight = active.scrollHeight || 0;

    active.style.display = prev.display;
    active.style.position = prev.position;
    active.style.visibility = prev.visibility;
    active.style.pointerEvents = prev.pointerEvents;
    active.style.left = prev.left;
    active.style.top = prev.top;
    active.style.width = prev.width;
    active.style.height = prev.height;
    active.style.minHeight = prev.minHeight;

    var cardStyles = window.getComputedStyle ? window.getComputedStyle(card) : null;
    var paddingY = 28;
    if (cardStyles) {
      paddingY = (parseFloat(cardStyles.paddingTop) || 0) + (parseFloat(cardStyles.paddingBottom) || 0);
    }

    if (contentHeight > 0) card.style.setProperty('--m-auth-card-h-auto', Math.ceil(contentHeight + paddingY) + 'px');
  }

  function scheduleAuthCardHeight() {
    if (AUTH_CARD_RAF) cancelAnimationFrame(AUTH_CARD_RAF);
    AUTH_CARD_RAF = requestAnimationFrame(function () {
      AUTH_CARD_RAF = 0;
      updateAuthCardHeight();
    });
  }

/* Game page */

  function gameMode() {
    var body = document.body;
    if (body && body.classList.contains('z-spectator')) return 'spectator';
    if (body && body.classList.contains('mode-pvp')) return 'pvp';
    return 'pvc';
  }

  function gameBack() {
    try {
      if (gameMode() === 'spectator') {
        var leave = qs('#btnLeaveRoom');
        if (leave) {
          leave.click();
          return;
        }
      }
      var target = (window.Online && window.Online.isActive) ? qs('#btnEndOnline') : qs('#btnEndLocalMatch');
      if (target) {
        target.click();
        return;
      }
    } catch (_) {}
    location.href = baseHref() + '/pages/mode.html';
  }

  function ensureGameSideLane() {
    if (pageType() !== 'game') return null;
    var lane = qs('.z-mobile-game-side-lane');
    if (lane) return lane;
    lane = document.createElement('div');
    lane.className = 'z-mobile-game-side-lane';
    return lane;
  }

  function ensureGameShell() {
    if (pageType() !== 'game') return null;
    var shell = qs('.z-mobile-game-shell');
    if (shell) return shell;

    return createShell({
      rootClass: 'z-mobile-game-shell',
      innerClass: 'z-mobile-game-shell-inner',
      menuClass: 'z-mobile-game-shell-menu',
      onBack: function (event) {
        event.preventDefault();
        gameBack();
      }
    });
  }

  function ensureGameLevelSlot(shell) {
    if (!shell) return null;
    var bar = qs('.z-mobile-game-shell-inner', shell);
    if (!bar) return null;
    var slot = qs('.z-mobile-game-level-slot', bar);
    if (slot) return slot;
    slot = document.createElement('div');
    slot.className = 'z-mobile-game-level-slot';
    bar.appendChild(slot);
    return slot;
  }

  function isAiLevelSelectInteracting() {
    return false;
  }

  function syncGameLevelInShell(shell) {
    var box = qs('#aiLevelBox');
    if (!box) return;
    var show = gameMode() === 'pvc';
    if (!show) {
      box.classList.toggle('z-mobile-game-top-level', false);
      box.hidden = true;
      box.style.display = 'none';
      return;
    }
    if (isAiLevelSelectInteracting()) return;
    box.classList.toggle('z-mobile-game-top-level', true);
    box.hidden = false;
    box.style.display = 'flex';
    var slot = ensureGameLevelSlot(shell || qs('.z-mobile-game-shell'));
    if (slot && box.parentNode !== slot) slot.appendChild(box);
    try { if (window.UI && typeof window.UI.updateAiLevelDisplay === 'function') window.UI.updateAiLevelDisplay(); } catch (_) {}
  }

  function ensureGameHead() {
    if (pageType() !== 'game') return null;
    var head = qs('.z-mobile-game-head');
    if (!head) {
      head = document.createElement('div');
      head.className = 'z-mobile-game-head';
    }
    if (!qs('.z-mobile-game-meta', head)) {
      head.innerHTML = [
        '<div class="z-mobile-game-player" data-player="top">',
        '<div class="z-mobile-game-avatar-wrap is-black-piece"><img class="z-mobile-game-avatar" data-avatar="top" src="' + baseHref() + '/assets/icons/users/computeruser.png" alt="" aria-hidden="true"></div>',
        '<div class="z-mobile-game-meta">',
        '<div class="z-mobile-game-name" data-name="top"></div>',
        '<div class="z-mobile-game-presence" data-presence="top">...</div>',
        '</div>',
        '</div>',
        '<div class="z-mobile-game-vs">VS</div>',
        '<div class="z-mobile-game-player" data-player="bot">',
        '<div class="z-mobile-game-avatar-wrap is-white-piece"><img class="z-mobile-game-avatar" data-avatar="bot" src="' + baseHref() + '/assets/icons/users/autouser2.png" alt="" aria-hidden="true"></div>',
        '<div class="z-mobile-game-meta">',
        '<div class="z-mobile-game-name" data-name="bot"></div>',
        '<div class="z-mobile-game-presence" data-presence="bot">...</div>',
        '</div>',
        '</div>'
      ].join('');
    }
    return head;
  }

  function ensureGameControlsHost() {
    if (pageType() !== 'game') return null;
    var host = qs('.z-mobile-game-controls-host');
    if (host) return host;
    host = document.createElement('div');
    host.className = 'z-mobile-game-controls-host';
    var grid = document.createElement('div');
    grid.className = 'z-mobile-game-controls-grid';
    host.appendChild(grid);
    return host;
  }

  function ensureDrawerChevron(handle) {
    if (!handle) return null;
    var icon = qs('.z-mobile-game-drawer-chevron', handle);
    if (icon) return icon;
    icon = document.createElement('span');
    icon.className = 'z-mobile-game-drawer-chevron';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▲';
    handle.appendChild(icon);
    return icon;
  }

  function setGameDrawer(open) {
    var drawer = qs('.z-mobile-game-drawer');
    var backdrop = qs('.z-mobile-game-drawer-backdrop');
    if (!drawer) return;
    drawer.classList.toggle('is-open', !!open);
    var handle = qs('.z-mobile-game-drawer-handle', drawer);
    if (handle) {
      handle.setAttribute('aria-expanded', open ? 'true' : 'false');
      handle.setAttribute('data-open', open ? 'true' : 'false');
      var icon = ensureDrawerChevron(handle);
      if (icon) icon.textContent = open ? '▼' : '▲';
    }
    drawer.style.transform = 'none';
    drawer.removeAttribute('data-offset');
    if (backdrop) backdrop.hidden = !(open && !isLandscape());
  }

  function ensureGameDrawer() {
    if (pageType() !== 'game') return null;
    var drawer = qs('.z-mobile-game-drawer');
    if (drawer) return drawer;

    drawer = document.createElement('div');
    drawer.className = 'z-mobile-game-drawer';
    drawer.innerHTML = [
      '<button type="button" class="z-mobile-game-drawer-handle" aria-label="' + window.I18N.translate('aria.drawer', null, 'الدرج', currentLang()) + '"><span class="z-mobile-game-drawer-chevron" aria-hidden="true">▲</span></button>',
      '<div class="z-mobile-game-drawer-body"><div class="z-mobile-game-drawer-content"></div></div>'
    ].join('');

    var backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'z-mobile-game-drawer-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', function () { setGameDrawer(false); });
    document.body.appendChild(backdrop);

    var handle = qs('.z-mobile-game-drawer-handle', drawer);
    ensureDrawerChevron(handle);

    handle.setAttribute('aria-expanded', 'false');
    handle.setAttribute('aria-label', window.I18N.translate('aria.drawerToggle', null, 'تبديل الدرج', currentLang()));
    handle.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setGameDrawer(!drawer.classList.contains('is-open'));
    });

    document.addEventListener('pointerdown', function (event) {
      if (pageType() !== 'game' || !isPhone()) return;
      if (!drawer.classList.contains('is-open')) return;
      var target = event.target;
      if (!target) return;
      if (drawer.contains(target)) return;
      setGameDrawer(false);
    }, true);

    return drawer;
  }

  function gamePresence(side) {
    if (gameMode() === 'pvc') return '';
    var chips = qsa('#onlinePresence .presence-chip');
    var chip = chips[side === 'top' ? 0 : 1];
    var status = chip ? qs('[data-presence-status="1"]', chip) : null;
    var text = status ? String(status.textContent || '').trim() : '...';
    return text || '...';
  }

  function gameName(side) {
    try {
      if (window.ZGamePlayers && typeof window.ZGamePlayers.resolveSlot === 'function') {
        var slot = window.ZGamePlayers.resolveSlot(side);
        if (slot && slot.name) return String(slot.name).trim();
      }
    } catch (_) {}
    var selector = side === 'top' ? '#pTopName' : '#pBotName';
    var fallback = side === 'top' ? '#pTopNameM' : '#pBotNameM';
    var el = qs(selector) || qs(fallback);
    return el ? String(el.textContent || '').trim() : '';
  }

  function gameActiveSide() {
    try {
      if (window.Game && typeof window.Game.player !== 'undefined' && typeof window.BOT !== 'undefined') {
        return window.Game.player === window.BOT ? 'bot' : 'top';
      }
    } catch (_) {}
    try {
      var pawn = qs('#turnPawn');
      if (pawn && /white/i.test(String(pawn.getAttribute('src') || ''))) return 'bot';
    } catch (_) {}
    return 'top';
  }

  function gameAvatar(side) {
    try {
      if (gameMode() === 'pvc' && side === 'top') return baseHref() + '/assets/icons/users/computeruser.png';
      if (window.ZGamePlayers && typeof window.ZGamePlayers.resolveSlot === 'function') {
        var slot = window.ZGamePlayers.resolveSlot(side);
        if (slot && slot.avatar) return String(slot.avatar).trim();
      }
    } catch (_) {}
    var selector = side === 'top' ? '#pTopAvatar' : '#pBotAvatar';
    var fallback = side === 'top' ? '#pTopAvatarM' : '#pBotAvatarM';
    var el = qs(selector) || qs(fallback);
    return el ? String(el.getAttribute('src') || '').trim() : '';
  }

  function syncGameHead() {
    var head = qs('.z-mobile-game-head');
    if (!head) return;
    ['top', 'bot'].forEach(function (side) {
      var name = qs('[data-name="' + side + '"]', head);
      var presence = qs('[data-presence="' + side + '"]', head);
      var avatar = qs('[data-avatar="' + side + '"]', head);
      var wrap = avatar ? avatar.parentElement : null;
      var nextName = gameName(side);
      var nextPresence = gamePresence(side);
      if (name && name.textContent !== nextName) name.textContent = nextName;
      if (presence && presence.textContent !== nextPresence) presence.textContent = nextPresence;
      if (avatar) {
        var src = gameAvatar(side);
        if (src && avatar.getAttribute('src') !== src) avatar.setAttribute('src', src);
        avatar.onerror = function () {
          var fb = this.getAttribute('data-avatar') === 'top' ? 'computeruser.png' : 'autouser2.png';
          this.src = baseHref() + '/assets/icons/users/' + fb;
        };
      }
      if (wrap) {
        var cls = side === 'top' ? 'is-black-piece' : 'is-white-piece';
        if (!wrap.classList.contains(cls)) {
          wrap.classList.remove('is-black-piece', 'is-white-piece');
          wrap.classList.add(cls);
        }
      }
    });
    var active = gameActiveSide();
    qsa('.z-mobile-game-player', head).forEach(function (card) {
      card.classList.toggle('is-active', card.getAttribute('data-player') === active);
    });
    var gm = gameMode();
    if (head.getAttribute('data-mode') !== gm) head.setAttribute('data-mode', gm);
  }

  function gameButtons() {
    if (gameMode() === 'spectator') return [qs('#btnChat')].filter(Boolean);
    if (gameMode() === 'pvp') return [qs('.timer-row'), qs('.soufla-row'), qs('#btnUndo'), qs('#btnSync'), qs('#btnSettings'), qs('#btnChat'), qs('#btnMic'), qs('#btnSpk')].filter(Boolean);
    return [qs('.timer-row'), qs('.soufla-row'), qs('#btnUndo'), qs('#btnSave'), qs('#btnResume'), qs('#btnNew'), qs('#btnSettings')].filter(Boolean);
  }

  function syncKillTile() {
    var row = qs('.timer-row');
    var clock = qs('#killClock');
    var btn = qs('#btnEndKill');
    if (!row || !clock || !btn) return;
    var live = String(clock.textContent || '').trim();
    var active = btn.getAttribute('data-chain-active') === 'true';
    row.classList.toggle('is-live', active);
    row.classList.toggle('is-disabled', !active);
  }

  function revealGameControl(node) {
    if (!node) return;
    node.hidden = false;
    node.removeAttribute('hidden');
    if (node.classList && node.classList.contains('timer-row')) {
      node.style.display = 'flex';
      var kill = qs('#btnEndKill', node);
      if (kill) {
        kill.hidden = false;
        kill.removeAttribute('hidden');
        kill.style.display = 'inline-flex';
      }
      return;
    }
    if (node.classList && node.classList.contains('soufla-row')) {
      node.style.display = 'flex';
      var soufla = qs('#btnSoufla', node);
      if (soufla) {
        soufla.hidden = false;
        soufla.removeAttribute('hidden');
        soufla.style.display = 'inline-flex';
      }
      return;
    }
    if (node.classList && node.classList.contains('btn')) {
      node.style.display = 'inline-flex';
    }
  }

  function syncGameControls() {
    var grid = qs('.z-mobile-game-controls-grid');
    if (!grid) return;
    var mode = gameMode();
    if (mode === 'spectator') {
      qsa('.timer-row, .soufla-row').forEach(function (node) {
        node.hidden = true;
        node.style.display = 'none';
      });
      var endKill = qs('#btnEndKill');
      if (endKill) {
        endKill.hidden = true;
        endKill.style.display = 'none';
      }
    }
    var items = gameButtons().filter(function (item) {
      return item && item.id !== 'btnEndOnline' && item.id !== 'btnEndLocalMatch' && item.id !== 'btnLeaveRoom';
    });
    items.forEach(revealGameControl);
    var same = grid.children.length === items.length && items.every(function (item, i) { return grid.children[i] === item; });
    if (!same) {
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      items.forEach(function (item) { grid.appendChild(item); });
    }
    if (grid.getAttribute('data-mode') !== mode) grid.setAttribute('data-mode', mode);
    syncKillTile();
  }

  function syncGameDrawer() {
    var drawer = qs('.z-mobile-game-drawer');
    var content = qs('.z-mobile-game-drawer-content', drawer);
    if (!drawer || !content) return;
    var mode = gameMode();
    var aiLevelBox = qs('#aiLevelBox');
    var stats = qs('.stats-mobile');
    var log = qs('#log');
    var logPanel = qs('.z-mobile-game-log-panel', content);
    var logTitle = qs('.z-mobile-game-log-title', content);
    if (!logPanel) {
      logPanel = document.createElement('div');
      logPanel.className = 'z-mobile-game-log-panel';
    }
    if (!logTitle) {
      logTitle = document.createElement('div');
      logTitle.className = 'z-mobile-game-log-title';
      logTitle.textContent = activityLogTitle();
    } else {
      logTitle.textContent = activityLogTitle();
    }
    if (aiLevelBox && !isAiLevelSelectInteracting()) {
      aiLevelBox.style.display = mode === 'pvc' ? 'flex' : 'none';
      aiLevelBox.hidden = mode !== 'pvc';
      aiLevelBox.style.order = '';
    }
    if (stats) {
      stats.style.display = 'block';
      stats.hidden = false;
      stats.style.order = '2';
      content.appendChild(stats);
    }
    if (log) {
      log.hidden = false;
      log.style.display = 'block';
      if (logTitle.parentNode !== logPanel) logPanel.appendChild(logTitle);
      if (log.parentNode !== logPanel) logPanel.appendChild(log);
      logPanel.style.order = '3';
      if (logPanel.parentNode !== content) content.appendChild(logPanel);
      else content.appendChild(logPanel);
    }
    if (!drawer.classList.contains('is-dragging')) setGameDrawer(drawer.classList.contains('is-open'));
  }

  function placeGameLayout() {
    if (pageType() !== 'game' || !isPhone()) return;
    var app = qs('.app');
    var board = qs('.board-wrap');
    var side = qs('.side');
    if (!app || !board || !side) return;

    var shell = ensureGameShell();
    var head = ensureGameHead();
    var controls = ensureGameControlsHost();
    var drawer = ensureGameDrawer();
    var lane = ensureGameSideLane();

    if (isLandscape()) {
      if (lane && lane.parentNode !== document.body) document.body.appendChild(lane);
      if (shell && lane && shell.parentNode !== lane) lane.appendChild(shell);
      if (side && lane && side.parentNode !== lane) lane.appendChild(side);
      if (drawer && lane && drawer.parentNode !== lane) lane.appendChild(drawer);
      if (head && head.parentNode !== side) side.insertBefore(head, side.firstChild);
      if (controls && controls.parentNode !== side) side.appendChild(controls);
    } else {
      if (head && head.parentNode !== app) app.insertBefore(head, board);
      if (side && side.parentNode !== app) app.appendChild(side);
      if (controls && controls.parentNode !== side) side.insertBefore(controls, side.firstChild);
      if (shell && shell.parentNode !== document.body) document.body.appendChild(shell);
      if (drawer && drawer.parentNode !== document.body) document.body.appendChild(drawer);
      if (lane && lane.parentNode) lane.parentNode.removeChild(lane);
    }
  }

  function syncGameLayout() {
    if (pageType() !== 'game' || !isPhone()) return;
    document.body.setAttribute('data-mobile-game-mode', gameMode());
    placeGameLayout();
    syncGameShellPins();
    syncGameHead();
    syncGameLevelInShell(qs('.z-mobile-game-shell'));
    syncGameControls();
    syncGameDrawer();
  }

  function scheduleGameLayoutSync() {
    if (pageType() !== 'game' || !isPhone() || GAME_LOOP) return;
    GAME_LOOP = window.requestAnimationFrame(function () {
      GAME_LOOP = 0;
      if (pageType() !== 'game' || !isPhone()) return;
      syncGameLayout();
    });
  }

  function disconnectGameLayoutObservers() {
    if (GAME_LOOP) {
      try { window.cancelAnimationFrame(GAME_LOOP); } catch (_) {}
      GAME_LOOP = 0;
    }
    if (GAME_LAYOUT_OBSERVER) {
      try { GAME_LAYOUT_OBSERVER.disconnect(); } catch (_) {}
      GAME_LAYOUT_OBSERVER = null;
    }
    if (GAME_RESIZE_OBSERVER) {
      try { GAME_RESIZE_OBSERVER.disconnect(); } catch (_) {}
      GAME_RESIZE_OBSERVER = null;
    }
  }

  function ensureGameLayoutObservers() {
    if (pageType() !== 'game') {
      disconnectGameLayoutObservers();
      return;
    }
    if (!isPhone()) {
      disconnectGameLayoutObservers();
      return;
    }
    var app = qs('.app');
    if (!app) return;
    if (!GAME_LAYOUT_OBSERVER) {
      try {
        GAME_LAYOUT_OBSERVER = new MutationObserver(function () { scheduleGameLayoutSync(); });
        GAME_LAYOUT_OBSERVER.observe(app, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'data-mobile-game-mode']
        });
      } catch (_) {}
    }
    if (!GAME_RESIZE_OBSERVER && typeof ResizeObserver === 'function') {
      try {
        GAME_RESIZE_OBSERVER = new ResizeObserver(function () { scheduleGameLayoutSync(); });
        [app, qs('.board-wrap'), qs('.side'), qs('#board'), qs('#board3d')].filter(Boolean).forEach(function (node) {
          try { GAME_RESIZE_OBSERVER.observe(node); } catch (_) {}
        });
      } catch (_) {
        GAME_RESIZE_OBSERVER = null;
      }
    }
    scheduleGameLayoutSync();
  }

  function syncGameShellPins() {
    if (pageType() !== 'game' || !isPhone()) return;
    var shell = qs('.z-mobile-game-shell');
    if (!shell) return;
    var inner = qs('.z-mobile-game-shell-inner', shell);
    var langBtn = qs('.z-mobile-shell-btn.is-lang', shell);
    var backBtn = qs('.z-mobile-shell-btn.is-back', shell);
    shell.style.left = '';
    shell.style.right = '';
    shell.style.insetInline = '';
    if (inner) inner.style.direction = 'ltr';
    if (langBtn) {
      langBtn.style.left = '';
      langBtn.style.right = '';
    }
    if (backBtn) {
      backBtn.style.left = '';
      backBtn.style.right = '';
    }
  }


  /* Dashboard page */

  function ensureDashboardSummaryTable() {
    if (pageType() !== 'dashboard') return;
    var summary = qs('.z-dash-summary');
    if (!summary) return;
    if (!qs('.z-dash-summary-table', summary)) {
      var table = document.createElement('table');
      table.className = 'z-dash-summary-table';
      table.innerHTML = [
        '<thead><tr>',
        '<th data-summary-key="games"></th>',
        '<th data-summary-key="points"></th>',
        '<th data-summary-key="rank"></th>',
        '</tr></thead>',
        '<tbody><tr>',
        '<td data-stat="statTotalGames">—</td>',
        '<td data-stat="statPoints">—</td>',
        '<td><button type="button" class="z-dash-summary-table-rank z-dash-summary-card" data-open-leaderboard="1" data-stat="statRank"></button></td>',
        '</tr></tbody>'
      ].join('');
      summary.appendChild(table);
    }
  }

  function placeDashboardSummary() {
    if (pageType() !== 'dashboard' || !document.body || !document.body.classList.contains('z-mobile-on')) return;
    var summary = qs('.z-dash-summary');
    var profile = qs('.z-dash-profile-card');
    var sideTop = qs('.z-dash-side-top');
    if (!summary || !profile || !sideTop) return;

    var anchor = qs('.z-dash-summary-anchor', sideTop);
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.className = 'z-dash-summary-anchor';
      anchor.hidden = true;
      sideTop.insertBefore(anchor, summary);
    }

    if (document.body.getAttribute('data-mobile-orientation') === 'landscape') {
      if (summary.parentNode !== profile) profile.appendChild(summary);
    } else if (summary.parentNode !== sideTop) {
      sideTop.insertBefore(summary, anchor.nextSibling);
    }
  }

  function bindDashboardSummaryLeaderboard() {
    if (pageType() !== 'dashboard') return;
    qsa('.z-dash-summary-table [data-open-leaderboard="1"]').forEach(function (el) {
      if (!el || el.__zLeaderboardBound) return;
      var openLeaderboard = function () {
        if (window.ZLeaderboard && typeof window.ZLeaderboard.openModal === 'function') {
          window.ZLeaderboard.openModal();
        }
      };
      el.addEventListener('click', openLeaderboard);
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openLeaderboard();
        }
      });
      el.__zLeaderboardBound = true;
    });
  }

  function refreshDashboardSummaryText() {
    if (pageType() !== 'dashboard') return;
    ensureDashboardSummaryTable();
    qsa('.z-dash-summary-table [data-summary-key="games"]').forEach(function (el) {
      el.textContent = window.I18N.text('dashboard.totalGames', null, currentLang());
    });
    qsa('.z-dash-summary-table [data-summary-key="points"]').forEach(function (el) {
      el.textContent = window.I18N.text('dashboard.points', null, currentLang());
    });
    qsa('.z-dash-summary-table [data-summary-key="rank"]').forEach(function (el) {
      el.textContent = window.I18N.text('dashboard.rank', null, currentLang());
    });
    qsa('.z-dash-summary-table [data-open-leaderboard="1"]').forEach(function (el) {
      var label = window.I18N.text('dashboard.showLeaderboard', null, currentLang());
      el.setAttribute('title', label);
      el.setAttribute('aria-label', label);
    });
    bindDashboardSummaryLeaderboard();
  }

  /* Text and i18n refresh */

  function refreshFooterText() {
    var footer = qs('.z-mobile-footer');
    if (!footer) return;
    var rights = qs('.z-mobile-footer-rights', footer);
    if (rights) rights.textContent = rightsText();
    qsa('.z-mobile-footer-nav a', footer).forEach(function (link, index) {
      var item = publicLinks()[index];
      if (!item) return;
      link.href = item.href;
      link.title = window.I18N.text(item.key, null, currentLang());
      link.textContent = isLandscape() ? window.I18N.text(item.key, null, currentLang()) : shortLinkLabel(item);
    });
    requestAnimationFrame(syncFooterMetrics);
  }

  function refreshShellText() {
    qsa('.z-mobile-shell-menu [data-lang], .z-mobile-game-shell-menu [data-lang]').forEach(function (btn) {
      var lang = btn.getAttribute('data-lang');
      btn.textContent = window.I18N.translate('langs.' + lang, null, lang, currentLang());
      btn.classList.toggle('is-active', lang === currentLang());
    });
    qsa('.z-mobile-shell-btn.is-lang, .z-mobile-game-shell .z-mobile-shell-btn.is-lang').forEach(function (btn) {
      btn.setAttribute('aria-label', window.I18N.translate('ui.language', null, 'Language', currentLang()));
    });
    qsa('.z-mobile-shell-btn.is-back, .z-mobile-game-shell .z-mobile-shell-btn.is-back').forEach(function (btn) {
      var actionKey = btn.getAttribute('data-shell-action') === 'logout' ? 'topbar.logout' : 'actions.back';
      var fallback = actionKey === 'topbar.logout' ? 'Sign out' : 'Back';
      btn.setAttribute('aria-label', window.I18N.translate(actionKey, null, fallback, currentLang()));
      btn.setAttribute('title', window.I18N.translate(actionKey, null, fallback, currentLang()));
    });
    var orient = qs('.z-mobile-orient');
    if (orient) orient.setAttribute('aria-label', window.I18N.translate('aria.fullscreen', null, 'Fullscreen', currentLang()));
  }

function refreshMobileText() {
    if (!document.body || !document.body.classList.contains('z-mobile-on')) return;
    refreshShellText();
    refreshFooterText();
    refreshDashboardSummaryText();
    ensureLobbyHead();
  }


  function clearPreinitState() {
    try {
      document.documentElement.classList.remove('z-mobile-preinit');
    } catch (_) {}
  }

  /* Mobile state lifecycle */

  function applyState() {
    if (!document.body) return;
    syncViewportMetrics();
    var mobile = isPhone() && !!MOBILE_PAGES[pageType()];
    var orientation = isLandscape() ? 'landscape' : 'portrait';

    document.body.classList.toggle('z-mobile-on', mobile);
    document.body.classList.toggle('z-mobile-portrait', mobile && orientation === 'portrait');
    document.body.classList.toggle('z-mobile-landscape', mobile && orientation === 'landscape');
    document.body.setAttribute('data-mobile-page', pageType());
    document.body.setAttribute('data-mobile-orientation', orientation);

    if (!mobile) {
      restoreModeHead();
      restoreLobbyHead();
      qsa('.z-mobile-shell-menu, .z-mobile-game-shell-menu').forEach(function (menu) { menu.hidden = true; });
      disconnectGameLayoutObservers();
      clearPreinitState();
      return;
    }

    ensureShell();
    ensureOrientButton();
    ensureFooter();
    ensureModeHead();
    ensureLobbyHead();
    ensureAuthLoginLayout();
    ensureAuthRegisterLayout();
    scheduleAuthCardHeight();
    ensureDashboardSummaryTable();
    placeDashboardSummary();
    syncGameLayout();
    ensureGameLayoutObservers();
    refreshMobileText();
    clearPreinitState();
  }

  window.Mobile = {
    refresh: refreshMobileText,
    syncGameLayout: syncGameLayout,
    syncGameHeadNow: syncGameHead
  };

  function handleViewportChange() {
    syncViewportMetrics();
    syncFooterMetrics();
    scheduleAuthCardHeight();
    placeDashboardSummary();
    syncGameLayout();
  }

  function init() {
    applyState();
    window.addEventListener('resize', applyState, { passive: true });
    window.addEventListener('orientationchange', applyState);
    window.addEventListener('pageshow', applyState);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange, { passive: true });
      window.visualViewport.addEventListener('scroll', handleViewportChange, { passive: true });
    }
    if (pageType() === 'auth') {
      var authRoot = qs('#authRoot');
      if (authRoot) {
        try {
          var authObserver = new MutationObserver(function () { scheduleAuthCardHeight(); });
          authObserver.observe(authRoot, { attributes: true, subtree: true, attributeFilter: ['style', 'data-auth-current', 'class'] });
        } catch (_) {}
      }
    }
    try {
      var observer = new MutationObserver(function () { refreshMobileText(); scheduleAuthCardHeight(); });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir', 'class'] });
    } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
