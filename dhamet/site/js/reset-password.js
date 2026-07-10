(function () {
  "use strict";

  var submitting = false;

  function qs(sel) {
    return document.querySelector(sel);
  }

  function msg(text, kind) {
    var el = qs("#resetMsg");
    if (!el) return;
    var hasText = !!String(text || "").trim();
    el.textContent = String(text || "");
    el.className = "z-auth-msg";
    el.setAttribute("role", hasText ? "status" : "presentation");
    el.setAttribute("aria-live", "polite");
    if (kind === "error") el.classList.add("is-error");
    if (kind === "ok") el.classList.add("is-ok");
    if (kind === "warn") el.classList.add("is-warn");
    if (hasText) el.classList.add("is-show");
  }

  function tokenFromUrl() {
    try {
      var sp = new URLSearchParams(location.search || "");
      return String(sp.get("resetToken") || sp.get("token") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function disableForm(disabled) {
    ["#resetPass1", "#resetPass2", "#btnApplyReset"].forEach(function (sel) {
      var el = qs(sel);
      if (el) el.disabled = !!disabled;
    });
  }

  function passwordLooksUsable(p) {
    return typeof p === "string" && p.length >= 6 && p.length <= 256;
  }

  async function postJson(url, body) {
    var controller = null;
    var timer = null;
    try {
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        timer = setTimeout(function () { try { controller.abort(); } catch (_) {} }, 15000);
      }
      var res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify(body || {}),
        signal: controller ? controller.signal : undefined,
      });
      var data = null;
      var txt = "";
      try { txt = await res.text(); } catch (_) { txt = ""; }
      try { data = txt ? JSON.parse(txt) : null; } catch (_) { data = null; }
      if (!res.ok || (data && data.ok === false)) {
        var code = data && (data.code || data.error) ? String(data.code || data.error) : "reset-failed";
        var err = new Error(code);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data || { ok: true };
    } catch (err) {
      if (err && err.name === "AbortError") {
        var timeoutErr = new Error("auth/network-timeout");
        timeoutErr.status = 0;
        throw timeoutErr;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function resetErrorText(err) {
    var code = String((err && (err.message || err.code)) || "");
    var dataCode = String((err && err.data && (err.data.code || err.data.error)) || "");
    code = code + " " + dataCode;
    if (code.includes("weak-password")) {
      return "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.";
    }
    if (code.includes("password-save-verification-failed")) {
      return "تعذر تأكيد حفظ كلمة المرور الجديدة. لم يتم إكمال العملية، اطلب رابطًا جديدًا وحاول مرة أخرى.";
    }
    if (code.includes("invalid-action-code") || code.includes("invalid-reset") || code.includes("expired")) {
      return "رابط الاستعادة غير صالح أو انتهت صلاحيته أو استُخدم سابقًا. اطلب رابطًا جديدًا من صفحة تسجيل الدخول.";
    }
    if (code.includes("network-timeout") || code.includes("Failed to fetch")) {
      return "تعذر الاتصال بالخادم. تحقق من الاتصال ثم حاول مرة أخرى.";
    }
    return "تعذر تحديث كلمة المرور. اطلب رابطًا جديدًا أو حاول لاحقًا.";
  }

  async function applyReset() {
    if (submitting) return;
    var token = tokenFromUrl();
    var p1El = qs("#resetPass1");
    var p2El = qs("#resetPass2");
    var p1 = String((p1El || {}).value || "");
    var p2 = String((p2El || {}).value || "");
    var btn = qs("#btnApplyReset");

    if (!token) {
      msg("رابط الاستعادة غير مكتمل. اطلب رابطًا جديدًا من صفحة تسجيل الدخول.", "error");
      return;
    }
    if (!passwordLooksUsable(p1)) {
      msg("كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.", "error");
      if (p1El) p1El.focus();
      return;
    }
    if (p1 !== p2) {
      msg("كلمة المرور وتأكيدها غير متطابقين.", "error");
      if (p2El) p2El.focus();
      return;
    }

    submitting = true;
    disableForm(true);
    if (btn) btn.textContent = "جارٍ التحديث...";
    msg("جارٍ تحديث كلمة المرور...", "ok");
    try {
      await postJson("/dhamet/api/auth/reset-password", { token: token, password: p1 });
      try { history.replaceState(null, "", location.pathname + "?reset=done"); } catch (_) {}
      try { if (p1El) p1El.value = ""; if (p2El) p2El.value = ""; } catch (_) {}
      msg("تم تحديث كلمة المرور بنجاح. انتقل الآن إلى تسجيل الدخول واستخدم كلمة المرور الجديدة.", "ok");
      if (btn) btn.textContent = "تم التحديث";
      setTimeout(function () {
        location.href = "../index.html?passwordReset=done";
      }, 2200);
    } catch (err) {
      submitting = false;
      disableForm(false);
      if (btn) btn.textContent = "تحديث كلمة المرور";
      msg(resetErrorText(err), "error");
    }
  }

  function bindPasswordToggle(buttonSel, inputSel) {
    var btn = qs(buttonSel);
    var input = qs(inputSel);
    if (!btn || !input) return;
    btn.addEventListener("click", function () {
      var visible = input.type === "text";
      input.type = visible ? "password" : "text";
      btn.textContent = visible ? "إظهار" : "إخفاء";
      try { input.focus(); } catch (_) {}
    });
  }

  function init() {
    var token = tokenFromUrl();
    if (!token) msg("رابط الاستعادة غير مكتمل. اطلب رابطًا جديدًا من صفحة تسجيل الدخول.", "error");
    else msg("أدخل كلمة المرور الجديدة ثم اضغط تحديث كلمة المرور.", "warn");
    bindPasswordToggle("#toggleResetPass1", "#resetPass1");
    bindPasswordToggle("#toggleResetPass2", "#resetPass2");
    var btn = qs("#btnApplyReset");
    if (btn) btn.addEventListener("click", applyReset);
    ["#resetPass1", "#resetPass2"].forEach(function (sel) {
      var el = qs(sel);
      if (!el) return;
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          applyReset();
        }
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
