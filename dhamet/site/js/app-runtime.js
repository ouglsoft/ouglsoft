;(function(){

// Build-level browser storage migration.
// Clear an incompatible pre-rebuild automatic PvC snapshot once, while preserving user settings,
// manual saves, account data, language, theme, and compatible sessions from later engine builds.
(function () {
  var BUILD = "computer-pvs-1.8.0";
  try {
    if (typeof window !== "undefined") window.DHAMET_APP_BUILD = BUILD;
    var key = "zamat.app.build.applied";
    var prev = null;
    try { prev = localStorage.getItem(key); } catch (_) { prev = null; }
    if (prev !== BUILD) {
      // A missing/legacy marker means the stored automatic game can contain the
      // state from the removed computer engine. Sessions created by the clean PVS engine are schema-
      // compatible across maintenance releases and must not be discarded.
      if (!prev || String(prev).indexOf("computer-pvs-1.") !== 0) {
        try { sessionStorage.removeItem("zamat.session.game.pvc.v1"); } catch (_) {}
      }
      try { localStorage.setItem(key, BUILD); } catch (_) {}
    }
  } catch (_) {}
})();


function readStoredTheme() {
  var theme = null;
  try {
    var raw = sessionStorage.getItem("zamat.session.settings.v2");
    theme = raw && JSON.parse(raw);
    theme = theme && theme.theme;
  } catch (_) { theme = null; }
  if (theme !== "dark" && theme !== "light") {
    try {
      var rawLocal = localStorage.getItem("zamat.session.settings.v2");
      theme = rawLocal && JSON.parse(rawLocal);
      theme = theme && theme.theme;
    } catch (_) { theme = null; }
  }
  if (theme !== "dark" && theme !== "light") {
    try { theme = localStorage.getItem("zamat.theme"); } catch (_) { theme = null; }
  }
  return theme === "dark" ? "dark" : "light";
}

function isPhoneLike() {
  var w = Math.max(0, window.innerWidth || 0), h = Math.max(0, window.innerHeight || 0);
  var sw = Math.max(0, window.screen && window.screen.width || 0), sh = Math.max(0, window.screen && window.screen.height || 0);
  var shortSide = Math.min(w || sw, h || sh, sw || w || 0, sh || h || 0) || Math.min(w, h);
  var longSide = Math.max(w, h, sw, sh), coarse = false, touch = 0, ua = "";
  try { coarse = window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches; } catch (_) {}
  try { touch = Math.max(0, navigator.maxTouchPoints || 0); ua = String(navigator.userAgent || navigator.vendor || ""); } catch (_) {}
  if (/Android.+Mobile|iPhone|iPod|Windows Phone|Opera Mini|IEMobile|Mobile Safari/i.test(ua)) return true;
  if (shortSide > 820 || (w > 1024 && h > 700)) return false;
  return (coarse || touch > 0) && ((shortSide <= 600 && longSide <= 1600) || (shortSide <= 720 && longSide <= 1366 && !/Android|iPad|Tablet|Silk/i.test(ua)));
}

try { document.documentElement.classList.toggle("dark", readStoredTheme() === "dark"); } catch (_) {}
try {
  window.addEventListener("pageshow", function () {
    window.setTimeout(function () {
      try { document.documentElement.classList.toggle("dark", readStoredTheme() === "dark"); } catch (_) {}
    }, 0);
  });
} catch (_) {}

if (!document.getElementById("z-mobile-preinit-style")) {
  var style = document.createElement("style");
  style.id = "z-mobile-preinit-style";
  style.textContent = "html.z-mobile-preinit body { visibility: hidden !important; opacity: 0 !important; }\nhtml.z-mobile-preinit body,\nhtml.z-mobile-preinit body * { transition: none !important; animation: none !important; }";
  (document.head || document.documentElement).appendChild(style);
}
if (isPhoneLike()) {
  try { document.documentElement.classList.add("z-mobile-preinit"); } catch (_) {}
  window.__clearMobilePreinit = function () {
    try { document.documentElement.classList.remove("z-mobile-preinit"); } catch (_) {}
  };
  window.setTimeout(function () {
    try { window.__clearMobilePreinit && window.__clearMobilePreinit(); } catch (_) {}
  }, 1600);
}

window.dataLayer = window.dataLayer || [];
if (typeof window.gtag !== "function") window.gtag = function () { window.dataLayer.push(arguments); };
try {
  window.gtag("js", new Date());
  window.gtag("config", "G-3511LJEQ1R");
} catch (_) {}

window.ZIconManifest = ["assets/icons/users/user1.png", "assets/icons/users/user2.png", "assets/icons/users/user3.png", "assets/icons/users/user4.png", "assets/icons/users/user5.png", "assets/icons/users/user6.png", "assets/icons/users/user7.png", "assets/icons/users/user8.png", "assets/icons/users/user9.png", "assets/icons/users/user11.png", "assets/icons/users/user12.png", "assets/icons/users/user13.png", "assets/icons/users/user14.png", "assets/icons/users/user15.png", "assets/icons/users/user16.png", "assets/icons/users/user17.png", "assets/icons/users/user18.png", "assets/icons/users/user19.png", "assets/icons/users/user20.png", "assets/icons/users/autouser1.png", "assets/icons/users/autouser2.png", "assets/icons/users/computeruser.png"];

function createDesktopLanguageSelect(id){
  var sel = document.createElement("select");
  sel.className = "z-lang-select";
  if (id) sel.id = id;
  sel.setAttribute("data-i18n-aria-label", "ui.language");
  sel.setAttribute("data-i18n-title", "ui.language");
  [
    { code: "ar", key: "langs.ar" },
    { code: "en", key: "langs.en" },
    { code: "fr", key: "langs.fr" },
  ].forEach(function(item){
    var opt = document.createElement("option");
    opt.value = item.code;
    opt.setAttribute("data-i18n", item.key);
    sel.appendChild(opt);
  });
  return sel;
}

function mountDesktopLanguageSelect(container, selectId){
  if (!container) return null;
  var existing = selectId ? container.querySelector("#" + selectId) : container.querySelector(".z-lang-select");
  if (existing) return existing;
  try { container.innerHTML = ""; } catch (_) {}
  var sel = createDesktopLanguageSelect(selectId);
  container.appendChild(sel);
  return sel;
}

function bindDesktopLanguageSelect(selectEl, getValue, onChange){
  if (!selectEl) return;
  var current = "ar";
  try { current = typeof getValue === "function" ? (getValue() || "ar") : "ar"; } catch (_) {}
  try { selectEl.value = current; } catch (_) {}
  if (selectEl._z_bound) return;
  selectEl._z_bound = true;
  selectEl.addEventListener("change", function(){
    var v = selectEl.value || "ar";
    if (typeof onChange === "function") onChange(v);
  });
}

const ZCOMMON_DEFAULT_ICON = "assets/icons/users/user1.png";
function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
function sanitizeUserIconPathShared(p){
  p = String(p || "").trim();
  p = p.replace(/^(?:\.\.\/)+/g, "").replace(/^\/+/, "");
  if (!p) return ZCOMMON_DEFAULT_ICON;
  if (/^assets\/icons\/usre1\.svg$/i.test(p)) p = "assets/icons/users/user1.png";
  var m = p.match(/^assets\/icons\/user(\d+)\.(svg|png)$/i);
  if (m) p = "assets/icons/users/user" + m[1] + ".png";
  if (/^assets\/icons\/user\.(svg|png)$/i.test(p)) p = ZCOMMON_DEFAULT_ICON;
  m = p.match(/^assets\/icons\/users\/user(\d+)\.(svg|png)$/i);
  if (m) p = "assets/icons/users/user" + m[1] + ".png";
  if (/^assets\/icons\/users\/user\.(svg|png)$/i.test(p)) p = ZCOMMON_DEFAULT_ICON;
  if (/^user(\d+)$/i.test(p)) {
    var n1 = p.match(/^user(\d+)$/i);
    p = "assets/icons/users/user" + n1[1] + ".png";
  }
  if (/^user(\d+)\.(svg|png)$/i.test(p)) {
    var n2 = p.match(/^user(\d+)\.(svg|png)$/i);
    p = "assets/icons/users/user" + n2[1] + ".png";
  }
  var m2 = p.match(/^assets\/icons\/users\/([a-z0-9_-]+)\.(?:svg|png)$/i);
  if (!m2) return ZCOMMON_DEFAULT_ICON;
  var name = m2[1];
  if (!/^(user\d+|autouser1|autouser2|computeruser)$/i.test(name)) return ZCOMMON_DEFAULT_ICON;
  var resolved = "assets/icons/users/" + name + ".png";
  var allowed = window.ZIconManifest && Array.isArray(window.ZIconManifest) ? window.ZIconManifest : null;
  if (allowed && allowed.indexOf(resolved) === -1) return ZCOMMON_DEFAULT_ICON;
  return resolved;
}


function getAllowedUserIcons(){
  var raw = window.ZIconManifest && Array.isArray(window.ZIconManifest) ? window.ZIconManifest : null;
  var fb = [];
  [1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,20].forEach(function(i){ fb.push("assets/icons/users/user" + i + ".png"); });
  fb.push("assets/icons/users/autouser1.png");
  fb.push("assets/icons/users/autouser2.png");
  fb.push("assets/icons/users/computeruser.png");
  var list = raw && raw.length ? raw : fb;
  var out = [];
  var seen = {};
  list.forEach(function(path){
    var safe = sanitizeUserIconPathShared(path);
    if (!safe || seen[safe]) return;
    seen[safe] = true;
    out.push(safe);
  });
  return out.length ? out : fb;
}

function pageAssetPrefix(){
  try {
    var p = String((location && location.pathname) || "");
    return p.indexOf("/pages/") !== -1 ? "../" : "";
  } catch (_) {
    return "";
  }
}

function pageAssetUrl(rel){
  var s = String(rel || "").trim();
  if (!s) return s;
  if (/^(?:\.\.\/|\.\/|https?:|data:|blob:)/i.test(s)) return s;
  return pageAssetPrefix() + s.replace(/^\/+/, "");
}

function getShellLang(){
  try {
    if (window.ZShell && typeof window.ZShell.getLang === "function") {
      return window.ZShell.getLang() || document.documentElement.lang || "ar";
    }
  } catch (_) {}
  return document.documentElement.lang || "ar";
}

window.ZCommon = window.ZCommon || {};
window.ZCommon.qs = qs;
window.ZCommon.qsa = qsa;
window.ZCommon.isPhoneLike = isPhoneLike;
window.ZCommon.getLang = getShellLang;
window.ZCommon.pageAssetPrefix = pageAssetPrefix;
window.ZCommon.pageAssetUrl = pageAssetUrl;
window.ZCommon.getAllowedUserIcons = getAllowedUserIcons;
window.ZCommon.sanitizeUserIconPath = sanitizeUserIconPathShared;
window.ZCommon.mountDesktopLanguageSelect = mountDesktopLanguageSelect;
window.ZCommon.bindDesktopLanguageSelect = bindDesktopLanguageSelect;


(function () {
  "use strict";

  const SESSION_KEY = "zamat.session.user.v1";
  const PERSIST_KEY = "zamat.session.user.persist.v1";
  const LANG_KEY = "zamat.lang";

const ICON_LS_KEY = "zamat.icon";


const NICK_LS_KEY = "zamat.nick";
const NICK_EXPLICIT_KEY = "zamat.nickExplicit";

const DEFAULT_ICON = "assets/icons/users/user1.png";
  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  function nowMs(){ return Date.now(); }


function sanitizeUserIconPath(p){
  p = String(p || "").trim();
  p = p.replace(/^(?:\.\.\/)+/g, "").replace(/^\/+/, "");
  if (!p) return DEFAULT_ICON;

  if (/^assets\/icons\/usre1\.svg$/i.test(p)) p = "assets/icons/users/user1.png";

  let m = p.match(/^assets\/icons\/user(\d+)\.(svg|png)$/i);
  if (m) p = `assets/icons/users/user${m[1]}.png`;
  if (/^assets\/icons\/user\.(svg|png)$/i.test(p)) p = DEFAULT_ICON;

  m = p.match(/^assets\/icons\/users\/user(\d+)\.(svg|png)$/i);
  if (m) p = `assets/icons/users/user${m[1]}.png`;
  if (/^assets\/icons\/users\/user\.(svg|png)$/i.test(p)) p = DEFAULT_ICON;

  if (/^user(\d+)$/i.test(p)) {
    const n = p.match(/^user(\d+)$/i);
    p = `assets/icons/users/user${n[1]}.png`;
  }
  if (/^user(\d+)\.(svg|png)$/i.test(p)) {
    const n = p.match(/^user(\d+)\.(svg|png)$/i);
    p = `assets/icons/users/user${n[1]}.png`;
  }

  const m2 = p.match(/^assets\/icons\/users\/([a-z0-9_-]+)\.(?:svg|png)$/i);
  if (!m2) return DEFAULT_ICON;
  const name = m2[1];
  if (!/^(user\d+|autouser1|autouser2|computeruser)$/i.test(name)) return DEFAULT_ICON;
  const resolved = `assets/icons/users/${name}.png`;
  const allowed = window.ZIconManifest && Array.isArray(window.ZIconManifest) ? window.ZIconManifest : null;
  if (allowed && !allowed.includes(resolved)) return DEFAULT_ICON;
  return resolved;
}

function persistNickIcon(session){
  try {
    if (session && session.nickname) {
      
      try { sessionStorage.setItem(NICK_LS_KEY, String(session.nickname)); } catch {}
      try { sessionStorage.setItem(NICK_EXPLICIT_KEY, "1"); } catch {}
      
      try { localStorage.removeItem(NICK_LS_KEY); } catch {}
      try { localStorage.removeItem(NICK_EXPLICIT_KEY); } catch {}
    }
  } catch {}
  try {
    const ic = sanitizeUserIconPath(session && session.icon);
    if (ic) localStorage.setItem(ICON_LS_KEY, ic);
  } catch {}
}


  
  function withTimeout(promise, ms, errCode){
    ms = Number(ms || 0);
    if (!ms || ms < 1000) ms = 10000;
    return new Promise(function(resolve, reject){
      var done = false;
      var t = setTimeout(function(){
        if (done) return;
        done = true;
        var e = new Error(errCode || "timeout");
        e.code = errCode || "timeout";
        reject(e);
      }, ms);

      Promise.resolve(promise)
        .then(function(v){
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve(v);
        })
        .catch(function(err){
          if (done) return;
          done = true;
          clearTimeout(t);
          reject(err);
        });
    });
  }

  function safeJSONParse(s){
    try { return JSON.parse(s); } catch { return null; }
  }

  function setDirFromLang(lang){
    const dir = (lang === "ar") ? "rtl" : "ltr";
    try {
      document.documentElement.setAttribute("lang", lang);
      document.documentElement.setAttribute("dir", dir);
    } catch {}
  }

  function getSavedLang(){
    try { return localStorage.getItem(LANG_KEY) || "ar"; } catch { return "ar"; }
  }
  function setSavedLang(lang){
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
  }

  function readSession(){
    const raw = (function(){
      try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
    })();
    if (!raw) return null;
    const obj = safeJSONParse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  }

  
function writeSession(s){
  try {
    s = s || {};
    s.lastActiveAt = nowMs();
    
    if (s.icon) s.icon = sanitizeUserIconPath(s.icon);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {}

  
  try { persistNickIcon(s); } catch {}
}


  function clearSession(){
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
    try { sessionStorage.removeItem(NICK_LS_KEY); } catch (_) {}
    try { sessionStorage.removeItem(NICK_EXPLICIT_KEY); } catch (_) {}
    try { localStorage.removeItem(NICK_LS_KEY); } catch (_) {}
    try { localStorage.removeItem(NICK_EXPLICIT_KEY); } catch (_) {}
    try { localStorage.removeItem(ICON_LS_KEY); } catch (_) {}
  }

  function isRegistered(s){ return s && s.kind === "registered"; }
  function isGuest(s){ return s && s.kind === "guest"; }

  function validateEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||"").trim());
  }

  function normalizeNick(n){
    n = String(n||"").trim();
    
    n = n.replace(/\s+/g, " ");
    return n;
  }
  function validateNick(n){
    n = normalizeNick(n);
    if (!n) return { ok:false, msg: window.I18N.translateArgs("errors.nick.required") };
    if (n.length < 3) return { ok:false, msg: window.I18N.translateArgs("errors.nick.tooShort") };
    if (n.length > 20) return { ok:false, msg: window.I18N.translateArgs("errors.nick.tooLong") };
    if (!/^[\w\u0600-\u06FF][\w\u0600-\u06FF\s.-]*$/.test(n)) return { ok:false, msg: window.I18N.translateArgs("errors.nick.invalid") };
    return { ok:true, nick:n };
  }

  function cloudflareAuthReady(){
    return !!(window.CloudflareAuth && typeof window.CloudflareAuth.ready === "function");
  }

  function initCloudflareAuth(){
    return cloudflareAuthReady();
  }


  function syncSessionUidToAuth(authUid){
    try{
      authUid = String(authUid || "").trim();
      if (!authUid) return;
      const s = readSession();
      if (!s || typeof s !== "object") return;

      
      if (s.uid !== authUid) {
        if (isGuest(s)) {
          if (!s.guestLocalId) s.guestLocalId = s.uid;
          s.uid = authUid;
          s.authUid = authUid;
          s.lastActiveAt = nowMs();
          writeSession(s);
        } else if (isRegistered(s)) {
          s.uid = authUid;
          s.authUid = authUid;
          s.lastActiveAt = nowMs();
          writeSession(s);
        }
      } else if (!s.authUid) {
        s.authUid = authUid;
        s.lastActiveAt = nowMs();
        writeSession(s);
      }
    } catch (_) {}
  }


  async function ensureAnonymousAuth(){
    if (!window.CloudflareAuth || typeof window.CloudflareAuth.signInGuest !== "function") return null;
    try {
      const existing = window.CloudflareAuth.currentUser && window.CloudflareAuth.currentUser();
      if (existing && existing.uid) {
        try { syncSessionUidToAuth(existing.uid); } catch (_) {}
        return existing;
      }
      const u = await withTimeout(window.CloudflareAuth.signInGuest({}), 12000, "auth-timeout");
      try { if (u && u.uid) syncSessionUidToAuth(u.uid); } catch (_) {}
      return u || null;
    } catch (_) {
      return null;
    }
  }


  async function loginEmail(email, pass){
    if (!window.CloudflareAuth || typeof window.CloudflareAuth.signInEmail !== "function") throw new Error("cloudflare-auth-unavailable");
    return await withTimeout(window.CloudflareAuth.signInEmail(email, pass), 12000, "auth-timeout");
  }

  async function loginGoogle(){
    if (!window.CloudflareAuth || typeof window.CloudflareAuth.startGoogleSignIn !== "function") throw new Error("cloudflare-auth-unavailable");
    await window.CloudflareAuth.startGoogleSignIn();
    return null;
  }

  async function consumeGoogleRedirectIfAny(){
    try {
      if (!window.CloudflareAuth || typeof window.CloudflareAuth.consumeGoogleRedirectIfAny !== "function") return null;
      const user = await withTimeout(window.CloudflareAuth.consumeGoogleRedirectIfAny(), 12000, "auth-timeout");
      return (user && !user.isAnonymous) ? user : null;
    } catch {
      return null;
    }
  }

  async function registerEmail(nick, email, pass){
    if (!window.CloudflareAuth || typeof window.CloudflareAuth.registerEmail !== "function") throw new Error("cloudflare-auth-unavailable");
    return await withTimeout(window.CloudflareAuth.registerEmail({ nickname: nick, email: email, password: pass }), 12000, "auth-timeout");
  }

  async function sendReset(email){
    if (!window.CloudflareAuth || typeof window.CloudflareAuth.requestPasswordReset !== "function") throw new Error("cloudflare-auth-unavailable");
    await withTimeout(window.CloudflareAuth.requestPasswordReset(email), 12000, "auth-timeout");
  }



  var logoutInFlight = null;

  async function logoutAll(){
    if (logoutInFlight) return logoutInFlight;
    logoutInFlight = (async function(){
      let nextUser = null;
      let logoutCompleted = false;
      try {
        if (window.Online) {
          if (typeof Online._stopUnifiedAppPulse === "function") Online._stopUnifiedAppPulse();
          Online._presenceInited = false;
        }
      } catch (_) {}
      try {
        if (window.CloudflareAuth && typeof window.CloudflareAuth.signOut === "function") {
          nextUser = await window.CloudflareAuth.signOut();
          logoutCompleted = true;
        }
      } catch (err) {
        try {
          if (window.Online && typeof Online._ensureUnifiedAppPulse === "function") {
            Online._ensureUnifiedAppPulse("logout-failed-resume", true);
          }
        } catch (_) {}
        throw err;
      }
      if (nextUser && nextUser.uid) {
        try { syncSessionUidToAuth(nextUser.uid); } catch (_) {}
        return nextUser;
      }
      if (logoutCompleted) clearSession();
      return null;
    })();
    try {
      return await logoutInFlight;
    } finally {
      logoutInFlight = null;
    }
  }

  function errorCode(err) {
    return (err && (err.code || err.message)) ? String(err.code || err.message) : "";
  }

  function showShellNotice(msg, kind) {
    const title = kind === "ok"
      ? window.I18N.translateArgs("modals.successTitle")
      : window.I18N.translateArgs("modals.errorTitle");
    try {
      if (window.Modal && typeof window.Modal.alert === "function") {
        window.Modal.alert({ title, text: msg });
        return true;
      }
    } catch {}
    try {
      alert(msg);
      return true;
    } catch {}
    return false;
  }

  function showMsg(el, text, kind){
    if (!el) return;
    const msg = String(text || "");
    const isAuthMsg = el && el.id === "authMsg";
    if (isAuthMsg) {
      el.textContent = "";
      el.classList.remove("is-error","is-ok","is-show");
      if (msg) showShellNotice(msg, kind);
      return;
    }
    el.textContent = msg;
    el.classList.remove("is-error","is-ok","is-show");
    if (kind === "error") el.classList.add("is-error");
    if (kind === "ok") el.classList.add("is-ok");
    if (msg) el.classList.add("is-show");
  }

  function loginErrorKey(code) {
    return code.includes("timeout") ? "auth.msgNetwork" : "auth.msgInvalid";
  }

  function googleLoginErrorKey(code) {
    return code.includes("popup-blocked") || code.includes("popup_closed_by_user")
      ? "auth.msgPopupBlocked"
      : "auth.msgNetwork";
  }

  function resetErrorKey(code) {
    if (code.includes("auth/user-not-found")) return "auth.msgResetNoUser";
    if (code.includes("auth/invalid-email")) return "auth.msgResetInvalidEmail";
    if (code.includes("auth/too-many-requests")) return "auth.msgResetTooMany";
    if (code.includes("auth/operation-not-allowed")) return "auth.msgResetNotAllowed";
    if (code.includes("auth/unauthorized-continue-uri") || code.includes("auth/invalid-continue-uri")) return "auth.msgResetDomain";
    return "auth.msgNetwork";
  }

  function setView(root, name){
    qsa("[data-auth-view]", root).forEach(function(v){
      v.style.display = (v.getAttribute("data-auth-view") === name) ? "" : "none";
    });
    root.setAttribute("data-auth-current", name);
  }

  function applyLangToPage(lang){
    setDirFromLang(lang);
    try {
      if (window.ZShell && typeof window.ZShell.setLang === "function") {
        window.ZShell.setLang(lang);
      }
    } catch {}
  }


  async function initIndexPage(){
    const root = qs("#authRoot");
    if (!root) return;

    const langMount = qs("#authLangMount", root) || qs(".z-auth-lang", root);
    const langSel = mountDesktopLanguageSelect(langMount, "authLangSel");
    const lang = getSavedLang();
    if (langSel) langSel.value = lang;
    applyLangToPage(lang);

    bindDesktopLanguageSelect(langSel, getSavedLang, function(v){
      setSavedLang(v);
      applyLangToPage(v);
    });

    const msgEl = qs("#authMsg", root);
   

    async function ensureProfileForUser(user, preferredNick){
      try {
        if (!user || !user.uid || !initCloudflareAuth()) return { nickname: preferredNick || "", icon: DEFAULT_ICON };
        const uid = user.uid;
        let existing = null;
        try {
          if (window.DhametAccount && typeof window.DhametAccount.getProfile === "function") {
            const res = await withTimeout(window.DhametAccount.getProfile(uid), 12000, "account-profile-timeout");
            existing = res && res.profile ? res.profile : null;
          }
        } catch (_) {}

        const pickedNickRaw = preferredNick || (user.displayName ? normalizeNick(user.displayName) : "");
        const pickedNickCheck = pickedNickRaw ? validateNick(pickedNickRaw) : { ok:false };
        const fallbackNick = window.I18N.translateArgs("players.player") + " " + String(uid).slice(-4);
        const nicknameToUse = (existing && existing.nickname)
          ? String(existing.nickname)
          : (pickedNickCheck.ok ? pickedNickCheck.nick : fallbackNick);

        const iconToUse = sanitizeUserIconPath((existing && existing.icon) ? String(existing.icon) : DEFAULT_ICON);

        const patch = {
          lastActiveAt: nowMs(),
        };
        if (!(existing && existing.nickname)) patch.nickname = nicknameToUse;
        if (user.email) patch.email = user.email;
        if (iconToUse) patch.icon = iconToUse;
        if (!(existing && existing.createdAt)) patch.createdAt = nowMs();

        try {
          const officialPatch = {};
          if (patch.nickname) officialPatch.nickname = patch.nickname;
          if (patch.icon) officialPatch.icon = patch.icon;
          if (Object.keys(officialPatch).length) {
            await fetch("/dhamet/api/auth/update-profile", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(officialPatch) });
          }
        } catch (_) {}
        return { nickname: nicknameToUse, icon: sanitizeUserIconPath(iconToUse) };
      } catch {
        return { nickname: preferredNick || "", icon: DEFAULT_ICON };
      }
    }

    async function finalizeRegisteredSession(user, preferredNick){
      const info = await ensureProfileForUser(user, preferredNick);
      const s = {
        kind: "registered",
        uid: user.uid,
        email: user.email || "",
        nickname: info.nickname || preferredNick || "",
        icon: sanitizeUserIconPath(info.icon || DEFAULT_ICON),
        createdAt: nowMs(),
        lastActiveAt: nowMs()
      };
      writeSession(s);

      
      location.href = "pages/dashboard.html";
    }

    function go(view){
      setView(root, view);
      showMsg(msgEl, "", null);
      
    }

    
    
    try {
      consumeGoogleRedirectIfAny().then(function(user){
        if (!user || !user.uid) return;
        finalizeRegisteredSession(user).catch(function(){});
      });
    } catch (_) {}

    
    let session = readSession();
    if (session && isRegistered(session) && session.uid) {
      location.href = "pages/dashboard.html";
      return;
    } else {
      go("login");
      try {
        const sp = new URLSearchParams(location.search || "");
        if (sp.get("passwordReset") === "done") {
          showMsg(msgEl, "تم تحديث كلمة المرور. سجّل الدخول الآن بالكلمة الجديدة.", "ok");
          history.replaceState(null, "", location.pathname || "index.html");
        }
      } catch (_) {}
    }

    
    qsa("[data-go]", root).forEach(function(a){
      a.addEventListener("click", function(e){
        e.preventDefault();
        const v = a.getAttribute("data-go");
        go(v);
      });
    });

    
    const btnLogin = qs("#btnLogin", root);
    if (btnLogin) btnLogin.addEventListener("click", async function(){
      const email = String(qs("#loginEmail", root)?.value || "").trim();
      const pass  = String(qs("#loginPass", root)?.value || "");
      if (!email || !pass) {
        showMsg(msgEl, window.I18N.translateArgs("auth.msgInvalid"), "error");
        return;
      }
      btnLogin.disabled = true;
      try {
        const user = await loginEmail(email, pass);
        await finalizeRegisteredSession(user);
      } catch (e) {
        showMsg(msgEl, window.I18N.translateArgs(loginErrorKey(errorCode(e))), "error");
      } finally {
        btnLogin.disabled = false;
      }
    });

    
    const btnGuest = qs("#btnGuest", root);
    if (btnGuest) btnGuest.addEventListener("click", async function(){
      btnGuest.disabled = true;
      try {
        const user = await ensureAnonymousAuth();
        if (!user || !user.uid) throw new Error("guest-auth-failed");
        const s = {
          kind: "guest",
          uid: user.uid,
          authUid: user.uid,
          nickname: user.nickname || user.displayName || "",
          email: "",
          icon: sanitizeUserIconPath(user.icon || DEFAULT_ICON),
          createdAt: nowMs(),
          lastActiveAt: nowMs()
        };
        writeSession(s);
        location.href = "pages/mode.html";
      } catch (e) {
        showMsg(msgEl, window.I18N.translateArgs("auth.msgNetwork"), "error");
        btnGuest.disabled = false;
      }
    });

    
const btnLoginGoogle = qs("#btnLoginGoogle", root);
if (btnLoginGoogle) btnLoginGoogle.addEventListener("click", async function(){
  btnLoginGoogle.disabled = true;
  try {
    const user = await loginGoogle();
    
    if (!user) return;
    await finalizeRegisteredSession(user);
  } catch (e) {
    showMsg(msgEl, window.I18N.translateArgs(googleLoginErrorKey(errorCode(e))), "error");
  } finally {
    btnLoginGoogle.disabled = false;
  }
});

const btnRegister = qs("#btnRegister", root);
    if (btnRegister) btnRegister.addEventListener("click", async function(){
      const nick = String(qs("#regNick", root)?.value || "");
      const email = String(qs("#regEmail", root)?.value || "").trim();
      const pass  = String(qs("#regPass", root)?.value || "");
      const pass2 = String(qs("#regPass2", root)?.value || "");

      const nickCheck = validateNick(nick);
      if (!nickCheck.ok || !validateEmail(email) || !pass || pass.length < 6 || pass !== pass2) {
        showMsg(msgEl, window.I18N.translateArgs("auth.msgInvalid"), "error");
        return;
      }

      btnRegister.disabled = true;
      try {
        const user = await registerEmail(nickCheck.nick, email, pass);
        await finalizeRegisteredSession(user, nickCheck.nick);
      } catch (e) {
        showMsg(msgEl, window.I18N.translateArgs("auth.msgNetwork"), "error");
      } finally {
        btnRegister.disabled = false;
      }
    });

    
    const btnRecover = qs("#btnRecover", root);
    if (btnRecover) btnRecover.addEventListener("click", async function(){
      const email = String(qs("#recEmail", root)?.value || "").trim();
      if (!validateEmail(email)) {
        showMsg(msgEl, window.I18N.translateArgs("auth.msgInvalid"), "error");
        return;
      }
      btnRecover.disabled = true;
      try {
        await sendReset(email);
        showMsg(msgEl, window.I18N.translateArgs("auth.msgSent"), "ok");
      } catch (e) {
  showMsg(msgEl, window.I18N.translateArgs(resetErrorKey(errorCode(e))), "error");
} finally {
        btnRecover.disabled = false;
      }
    });
  }

  async function logoutAndRedirect(nextHref){
    await logoutAll();
    location.href = nextHref || "index.html";
  }

  async function confirmLogout(){
    var confirmLogout = true;
    try {
      if (window.Modal && typeof window.Modal.confirm === "function" && window.I18N) {
        confirmLogout = await window.Modal.confirm(
          window.I18N.text("dashboard.logoutConfirm.body"),
          window.I18N.text("dashboard.logoutConfirm.title"),
          window.I18N.text("topbar.logout"),
          window.I18N.text("actions.cancel")
        );
      } else {
        confirmLogout = window.confirm("هل تريد تسجيل الخروج؟");
      }
    } catch (_) {
      confirmLogout = window.confirm("هل تريد تسجيل الخروج؟");
    }
    return !!confirmLogout;
  }

  async function confirmLogoutAndRedirect(nextHref){
    if (!(await confirmLogout())) return false;
    await logoutAndRedirect(nextHref);
    return true;
  }

  function bindLogoutTrigger(button, nextHref, beforeLogout){
    if (!button || button._z_logout_bound) return;
    button._z_logout_bound = true;
    button.addEventListener("click", async function(e){
      try {
        if (typeof beforeLogout === "function") beforeLogout(e);
      } catch (_) {}
      try {
        await confirmLogoutAndRedirect(nextHref);
      } catch (err) {
        try {
          var msg = window.I18N && typeof window.I18N.translateArgs === "function"
            ? window.I18N.translateArgs("auth.logoutFailed", "تعذر تسجيل الخروج. تحقق من الاتصال ثم حاول مرة أخرى.")
            : "تعذر تسجيل الخروج. تحقق من الاتصال ثم حاول مرة أخرى.";
          if (window.Modal && typeof window.Modal.alert === "function") window.Modal.alert(msg);
          else window.alert(msg);
        } catch (_) {}
      }
    });
  }

  window.ZAuth = {
    readSession, writeSession, clearSession, initCloudflareAuth,
    ensureAnonymousAuth,
    isRegistered, isGuest,
    logout: logoutAll,
    logoutAndRedirect,
    confirmLogout,
    confirmLogoutAndRedirect,
    bindLogoutTrigger,
    initIndexPage
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { if (qs("#authRoot")) initIndexPage(); });
  else if (qs("#authRoot")) initIndexPage();
})();



(function(){
  function __z_init_pages_shell(){
    (function () {
      "use strict";
    
      var Common = window.ZCommon || {};
      var qs = typeof Common.qs === "function" ? Common.qs : function (sel, root) { return (root || document).querySelector(sel); };
      var qsa = typeof Common.qsa === "function" ? Common.qsa : function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };
      function getAuthApi() {
        return (window.ZAuth && typeof window.ZAuth === "object") ? window.ZAuth : null;
      }
      function safeJSONParse(s) {
        try { return JSON.parse(s); } catch (_) { return null; }
      }
    
      function pathLower() { return String(location.pathname || "").toLowerCase(); }
      function isInfoPage() { return pathLower().includes("/pages/"); }
    
      function isGamePage() {
        var p = pathLower();
        if (p.endsWith("/pages/game.html") || p.endsWith("/game.html") || p.endsWith("/pages/game") || p.endsWith("/game")) return true;
        try { return !!(document.body && document.body.classList && document.body.classList.contains("z-game-page")); } catch (_) { return false; }
      }
    
    
      function getBaseHref() { return isInfoPage() ? ".." : "."; }
    
      function isLoginPage() {
        var p = pathLower();
        return (p.endsWith("/index.html") || p === "/" || p.endsWith("/"));
      }
    
      var SESSION_KEY = "zamat.session.user.v1";
      var PERSIST_KEY = "zamat.session.user.persist.v1";
    
      function readSessionAny() {
        var auth = getAuthApi();
        if (auth && typeof auth.readSession === "function") {
          try {
            var current = auth.readSession();
            if (current && typeof current === "object") return current;
          } catch (_) {}
        }
        var raw = null;
        try { raw = sessionStorage.getItem(SESSION_KEY); } catch (_) {}
        if (!raw) {
          try { raw = localStorage.getItem(PERSIST_KEY); } catch (_) {}
        }
        var obj = raw ? safeJSONParse(raw) : null;
        return obj && typeof obj === "object" ? obj : null;
      }
    
      function isRegisteredSession(session) {
        var auth = getAuthApi();
        if (auth && typeof auth.isRegistered === "function") {
          try { return !!auth.isRegistered(session); } catch (_) {}
        }
        return !!(session && session.uid && session.kind === "registered");
      }

      function hasSession() {
        var obj = readSessionAny();
        return isRegisteredSession(obj);
      }

      function bindAccountLogout(button, nextHref, beforeLogout) {
        var auth = getAuthApi();
        if (!auth || typeof auth.bindLogoutTrigger !== "function") {
          throw new Error("ZAuth.bindLogoutTrigger is unavailable");
        }
        auth.bindLogoutTrigger(button, nextHref, beforeLogout);
      }
    
      var HOME_FIXED_DIR = null;
    
      var AppPref = {
        getLang: function () {
          try {
            var url = new URL(location.href);
            var q = url.searchParams.get("lang");
            if (q) return q;
          } catch (_) {}
          try { return localStorage.getItem("zamat.lang") || "ar"; } catch (_) {}
          return "ar";
        },
        setLang: function (lang) {
          try { localStorage.setItem("zamat.lang", lang); } catch (_) {}
        },
        getTheme: function () {
          return readStoredTheme();
        }
      };
    
      function applyTheme() {
        try { document.documentElement.classList.toggle("dark", AppPref.getTheme() === "dark"); } catch (_) {}
      }
    
      function setTopbarDirAndLang(lang) {
        var dir = (lang === "ar") ? "rtl" : "ltr";
        var tb = qs(".z-topbar");
        if (tb) {
          tb.setAttribute("dir", dir);
          tb.setAttribute("lang", lang);
        }
      }
    
      
      
      
      function applyShellLanguage(lang) {
        if (!lang) lang = "ar";
        var dir = (lang === "ar") ? "rtl" : "ltr";
    
        document.documentElement.lang = lang;
    
        if (isInfoPage()) {
          document.documentElement.dir = dir;
        } else if (HOME_FIXED_DIR) {
          document.documentElement.dir = HOME_FIXED_DIR;
        }
    
        document.documentElement.classList.remove("lang-ar", "lang-en", "lang-fr");
        document.documentElement.classList.add("lang-" + lang);
    
        setTopbarDirAndLang(lang);
        try { if (window.Modal && typeof window.Modal.setDir === "function") window.Modal.setDir(); } catch (_) {}
    
        try {
          if (window.I18N && typeof window.I18N.apply === "function") {
            window.I18N.apply(document, lang);
            if (!isInfoPage() && HOME_FIXED_DIR) {
              try { document.documentElement.dir = HOME_FIXED_DIR; } catch (_) {}
            }
          }
        } catch (_) {}
    
        syncFooterText(document);
        syncCompanyPublicLinks(document, lang);
        ensureMobileNavToggle(qs(".z-topbar"), lang);
      }

      function _navMarkInternal() {
        try { sessionStorage.setItem("zamat.internalNavTs", String(Date.now())); } catch (_) {}
      }

      function _navGetActiveGameId() {
        try { return String(sessionStorage.getItem("zamat.activeGameId") || "").trim(); } catch (_) { return ""; }
      }

      function _navBindGuards(topbarEl, base) {
        if (!topbarEl) return;

        function goToGame() {
          try { location.href = base + "/pages/game.html"; } catch (_) {}
        }

        function shouldResume() {
          return !!_navGetActiveGameId();
        }

        try {
          topbarEl.addEventListener("click", function (e) {
            var a = e && e.target && e.target.closest ? e.target.closest("a") : null;
            if (!a) return;

            var href = String(a.getAttribute("href") || "");
            if (!href) return;

            
            if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return;
            if (a.target && a.target !== "" && a.target !== "_self") return;

            
            _navMarkInternal();

            
var cls = a.classList;
var isHome = !!(cls && (cls.contains("z-nav-home") || cls.contains("z-nav-home-title")));
if (isHome && shouldResume()) {
  e.preventDefault();
  e.stopPropagation();
  goToGame();
  return;
}

          }, true);
        } catch (_) {}

        
        try {
          if (document && !document._z_internalNavBound) {
            document._z_internalNavBound = true;
            document.addEventListener("click", function (e) {
              var a = e && e.target && e.target.closest ? e.target.closest("a") : null;
              if (!a) return;
              var href = String(a.getAttribute("href") || "");
              if (!href) return;
              if (href[0] === "#") return;
              if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return;
              if (a.target && a.target !== "" && a.target !== "_self") return;
              _navMarkInternal();
            }, true);
          }
        } catch (_) {}
      }


    
      



      function normalizePublicLang(lang) {
        lang = String(lang || "").toLowerCase();
        if (lang.indexOf("fr") === 0) return "fr";
        if (lang.indexOf("en") === 0) return "en";
        return "ar";
      }

      function getCompanyPublicUrl(kind, lang) {
        var l = normalizePublicLang(lang || AppPref.getLang());
        var legalBase = "https://ouglsoft.com/legal/dhamet";
        if (l === "ar") legalBase += "/ar";
        else if (l === "fr") legalBase += "/fr";

        if (kind === "rules") return legalBase + "/rules.html";
        if (kind === "privacy") return legalBase + "/privacy-policy.html";
        if (kind === "terms") return legalBase + "/terms-of-use.html";
        if (kind === "contact") {
          if (l === "ar") return "https://ouglsoft.com/ar/pages/contact.html";
          if (l === "fr") return "https://ouglsoft.com/fr/pages/contact.html";
          return "https://ouglsoft.com/pages/contact.html";
        }
        return "https://ouglsoft.com";
      }

      function getPublicLinks(base) {
        base = base || getBaseHref();
        var lang = AppPref.getLang();
        return [
          { href: getCompanyPublicUrl("terms", lang), key: 'pages.nav.terms', shortKey: 'pages.navShort.terms', external: true, legalKind: 'terms' },
          { href: getCompanyPublicUrl("privacy", lang), key: 'pages.nav.privacy', shortKey: 'pages.navShort.privacy', external: true, legalKind: 'privacy' },
          { href: getCompanyPublicUrl("rules", lang), key: 'pages.nav.rules', shortKey: 'pages.nav.rules', external: true, legalKind: 'rules' },
          { href: getCompanyPublicUrl("contact", lang), key: 'pages.nav.contact', shortKey: 'pages.navShort.contact', external: true, legalKind: 'contact' }
        ];
      }

      function syncCompanyPublicLinks(root, lang) {
        var scope = root || document;
        var useLang = normalizePublicLang(lang || AppPref.getLang());
        qsa('[data-ouglsoft-link]', scope).forEach(function (a) {
          var kind = String(a.getAttribute('data-ouglsoft-link') || '').trim();
          if (!kind) return;
          a.href = getCompanyPublicUrl(kind, useLang);
        });
      }

      function getFooterText() {
        var year = new Date().getFullYear();
        if (window.I18N && typeof window.I18N.text === 'function') return window.I18N.text('pages.footer.text', { year: year });
        return '© ' + year + ' El Ougl Software SARL';
      }

      function syncFooterText(root) {
        qsa('.z-footer', root || document).forEach(function (el) {
          el.textContent = getFooterText();
        });
      }

      function getModePageHref(base) {
        return (base || getBaseHref()) + '/pages/mode.html';
      }

      function goToMode(base) {
        location.href = getModePageHref(base);
      }

      function bindStartPlayTrigger(el, base) {
        if (!el) return el;
        var href = getModePageHref(base);
        if (String(el.tagName || '').toLowerCase() === 'a') {
          el.href = href;
          return el;
        }
        if (!el._z_start_play_bound) {
          el._z_start_play_bound = true;
          el.addEventListener('click', function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            goToMode(base);
          });
        }
        return el;
      }

      function createStartPlayButton(base) {
        var hrefBase = base || getBaseHref();
        var link = document.createElement("a");
        link.className = "btn primary z-start-play-btn";
        link.href = getModePageHref(hrefBase);
        var span = document.createElement("span");
        span.setAttribute("data-i18n", "pages.cta.playNow");
        span.textContent = window.I18N && typeof window.I18N.text === "function"
          ? window.I18N.text("pages.cta.playNow")
          : "ابدأ اللعب الآن";
        link.appendChild(span);
        return bindStartPlayTrigger(link, hrefBase);
      }

function buildTopbar() {
        var base = getBaseHref();
        var wrap = document.createElement("header");
        wrap.className = "z-topbar";
        wrap.innerHTML =
          '<div class="z-topbar-inner">' +
            '<div class="z-topbar-nav">' +
              '<button class="z-nav-toggle" type="button" data-i18n-aria-label="aria.menu" aria-expanded="false">' +
                '<span class="z-hamburger" aria-hidden="true"><span></span></span>' +
              '</button>' +
              '<nav class="z-nav" data-i18n-aria-label="aria.primaryNav">' +
                '<a class="z-nav-home" href="https://ouglsoft.com/" data-i18n="buttons.home"></a>' +
                getPublicLinks(base).map(function (item) {
                  var attrs = item.external ? ' data-ouglsoft-link="' + item.legalKind + '"' : '';
                  return '<a href="' + item.href + '"' + attrs + ' data-i18n="' + item.key + '"></a>';
                }).join('') +
              '</nav>' +
            '</div>' +
            '<div class="z-topbar-title">' +
              '<a class="z-topbar-title-link z-nav-home-title" href="' + base + '/pages/mode.html" data-i18n="game.title"></a>' +
            '</div>' +
            '<div class="z-topbar-right">' +
              '<div class="z-topbar-lang" id="zTopbarLangMount"></div>' +
              '<div class="z-topbar-account" id="zAccountArea"></div>' +
            '</div>' +
          '</div>';

        var langMount = qs("#zTopbarLangMount", wrap);
        mountDesktopLanguageSelect(langMount, "zLangSel");
    
        var p = pathLower();
        qsa("a", wrap).forEach(function (a) {
          var href = String(a.getAttribute("href") || "").toLowerCase();
          var isActive =
            (p.endsWith("/index.html") && href.endsWith("/index.html"));
          if (isActive) a.classList.add("active");
        });
    
        try { _navBindGuards(wrap, base); } catch (_) {}

        return wrap;
      }
    
      function buildFooter() {
        var wrap = document.createElement("div");
        wrap.className = "z-footer-wrap";
        var footer = document.createElement("footer");
        footer.className = "z-footer";
        footer.setAttribute("role", "contentinfo");
        footer.textContent = getFooterText();
        wrap.appendChild(footer);
        return wrap;
      }
    
      


      function ensureMobileNavToggle(topbarEl, lang) {
        if (!topbarEl) return;
    
        var btn = qs(".z-nav-toggle", topbarEl);
        var nav = qs(".z-nav", topbarEl);
        if (!btn || !nav) return;
    
        function setLabel(l) {
          try { btn.setAttribute("aria-label", window.I18N.translateArgs("aria.menu")); } catch (_) {}
        }
    
        setLabel(lang || AppPref.getLang());
    
        if (btn._z_bound) return;
        btn._z_bound = true;
    
        function close() {
          topbarEl.classList.remove("is-nav-open");
          try { btn.setAttribute("aria-expanded", "false"); } catch (_) {}
        }
    
        function toggle() {
          var open = !topbarEl.classList.contains("is-nav-open");
          if (open) topbarEl.classList.add("is-nav-open");
          else topbarEl.classList.remove("is-nav-open");
          try { btn.setAttribute("aria-expanded", open ? "true" : "false"); } catch (_) {}
        }
    
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        });
    
        qsa("a", nav).forEach(function (a) {
          a.addEventListener("click", function () { close(); });
        });
    
        document.addEventListener("click", function (e) {
          if (!topbarEl.contains(e.target)) close();
        });
    
        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape") close();
        });
      }
    
      


      function wrapGameApplyLanguageIfNeeded() {
        if (isInfoPage()) return;
        if (typeof window.applyLanguage !== "function") return;
        if (window.applyLanguage._z_wrapped) return;
    
        var original = window.applyLanguage;
    
        function wrapped(lang) {
          try { AppPref.setLang(lang); } catch (_) {}
          try { original(lang); } catch (_) {}
    
          if (HOME_FIXED_DIR) {
            try { document.documentElement.dir = HOME_FIXED_DIR; } catch (_) {}
          }
    
          try { applyShellLanguage(lang); } catch (_) {}
        }
    
        wrapped._z_wrapped = true;
        wrapped._z_original = original;
        window.applyLanguage = wrapped;
      }

      function applyCurrentShellLanguage(lang) {
        var next = lang;
        if (next == null) {
          try { next = (AppPref && typeof AppPref.getLang === "function") ? AppPref.getLang() : "ar"; } catch (_) { next = "ar"; }
        }
        try {
          if (typeof window.applyLanguage === "function") {
            window.applyLanguage(next);
          } else {
            applyShellLanguage(next);
          }
        } catch (_) {}
      }
    
      


      
      function updateAccountArea() {
        var area = qs("#zAccountArea");
        if (!area) return;
    
        var loggedIn = hasSession();
        var base = getBaseHref();
    
        if (!loggedIn) {
          if (isLoginPage()) {
            area.innerHTML = "";
            applyCurrentShellLanguage();
            return;
          }
          area.innerHTML =
            '<div class="z-acc-desktop">' +
              '<a class="btn small secondary z-acc-btn" href="' + base + '/index.html" data-i18n="topbar.login"></a>' +
            '</div>';
          applyCurrentShellLanguage();
          return;
        }
    
        
        
        area.innerHTML =
          '<div class="z-acc-desktop">' +
            '<button type="button" class="btn small secondary z-acc-menu-btn" id="zAccMenuBtn" aria-expanded="false" data-i18n-title="topbar.account">' +
              '<span class="z-acc-ico" aria-hidden="true"><img class="z-ico" src="' + base + '/assets/icons/dashboard.svg" alt="" aria-hidden="true" /></span>' +
              '<span class="z-acc-text" data-i18n="topbar.account"></span>' +
            '</button>' +
          '</div>' +
          '<div class="z-acc-menu" id="zAccMenu" hidden>' +
            '<a class="z-acc-item" href="' + base + '/pages/dashboard.html" data-i18n="topbar.account"></a>' +
            '<button type="button" class="z-acc-item danger" id="zAccLogout" data-i18n="topbar.logout"></button>' +
          '</div>';
        var btn = qs("#zAccMenuBtn");
        var menu = qs("#zAccMenu");
        var logout = qs("#zAccLogout");
    
        function closeMenu(){
          if (!menu) return;
          menu.hidden = true;
          if (btn) btn.setAttribute("aria-expanded","false");
        }
        function toggleMenu(){
          if (!menu) return;
          var open = !!menu.hidden;
          menu.hidden = !open;
          if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
        }
    
        if (btn && !btn._z_bound) {
          btn._z_bound = true;
          btn.addEventListener("click", function(e){
            e.preventDefault();
            toggleMenu();
          });
          document.addEventListener("click", function(e){
            if (!area.contains(e.target)) closeMenu();
          });
        }
        if (logout) bindAccountLogout(logout, base + "/index.html", closeMenu);
    
        applyCurrentShellLanguage();
      }
    
      function ensureShell() {
        applyTheme();
    
        if (document.body && !document.body.classList.contains("z-page-body")) {
          document.body.classList.add("z-page-body");
        }
    
        
        try {
          if (isGamePage()) document.body.classList.add("z-game-page");
          else document.body.classList.remove("z-game-page");
        } catch (_) {}
    
        var hideTopbar = false;
    
        if (!hideTopbar) {
          document.body.classList.add("z-has-topbar");
        } else {
          document.body.classList.remove("z-has-topbar");
        }
        document.body.classList.add(isInfoPage() ? "z-info-page" : "z-home-page");
    
        if (!hideTopbar) {
          if (!qs(".z-topbar")) {
            document.body.insertBefore(buildTopbar(), document.body.firstChild);
          }
          updateAccountArea();
        } else {
          
          var ex = qs(".z-topbar");
          if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
        }
    
        if (!isInfoPage() && !HOME_FIXED_DIR) {
          HOME_FIXED_DIR = document.documentElement.getAttribute("dir") || "rtl";
        }
    
        if (isInfoPage() && !isGamePage() && !qs(".z-footer-wrap")) {
          document.body.appendChild(buildFooter());
        }
    
        
        if (isGamePage()) {
          try {
            qsa(".z-footer-wrap").forEach(function (el) {
              if (el && el.parentNode) el.parentNode.removeChild(el);
            });
          } catch (_) {}
        }
    
        wrapGameApplyLanguageIfNeeded();
    
        var lang = AppPref.getLang();
    
        applyShellLanguage(lang);
    
        var langSel = qs("#zLangSel");

        function setLang(v){
          v = v || "ar";
          AppPref.setLang(v);

          if (langSel && langSel.value !== v) langSel.value = v;
          applyCurrentShellLanguage(v);
        }

        bindDesktopLanguageSelect(langSel, function(){
          return AppPref.getLang();
        }, function(v){
          setLang(v);
        });
      }
    
    
      
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureShell);
      } else {
        ensureShell();
      }
    
      
      window.ZShell = window.ZShell || {};
      window.ZShell.getLang = function () {
        try { return (AppPref && typeof AppPref.getLang === "function") ? AppPref.getLang() : "ar"; } catch (_) { return "ar"; }
      };
      window.ZShell.getPublicLinks = function (base) {
        return getPublicLinks(base);
      };
      window.ZShell.getCompanyPublicUrl = function (kind, lang) {
        return getCompanyPublicUrl(kind, lang);
      };
      window.ZShell.syncCompanyPublicLinks = function (root, lang) {
        return syncCompanyPublicLinks(root, lang);
      };
      window.ZShell.getFooterText = function () {
        return getFooterText();
      };
      window.ZShell.getModePageHref = function (base) {
        return getModePageHref(base);
      };
      window.ZShell.goToMode = function (base) {
        goToMode(base);
      };
      window.ZShell.bindStartPlayTrigger = function (el, base) {
        return bindStartPlayTrigger(el, base);
      };
      window.ZShell.createStartPlayButton = function (base) {
        return createStartPlayButton(base);
      };
      window.ZShell.setLang = function (lang) {
        try { AppPref.setLang(lang); } catch (_) {}
        applyCurrentShellLanguage(lang);
      };
    })();

  }
  __z_init_pages_shell();
})();

})();
