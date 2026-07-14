(function () {
  var Common = window.ZCommon || {};
  var qs = typeof Common.qs === "function" ? Common.qs : function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var qsa = typeof Common.qsa === "function" ? Common.qsa : function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };


  async function updateOfficialProfilePatch(patch) {
    if (window.CloudflareAuth && typeof window.CloudflareAuth.updateProfile === "function") {
      return await window.CloudflareAuth.updateProfile(patch || {});
    }
    var res = await fetch('/dhamet/api/auth/update-profile', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch || {}),
    });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || (data && data.ok === false)) {
      var err = new Error((data && data.error) || ('http-' + res.status));
      err.code = (data && data.error) || ('http-' + res.status);
      throw err;
    }
    return data || {};
  }

  function showDashboardResult(text, kind, opts) {
    var msg = String(text || "").trim();
    if (!msg) return;
    var cfg = opts && typeof opts === "object" ? opts : {};
    var titleKey = kind === "ok" ? "modals.notice" : "modals.errorTitle";
    if (Modal.isOpen()) Modal.close();
    setTimeout(function () {
      Modal.alert({
        title: window.I18N.text(titleKey),
        text: msg,
        okLabel: window.I18N.text("actions.ok"),
        okClassName: kind === "ok" ? "primary" : "danger",
        onClose: cfg.onClose,
      });
    }, 0);
  }

  function getAllowedIcons() {
    if (typeof Common.getAllowedUserIcons === "function") return Common.getAllowedUserIcons();
    var fb = [];
    [1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,20].forEach(function(i){ fb.push("assets/icons/users/user" + i + ".png"); });
    fb.push("assets/icons/users/autouser1.png");
    fb.push("assets/icons/users/autouser2.png");
    fb.push("assets/icons/users/computeruser.png");
    return fb;
  }

  function sanitizeIconPath(p) {
    if (typeof Common.sanitizeUserIconPath === "function") return Common.sanitizeUserIconPath(p);
    return "assets/icons/users/user1.png";
  }

  function pageIconPath(p) {
    var rel = sanitizeIconPath(p);
    return typeof Common.pageAssetUrl === "function" ? Common.pageAssetUrl(rel) : rel;
  }

  function initCloudflareAuth() {
    return !!(window.CloudflareAuth && typeof window.CloudflareAuth.ready === "function");
  }

  function getCurrentRegisteredUser() {
    initCloudflareAuth();
    var user = null;
    try {
      if (window.CloudflareAuth && typeof window.CloudflareAuth.currentUser === "function") user = window.CloudflareAuth.currentUser();
    } catch (_) {}
    if (!user || user.isAnonymous) {
      location.href = "../index.html";
      return null;
    }
    return user;
  }

  function getProviderIds(user) {
    return ((user && user.providerData) || [])
      .map(function (p) { return p && p.providerId; })
      .filter(Boolean);
  }

  function errorCode(err) {
    return err && (err.code || err.message) ? String(err.code || err.message) : "";
  }

  function showDashboardResultKey(key, kind, opts) {
    showDashboardResult(window.I18N.text(key), kind, opts);
  }

  function keyForCode(code, entries, fallbackKey) {
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      if (code.indexOf(entry[0]) >= 0) return entry[1];
    }
    return fallbackKey;
  }

  function stopRefreshTimer() {
    if (_dashRefreshTimer) {
      clearInterval(_dashRefreshTimer);
      _dashRefreshTimer = null;
    }
    _detachProfileListener();
  }

  function restartRefreshTimer(uid) {
    if (!uid) return;
    load(uid);
  }

  let _allUserIconsPromise = null;

  function _iconNumber(path) {
    const m = String(path || "").match(/user(\d+)\.png$/i);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  }

  async function discoverAllUserIcons() {
    if (_allUserIconsPromise) return _allUserIconsPromise;
    _allUserIconsPromise = Promise.resolve(
      getAllowedIcons()
        .filter(function (p) {
          return /^assets\/icons\/users\/user\d+\.png$/i.test(String(p || ""));
        })
        .sort(function (a, b) {
          return _iconNumber(a) - _iconNumber(b);
        }),
    );
    return _allUserIconsPromise;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  let _dashRefreshTimer = null;
  let _dashDeleting = false;

  function fmt(v) {
    const n = num(v);
    if (n == null) return "—";
    return String(n);
  }

  function setProfile(profile, session) {
    var src = (profile && profile.icon) || (session && session.icon) || '';
    var nick = (profile && profile.nickname) || (session && session.nickname) || '—';
    var img = qs('#dashProfileIcon');
    var name = qs('#dashProfileName');
    if (img) img.src = pageIconPath(src);
    if (name) name.textContent = String(nick || '—');
  }

  function ensureRegisteredSession() {
    const s = window.ZAuth && ZAuth.readSession ? ZAuth.readSession() : null;
    if (!s || s.kind !== "registered" || !s.uid) return null;
    return s;
  }

  function setStat(name, value) {
    var out = String(value == null ? "—" : value);
    qsa('#' + name + ', [data-stat="' + name + '"]').forEach(function (el) {
      el.textContent = out;
    });
  }

  function statValue(obj, keys, fallback) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (let i = 0; i < list.length; i += 1) {
      const n = num(obj && obj[list[i]]);
      if (n != null) return n;
    }
    return fallback != null ? fallback : null;
  }

  function normalizeStats(stats) {
    const s = stats || {};

    const humW = statValue(s, ["vsHumansWins"], 0) || 0;
    const humD = statValue(s, ["vsHumansDraws"], 0) || 0;
    const humL = statValue(s, ["vsHumansLosses"], 0) || 0;
    const cpuW = statValue(s, ["vsComputerWins"], 0) || 0;
    const cpuD = statValue(s, ["vsComputerDraws"], 0) || 0;
    const cpuL = statValue(s, ["vsComputerLosses"], 0) || 0;

    const humT = statValue(s, ["vsHumansGames"], humW + humD + humL) || 0;
    const cpuT = statValue(s, ["vsComputerGames"], cpuW + cpuD + cpuL) || 0;

    const allW = statValue(s, ["wins"], humW + cpuW) || 0;
    const allD = statValue(s, ["draws"], humD + cpuD) || 0;
    const allL = statValue(s, ["losses"], humL + cpuL) || 0;
    const allT = statValue(s, ["totalGames", "played"], humT + cpuT) || 0;
    const points = statValue(s, ["points"], 0) || 0;
    const rank = statValue(s, ["globalRank", "rank"], null);

    return {
      total: allT,
      points: points,
      rank: rank,
      humW: humW,
      humD: humD,
      humL: humL,
      humT: humT,
      cpuW: cpuW,
      cpuD: cpuD,
      cpuL: cpuL,
      cpuT: cpuT,
      allW: allW,
      allD: allD,
      allL: allL,
      allT: allT,
    };
  }

  function updateTable(stats) {
    const s = normalizeStats(stats);

    setStat("statTotalGames", fmt(s.total));
    setStat("statPoints", fmt(s.points));
    setStat("statRank", fmt(s.rank));

    setStat("statHumWins", fmt(s.humW));
    setStat("statHumDraws", fmt(s.humD));
    setStat("statHumLosses", fmt(s.humL));
    setStat("statHumTotal", fmt(s.humT));

    setStat("statCpuWins", fmt(s.cpuW));
    setStat("statCpuDraws", fmt(s.cpuD));
    setStat("statCpuLosses", fmt(s.cpuL));
    setStat("statCpuTotal", fmt(s.cpuT));

    setStat("statAllWins", fmt(s.allW));
    setStat("statAllDraws", fmt(s.allD));
    setStat("statAllLosses", fmt(s.allL));
    setStat("statAllTotal", fmt(s.allT));
  }

  async function load(uid) {
    if (_dashDeleting || !uid) return;
    try {
      if (window.ZAuth && typeof ZAuth.initCloudflareAuth === "function") ZAuth.initCloudflareAuth();
      const session = ensureRegisteredSession() || {};
      let profile = {};
      if (window.DhametAccount && typeof window.DhametAccount.getProfile === "function") {
        const res = await window.DhametAccount.getProfile(uid);
        profile = res && res.profile ? res.profile : {};
      }
      const stats = profile && profile.stats ? profile.stats : {};
      setProfile(profile || {}, session || {});
      updateTable(stats || {});
    } catch (e) {
      showDashboardResultKey("auth.msgNetwork", "error");
    }
  }


  function createFormBody(className) {
    const body = document.createElement("div");
    body.className = className || "z-form";
    return body;
  }

  function createFormRow(labelText, input) {
    const row = document.createElement("div");
    row.className = "z-form-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  function createInput(config) {
    const cfg = config || {};
    const input = document.createElement("input");
    input.type = cfg.type || "text";
    if (cfg.id) input.id = cfg.id;
    if (cfg.value != null) input.value = cfg.value;
    if (cfg.maxLength != null) input.maxLength = cfg.maxLength;
    if (cfg.placeholder != null) input.placeholder = cfg.placeholder;
    return input;
  }

  function openDashboardFormModal(config) {
    const cfg = config || {};
    Modal.form({
      title: cfg.title,
      body: cfg.body,
      focusSelector: cfg.focusSelector,
      modalClassName: cfg.modalClassName,
      submitLabel: cfg.submitLabel || window.I18N.text("auth.save"),
      submitClassName: cfg.submitClassName || "primary",
      cancelLabel: cfg.cancelLabel || window.I18N.text("actions.cancel"),
      cancelClassName: cfg.cancelClassName || "ghost",
      onSubmit: cfg.onSubmit,
      onCancel: cfg.onCancel,
    });
  }

  function openEditNickname(session) {
    const inp = createInput({ id: "dashNickInput", value: session.nickname || "", maxLength: 18 });
    const body = createFormBody();
    body.appendChild(createFormRow(window.I18N.text("auth.nickname"), inp));

    openDashboardFormModal({
      title: window.I18N.text("dashboard.editNick"),
      body: body,
      focusSelector: "#dashNickInput",
      onSubmit: async function () {
        const v = String(inp.value || "").trim();
        if (v.length < 2 || v.length > 18) {
          showDashboardResultKey("auth.msgInvalid", "error");
          return;
        }
        try {
          await updateOfficialProfilePatch({ nickname: v });
          const next = Object.assign({}, session, { nickname: v, lastActiveAt: Date.now() });
          ZAuth.writeSession(next);
          setProfile({ nickname: v }, next);
          showDashboardResultKey("auth.msgSaved", "ok");
        } catch (e) {
          showDashboardResultKey("auth.msgNetwork", "error");
        }
      },
    });
  }

  async function reauthPasswordProvider(user, currentPassword) {
    const email = user.email || "";
    if (!window.CloudflareAuth || typeof window.CloudflareAuth.reauthenticatePassword !== "function") throw new Error("cloudflare-auth-unavailable");
    await window.CloudflareAuth.reauthenticatePassword(String(currentPassword || ""), email);
  }

  async function reauthGoogleProvider() {
    if (!window.CloudflareAuth || typeof window.CloudflareAuth.reauthenticateGoogle !== "function") throw new Error("cloudflare-auth-unavailable");
    await window.CloudflareAuth.reauthenticateGoogle();
  }

  function openEditEmail(session) {
    const user = getCurrentRegisteredUser();
    if (!user) return;
    const providerIds = getProviderIds(user);
    const usesPasswordProvider = providerIds.includes("password");
    const usesGoogleProvider = providerIds.includes("google.com");
    const currentEmail = String((user && user.email) || session.email || "").trim();

    const inpEmail = createInput({ type: "email", id: "dashEmailInput", value: currentEmail });
    const inpPass = createInput({ type: "password", id: "dashCurPass", placeholder: "••••••••" });
    const body = createFormBody();
    body.appendChild(createFormRow(window.I18N.text("auth.email"), inpEmail));
    if (usesPasswordProvider) {
      body.appendChild(createFormRow(window.I18N.text("auth.password"), inpPass));
    }

    openDashboardFormModal({
      title: window.I18N.text("dashboard.editEmail"),
      body: body,
      focusSelector: "#dashEmailInput",
      onSubmit: async function () {
        const nextEmail = String(inpEmail.value || "").trim();
        if (!nextEmail || !nextEmail.includes("@")) {
          showDashboardResultKey("auth.msgInvalid", "error");
          return;
        }
        try {
          let liveUser = getCurrentRegisteredUser();
          if (!liveUser) return;

          if (usesPasswordProvider) {
            await reauthPasswordProvider(liveUser, inpPass.value || "");
          } else if (usesGoogleProvider) {
            await reauthGoogleProvider(liveUser);
          }

          if (window.CloudflareAuth && typeof window.CloudflareAuth.updateEmail === "function") {
            await window.CloudflareAuth.updateEmail(nextEmail);
            liveUser = window.CloudflareAuth.currentUser ? window.CloudflareAuth.currentUser() || liveUser : liveUser;
          } else {
            await liveUser.updateEmail(nextEmail);
          }

          const syncedEmail = String((liveUser && liveUser.email) || nextEmail || "").trim();
          const next = Object.assign({}, session, {
            email: syncedEmail,
            lastActiveAt: Date.now(),
          });
          ZAuth.writeSession(next);
          setProfile({}, next);
          showDashboardResultKey("auth.msgSaved", "ok");
        } catch (e) {
          showDashboardResultKey(keyForCode(errorCode(e), [
            ["auth/wrong-password", "auth.msgInvalid"],
            ["auth/invalid-credential", "auth.msgInvalid"],
            ["auth/popup-blocked", "auth.msgPopupBlocked"],
            ["auth/popup-closed-by-user", "auth.msgPopupBlocked"],
            ["auth/requires-recent-login", "dashboard.password.recentLogin"],
          ], "auth.msgNetwork"), "error");
        }
      },
    });
  }

  function openEditPassword() {
    const p1 = createInput({ type: "password", id: "dashOldPass", placeholder: "••••••••" });
    const p2 = createInput({ type: "password", id: "dashNewPass", placeholder: "••••••••" });
    const p3 = createInput({ type: "password", id: "dashNewPass2", placeholder: "••••••••" });
    const body = createFormBody();
    body.appendChild(createFormRow(window.I18N.text("dashboard.password.currentLabel"), p1));
    body.appendChild(createFormRow(window.I18N.text("dashboard.password.newLabel"), p2));
    body.appendChild(createFormRow(window.I18N.text("auth.password2"), p3));

    openDashboardFormModal({
      title: window.I18N.text("dashboard.editPass"),
      body: body,
      focusSelector: "#dashOldPass",
      onSubmit: async function () {
        const oldP = String(p1.value || "");
        const newP = String(p2.value || "");
        const newP2 = String(p3.value || "");
        if (newP.length < 6 || newP !== newP2) {
          showDashboardResultKey("auth.msgInvalid", "error");
          return;
        }
        try {
          const user = getCurrentRegisteredUser();
          if (!user) return;

          const providerIds = getProviderIds(user);
          if (!providerIds.includes("password")) {
            showDashboardResultKey("dashboard.password.googleNotSupported", "error");
            return;
          }

          await reauthPasswordProvider(user, oldP);
          if (window.CloudflareAuth && typeof window.CloudflareAuth.updatePassword === "function") await window.CloudflareAuth.updatePassword(newP);
          else await user.updatePassword(newP);
          showDashboardResultKey("auth.msgSaved", "ok");
        } catch (e) {
          showDashboardResultKey(keyForCode(errorCode(e), [
            ["auth/wrong-password", "dashboard.password.oldWrong"],
            ["auth/invalid-credential", "dashboard.password.oldWrong"],
            ["auth/weak-password", "dashboard.password.weak"],
            ["auth/requires-recent-login", "dashboard.password.recentLogin"],
          ], "auth.msgNetwork"), "error");
        }
      },
    });
  }

  async function openEditIcon(session) {
    const body = createFormBody("z-icon-picker");

    const wrap = document.createElement("div");
    wrap.className = "z-icon-grid";

    const cur = sanitizeIconPath(session.icon);

    function renderIcons(list) {
      wrap.innerHTML = "";
      const icons = (Array.isArray(list) ? list : []).filter(function (p) {
        return /^assets\/icons\/users\/user\d+\.png$/i.test(String(p || ""));
      }).sort(function (a, b) {
        return _iconNumber(a) - _iconNumber(b);
      });
      icons.forEach(function (p) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "z-icon-item" + (p === cur ? " active" : "");
        btn.setAttribute("data-path", p);
        const img = document.createElement("img");
        img.src = pageIconPath(p);
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        btn.appendChild(img);
        btn.addEventListener("click", function () {
          qsa(".z-icon-item", wrap).forEach(function (x) {
            x.classList.remove("active");
          });
          btn.classList.add("active");
        });
        wrap.appendChild(btn);
      });
    }

    renderIcons(getAllowedIcons());
    body.appendChild(wrap);

    openDashboardFormModal({
      title: window.I18N.text("dashboard.editIcon"),
      body: body,
      modalClassName: "z-edit-icon-modal",
      onSubmit: async function () {
        const active = qs(".z-icon-item.active", wrap);
        const chosen = sanitizeIconPath(active ? active.getAttribute("data-path") : cur);
        try {
          const user = getCurrentRegisteredUser();
          if (!user) return;
          await updateOfficialProfilePatch({ icon: chosen });
          const next = Object.assign({}, session, { icon: chosen, lastActiveAt: Date.now() });
          ZAuth.writeSession(next);
          setProfile({ icon: chosen }, next);
          showDashboardResultKey("auth.msgSaved", "ok");
        } catch (e) {
          showDashboardResultKey("auth.msgNetwork", "error");
        }
      },
    });

    discoverAllUserIcons().then(function (icons) {
      if (document.body.contains(wrap)) renderIcons(icons);
    }).catch(function () {});
  }

  function openDeleteAccount(session) {
    const user = getCurrentRegisteredUser();
    if (!user) return;
    const providerIds = getProviderIds(user);
    const usesPasswordProvider = providerIds.includes("password");
    const usesGoogleProvider = providerIds.includes("google.com");

    const body = createFormBody();

    const note = document.createElement("div");
    note.style.whiteSpace = "pre-wrap";
    note.style.marginBottom = "10px";
    note.textContent = window.I18N.text("dashboard.delete.body");
    body.appendChild(note);

    const inp = createInput({ type: "password", id: "dashDelPass", placeholder: "••••••••" });
    if (usesPasswordProvider) {
      body.appendChild(createFormRow(window.I18N.text("dashboard.delete.passwordLabel"), inp));
    }

    let busy = false;

    openDashboardFormModal({
      title: window.I18N.text("dashboard.delete.title"),
      body: body,
      focusSelector: usesPasswordProvider ? "#dashDelPass" : "#modalOkBtn",
      submitLabel: window.I18N.text("dashboard.delete.confirm"),
      submitClassName: "danger",
      onSubmit: async function () {
        if (busy) return;
        if (usesPasswordProvider && !String(inp.value || "")) {
          showDashboardResultKey("dashboard.delete.wrongPassword", "error");
          return;
        }

        try {
          const liveUser = getCurrentRegisteredUser();
          if (!liveUser) return;

          busy = true;
          _dashDeleting = true;
          stopRefreshTimer();
          Modal.setButtonsDisabled(true);

          if (usesPasswordProvider) {
            await reauthPasswordProvider(liveUser, inp.value || "");
          } else if (usesGoogleProvider) {
            await reauthGoogleProvider(liveUser);
          }

          if (window.CloudflareAuth && typeof window.CloudflareAuth.deleteAccount === "function") await window.CloudflareAuth.deleteAccount();
          else await liveUser.delete();

          if (window.ZAuth && typeof ZAuth.clearSession === "function") ZAuth.clearSession();
          showDashboardResultKey("dashboard.delete.success", "ok", {
            onClose: function () {
              location.href = "../index.html";
            },
          });
        } catch (e) {
          showDashboardResultKey(keyForCode(errorCode(e), [
            ["auth/wrong-password", "dashboard.delete.wrongPassword"],
            ["auth/invalid-credential", "dashboard.delete.wrongPassword"],
            ["auth/popup-blocked", "auth.msgPopupBlocked"],
            ["auth/popup-closed-by-user", "auth.msgPopupBlocked"],
            ["auth/requires-recent-login", "dashboard.delete.recentLogin"],
          ], "auth.msgNetwork"), "error");
          Modal.setButtonsDisabled(false);
          busy = false;
          _dashDeleting = false;
          restartRefreshTimer(session && session.uid);
        }
      },
    });
  }

  function bind(session) {
    const bNick = qs("#btnEditNick");
    const bEmail = qs("#btnEditEmail");
    const bPass = qs("#btnEditPass");
    const bIcon = qs("#btnEditIcon");
    const bDel = qs("#btnDeleteAccount");
    const bLogout = qs("#btnDashLogout");
    const leaderboardTriggers = qsa('[data-open-leaderboard="1"]');

    if (bNick)
      bNick.addEventListener("click", function () {
        openEditNickname(session);
      });
    if (bEmail)
      bEmail.addEventListener("click", function () {
        openEditEmail(session);
      });
    if (bPass)
      bPass.addEventListener("click", function () {
        openEditPassword(session);
      });
    if (bIcon)
      bIcon.addEventListener("click", function () {
        openEditIcon(session);
      });
    if (bDel)
      bDel.addEventListener("click", function () {
        openDeleteAccount(session);
      });
    if (bLogout && window.ZAuth && typeof window.ZAuth.bindLogoutTrigger === "function") {
      window.ZAuth.bindLogoutTrigger(bLogout, "../index.html");
    }
    const bPlay = qs("#btnDashPlay");
    if (bPlay && window.ZShell && typeof window.ZShell.bindStartPlayTrigger === "function") {
      window.ZShell.bindStartPlayTrigger(bPlay, "..");
    }
    if (leaderboardTriggers.length && window.ZLeaderboard && typeof window.ZLeaderboard.bindOpeners === "function") {
      window.ZLeaderboard.bindOpeners(document);
    }
  }

  function init() {
    const s = ensureRegisteredSession();
    if (!s) {
      location.href = "../index.html";
      return;
    }
    try {
      if (window.ZAuth && typeof ZAuth.initCloudflareAuth === "function") ZAuth.initCloudflareAuth();
    } catch (_) {}
    bind(s);
    load(s.uid);
    window.addEventListener("beforeunload", function () {
      stopRefreshTimer();
    }, { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
