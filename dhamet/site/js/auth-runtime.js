/*
 * Dhamet authentication client.
 * Official browser API: window.CloudflareAuth / window.DhametAuth.
 */
(function () {
  'use strict';

  var API_BASE = '';
  var DEFAULT_ICON = 'assets/icons/users/user1.png';
  var cachedUser = null;
  var authListeners = [];
  var readyPromise = null;

  function now() { try { return Date.now(); } catch (_) { return 0; } }
  function api(path) { return API_BASE + path; }
  function safeJson(s) { try { return JSON.parse(s); } catch (_) { return null; } }
  function cleanEmail(email) { return String(email || '').trim().toLowerCase(); }
  function cleanNickname(nickname) { return String(nickname || '').trim().replace(/\s+/g, ' ').slice(0, 20); }
  function emitAuthState() {
    authListeners.slice().forEach(function (cb) {
      try { cb(cachedUser); } catch (_) {}
    });
  }

  function normalizeProviderData(u) {
    var providerData = Array.isArray(u && u.providerData) ? u.providerData.slice() : [];
    var providers = String((u && u.providers) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    providers.forEach(function (provider) {
      var providerId = provider === 'google' ? 'google.com' : (provider === 'guest' ? 'anonymous' : provider);
      if (!providerData.some(function (p) { return p && p.providerId === providerId; })) providerData.push({ providerId: providerId });
    });
    if (u && (u.isAnonymous || u.kind === 'guest') && !providerData.some(function (p) { return p && p.providerId === 'anonymous'; })) {
      providerData.push({ providerId: 'anonymous' });
    }
    return providerData;
  }

  function userToSession(user) {
    user = normalizeUser(user);
    if (!user) return null;
    return {
      kind: user.isAnonymous ? 'guest' : 'registered',
      uid: user.uid,
      authUid: user.uid,
      email: user.email || '',
      nickname: user.nickname || user.displayName || '',
      icon: user.icon || DEFAULT_ICON,
      createdAt: now(),
      lastActiveAt: now()
    };
  }

  function normalizeUser(u) {
    if (!u) return null;
    var providerData = normalizeProviderData(u);
    var user = {
      uid: String(u.uid || u.id || ''),
      email: u.email || '',
      displayName: u.displayName || u.nickname || '',
      nickname: u.nickname || u.displayName || '',
      photoURL: u.photoURL || '',
      icon: u.icon || DEFAULT_ICON,
      isAnonymous: !!u.isAnonymous || u.kind === 'guest',
      emailVerified: !!u.emailVerified,
      providerData: providerData,
      getIdToken: function () { return Promise.resolve('cloudflare-session-cookie'); },
      updateEmail: function (email) { return updateEmail(email); },
      updatePassword: function (password) { return updatePassword(password); },
      delete: function () { return deleteAccount(); },
      reauthenticateWithCredential: function (cred) { return reauthenticatePassword(cred && cred.password, cred && cred.email); },
      reauthenticateWithPopup: function () { return reauthenticateGoogle(); }
    };
    if (!user.uid) return null;
    return user;
  }

  function persistUser(user) {
    cachedUser = normalizeUser(user);
    try {
      if (cachedUser) localStorage.setItem('dhamet.cf.user.v1', JSON.stringify(cachedUser));
      else localStorage.removeItem('dhamet.cf.user.v1');
    } catch (_) {}
    try {
      var s = userToSession(cachedUser);
      if (s) sessionStorage.setItem('zamat.session.user.v1', JSON.stringify(s));
      else sessionStorage.removeItem('zamat.session.user.v1');
    } catch (_) {}
    emitAuthState();
    return cachedUser;
  }

  function setCurrentUser(user) { return persistUser(user); }

  function makeError(code, status, data) {
    var err = new Error(code || ('http-' + (status || 0)));
    err.code = code || ('http-' + (status || 0));
    err.status = status || 0;
    err.data = data || null;
    return err;
  }

  function fetchJson(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'content-type': 'application/json', 'accept': 'application/json' }, opts.headers || {});
    return fetch(api(path), opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = txt ? safeJson(txt) : {};
        if (!res.ok || (data && data.ok === false)) throw makeError((data && data.error) || ('http-' + res.status), res.status, data || null);
        return data || {};
      });
    });
  }
  function post(path, data) { return fetchJson(path, { method: 'POST', body: JSON.stringify(data || {}) }); }

  function refreshMe() {
    readyPromise = fetchJson('/dhamet/api/auth/me', { method: 'GET' }).then(function (res) {
      setCurrentUser(res.user || null);
      return cachedUser;
    }).catch(function () {
      setCurrentUser(null);
      return null;
    });
    return readyPromise;
  }

  function ready() { return readyPromise || refreshMe(); }
  function currentUser() { return cachedUser; }

  function onAuthStateChanged(cb) {
    if (typeof cb !== 'function') return function () {};
    authListeners.push(cb);
    Promise.resolve().then(function () {
      try { cb(cachedUser); } catch (_) {}
      return refreshMe();
    }).then(function (u) {
      try { cb(u); } catch (_) {}
    }).catch(function () {});
    return function () { authListeners = authListeners.filter(function (x) { return x !== cb; }); };
  }

  function signInGuest(input) {
    if (cachedUser && cachedUser.uid && cachedUser.isAnonymous) return Promise.resolve(cachedUser);
    var src = input && typeof input === 'object' ? input : {};
    return refreshMe().then(function (u) {
      if (u && u.uid && u.isAnonymous) return u;
      if (u && u.uid && !u.isAnonymous) return u;
      return post('/dhamet/api/auth/guest', { nickname: cleanNickname(src.nickname), icon: src.icon || DEFAULT_ICON }).then(function (res) { return setCurrentUser(res.user); });
    });
  }

  function signInEmail(email, password) {
    return post('/dhamet/api/auth/login', { email: cleanEmail(email), password: String(password || '') }).then(function (res) { return setCurrentUser(res.user); });
  }

  function registerEmail(inputOrEmail, password, nickname) {
    var input = inputOrEmail && typeof inputOrEmail === 'object'
      ? inputOrEmail
      : { email: inputOrEmail, password: password, nickname: nickname };
    return post('/dhamet/api/auth/register', {
      email: cleanEmail(input.email),
      password: String(input.password || ''),
      nickname: cleanNickname(input.nickname),
      icon: input.icon || DEFAULT_ICON
    }).then(function (res) { return setCurrentUser(res.user); });
  }

  function startGoogleSignIn() {
    location.href = api('/dhamet/api/auth/google/start');
    return new Promise(function () {});
  }

  function consumeGoogleRedirectIfAny() {
    var isGoogleReturn = false;
    try { isGoogleReturn = new URLSearchParams(location.search || '').get('oauth') === 'google'; } catch (_) {}
    if (!isGoogleReturn) return Promise.resolve(null);
    return refreshMe().then(function (u) { return (u && !u.isAnonymous) ? u : null; });
  }

  function requestPasswordReset(email) { return post('/dhamet/api/auth/request-reset', { email: cleanEmail(email) }); }
  function resetPassword(token, password) { return post('/dhamet/api/auth/reset-password', { token: String(token || ''), password: String(password || '') }); }

  function reauthenticatePassword(password, email) {
    return post('/dhamet/api/auth/reauth', { email: cleanEmail(email || (cachedUser && cachedUser.email) || ''), password: String(password || '') });
  }

  function reauthenticateGoogle() {
    // The Worker currently enforces recent-login only for password-backed sensitive actions.
    // Google-backed reauth can therefore be a visible no-op until a dedicated server flow is added.
    return Promise.resolve({ user: cachedUser });
  }

  function updateProfile(patch) {
    return post('/dhamet/api/auth/update-profile', patch || {}).then(function (res) {
      if (res && res.user) setCurrentUser(res.user);
      else refreshMe().catch(function () {});
      return res || {};
    });
  }

  function updateEmail(email) {
    return post('/dhamet/api/auth/update-email', { email: cleanEmail(email) }).then(function (res) {
      setCurrentUser(res.user);
      return cachedUser;
    });
  }

  function updatePassword(password) { return post('/dhamet/api/auth/update-password', { password: String(password || '') }); }

  function deleteAccount() {
    return post('/dhamet/api/auth/delete', {}).then(function (res) {
      setCurrentUser(null);
      return res || { ok: true };
    });
  }

  function signOut() {
    return post('/dhamet/api/auth/logout', {}).then(function (res) {
      if (res && res.user) return setCurrentUser(res.user);
      setCurrentUser(null);
      return null;
    });
  }

  function providerIds(user) {
    return ((user || cachedUser || {}).providerData || []).map(function (p) { return p && p.providerId; }).filter(Boolean);
  }

  function handleResetTokenFromUrl() {
    try {
      var sp = new URLSearchParams(location.search || '');
      var token = sp.get('resetToken');
      if (!token) return;
      var path = String(location.pathname || '');
      if (!/\/pages\/reset-password\.html$/i.test(path)) {
        location.replace('/dhamet/pages/reset-password.html?resetToken=' + encodeURIComponent(token));
      }
    } catch (_) {}
  }

  window.CloudflareAuth = Object.freeze({
    version: 'cloudflare-auth-v3-official',
    ready: ready,
    refreshMe: refreshMe,
    currentUser: currentUser,
    onAuthStateChanged: onAuthStateChanged,
    signInGuest: signInGuest,
    signInEmail: signInEmail,
    registerEmail: registerEmail,
    startGoogleSignIn: startGoogleSignIn,
    consumeGoogleRedirectIfAny: consumeGoogleRedirectIfAny,
    requestPasswordReset: requestPasswordReset,
    resetPassword: resetPassword,
    reauthenticatePassword: reauthenticatePassword,
    reauthenticateGoogle: reauthenticateGoogle,
    updateProfile: updateProfile,
    updateEmail: updateEmail,
    updatePassword: updatePassword,
    deleteAccount: deleteAccount,
    signOut: signOut,
    providerIds: providerIds
  });
  window.DhametAuth = window.CloudflareAuth;



  handleResetTokenFromUrl();
  try {
    var raw = localStorage.getItem('dhamet.cf.user.v1');
    var localUser = raw ? safeJson(raw) : null;
    if (localUser && localUser.uid) cachedUser = normalizeUser(localUser);
  } catch (_) {}
  refreshMe();
})();
