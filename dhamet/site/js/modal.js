(function () {
  "use strict";

  var Common = window.ZCommon || {};
  var qs = typeof Common.qs === "function" ? Common.qs : function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var qsa = typeof Common.qsa === "function" ? Common.qsa : function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  function ensureDom() {
    var b = qs("#modalBackdrop");
    if (b) return b;

    b = document.createElement("div");
    b.id = "modalBackdrop";
    b.className = "modal-backdrop";
    b.setAttribute("role", "dialog");
    b.setAttribute("aria-modal", "true");
    b.setAttribute("aria-hidden", "true");
    b.style.display = "none";

    b.innerHTML =
      '<div class="modal" role="document">' +
      '  <div class="modal-header">' +
      '    <div class="modal-title" id="modalTitle">...</div>' +
      '    <button class="modal-close" id="modalClose">✕</button>' +
      "  </div>" +
      '  <div class="modal-body" id="modalBody"></div>' +
      '  <div class="modal-footer" id="modalFooter">' +
      '    <div class="row" id="modalFooterButtons"></div>' +
      "  </div>" +
      "</div>";

    (document.body || document.documentElement).appendChild(b);
    try {
      var c = qs("#modalClose", b);
      if (c) {
        c.setAttribute("aria-label", window.I18N.translateArgs("actions.close"));
        c.title = window.I18N.translateArgs("actions.close");
      }
    } catch (_) {}
    return b;
  }

  function normalizeButtons(opts) {
    if (Array.isArray(opts.buttons)) return opts.buttons;

    if (Array.isArray(opts.actions)) return opts.actions;

    return [
      {
        label: opts.okLabel || window.I18N.translateArgs("actions.ok"),
        className: opts.okClassName || "primary",
        onClick: function () {
          close();
        },
      },
    ];
  }

  function normalizeBody(opts) {
    if (opts.body != null) return opts.body;

    if (opts.html != null) return String(opts.html);

    if (opts.text != null) {
      var div = document.createElement("div");
      div.style.whiteSpace = "pre-wrap";
      div.textContent = String(opts.text);
      return div;
    }

    if (opts.node && opts.node.nodeType) return opts.node;

    return "";
  }

  function setDir(backdrop) {
    try {
      var dir =
        document.documentElement.getAttribute("dir") ||
        (document.body ? document.body.getAttribute("dir") : "") ||
        "ltr";
      dir = String(dir || "ltr").toLowerCase() === "rtl" ? "rtl" : "ltr";

      var htmlLang = document.documentElement.getAttribute("lang") || (dir === "rtl" ? "ar" : "en");

      backdrop.setAttribute("dir", dir);
      backdrop.setAttribute("lang", htmlLang);

      var modalEl = qs(".modal", backdrop);
      if (modalEl) {
        modalEl.setAttribute("dir", dir);
        modalEl.setAttribute("lang", htmlLang);
      }
    } catch (_) {}
  }

  var state = {
    onClose: null,
    keyHandler: null,
    modalClassName: null,
  };

  function safeRunOnClose() {
    try {
      if (typeof state.onClose === "function") state.onClose();
    } catch (_) {}
    state.onClose = null;
  }

  function close() {
    var b = ensureDom();

    try {
      var modalEl0 = qs(".modal", b);
      if (modalEl0 && state.modalClassName) modalEl0.classList.remove(state.modalClassName);
    } catch (_) {}
    state.modalClassName = null;

    if (state.keyHandler) {
      try {
        document.removeEventListener("keydown", state.keyHandler);
      } catch (_) {}
      state.keyHandler = null;
    }

    safeRunOnClose();

    try {
      var focused = b.querySelector(":focus");
      if (focused) focused.blur();
    } catch (_) {}

    b.style.display = "none";
    b.setAttribute("aria-hidden", "true");
    try {
      document.body.classList.remove("modal-open");
    } catch (_) {}
  }

  function open(opts) {
    opts = opts || {};

    try {
      if (
        document.body &&
        document.body.classList &&
        document.body.classList.contains("z-spectator")
      ) {
        if (!opts.allowSpectator) return;
      }
    } catch (_) {}

    var b = ensureDom();

    close();

    try {
      var modalEl = qs(".modal", b);
      if (modalEl && state.modalClassName) modalEl.classList.remove(state.modalClassName);
      state.modalClassName = null;
      if (modalEl && opts.modalClassName) {
        modalEl.classList.add(String(opts.modalClassName));
        state.modalClassName = String(opts.modalClassName);
      }
    } catch (_) {}

    setDir(b);

    try {
      var cbtn = qs("#modalClose", b);
      if (cbtn) cbtn.setAttribute("aria-label", window.I18N.translateArgs("actions.close"));
    } catch (_) {}

    var titleEl = qs("#modalTitle", b);
    var bodyEl = qs("#modalBody", b);
    var footer = qs("#modalFooterButtons", b);
    var closeBtn = qs("#modalClose", b);

    if (titleEl) titleEl.textContent = String(opts.title || "");

    var body = normalizeBody(opts);
    if (bodyEl) {
      bodyEl.innerHTML = "";
      if (typeof body === "string") {
        bodyEl.insertAdjacentHTML("afterbegin", body);
      } else if (body && body.nodeType) {
        bodyEl.appendChild(body);
      } else {
        bodyEl.textContent = String(body || "");
      }
    }

    if (footer) footer.innerHTML = "";
    var btns = normalizeButtons(opts);
    btns.forEach(function (btn) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "btn " + (btn.className || "");
      el.textContent = btn.label || window.I18N.translateArgs("actions.ok");
      if (btn.title) el.title = String(btn.title);
      if (btn.disabled) el.disabled = true;
      el.addEventListener("click", function () {
        try {
          if (btn.onClick) btn.onClick();
        } catch (_) {}
      });
      if (footer) footer.appendChild(el);
    });

    if (closeBtn) {
      closeBtn.onclick = function () {
        close();
      };
    }

    state.keyHandler = function (e) {
      try {
        if (e.key === "Escape") {
          if (opts.allowEsc === false) return;
          close();
          return;
        }
        if (e.key === "Enter" && typeof opts.onEnter === "function") {
          opts.onEnter();
        }
      } catch (_) {}
    };
    document.addEventListener("keydown", state.keyHandler);

    state.onClose = typeof opts.onClose === "function" ? opts.onClose : null;

    b.style.display = "flex";
    b.setAttribute("aria-hidden", "false");
    try {
      document.body.classList.add("modal-open");
    } catch (_) {}

    try {
      if (opts.focusSelector) {
        var f = qs(opts.focusSelector, b);
        if (f && typeof f.focus === "function")
          setTimeout(function () {
            f.focus();
          }, 0);
      }
    } catch (_) {}
  }

  function getBackdrop() {
    return qs("#modalBackdrop") || ensureDom();
  }

  function getModalElement() {
    return qs(".modal", getBackdrop());
  }

  function isOpen() {
    var b = getBackdrop();
    return !!(b && b.getAttribute("aria-hidden") === "false" && b.style.display !== "none");
  }

  function getBody() {
    return qs("#modalBody", getBackdrop());
  }

  function setButtonsDisabled(disabled) {
    qsa("#modalFooterButtons button", getBackdrop()).forEach(function (button) {
      button.disabled = !!disabled;
    });
  }

  function toggleModalClass(className, enabled) {
    var modalEl = getModalElement();
    if (!modalEl || !className) return;
    modalEl.classList.toggle(String(className), !!enabled);
  }

  function setBackdropTag(tag) {
    var b = getBackdrop();
    if (!b || !b.dataset) return;
    if (tag == null || tag === "") delete b.dataset.zamatModalTag;
    else b.dataset.zamatModalTag = String(tag);
  }

  function getBackdropTag() {
    var b = getBackdrop();
    return b && b.dataset ? b.dataset.zamatModalTag || "" : "";
  }

  function alertModal(opts, title, okLabel, okClassName) {
    var cfg;
    if (opts && typeof opts === "object" && !opts.nodeType && !Array.isArray(opts)) {
      cfg = opts;
    } else {
      cfg = { text: opts, title: title, okLabel: okLabel, okClassName: okClassName };
    }

    var afterClose = typeof cfg.onClick === "function" ? cfg.onClick : null;
    open({
      title: cfg.title,
      body: normalizeBody(cfg),
      allowSpectator: cfg.allowSpectator,
      allowEsc: cfg.allowEsc,
      focusSelector: cfg.focusSelector,
      modalClassName: cfg.modalClassName,
      onClose: cfg.onClose,
      onEnter: cfg.onEnter,
      buttons: [
        {
          label: cfg.okLabel || window.I18N.translateArgs("actions.ok"),
          className: cfg.okClassName || "primary",
          onClick: function () {
            if (cfg.autoClose !== false) close();
            if (afterClose) afterClose();
          },
        },
      ],
    });
  }


  function twoActionModal(opts) {
    var cfg = opts && typeof opts === "object" && !opts.nodeType && !Array.isArray(opts) ? opts : {};
    var onFirst = typeof cfg.onFirst === "function" ? cfg.onFirst : null;
    var onSecond = typeof cfg.onSecond === "function" ? cfg.onSecond : null;
    open({
      title: cfg.title,
      body: normalizeBody(cfg),
      allowSpectator: cfg.allowSpectator,
      allowEsc: cfg.allowEsc,
      focusSelector: cfg.focusSelector,
      modalClassName: cfg.modalClassName,
      onClose: cfg.onClose,
      onEnter: cfg.onEnter,
      buttons: [
        {
          label: cfg.firstLabel || window.I18N.translateArgs("actions.ok"),
          className: cfg.firstClassName || "primary",
          disabled: !!cfg.firstDisabled,
          title: cfg.firstTitle,
          onClick: function () {
            if (cfg.autoCloseFirst !== false) close();
            if (onFirst) onFirst();
          },
        },
        {
          label: cfg.secondLabel || window.I18N.translateArgs("actions.cancel"),
          className: cfg.secondClassName || "ghost",
          disabled: !!cfg.secondDisabled,
          title: cfg.secondTitle,
          onClick: function () {
            if (cfg.autoCloseSecond !== false) close();
            if (onSecond) onSecond();
          },
        },
      ],
    });
  }


  function formModal(opts) {
    var cfg = opts && typeof opts === "object" && !opts.nodeType && !Array.isArray(opts) ? opts : {};
    var onSubmit = typeof cfg.onSubmit === "function" ? cfg.onSubmit : null;
    var onCancel = typeof cfg.onCancel === "function" ? cfg.onCancel : null;
    open({
      title: cfg.title,
      body: normalizeBody(cfg),
      allowSpectator: cfg.allowSpectator,
      allowEsc: cfg.allowEsc,
      focusSelector: cfg.focusSelector,
      modalClassName: cfg.modalClassName,
      onClose: cfg.onClose,
      onEnter: cfg.onEnter,
      buttons: [
        {
          label: cfg.submitLabel || window.I18N.translateArgs("actions.ok"),
          className: cfg.submitClassName || "primary",
          disabled: !!cfg.submitDisabled,
          title: cfg.submitTitle,
          onClick: function () {
            if (cfg.autoCloseSubmit === true) close();
            if (onSubmit) onSubmit();
          },
        },
        {
          label: cfg.cancelLabel || window.I18N.translateArgs("actions.cancel"),
          className: cfg.cancelClassName || "ghost",
          disabled: !!cfg.cancelDisabled,
          title: cfg.cancelTitle,
          onClick: function () {
            if (cfg.autoCloseCancel !== false) close();
            if (onCancel) onCancel();
          },
        },
      ],
    });
  }

  function confirmModal(msg, title, yesLabel, noLabel) {
    return new Promise(function (resolve) {
      var div = document.createElement("div");
      div.style.whiteSpace = "pre-wrap";
      div.textContent = String(msg == null ? "" : msg);
      open({
        title: title || "",
        body: div,
        buttons: [
          {
            label: yesLabel || window.I18N.translateArgs("actions.ok"),
            className: "primary",
            onClick: function () {
              close();
              resolve(true);
            },
          },
          {
            label: noLabel || window.I18N.translateArgs("actions.cancel"),
            className: "ghost",
            onClick: function () {
              close();
              resolve(false);
            },
          },
        ],
      });
    });
  }

  var Modal = (window.Modal = window.Modal || {});
  Modal.open = open;
  Modal.close = close;
  Modal.confirm = confirmModal;
  Modal.alert = alertModal;
  Modal.twoAction = twoActionModal;
  Modal.form = formModal;
  Modal.isOpen = isOpen;
  Modal.getBody = getBody;
  Modal.setButtonsDisabled = setButtonsDisabled;
  Modal.toggleModalClass = toggleModalClass;
  Modal.setBackdropTag = setBackdropTag;
  Modal.clearBackdropTag = function () {
    setBackdropTag(null);
  };
  Modal.getBackdropTag = getBackdropTag;
  Modal.setDir = function () {
    try {
      var b = ensureDom();
      setDir(b);
    } catch (_) {}
  };


  if (!window.qs) window.qs = qs;
  if (!window.qsa) window.qsa = qsa;
})();
