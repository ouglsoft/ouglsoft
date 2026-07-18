/*
 * Dhamet lobby runtime.
 *
 * Owns the browser-side lobby, public presence, unified app pulse, invite
 * preference, invite receive/send flow, online notices, nickname migration,
 * and lightweight online page bootstrap.
 */
(function () {
  function formatTpl(s, vars) {
    return (s || "").replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ""));
  }

  const Logger = (() => {
    const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
    const NAMES = ["error", "warn", "info", "debug"];
    let level = 1;
    let buffer = [];
    const MAX_BUF = 200;

    function _now() {
      try {
        return Date.now();
      } catch (e) {
        return 0;
      }
    }

    function _parseLevel(v) {
      const s = String(v || "")
        .toLowerCase()
        .trim();
      if (s === "debug") return 3;
      if (s === "info") return 2;
      if (s === "warn" || s === "warning") return 1;
      if (s === "error") return 0;
      const n = Number(s);
      return Number.isFinite(n) ? Math.max(0, Math.min(3, n | 0)) : null;
    }

    function _readQuery() {
      try {
        const sp = new URLSearchParams(location.search || "");
        const ql = sp.get("log") || sp.get("logger") || "";
        const dbg = sp.get("debug");
        if (dbg === "1" || dbg === "true") return 3;
        const lv = _parseLevel(ql);
        return lv == null ? null : lv;
      } catch (e) {
        return null;
      }
    }

    function _readStorage() {
      try {
        const v = localStorage.getItem("zamat.log.level");
        const lv = _parseLevel(v);
        return lv == null ? null : lv;
      } catch (e) {
        return null;
      }
    }

    function _init() {
      const q = _readQuery();
      if (q != null) {
        level = q;
        return;
      }
      const s = _readStorage();
      if (s != null) {
        level = s;
        return;
      }
      level = 1;
    }

    function setLevel(v) {
      const lv = _parseLevel(v);
      if (lv == null) return false;
      level = lv;
      try {
        localStorage.setItem("zamat.log.level", NAMES[level]);
      } catch (e) {}
      return true;
    }

    function getLevel() {
      return NAMES[level];
    }

    function _safeClone(x) {
      try {
        if (x == null) return null;
        if (typeof x === "string") return x.length > 500 ? x.slice(0, 500) : x;
        if (typeof x === "number" || typeof x === "boolean") return x;
        if (Array.isArray(x)) return x.slice(0, 20).map(_safeClone);
        if (typeof x === "object") {
          const out = {};
          const ks = Object.keys(x).slice(0, 40);
          for (const k of ks) {
            const lk = String(k).toLowerCase();
            if (
              lk.includes("token") ||
              lk.includes("password") ||
              lk.includes("secret") ||
              lk.includes("auth")
            )
              continue;
            out[k] = _safeClone(x[k]);
          }
          return out;
        }
      } catch (e) {}
      return null;
    }

    function _emitConsole(kind, msg, meta) {
      try {
        const fn =
          kind === "error"
            ? console.error
            : kind === "warn"
              ? console.warn
              : kind === "info"
                ? console.info
                : console.debug;
        if (meta != null) fn("[ZAMAT]", msg, meta);
        else fn("[ZAMAT]", msg);
      } catch (e) {}
    }

    function _push(kind, msg, meta) {
      try {
        const entry = { ts: _now(), level: kind, msg: String(msg || ""), meta: _safeClone(meta) };
        buffer.push(entry);
        if (buffer.length > MAX_BUF) buffer = buffer.slice(buffer.length - MAX_BUF);
      } catch (e) {}
    }

    function _logAt(lv, kind, args) {
      if (lv > level) return;
      const a = Array.prototype.slice.call(args || []);
      const msg = a.length ? String(a[0]) : "";
      const meta = a.length > 1 ? a[1] : null;
      _push(kind, msg, meta);
      _emitConsole(kind, msg, meta);
    }

    function error() {
      _logAt(0, "error", arguments);
    }
    function warn() {
      _logAt(1, "warn", arguments);
    }
    function info() {
      _logAt(2, "info", arguments);
    }
    function debug() {
      _logAt(3, "debug", arguments);
    }

    function capture(err, ctx) {
      try {
        const e = err || {};
        const meta = {
          ctx: _safeClone(ctx),
          name: String(e.name || ""),
          code: String(e.code || ""),
          message: String(e.message || ""),
          stack: typeof e.stack === "string" ? e.stack.split("\n").slice(0, 6).join("\n") : "",
        };
        error("error", meta);
      } catch (e2) {}
    }

    _init();
    return { setLevel, getLevel, capture, error, warn, info, debug };
  })();
  try {
    window.Logger = Logger;
  } catch (e) {}

  function normalizeSouflaFx(fx) {
    try {
      if (!fx || typeof fx !== "object") return null;
      const out = {};

      if (Array.isArray(fx.redPaths) && fx.redPaths.length) {
        const rp = [];
        for (const seg of fx.redPaths) {
          if (!seg) continue;
          const from = Number(seg.from);
          const path = Array.isArray(seg.path)
            ? seg.path.map(Number).filter(Number.isFinite)
            : null;
          if (!Number.isFinite(from) || !path || !path.length) continue;
          const jumps = Array.isArray(seg.jumps)
            ? seg.jumps.map(Number).filter(Number.isFinite)
            : [];
          rp.push({ from, path, jumps });
        }
        if (rp.length) out.redPaths = rp;
      }

      if (!out.redPaths && fx.red && fx.red.from != null && fx.red.to != null) {
        const f = Number(fx.red.from);
        const t = Number(fx.red.to);
        if (Number.isFinite(f) && Number.isFinite(t)) out.red = { from: f, to: t };
      }

      if (fx.undoArrow) {
        try {
          let nodes = [];
          if (Array.isArray(fx.undoArrow.nodes)) {
            nodes = fx.undoArrow.nodes.map(Number).filter(Number.isFinite);
          } else if (fx.undoArrow.from != null && Array.isArray(fx.undoArrow.path)) {
            nodes = [fx.undoArrow.from].concat(fx.undoArrow.path).map(Number).filter(Number.isFinite);
          } else if (fx.undoArrow.from != null && fx.undoArrow.to != null) {
            nodes = [fx.undoArrow.from, fx.undoArrow.to].map(Number).filter(Number.isFinite);
          }
          if (nodes.length >= 2) out.undoArrow = { nodes };
        } catch (e) {}
      }

      if (fx.removeIdx != null) {
        const r = Number(fx.removeIdx);
        if (Number.isFinite(r)) out.removeIdx = r;
      }

      if (Array.isArray(fx.forcePath) && fx.forcePath.length) {
        const fp = fx.forcePath.map(Number).filter(Number.isFinite);
        if (fp.length) out.forcePath = fp;
      }

      return Object.keys(out).length ? out : null;
    } catch (e) {
      return null;
    }
  }

  function isPermissionDenied(err) {
    const parts = [];
    try {
      if (err && err.code != null) parts.push(String(err.code));
    } catch (e) {}
    try {
      if (err && err.message) parts.push(String(err.message));
    } catch (e) {}
    const msg = parts.join(" | ");
    return /permission[_ -]?denied/i.test(msg);
  }

  function _ctx(meta) {
    try {
      return String((meta && (meta.ctx || meta.context)) || "");
    } catch (e) {
      return "";
    }
  }

  function _spectatorMayWrite(ctx) {
    ctx = String(ctx || "");
    return /^(players\.|gamePresence\.|spectator\.|chat\.)/.test(ctx);
  }

  function _dbErrorMessage(err, fallbackMsg, meta) {
    try {
      if (!isPermissionDenied(err)) return fallbackMsg || "";
      const ctx = _ctx(meta);
      const info = getAuthDebug();
      if (!info.signedIn) return window.I18N.translateArgs("online.errors.authRequired");
      if (ctx.indexOf("gamePresence") === 0) return window.I18N.translateArgs("online.errors.presenceWriteDenied");
      if (ctx.indexOf("invite") === 0) return window.I18N.translateArgs("online.errors.inviteWriteDenied");
      if (ctx.indexOf("chat") === 0) return window.I18N.translateArgs("online.errors.chatWriteDenied");
      if (ctx.indexOf("rtc") === 0) return window.I18N.translateArgs("online.errors.voiceWriteDenied");
      if (ctx.indexOf("move") === 0 || ctx.indexOf("soufla") === 0 || ctx.indexOf("undo") === 0 || ctx.indexOf("log") === 0) {
        try {
          if (window.Online && window.Online.isSpectator) {
            return window.I18N.translateArgs("spectator.only") || window.I18N.translateArgs("online.errors.spectatorAction");
          }
          if (window.Online && window.Online._lastGameData && window.Online._lastGameData.status && window.Online._lastGameData.status !== "active") {
            return window.I18N.translateArgs("online.errors.matchEnded");
          }
        } catch (e) {}
        return window.I18N.translateArgs("online.errors.moveWriteDenied");
      }
      return fallbackMsg || window.I18N.translateArgs("online.permissionDenied");
    } catch (e) {
      return fallbackMsg || "";
    }
  }

  function handleDbError(err, fallbackMsg, meta) {
    try {
      const msg = _dbErrorMessage(err, fallbackMsg, meta || null);
      if (msg) showOnlineNotice(msg, { allowSpectator: true });
    } catch (e) {}
  }

  const DENIED_LOG_TTL_MS = 4000;
  const DENIED_LOG_MAX_KEYS = 200;
  const _DENIED_LOG_LAST = Object.create(null);
  let _DENIED_LOG_KEYS = 0;
  function _shouldLogDenied(key) {
    try {
      const now = Date.now();
      const last = _DENIED_LOG_LAST[key] || 0;
      if (now - last < DENIED_LOG_TTL_MS) return false;
      _DENIED_LOG_LAST[key] = now;
      _DENIED_LOG_KEYS++;
      if (_DENIED_LOG_KEYS > DENIED_LOG_MAX_KEYS) {
        for (const k in _DENIED_LOG_LAST) delete _DENIED_LOG_LAST[k];
        _DENIED_LOG_KEYS = 0;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function allowOnlineWrite(meta) {
    try {
      const ctx = _ctx(meta);
      if (window.Online && window.Online.isSpectator && !_spectatorMayWrite(ctx)) {
        showOnlineNotice(
          window.I18N.translateArgs("spectator.only") || window.I18N.translateArgs("online.errors.spectatorAction"),
          { allowSpectator: true },
        );
        return false;
      }
    } catch (e) {}
    return true;
  }

  function getAuthDebug() {
    try {
      const u = auth && auth.currentUser ? auth.currentUser : null;
      const signedIn = !!(u && u.uid);
      const authUid = signedIn ? String(u.uid) : null;
      return { signedIn, authUid };
    } catch (e) {
      return { signedIn: false, authUid: null };
    }
  }

  function requireAuthUid(expectedUid) {
    const info = getAuthDebug();
    if (!info.signedIn || !info.authUid) return null;
    if (expectedUid != null && String(expectedUid) !== info.authUid) return null;
    return info.authUid;
  }

  // Browser writes must use official Worker/GameRoom endpoints for all realtime mutations.

  function isGamePage() {
    try {
      return !!document.getElementById("board");
    } catch (e) {
      return false;
    }
  }

  function isPvCGamePage() {
    try {
      if (!isGamePage()) return false;
      const sp = new URLSearchParams(location.search || "");
      const pvp = (sp.get("pvp") || "").trim().toLowerCase();
      const online = !!(
        sp.get("room") ||
        sp.get("rid") ||
        sp.get("gid") ||
        sp.get("game") ||
        sp.get("id") ||
        sp.get("spectate") ||
        (pvp && pvp !== "0" && pvp !== "false")
      );
      return !online;
    } catch (e) {
      return false;
    }
  }

  function escapeHtml(s) {
    const str = String(s == null ? "" : s);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const LOG_ENC_PREFIX = "@@ZL1@";

  function encodeSharedLogText(ev) {
    try {
      if (!ev || typeof ev !== "object") return String(ev ?? "");
      const kind = String(ev.kind || "");
      let packed = null;

      if (kind === "i18n") {
        packed = {
          k: "i",
          K: String(ev.key || ""),
          v: ev.vars && typeof ev.vars === "object" ? ev.vars : {},
        };
      } else if (kind === "actor_i18n") {
        packed = {
          k: "a",
          a: String(ev.actor || ""),
          K: String(ev.key || ""),
          v: ev.vars && typeof ev.vars === "object" ? ev.vars : {},
        };
      } else if (kind === "turn") {
        packed = { k: "t", s: ev.side, f: ev.from, t: ev.to, c: ev.captures | 0 };
      } else if (kind === "promote") {
        packed = { k: "p", s: ev.side, i: ev.idx };
      } else if (kind === "soufla_remove") {
        packed = { k: "sr", i: ev.idx };
      } else if (kind === "soufla_force") {
        packed = { k: "sf", f: ev.from, p: Array.isArray(ev.path) ? ev.path : ev.path };
      } else if (kind === "undo") {
        packed = { k: "u", f: ev.from, t: ev.to };
      } else if (kind === "raw") {
        return String(ev.text ?? "");
      } else {
        return String(ev.text ?? ev.msg ?? "");
      }

      let txt = LOG_ENC_PREFIX + JSON.stringify(packed);

      if (txt.length > 200) {
        try {
          if ((packed.k === "i" || packed.k === "a") && packed.v && typeof packed.v === "object") {
            for (const kk of Object.keys(packed.v)) {
              const vv = packed.v[kk];
              if (typeof vv === "string" && vv.length > 80) packed.v[kk] = vv.slice(0, 80);
            }
          }
          if (packed.k === "sf" && typeof packed.p === "string" && packed.p.length > 120) {
            packed.p = packed.p.slice(0, 120);
          }
          if (packed.k === "sf" && Array.isArray(packed.p) && packed.p.length > 60) {
            packed.p = packed.p.slice(0, 60);
          }
          txt = LOG_ENC_PREFIX + JSON.stringify(packed);
        } catch (e) {}
      }

      if (txt.length > 200) {
        try {
          if (packed.k === "i")
            txt = LOG_ENC_PREFIX + JSON.stringify({ k: "i", K: packed.K, v: {} });
          else if (packed.k === "a")
            txt = LOG_ENC_PREFIX + JSON.stringify({ k: "a", a: packed.a, K: packed.K, v: {} });
          else txt = txt.slice(0, 200);
        } catch (e) {
          txt = txt.slice(0, 200);
        }
      }

      if (txt.length > 200) txt = txt.slice(0, 200);
      return txt;
    } catch (e) {
      return "";
    }
  }

  function decodeSharedLogText(text) {
    try {
      if (typeof text !== "string") return null;
      if (!text.startsWith(LOG_ENC_PREFIX)) return null;
      const raw = text.slice(LOG_ENC_PREFIX.length);
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;

      if (obj.k === "i")
        return { kind: "i18n", key: obj.K, vars: obj.v && typeof obj.v === "object" ? obj.v : {} };
      if (obj.k === "a")
        return {
          kind: "actor_i18n",
          actor: obj.a || "",
          key: obj.K,
          vars: obj.v && typeof obj.v === "object" ? obj.v : {},
        };
      if (obj.k === "t")
        return { kind: "turn", side: obj.s, from: obj.f, to: obj.t, captures: obj.c | 0 };
      if (obj.k === "p") return { kind: "promote", side: obj.s, idx: obj.i };
      if (obj.k === "sr") return { kind: "soufla_remove", idx: obj.i };
      if (obj.k === "sf") return { kind: "soufla_force", from: obj.f, path: obj.p };
      if (obj.k === "u") return { kind: "undo", from: obj.f, to: obj.t };

      return null;
    } catch (e) {
      return null;
    }
  }

  function normalizeLogArrayForWrite(arr) {
    try {
      if (!Array.isArray(arr)) return [];
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (!it || typeof it !== "object") continue;

        const hasStructured =
          it.kind != null ||
          it.type != null ||
          it.key != null ||
          it.actor != null ||
          it.side != null ||
          it.by != null ||
          it.s != null ||
          it.from != null ||
          it.to != null ||
          it.f != null ||
          it.t != null ||
          it.idx != null ||
          it.path != null ||
          it.captures != null ||
          it.c != null ||
          typeof it.msg === "string";

        if (typeof it.text === "string") {
          const dec = decodeSharedLogText(it.text);
          if (dec) continue;
          if (!hasStructured) continue;
        }

        const pick = (a, b) => (a !== undefined && a !== null ? a : b);

        let ev = null;
        const k = String(it.kind || it.type || "");

        const side = pick(it.side, pick(it.by, it.s));
        const from = pick(it.from, it.f);
        const to = pick(it.to, it.t);
        const captures = pick(it.captures, it.c);

        if (
          k === "turn" ||
          (from != null && to != null && side != null && (k === "" || k === "move"))
        ) {
          ev = { kind: "turn", side: side, from: from, to: to, captures: captures | 0 };
        } else if (k === "undo") {
          ev = { kind: "undo", from: from, to: to };
        } else if (k === "promote") {
          ev = { kind: "promote", side: side, idx: it.idx };
        } else if (k === "soufla_remove") {
          ev = { kind: "soufla_remove", idx: it.idx };
        } else if (k === "soufla_force") {
          ev = { kind: "soufla_force", from: from, path: it.path };
        } else if (k === "actor_i18n" || it.actor) {
          ev = { kind: "actor_i18n", actor: it.actor, key: it.key, vars: it.vars };
        } else if (k === "i18n" || it.key) {
          ev = { kind: "i18n", key: it.key, vars: it.vars };
        } else if (typeof it.msg === "string") {
          ev = { kind: "raw", text: it.msg };
        } else if (typeof it.text === "string") {
          ev = { kind: "raw", text: it.text };
        }

        it.ts = typeof it.ts === "number" ? it.ts : nowTs();
        it.text = encodeSharedLogText(ev || { kind: "raw", text: "" });

        try {
          delete it.kind;
          delete it.key;
          delete it.vars;
          delete it.actor;
          delete it.side;
          delete it.by;
          delete it.s;
          delete it.from;
          delete it.f;
          delete it.to;
          delete it.t;
          delete it.captures;
          delete it.c;
          delete it.idx;
          delete it.path;
          delete it.msg;
        } catch (e) {}
      }
      return arr;
    } catch (e) {
      return arr;
    }
  }

  let db = null;
  let auth = null;

  function createCloudflareAuthAdapter() {
    const api = window.CloudflareAuth;
    const out = {
      onAuthStateChanged: function (cb) { return api.onAuthStateChanged(cb); },
      signInAnonymously: function () { return api.signInGuest({}).then(function (user) { return { user: user }; }); },
      signOut: function () { return api.signOut(); }
    };
    Object.defineProperty(out, "currentUser", { get: function () { return api.currentUser ? api.currentUser() : null; } });
    return out;
  }

  function buildNoticeBody(msg, cfg) {
    const text = String(msg == null ? "" : msg);
    const div = document.createElement("div");
    div.className = "z-notice-text";
    div.style.whiteSpace = "pre-wrap";
    const names = [];
    const addName = (value) => {
      const name = String(value || "").trim();
      if (name && name.length >= 3 && !names.includes(name)) names.push(name);
    };
    try {
      const supplied = cfg && Array.isArray(cfg.playerNames) ? cfg.playerNames : [];
      supplied.forEach(addName);
      const online = window.Online || null;
      addName(online && online.myNick);
      const game = online && online._lastGameData && typeof online._lastGameData === "object" ? online._lastGameData : null;
      const gamePlayers = game && game.players && typeof game.players === "object" ? game.players : {};
      addName(gamePlayers.white && gamePlayers.white.nickname);
      addName(gamePlayers.black && gamePlayers.black.nickname);
      const lobbyPlayers = online && online._lastOfficialLobbyView && online._lastOfficialLobbyView.players;
      if (lobbyPlayers && typeof lobbyPlayers === "object") {
        Object.values(lobbyPlayers).forEach((row) => addName(row && row.nickname));
      }
    } catch (e) {}
    names.sort((a, b) => b.length - a.length);
    if (!names.length) {
      div.textContent = text;
      return div;
    }
    const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp("(" + escaped.join("|") + ")", "gu");
    let last = 0;
    text.replace(re, (match, _group, offset) => {
      if (offset > last) div.appendChild(document.createTextNode(text.slice(last, offset)));
      const span = document.createElement("span");
      span.className = "z-notice-player-name";
      span.textContent = match;
      div.appendChild(span);
      last = offset + match.length;
      return match;
    });
    if (last < text.length) div.appendChild(document.createTextNode(text.slice(last)));
    return div;
  }

  function showOnlineNotice(msg, opts) {
    const cfg = opts && typeof opts === "object" ? opts : {};
    try {
      if (
        !cfg.allowSpectator &&
        document.body &&
        document.body.classList &&
        document.body.classList.contains("z-spectator")
      )
        return;
    } catch (_) {}
    const titleText = cfg.title || window.I18N.translateArgs(cfg.titleKey || "modals.notice");
    const safeMsg = String(msg ?? "");
    try {
      if (window.Modal && typeof Modal.alert === "function") {
        Modal.alert({
          title: titleText,
          body: buildNoticeBody(safeMsg, cfg),
          okLabel: cfg.okLabel || window.I18N.translateArgs("actions.close"),
          okClassName: cfg.okClassName,
          allowSpectator: cfg.allowSpectator,
          allowEsc: cfg.allowEsc,
          focusSelector: cfg.focusSelector,
          modalClassName: cfg.modalClassName,
          priority: cfg.priority,
          blocking: cfg.blocking,
          forceReplace: cfg.forceReplace,
          queueOnBlocked: cfg.queueOnBlocked,
          onClick: cfg.onClick,
          onClose: cfg.onClose,
          onEnter: cfg.onEnter,
        });
        return;
      }
    } catch (e) {}
    try {
      alert(safeMsg);
    } catch (e) {}
  }


  function ensureCloudflareAuth() {
    if (auth) return true;
    try {
      if (!window.CloudflareAuth || typeof window.CloudflareAuth.ready !== "function") return false;
      auth = createCloudflareAuthAdapter();
      db = null;
      return true;
    } catch (e) {
      return false;
    }
  }
  function nowTs() {
    return Date.now();
  }
  function localNow() {
    return Date.now();
  }

  const PERSIST_GAME_ID_KEY = "zamat.activeGameId";
  const PERSIST_GAME_TS_KEY = "zamat.activeGameTs";
  const PERSIST_GAME_TTL_MS = 1000 * 60 * 60 * 12;

  function currentPersistUid(ctx) {
    try { return String((ctx && ctx.myUid) || (auth && auth.currentUser && auth.currentUser.uid) || '').trim(); } catch (e) { return ''; }
  }
  function localPersistKey(base, uid) {
    const cleanUid = String(uid || '').replace(/[^A-Za-z0-9._:@-]/g, '').slice(0, 120);
    return cleanUid ? base + '.' + cleanUid : '';
  }

  function ssGet(k) {
    try {
      return sessionStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function ssSet(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch (e) {}
  }
  function ssRemove(k) {
    try {
      sessionStorage.removeItem(k);
    } catch (e) {}
  }

  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  function chatLastReadKey(gameId, uid) {
    try {
      return "zamat.chatLastRead." + String(gameId || "") + "." + String(uid || "");
    } catch (e) {
      return "zamat.chatLastRead";
    }
  }function nickSuffixFromUid(uid) {
    try {
      const s = String(uid || "");
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }

      const n = (h % 9000) + 1000;
      return String(n);
    } catch (e) {
      return String(Math.floor(1000 + Math.random() * 9000));
    }
  }

  function defaultNick(uid) {
    const base = window.I18N.translateArgs("players.player");
    return `${base} ${nickSuffixFromUid(uid)}`;
  }

  function isGeneratedGuestNickname(uid, nickname) {
    try {
      const id = String(uid || "").trim();
      const nick = String(nickname || "").trim();
      if (!id || !nick) return false;
      return nick === `Guest ${id.slice(-4)}`;
    } catch (e) {
      return false;
    }
  }

  // Prefer a nickname explicitly chosen by the player (or stored on a registered
  // account). Fall back to the stable localized four-digit label only when the
  // server still carries its generated guest placeholder. This is display-only
  // and adds no read, write, pulse, or network request.
  function displayPlayerName(uid, nickname) {
    const id = String(uid || "").trim();
    const chosen = String(nickname || "").trim();
    if (chosen && !isGeneratedGuestNickname(id, chosen)) return chosen;
    return defaultNick(id || chosen || "player");
  }

  const NICK_KEY = "zamat.nick";
  const NICK_EXPLICIT_KEY = "zamat.nickExplicit";

  const MIGRATION_VERSION_KEY = "zamat.migrationVersion";

  function readMigrationVersion() {
    try {
      const v = parseInt(localStorage.getItem(MIGRATION_VERSION_KEY) || "0", 10);
      return Number.isFinite(v) ? Math.max(0, v | 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  function writeMigrationVersion(v) {
    try {
      localStorage.setItem(MIGRATION_VERSION_KEY, String(v | 0));
    } catch (e) {}
  }

  function runMigrationsOnline() {
    const cur = readMigrationVersion();
    if (cur >= 1) return;

    let storedNick = "";
    let storedExplicit = "";
    try {
      storedNick = String(localStorage.getItem(NICK_KEY) || "").trim();
    } catch (e) {
      storedNick = "";
    }
    try {
      storedExplicit = String(localStorage.getItem(NICK_EXPLICIT_KEY) || "").trim();
    } catch (e) {
      storedExplicit = "";
    }

    if (storedNick) {
      try {
        if (!sessionStorage.getItem(NICK_KEY)) sessionStorage.setItem(NICK_KEY, storedNick);
      } catch (e) {}
    }
    if (storedExplicit) {
      try {
        if (!sessionStorage.getItem(NICK_EXPLICIT_KEY))
          sessionStorage.setItem(NICK_EXPLICIT_KEY, storedExplicit);
      } catch (e) {}
    }

    let ok = true;
    if (storedNick) {
      try {
        ok = ok && String(sessionStorage.getItem(NICK_KEY) || "").trim() === storedNick;
      } catch (e) {
        ok = false;
      }
    }

    if (ok) {
      try {
        localStorage.removeItem(NICK_KEY);
      } catch (e) {}
      try {
        localStorage.removeItem(NICK_EXPLICIT_KEY);
      } catch (e) {}
      writeMigrationVersion(1);
      try {
        Logger.info("migration", { step: 1 });
      } catch (e) {}
    } else {
      try {
        Logger.warn("migration_failed", { step: 1 });
      } catch (e) {}
    }
  }

  runMigrationsOnline();

  const PresenceBudget = (typeof window !== "undefined" && window.DhametPresence && window.DhametPresence.POLICY)
    ? window.DhametPresence.POLICY
    : {};
  const PRESENCE_STABLE_TTL_MS = Number(PresenceBudget.lobbyTtlMs || PresenceBudget.appPresenceTtlMs || 0) || 180 * 1000;
  const PRESENCE_LIST_TTL_MS = PRESENCE_STABLE_TTL_MS;
  const PRESENCE_ONLINE_TTL_MS = PRESENCE_STABLE_TTL_MS;

  const PRESENCE_HEARTBEAT_MS = Number(PresenceBudget.lobbyPulseActiveMs || PresenceBudget.unifiedAppPulseMs || PresenceBudget.lobbyHeartbeatMs || 0) || 30 * 1000;
  const GAME_PRESENCE_HEARTBEAT_MS = Number(PresenceBudget.gamePulseActiveMs || PresenceBudget.gameHeartbeatMs || PresenceBudget.unifiedAppPulseMs || 0) || 20 * 1000;
  const LOBBY_PULSE_ACTIVE_MS = Number(PresenceBudget.lobbyPulseActiveMs || 0) || 30 * 1000;
  const LOBBY_PULSE_IDLE_MS = Number(PresenceBudget.lobbyPulseIdleMs || 0) || 60 * 1000;
  const LOBBY_PULSE_LONG_IDLE_MS = Number(PresenceBudget.lobbyPulseLongIdleMs || 0) || 120 * 1000;
  const LOBBY_PULSE_IDLE_AFTER_MS = Number(PresenceBudget.lobbyPulseIdleAfterMs || 0) || 2 * 60 * 1000;
  const LOBBY_PULSE_LONG_IDLE_AFTER_MS = Number(PresenceBudget.lobbyPulseLongIdleAfterMs || 0) || 6 * 60 * 1000;
  const OUTGOING_INVITE_PULSE_TARGETS_MS = Object.freeze([5 * 1000, 15 * 1000, 30 * 1000, 50 * 1000]);
  const GAME_PULSE_ACTIVE_MS = Number(PresenceBudget.gamePulseActiveMs || 0) || 20 * 1000;
  const GAME_PULSE_IDLE_MS = Number(PresenceBudget.gamePulseIdleMs || 0) || 60 * 1000;
  const GAME_PULSE_LONG_IDLE_MS = Number(PresenceBudget.gamePulseLongIdleMs || 0) || 120 * 1000;
  const GAME_PULSE_IDLE_AFTER_MS = Number(PresenceBudget.gamePulseIdleAfterMs || 0) || 2 * 60 * 1000;
  const GAME_PULSE_LONG_IDLE_AFTER_MS = Number(PresenceBudget.gamePulseLongIdleAfterMs || 0) || 6 * 60 * 1000;
  const APP_PULSE_BACKGROUND_MS = Number(PresenceBudget.appPulseBackgroundMs || 0) || 120 * 1000;
  const APP_PULSE_SLOW_INITIAL_MS = Number(PresenceBudget.appPulseSlowInitialMs || 0) || 30 * 1000;
  const APP_PULSE_SLOW_LATER_MS = Number(PresenceBudget.appPulseSlowLaterMs || 0) || 60 * 1000;
  const APP_PULSE_SLOW_IDLE_MS = Number(PresenceBudget.appPulseSlowIdleMs || 0) || 120 * 1000;
  const APP_PULSE_SLOW_BACKGROUND_MS = Number(PresenceBudget.appPulseSlowBackgroundMs || 0) || 120 * 1000;
  const APP_INVITE_FALLBACK_MS = Number(PresenceBudget.appInviteFallbackMs || 0) || 25 * 1000;
  const GAME_PRESENCE_ONLINE_TTL_MS = Number(PresenceBudget.gameTtlMs || PresenceBudget.gamePresenceTtlMs || 0) || 45 * 1000;
  const SPECTATOR_COUNT_STALE_MS = Number(PresenceBudget.spectatorTtlMs || 0) || 3 * 60 * 1000;
  const INVITE_PREF_CACHE_KEY = "zamat.acceptsInvites.v1";
  const SESSION_APP_ENTRY_PULSE_KEY = "zamat.appEntryPulseSent.v2";
  const ROOM_VISIBILITY_PUBLIC = "public";
  const ROOM_VISIBILITY_PRIVATE = "private";

  const INVITE_TTL_MS = Number(PresenceBudget.inviteTtlMs || 0) || 60 * 1000;
  const OPPONENT_ABSENCE_MS = 2 * 60 * 1000;
  const MOVE_SYNC_STALL_MS = 20 * 1000;
  const MOVE_SYNC_WARN_AFTER_MS = 30 * 1000;
  const MOVE_SYNC_WATCHDOG_MS = 2 * 1000;
  function isPresenceFresh(ts, ttlMs) {
    try {
      const lastSeen = Number(ts || 0) || 0;
      const ttl = Number(ttlMs || PRESENCE_STABLE_TTL_MS) || PRESENCE_STABLE_TTL_MS;
      return !!(lastSeen && nowTs() - lastSeen <= ttl);
    } catch (e) {
      return false;
    }
  }

  function normalizeRoomVisibility(value) {
    return String(value || ROOM_VISIBILITY_PUBLIC) === ROOM_VISIBILITY_PRIVATE
      ? ROOM_VISIBILITY_PRIVATE
      : ROOM_VISIBILITY_PUBLIC;
  }

  function playerAcceptsInvites(player) {
    return !(player && player.acceptsInvites === false);
  }

  function localAcceptsInvitesPreference() {
    try {
      return localStorage.getItem(INVITE_PREF_CACHE_KEY) !== "0";
    } catch (e) {
      return true;
    }
  }

  function formatPresenceDisconnectElapsed(startedAt) {
    try {
      const start = Number(startedAt || 0) || 0;
      if (!start) return '00:00';
      const totalSeconds = Math.max(0, Math.floor((nowTs() - start) / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    } catch (e) {
      return '00:00';
    }
  }

  function getSessionUser() {
    try {
      const raw = sessionStorage.getItem("zamat.session.user.v1");
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function getNickFromSessionUser() {
    try {
      const obj = getSessionUser();
      return obj && obj.nickname ? String(obj.nickname).trim() : "";
    } catch (e) {
      return "";
    }
  }

  function getSavedNick() {
    try {
      const sessionUser = getSessionUser();
      const stored = String(sessionStorage.getItem(NICK_KEY) || "").trim();
      const explicit = String(sessionStorage.getItem(NICK_EXPLICIT_KEY) || "") === "1";

      // A nickname chosen in this browser session has first priority. Ignore the
      // historical generated guest value that older builds marked explicit.
      if (explicit && stored && !isGeneratedGuestNickname(sessionUser && sessionUser.uid, stored)) return stored;

      // Registered accounts already have a deliberate profile nickname and do
      // not need the guest nickname prompt.
      if (sessionUser && sessionUser.kind === "registered") {
        const registeredNick = String(sessionUser.nickname || "").trim();
        if (registeredNick) return registeredNick;
      }
      return "";
    } catch (e) {
      return "";
    }
  }

  function saveNickSession(nick, explicit) {
    try {
      sessionStorage.setItem(NICK_KEY, String(nick || ""));
      if (explicit) sessionStorage.setItem(NICK_EXPLICIT_KEY, "1");
    } catch (e) {}

    try {
      localStorage.removeItem(NICK_KEY);
    } catch (e) {}
    try {
      localStorage.removeItem(NICK_EXPLICIT_KEY);
    } catch (e) {}
  }

  let _authReadyPromise = null;
  async function ensureAuthReady() {
    if (!ensureCloudflareAuth()) return false;
    try {
      try {
        if ((!auth || !auth.currentUser) && window.CloudflareAuth && typeof window.CloudflareAuth.ready === "function") {
          await window.CloudflareAuth.ready();
        }
        if ((!auth || !auth.currentUser) && window.CloudflareAuth && typeof window.CloudflareAuth.refreshMe === "function") {
          await window.CloudflareAuth.refreshMe();
        }
      } catch (_) {}

      const isRegisteredSession = (function () {
        try {
          const raw = sessionStorage.getItem("zamat.session.user.v1");
          if (!raw) return false;
          const obj = JSON.parse(raw);
          return !!(obj && obj.kind === "registered");
        } catch (e) {
          return false;
        }
      })();

      if (isRegisteredSession) {
        if (auth && auth.currentUser && !auth.currentUser.isAnonymous) return true;

        const u = await new Promise((resolve) => {
          try {
            const a = auth;
            if (!a || typeof a.onAuthStateChanged !== "function") return resolve(null);

            let done = false;
            const finish = (user) => {
              if (done) return;
              done = true;
              try {
                if (typeof unsub === "function") unsub();
              } catch (_) {}
              resolve(user || null);
            };

            const timer = setTimeout(() => {
              try {
                clearTimeout(timer);
              } catch (_) {}
              const cur = a.currentUser;
              finish(cur && !cur.isAnonymous ? cur : null);
            }, 8000);

            var unsub = a.onAuthStateChanged((user) => {
              if (user && !user.isAnonymous) {
                try {
                  clearTimeout(timer);
                } catch (_) {}
                finish(user);
              }
            });
          } catch (e) {
            resolve(null);
          }
        });

        if (u && !u.isAnonymous) return true;

        try {
          const msg = window.I18N.translateArgs("online.authRestoreFailed");
          if (window.Modal && typeof Modal.alert === "function") {
            Modal.alert({
              title: window.I18N.translateArgs("topbar.login"),
              text: msg,
              okLabel: window.I18N.translateArgs("actions.ok"),
            });
          } else {
            try {
              alert(msg);
            } catch (_) {}
          }
        } catch (_) {}

        return false;
      }

      if (auth && auth.currentUser) return true;

      try {
        if (window.CloudflareAuth && typeof window.CloudflareAuth.refreshMe === "function") {
          const restored = await window.CloudflareAuth.refreshMe();
          if (restored && restored.uid && auth && auth.currentUser) return true;
        }
      } catch (_) {}

      if (!_authReadyPromise) {
        _authReadyPromise = auth
          .signInAnonymously()
          .catch((e) => {
            return null;
          })
          .then(() => !!(auth && auth.currentUser));
      }
      return await _authReadyPromise;
    } catch (e) {
      return false;
    }
  }

  function getSavedNickOrDefault(uid) {
    return getSavedNick() || defaultNick(uid);
  }

  function allowedUserIcons() {
    const raw = window.ZIconManifest && Array.isArray(window.ZIconManifest) ? window.ZIconManifest : null;
    if (raw && raw.length) {
      return raw.filter((p, i, arr) => {
        const s = String(p || "").trim();
        return /^assets\/icons\/users\/(user\d+|autouser1|autouser2|computeruser)\.png$/i.test(s) && arr.indexOf(p) === i;
      });
    }
    const a = [];
    [1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,20].forEach((i) => a.push("assets/icons/users/user" + i + ".png"));
    a.push("assets/icons/users/autouser1.png");
    a.push("assets/icons/users/autouser2.png");
    a.push("assets/icons/users/computeruser.png");
    return a;
  }

  function sanitizeUserIcon(p) {
    p = String(p || "").trim();
    p = p.replace(/^(?:\.\.\/)+/g, "").replace(/^\/+/, "");
    if (!p) return "";

    if (/^assets\/icons\/usre1\.svg$/i.test(p)) p = "assets/icons/users/user1.png";

    let m = p.match(/^assets\/icons\/user(\d+)\.(svg|png)$/i);
    if (m) p = `assets/icons/users/user${m[1]}.png`;
    if (/^assets\/icons\/user\.(svg|png)$/i.test(p)) p = "assets/icons/users/user1.png";

    m = p.match(/^assets\/icons\/users\/user(\d+)\.(svg|png)$/i);
    if (m) p = `assets/icons/users/user${m[1]}.png`;
    if (/^assets\/icons\/users\/user\.(svg|png)$/i.test(p)) p = "assets/icons/users/user1.png";

    if (/^user(\d+)$/i.test(p)) {
      const n = p.match(/^user(\d+)$/i);
      p = `assets/icons/users/user${n[1]}.png`;
    }
    if (/^user(\d+)\.(svg|png)$/i.test(p)) {
      const n = p.match(/^user(\d+)\.(svg|png)$/i);
      p = `assets/icons/users/user${n[1]}.png`;
    }
    if (/^(autouser1|autouser2|computeruser)(\.(svg|png))?$/i.test(p)) {
      const n = p.match(/^(autouser1|autouser2|computeruser)/i);
      p = `assets/icons/users/${n[1]}.png`;
    }
    if (/^assets\/icons\/users\/(autouser1|autouser2|computeruser)\.(svg|png)$/i.test(p)) {
      const n = p.match(/^assets\/icons\/users\/(autouser1|autouser2|computeruser)\.(svg|png)$/i);
      p = `assets/icons/users/${n[1]}.png`;
    }

    if (!/^assets\/icons\/users\/[a-z0-9_-]+\.png$/i.test(p)) return "";
    if (!allowedUserIcons().includes(p)) return "";
    return p;
  }

  const ASSET_PREFIX = (function () {
    try {
      const p = location && location.pathname ? String(location.pathname) : "";
      return p.includes("/pages/") ? "../" : "";
    } catch (e) {
      return "";
    }
  })();

  function iconSrcForPage(p) {
    const ic = sanitizeUserIcon(p) || "assets/icons/users/user1.png";
    return ASSET_PREFIX + ic;
  }

  function getSavedIconOrDefault() {
    const def = "assets/icons/users/user1.png";
    try {
      const raw = sessionStorage.getItem("zamat.session.user.v1");
      if (raw) {
        const obj = JSON.parse(raw);
        const ic = sanitizeUserIcon(obj && obj.icon);
        if (ic) return ic;
      }
    } catch (e) {}

    try {
      const ic = sanitizeUserIcon(localStorage.getItem("zamat.icon"));
      if (ic) return ic;
    } catch (e) {}

    return def;
  }
  function currentSessionIsRegistered() {
    try {
      if (window.ZAuth && typeof window.ZAuth.readSession === "function") {
        const s = window.ZAuth.readSession();
        return !!(s && s.kind === "registered" && s.uid);
      }
    } catch (e) {}
    return false;
  }

  function guestListIconByIndex(index) {
    return index % 2 === 0 ? ASSET_PREFIX + "assets/icons/users/autouser1.png" : ASSET_PREFIX + "assets/icons/users/autouser2.png";
  }

  function openOnlineTextPrompt(opts) {
    const cfg = opts && typeof opts === "object" ? opts : {};
    return new Promise((resolve) => {
      try {
        const body = document.createElement("div");
        if (cfg.bodyClassName) body.className = String(cfg.bodyClassName);
        if (cfg.bodyStyle && typeof cfg.bodyStyle === "object") Object.assign(body.style, cfg.bodyStyle);

        if (cfg.description) {
          const description = document.createElement("div");
          description.textContent = String(cfg.description);
          if (cfg.descriptionClassName) description.className = String(cfg.descriptionClassName);
          if (cfg.descriptionStyle && typeof cfg.descriptionStyle === "object")
            Object.assign(description.style, cfg.descriptionStyle);
          body.appendChild(description);
        }

        if (cfg.label) {
          const labelEl = document.createElement("label");
          labelEl.textContent = String(cfg.label);
          if (cfg.labelClassName) labelEl.className = String(cfg.labelClassName);
          if (cfg.labelStyle && typeof cfg.labelStyle === "object") Object.assign(labelEl.style, cfg.labelStyle);
          body.appendChild(labelEl);
        }

        const input = document.createElement("input");
        input.type = "text";
        input.value = String(cfg.value || "");
        input.placeholder = String(cfg.placeholder || "");
        input.autocomplete = cfg.autocomplete != null ? String(cfg.autocomplete) : "off";
        if (cfg.inputId) input.id = String(cfg.inputId);
        if (cfg.inputClassName) input.className = String(cfg.inputClassName);
        if (cfg.maxLength != null) input.maxLength = Number(cfg.maxLength) || input.maxLength;
        if (cfg.inputStyle && typeof cfg.inputStyle === "object") Object.assign(input.style, cfg.inputStyle);
        body.appendChild(input);

        if (typeof cfg.afterInput === "function") {
          try {
            cfg.afterInput(body, input);
          } catch (e) {}
        }

        let done = false;
        const finish = (value, submitted) => {
          if (done) return;
          done = true;
          resolve(cfg.returnMeta ? { value, submitted: !!submitted } : value);
        };

        const normalizeValue = () => {
          const raw = String(input.value || "");
          return typeof cfg.normalizeValue === "function" ? cfg.normalizeValue(raw, input) : raw.trim();
        };

        const invalid = () => {
          try {
            if (typeof cfg.onInvalid === "function") cfg.onInvalid(input);
            else input.focus();
          } catch (e) {}
        };

        const submit = () => {
          const value = normalizeValue();
          const emptyValue = typeof cfg.isEmptyValue === "function"
            ? cfg.isEmptyValue(value)
            : !String(value || "").trim();
          if (!cfg.allowEmpty && emptyValue) {
            invalid();
            return;
          }
          finish(value, true);
          if (cfg.autoCloseSubmit !== false) {
            try {
              Modal.close();
            } catch (e) {}
          }
        };

        Modal.form({
          allowSpectator: !!cfg.allowSpectator,
          allowEsc: cfg.allowEsc !== false,
          title: cfg.title,
          body,
          focusSelector: cfg.focusSelector || (cfg.inputId ? '#' + cfg.inputId : null),
          submitLabel: cfg.submitLabel || window.I18N.translateArgs("actions.ok"),
          submitClassName: cfg.submitClassName || "primary",
          onSubmit: submit,
          cancelLabel: cfg.cancelLabel || window.I18N.translateArgs("actions.cancel"),
          cancelClassName: cfg.cancelClassName || "ghost",
          onCancel: () => {
            const value = typeof cfg.getCancelValue === "function" ? cfg.getCancelValue(input) : "";
            finish(value, false);
          },
          onClose:
            typeof cfg.getCloseValue === "function"
              ? () => {
                  finish(cfg.getCloseValue(input), false);
                }
              : null,
          modalClassName: cfg.modalClassName,
        });

        if (cfg.autoFocus) {
          setTimeout(() => {
            try {
              input.focus();
            } catch (e) {}
          }, 0);
        }

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        });
      } catch (e) {
        resolve(typeof cfg.fallbackValue === "function" ? cfg.fallbackValue() : "");
      }
    });
  }

  function askNickname() {
    const saved = getSavedNick();
    const title = window.I18N.translateArgs("modals.pickOnlineNickTitle");
    const label = title;
    const resolveFallbackNick = () => {
      const uid = (auth && auth.currentUser && auth.currentUser.uid) || "";
      return saved || defaultNick(uid);
    };

    return openOnlineTextPrompt({
      returnMeta: true,
      allowSpectator: true,
      title,
      label,
      value: saved,
      placeholder: label,
      inputId: "nickInput",
      inputClassName: "input",
      maxLength: 18,
      labelStyle: { display: "block", marginBottom: "6px", fontWeight: "600" },
      normalizeValue: (raw) => {
        const nick = String(raw || "").trim();
        return nick || resolveFallbackNick();
      },
      getCancelValue: () => resolveFallbackNick(),
      getCloseValue: () => resolveFallbackNick(),
      fallbackValue: () => ({ value: resolveFallbackNick(), submitted: false }),
      cancelClassName: "secondary",
    }).then((result) => {
      const nick = result && typeof result === "object" ? result.value : result;
      if (result && typeof result === "object" && result.submitted) saveNickSession(nick, true);
      return nick;
    });
  }

  function stripUndefined(x) {
    if (x === undefined) return undefined;
    if (x === null) return null;

    if (Array.isArray(x)) {
      return x.map(stripUndefined).filter((v) => v !== undefined);
    }
    if (typeof x === "object") {
      const o = {};
      for (const k of Object.keys(x)) {
        const v = stripUndefined(x[k]);
        if (v !== undefined) o[k] = v;
      }
      return o;
    }
    return x;
  }

  function askRoomName() {
    let visibility = ROOM_VISIBILITY_PUBLIC;
    return openOnlineTextPrompt({
      title: window.I18N.translateArgs("online.roomNameTitle"),
      description: window.I18N.translateArgs("online.roomNamePrompt"),
      placeholder: window.I18N.translateArgs("online.roomNamePlaceholder"),
      maxLength: 30,
      bodyStyle: { display: "grid", gap: "10px" },
      inputStyle: {
        padding: "10px",
        border: "1px solid #666",
        borderRadius: "10px",
      },
      afterInput: (body) => {
        const wrap = document.createElement("div");
        wrap.style.display = "grid";
        wrap.style.gap = "6px";
        wrap.innerHTML = `
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="radio" name="roomVisibility" value="public" checked />
            <span>${window.I18N.translateArgs("online.roomVisibility.public")}</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="radio" name="roomVisibility" value="private" />
            <span>${window.I18N.translateArgs("online.roomVisibility.private")}</span>
          </label>
        `;
        wrap.addEventListener("change", (ev) => {
          const target = ev.target;
          if (target && target.name === "roomVisibility") visibility = normalizeRoomVisibility(target.value);
        });
        body.appendChild(wrap);
      },
      submitLabel: window.I18N.translateArgs("actions.continue"),
      submitClassName: "ok",
      cancelLabel: window.I18N.translateArgs("actions.cancel"),
      cancelClassName: "ghost",
      allowEsc: true,
      autoFocus: true,
      normalizeValue: (raw) => ({ roomName: String(raw || "").trim(), visibility: normalizeRoomVisibility(visibility) }),
      isEmptyValue: (value) => !String((value && value.roomName) || "").trim(),
      getCancelValue: () => ({ roomName: "", visibility: ROOM_VISIBILITY_PUBLIC }),
      getCloseValue: () => ({ roomName: "", visibility: ROOM_VISIBILITY_PUBLIC }),
      fallbackValue: () => ({ roomName: "", visibility: ROOM_VISIBILITY_PUBLIC }),
    });
  }

  function hasExplicitNick(uid) {
    try {
      const sessionUser = getSessionUser();
      if (sessionUser && sessionUser.kind === "registered" && String(sessionUser.nickname || "").trim()) return true;

      const flag = String(sessionStorage.getItem(NICK_EXPLICIT_KEY) || "") === "1";
      if (!flag) return false;
      const stored = String(sessionStorage.getItem(NICK_KEY) || "").trim();
      const resolvedUid = String(uid || (sessionUser && sessionUser.uid) || (auth && auth.currentUser && auth.currentUser.uid) || "").trim();
      return !!stored && !isGeneratedGuestNickname(resolvedUid, stored);
    } catch (e) {
      return false;
    }
  }

  function souflaToPlain(pending) {
    if (!pending) return null;
    const lb = [];
    try {
      pending.longestByPiece && pending.longestByPiece.forEach((v, k) => lb.push([k, v]));
    } catch (e) {}
    return {
      offenders: pending.offenders || [],
      longestByPiece: lb,
      longestGlobal: pending.longestGlobal || 0,
      options: pending.options || [],
      turnStartSnapshot: stripUndefined(pending.turnStartSnapshot) || null,
      lastPieceIdx: pending.lastPieceIdx != null ? pending.lastPieceIdx : null,
      startedFrom: pending.startedFrom != null ? pending.startedFrom : null,
      lastMoveFrom: pending.lastMoveFrom != null ? pending.lastMoveFrom : null,
      lastMovePath: Array.isArray(pending.lastMovePath) ? pending.lastMovePath.slice() : null,
      penalizer: pending.penalizer,
    };
  }

  function plainToSoufla(plain) {
    if (!plain) return null;
    const m = new Map();
    (plain.longestByPiece || []).forEach(([k, v]) => m.set(k, v));
    return {
      offenders: plain.offenders || [],
      longestByPiece: m,
      longestGlobal: plain.longestGlobal || 0,
      options: plain.options || [],
      turnStartSnapshot: plain.turnStartSnapshot || null,
      lastPieceIdx: plain.lastPieceIdx != null ? plain.lastPieceIdx : null,
      startedFrom: plain.startedFrom != null ? plain.startedFrom : null,
      lastMoveFrom: plain.lastMoveFrom != null ? plain.lastMoveFrom : null,
      lastMovePath: Array.isArray(plain.lastMovePath) ? plain.lastMovePath.slice() : null,
      penalizer: plain.penalizer,
    };
  }

  const Online = {
    isActive: false,

    isSpectator: false,

    myUid: null,

    mySide: null,

    myNick: "",

    gameId: null,

    _acceptedGameNavigationId: null,

    gameRef: null,

    _invitePreferenceRef: null,

    _invitePreferenceCb: null,

    _inviteToggleEl: null,

    _lastAcceptsInvites: true,

    _lastRoomActivityTouchAt: 0,

    _lastLobbyPresenceWriteAt: 0,

    _lastLobbyPresencePayload: null,

    _lobbyActivePlayerRooms: null,

    _lobbyPlayersLastSnap: null,

    _unifiedAppPulseTimer: null,

    _unifiedAppPulseInFlight: false,

    _unifiedPulseStarted: false,

    _pendingUnifiedPulseReasons: null,

    _lastUnifiedPulseAt: 0,

    _lastLobbyUserActivityAt: 0,

    _lastGameUserActivityAt: 0,

    _lastManualLobbyRefreshAt: 0,

    _lobbyRefreshInFlight: false,

    _pulseActivityBound: false,

    moveIndex: 0,

    ply: 0,

    _pendingSteps: [],

    _cachedSouflaPlain: null,

    _isApplyingRemote: false,

    _lastTrainLoggedMoveIndex: 0,

    _awaitingLocalCommit: false,

    _expectedMoveIndex: null,

    _moveRetryTimer: null,

    _moveRetryAttempt: 0,

    _moveRetryArgs: null,

    _moveRetryNotified: false,

    _moveCommitInFlight: null,

    _lobbyUnsub: null,

    _viewHooksInstalled: false,

    _lastSeenMoveModal: 0,

    _lastSouflaFXMoveIndex: null,

    _undoWaitOpen: false,

    _undoWaitKey: null,

    _undoWaitDismissedKey: null,

    _undoWaitAutoClose: false,

    _presenceInited: false,

    _presenceStatus: "available",

    _presenceRole: null,

    _presenceRoomId: null,

    _lobbyOpenedAt: 0,

    _outInviteWatchMap: null,

    _outInviteWatchTimer: null,

    _outInviteWatchStarted: false,

    _slowPresencePulseCount: 0,

    presenceRef: null,

    _gamePresenceJoinedAt: 0,

    _spectatorRef: null,

    _spectatorJoinedAt: 0,

    _selfOfflineSince: null,

    _oppOfflineSince: null,

    _oppLeftModalShown: false,

    _oppAbsenceWatchTimer: null,

    _oppName: "",

    _lastRenderedLogKey: "",

    _localDisplayLogEvents: [],

    _displayLogGameId: "",

    _wasConnected: true,

    _selfConnected: true,

    _oppOnline: true,

    _presenceUiReady: false,

    _presenceTicker: null,

    _presenceChipTop: null,

    _presenceChipBot: null,

    _topDisplayName: "",

    _botDisplayName: "",

    _topPresenceOnline: true,

    _botPresenceOnline: true,

    _topPresenceOfflineSince: null,

    _botPresenceOfflineSince: null,

    _moveCommitWatchdogTimer: null,

    _moveCommitStartedAt: 0,

    _moveCommitEscalatedAt: 0,

    _syncIssueVisible: false,

    _browserOfflineSince: null,

    _gameDisconnectedAt: null,

    _reconnectRecoveryBound: false,

    _autoReconnectActionAt: 0,

    _gameLiveRecoveryActive: false,

    _gameLiveRecoveryTimer: null,

    _gameLiveRecoveryAttempt: 0,

    _gameLiveRecoveryGameId: null,

    _gameLiveSocketOpen: false,

    _gameLiveRecoveryNoticeAt: 0,

    _spectatorRecoveryRegistrationAttemptAt: 0,

    _spectatorRecoveryRegistrationPromise: null,

    _applySessionState: function (input) {
          const next = input && typeof input === "object" ? input : {};
          const has = (key) => Object.prototype.hasOwnProperty.call(next, key);

          if (has("active")) this.isActive = !!next.active;
          if (has("spectator")) this.isSpectator = !!next.spectator;
          if (has("side")) this.mySide = next.side == null ? null : Number(next.side);
          if (has("gameId")) this.gameId = next.gameId ? String(next.gameId) : null;
          if (has("gameRef")) this.gameRef = next.gameRef || null;
          if (has("postMatch")) this._inPostMatch = !!next.postMatch;
          if (has("postMatchShown")) this._postMatchShown = !!next.postMatchShown;
          if (has("presenceStatus")) this._presenceStatus = next.presenceStatus || "available";
          if (has("presenceRole")) this._presenceRole = next.presenceRole || null;
          if (has("presenceRoomId")) this._presenceRoomId = next.presenceRoomId ? String(next.presenceRoomId) : null;

          try {
            if (typeof document !== "undefined" && document.body && document.body.classList) {
              document.body.classList.toggle("z-spectator", !!this.isSpectator);
            }
          } catch (error) {
            try { Logger.warn("session_state_class_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
          }

          if (next.phase && window.DhametMatchCoordinator) {
            try {
              if (next.newEpoch === false && typeof DhametMatchCoordinator.setPhase === "function") {
                DhametMatchCoordinator.setPhase(next.phase);
              } else if (typeof DhametMatchCoordinator.begin === "function") {
                DhametMatchCoordinator.begin(next.phase, next.reason || "session-state");
              }
            } catch (error) {
              try { Logger.warn("session_state_phase_failed", { phase: next.phase, error: String(error && (error.message || error)) }); } catch (_) {}
            }
          }

          return {
            active: !!this.isActive,
            spectator: !!this.isSpectator,
            side: this.mySide == null ? null : Number(this.mySide),
            gameId: this.gameId || null,
            gameRef: this.gameRef || null,
            postMatch: !!this._inPostMatch,
            presenceStatus: this._presenceStatus || "available",
            presenceRole: this._presenceRole || null,
            presenceRoomId: this._presenceRoomId || null,
          };
        },

    _handleClearedBusyReconciliation: function (staleRoomId) {
          const stale = String(staleRoomId || "").trim();
          const current = String(this.gameId || this._presenceRoomId || "").trim();
          if (stale && current && stale !== current) return false;

          this._applySessionState({
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.LEAVING : null,
            reason: "presence-cleared-busy",
          });

          try { this._unbindGameLiveSubscription && this._unbindGameLiveSubscription(); } catch (error) {
            try { Logger.warn("cleared_busy_live_teardown_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
          }
          try { this._teardownRoomComms && this._teardownRoomComms(); } catch (error) {
            try { Logger.warn("cleared_busy_comms_teardown_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
          }
          try { this.gameRef && this.gameRef.off && this.gameRef.off(); } catch (error) {
            try { Logger.warn("cleared_busy_ref_teardown_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
          }
          try { this._teardownGamePresence && this._teardownGamePresence(); } catch (error) {
            try { Logger.warn("cleared_busy_presence_teardown_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
          }
          try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (_) {}
          try { this._markLocalCommitSettled && this._markLocalCommitSettled(); } catch (_) {}
          try { this._clearPersistedActiveGame && this._clearPersistedActiveGame(); } catch (_) {}

          this._applySessionState({
            active: false,
            spectator: false,
            side: null,
            gameId: null,
            gameRef: null,
            postMatch: false,
            presenceStatus: "available",
            presenceRole: "lobby",
            presenceRoomId: null,
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.BOOTING : null,
            newEpoch: false,
            reason: "presence-cleared-busy-complete",
          });
          try { this._setOnlineButtonsState && this._setOnlineButtonsState(false); } catch (_) {}
          return true;
        },

    _bindReconnectRecovery: function () {
          try {
            if (this._reconnectRecoveryBound) return;
            this._reconnectRecoveryBound = true;
    
            window.addEventListener("offline", () => {
              try {
                if (!this.isActive) return;
                this._noteReconnectLoss("browser");
              } catch (e) {}
            });
    
            window.addEventListener("online", () => {
              try {
                this._handleReconnectRecovery();
              } catch (e) {}
            });
          } catch (e) {}
        },

    _noteReconnectLoss: function (source) {
          try {
            const ts = nowTs();
            if (source === "browser") {
              if (!this._browserOfflineSince) this._browserOfflineSince = ts;
              return;
            }
            if (!this._gameDisconnectedAt) this._gameDisconnectedAt = ts;
          } catch (e) {}
        },

    _handleReconnectRecovery: function () {
          try {
            if (!this.isActive || !this.gameRef) return "none";
            const now = nowTs();
            if (this._autoReconnectActionAt && now - this._autoReconnectActionAt < 500) return "none";
    
            const starts = [];
            if (this._browserOfflineSince) starts.push(Number(this._browserOfflineSince) || 0);
            if (this._gameDisconnectedAt) starts.push(Number(this._gameDisconnectedAt) || 0);
            this._browserOfflineSince = null;
            this._gameDisconnectedAt = null;
    
            const base = starts.filter((v) => v > 0).sort((a, b) => a - b)[0] || 0;
            const downtimeMs = base ? Math.max(0, now - base) : 0;
            if (!downtimeMs) return "none";
    
            this._autoReconnectActionAt = now;
            const reconnectGameId = String(this.gameId || "");
            try {
              // A browser may report itself online while its previous WebSocket
              // is still half-open. Rebind the existing live subscription so
              // its initial official value restores the current board state.
              if (typeof this._bindGameLiveSubscription === "function") this._bindGameLiveSubscription(reconnectGameId);
            } catch (e) {}
            try {
              const syncReason = downtimeMs >= 40 * 1000 ? "long-reconnect" : "reconnect";
              const firstSync = this.syncNow({ reason: syncReason, repairPresence: false, notifyFailure: false });
              Promise.resolve(firstSync).then((applied) => {
                if (applied) return;
                try { if (this._reconnectSyncRetryTimer) clearTimeout(this._reconnectSyncRetryTimer); } catch (_) {}
                this._reconnectSyncRetryTimer = setTimeout(() => {
                  this._reconnectSyncRetryTimer = null;
                  try {
                    if (!this.isActive || String(this.gameId || "") !== reconnectGameId) return;
                    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
                    this.syncNow({ reason: syncReason + "-retry", repairPresence: false, notifyFailure: false });
                  } catch (e) {}
                }, 1500);
              }).catch(() => {});
            } catch (e) {}
            try {
              if (this._moveRetryPausedOffline && this._moveRetryArgs && this.isActive) {
                const a = this._moveRetryArgs;
                this._moveRetryPausedOffline = false;
                setTimeout(() => {
                  try { this._scheduleMoveRetry && this._scheduleMoveRetry(a.from, a.to, a.nextTurn); } catch (e) {}
                }, 250);
              }
            } catch (e) {}
            try {
              setTimeout(() => {
                try { this._runUnifiedAppPulse && this._runUnifiedAppPulse("reconnect"); } catch (e) {}
              }, 2000);
            } catch (e) {}
            return "sync";
          } catch (e) {
            this._browserOfflineSince = null;
            this._gameDisconnectedAt = null;
          }
          return "none";
        },

    _persistActiveGame: function () {
          try {
            const gid = String(this.gameId || this._presenceRoomId || "").trim();
            if (!gid) return;
            const ts = String(Date.now());
            const uid = currentPersistUid(this);
            ssSet(PERSIST_GAME_ID_KEY, gid);
            ssSet(PERSIST_GAME_TS_KEY, ts);
            const idKey = localPersistKey(PERSIST_GAME_ID_KEY, uid);
            const tsKey = localPersistKey(PERSIST_GAME_TS_KEY, uid);
            if (idKey && tsKey) { lsSet(idKey, gid); lsSet(tsKey, ts); }
          } catch (e) {}
        },

    _clearPersistedActiveGame: function () {
          const uid = currentPersistUid(this);
          try { ssRemove(PERSIST_GAME_ID_KEY); } catch (e) {}
          try { ssRemove(PERSIST_GAME_TS_KEY); } catch (e) {}
          try {
            const idKey = localPersistKey(PERSIST_GAME_ID_KEY, uid);
            const tsKey = localPersistKey(PERSIST_GAME_TS_KEY, uid);
            if (idKey) localStorage.removeItem(idKey);
            if (tsKey) localStorage.removeItem(tsKey);
            localStorage.removeItem(PERSIST_GAME_ID_KEY);
            localStorage.removeItem(PERSIST_GAME_TS_KEY);
          } catch (e) {}
        },

    _getPersistedActiveGameId: function () {
          try {
            const fromSession = String(ssGet(PERSIST_GAME_ID_KEY) || "").trim();
            if (fromSession) return fromSession;
            const uid = currentPersistUid(this);
            const idKey = localPersistKey(PERSIST_GAME_ID_KEY, uid);
            const tsKey = localPersistKey(PERSIST_GAME_TS_KEY, uid);
            if (!idKey || !tsKey) return "";
            const fromLocal = String(lsGet(idKey) || "").trim();
            if (!fromLocal) return "";
            const ts = Number(lsGet(tsKey) || 0) || 0;
            if (ts && Date.now() - ts > PERSIST_GAME_TTL_MS) {
              try { localStorage.removeItem(idKey); } catch (e) {}
              try { localStorage.removeItem(tsKey); } catch (e) {}
              return "";
            }
            return fromLocal;
          } catch (e) {
            return "";
          }
        },


    _getKnownActivePlayerRoomId: function () {
          const gid = String(this.gameId || this._presenceRoomId || "").trim();
          return gid || "";
        },


    _rememberPresenceWrite: function (kind, payload) {
          try {
            const core = typeof window !== "undefined" ? window.DhametPresence : null;
            const remembered = core && typeof core.rememberPresenceWrite === "function"
              ? core.rememberPresenceWrite(null, payload, nowTs())
              : { lastWriteAt: nowTs(), payload: payload || null };
            if (kind === "game") {
              this._lastGamePresenceWriteAt = remembered.lastWriteAt || nowTs();
              this._lastGamePresencePayload = remembered.payload || payload || null;
            } else {
              this._lastLobbyPresenceWriteAt = remembered.lastWriteAt || nowTs();
              this._lastLobbyPresencePayload = remembered.payload || payload || null;
            }
          } catch (e) {}
        },


    _rememberUnifiedPulseReason: function (reason) {
          try {
            const r = String(reason || "tick").trim().slice(0, 50) || "tick";
            if (!this._pendingUnifiedPulseReasons) this._pendingUnifiedPulseReasons = [];
            if (!this._pendingUnifiedPulseReasons.includes(r)) this._pendingUnifiedPulseReasons.push(r);
            if (this._pendingUnifiedPulseReasons.length > 10) this._pendingUnifiedPulseReasons = this._pendingUnifiedPulseReasons.slice(-10);
          } catch (e) {}
        },

    _consumeUnifiedPulseReasons: function (primary) {
          try {
            const list = Array.isArray(this._pendingUnifiedPulseReasons) ? this._pendingUnifiedPulseReasons.slice() : [];
            this._pendingUnifiedPulseReasons = [];
            const p = String(primary || list[0] || "tick").trim().slice(0, 50) || "tick";
            if (!list.includes(p)) list.unshift(p);
            return { reason: p, reasons: list.slice(0, 10) };
          } catch (e) {
            return { reason: String(primary || "tick"), reasons: [String(primary || "tick")] };
          }
        },

    _getPendingOutgoingInvitePulseDelay: function () {
          try {
            if (!this._isUnifiedLobbyPage || !this._isUnifiedLobbyPage()) return 0;
            const now = nowTs();
            const rows = this._loadOutgoingInvites ? this._loadOutgoingInvites() : [];
            const pending = (Array.isArray(rows) ? rows : []).filter((row) => {
              if (!row || !row.gameId) return false;
              const expiresAt = Number(row.expiresAt || 0) || 0;
              return !expiresAt || now < expiresAt;
            });
            if (!pending.length) return 0;
            const createdAt = pending.reduce((latest, row) => Math.max(latest, Number(row.createdAt || 0) || now), 0) || now;
            const elapsed = Math.max(0, now - createdAt);
            for (const target of OUTGOING_INVITE_PULSE_TARGETS_MS) {
              if (elapsed < target) return Math.max(250, target - elapsed);
            }
          } catch (e) {}
          return 0;
        },

    _getUnifiedAppPulseMinGap: function () {
          try {
            const pendingDelay = this._getPendingOutgoingInvitePulseDelay ? this._getPendingOutgoingInvitePulseDelay() : 0;
            if (pendingDelay > 0) return 5 * 1000;
            const core = typeof window !== "undefined" ? window.DhametPresence : null;
            const policy = core && core.POLICY ? core.POLICY : {};
            return Number(policy.appPulseMinGapMs || 0) || 20 * 1000;
          } catch (e) {
            return 20 * 1000;
          }
        },

    _activityAdaptiveDelay: function (elapsedMs, activeMs, idleMs, longIdleMs, idleAfterMs, longIdleAfterMs) {
          try {
            const elapsed = Math.max(0, Number(elapsedMs || 0) || 0);
            if (elapsed >= (Number(longIdleAfterMs || 0) || 0)) return Number(longIdleMs || 0) || 120 * 1000;
            if (elapsed >= (Number(idleAfterMs || 0) || 0)) return Number(idleMs || 0) || 60 * 1000;
            return Number(activeMs || 0) || 30 * 1000;
          } catch (e) {
            return Number(activeMs || 0) || PRESENCE_HEARTBEAT_MS;
          }
        },

    _noteLobbyUserActivity: function (reason) {
          try {
            this._lastLobbyUserActivityAt = nowTs();
            const r = String(reason || "lobby-activity");
            if (/refresh/.test(r)) this._lastManualLobbyRefreshAt = this._lastLobbyUserActivityAt;
            this._rememberUnifiedPulseReason && this._rememberUnifiedPulseReason(r);
            if (!this._isUnifiedLobbyPage || !this._isUnifiedLobbyPage()) return false;
            const interval = this._getUnifiedAppPulseInterval ? this._getUnifiedAppPulseInterval() : PRESENCE_HEARTBEAT_MS;
            if (interval > 0 && this._scheduleUnifiedAppPulseAfter) {
              this._scheduleUnifiedAppPulseAfter(interval);
              return true;
            }
          } catch (e) {}
          return false;
        },

    _scheduleUnifiedAppPulseAfter: function (delayMs) {
          try {
            const n = Number(delayMs || 0);
            if (!Number.isFinite(n) || n < 0) return false;
            const delay = Math.max(0, n || 0);
            if (this._unifiedAppPulseTimer) clearTimeout(this._unifiedAppPulseTimer);
            this._unifiedAppPulseDueAt = nowTs() + delay;
            this._unifiedAppPulseTimer = setTimeout(() => {
              this._unifiedAppPulseTimer = null;
              this._unifiedAppPulseDueAt = 0;
              try { this._runUnifiedAppPulse(false, "tick"); } catch (e) {}
            }, delay);
            return true;
          } catch (e) {
            return false;
          }
        },

    _scheduleUnifiedAppPulseNoLaterThan: function (delayMs) {
          try {
            const delay = Math.max(0, Number(delayMs || 0) || 0);
            const dueAt = Number(this._unifiedAppPulseDueAt || 0) || 0;
            if (this._unifiedAppPulseTimer && dueAt > 0 && dueAt <= nowTs() + delay) return true;
            return this._scheduleUnifiedAppPulseAfter(delay);
          } catch (e) {
            return false;
          }
        },

    _noteOnlineGameTransportActivity: function (reason) {
          try {
            this._lastOnlineGameTransportActivityAt = nowTs();
            this._lastGameUserActivityAt = this._lastOnlineGameTransportActivityAt;
            this._rememberUnifiedPulseReason && this._rememberUnifiedPulseReason(reason || "game-activity");
            if (!this._isUnifiedOnlineGamePage || !this._isUnifiedOnlineGamePage()) return false;
            const interval = this._getUnifiedAppPulseInterval ? this._getUnifiedAppPulseInterval() : GAME_PRESENCE_HEARTBEAT_MS;
            if (interval > 0 && this._scheduleUnifiedAppPulseAfter) {
              this._scheduleUnifiedAppPulseAfter(interval);
              return true;
            }
          } catch (e) {}
          return false;
        },

    _bindUnifiedPulseActivityListeners: function () {
          try {
            if (this._pulseActivityBound || typeof document === "undefined" || !document.addEventListener) return true;
            this._pulseActivityBound = true;
            const mark = (reason) => {
              try {
                const page = this._currentPageKey ? this._currentPageKey() : "app";
                if (this._isUnifiedLobbyPage && this._isUnifiedLobbyPage(page)) this._noteLobbyUserActivity(reason || "lobby-user-activity");
                else if (this._isUnifiedOnlineGamePage && this._isUnifiedOnlineGamePage()) this._noteOnlineGameTransportActivity(reason || "game-user-activity");
              } catch (e) {}
            };
            document.addEventListener("pointerdown", () => mark("pointer"), { passive: true });
            document.addEventListener("keydown", () => mark("keyboard"));
            return true;
          } catch (e) {
            return false;
          }
        },

    _currentPageKey: function () {
          try {
            return (location && location.pathname ? String(location.pathname).split("/").pop() || "index" : "app").replace(/\.html$/i, "") || "app";
          } catch (e) {
            return "app";
          }
        },

    _isUnifiedLobbyPage: function (page) {
          const p = String(page || (this._currentPageKey && this._currentPageKey()) || "").toLowerCase();
          return p === "loby" || p === "lobby" || !!this._lobbyModalOpen;
        },

    _isUnifiedOnlineGamePage: function () {
          try {
            if (!isGamePage() || isPvCGamePage()) return false;
            const sp = new URLSearchParams(location.search || "");
            return !!(this.gameId || this._presenceRoomId || sp.get("room") || sp.get("rid") || sp.get("gid") || sp.get("game") || sp.get("id") || sp.get("spectate") || String(sp.get("pvp") || "").trim());
          } catch (e) {
            return false;
          }
        },

    _isUnifiedPeriodicPulsePage: function () {
          try { return !!this.myUid; } catch (e) { return false; }
        },

    _shouldBypassUnifiedPulseMinGap: function (force, reason) {
          try {
            if (!force) return false;
            const r = String(reason || "").toLowerCase();
            return /^(site-entry|lobby-enter|lobby-open|return-lobby|enter-pvc|pvc-exit|game-enter|game-resume|enter-game|manual-lobby-refresh|refresh-lobby|invite-toggle|accept-invite|invite-accept|reject-invite|invite-reject|logout|leave|pagehide|auth-change)$/.test(r);
          } catch (e) { return false; }
        },

    _siteEntryPulseAlreadySent: function () {
          try { return sessionStorage.getItem(SESSION_APP_ENTRY_PULSE_KEY) === String(this.myUid || ""); } catch (e) { return false; }
        },

    _markSiteEntryPulseSent: function () {
          try { if (this.myUid) sessionStorage.setItem(SESSION_APP_ENTRY_PULSE_KEY, String(this.myUid)); } catch (e) {}
        },

    _resolveUnifiedPulseScope: function (page, status, role, gameId) {
          try {
            const p = String(page || "").toLowerCase();
            const st = String(status || "");
            const rl = String(role || "");
            const gid = String(gameId || "").trim();
            if (p === "loby" || p === "lobby") return "lobby-sync";
            if (gid || st === "inPvP" || rl === "player" || rl === "spectator" || st === "spectating") return "game-presence";
            return "presence-only";
          } catch (e) { return "presence-only"; }
        },

    _shouldScheduleNextUnifiedPulse: function (payload, result) {
          try {
            const scope = String((payload && payload.scope) || (result && result.scope) || "");
            return scope === "lobby-sync" || scope === "game-presence" || scope === "presence-only" || scope === "notifications-only";
          } catch (e) { return true; }
        },


    _getUnifiedAppStatePulseInterval: function () {
          try {
            if (!this._isUnifiedPeriodicPulsePage || !this._isUnifiedPeriodicPulsePage()) return 0;
            const page = this._currentPageKey ? this._currentPageKey() : "app";
            const hidden = !!(typeof document !== "undefined" && document.hidden);
            const now = nowTs();
            if (this._isUnifiedLobbyPage && this._isUnifiedLobbyPage(page)) {
              if (!this._lastLobbyUserActivityAt) this._lastLobbyUserActivityAt = this._lobbyOpenedAt || now;
              const base = Math.max(Number(this._lastLobbyUserActivityAt || 0) || 0, Number(this._lastManualLobbyRefreshAt || 0) || 0, Number(this._lobbyOpenedAt || 0) || 0) || now;
              const delay = this._activityAdaptiveDelay(now - base, LOBBY_PULSE_ACTIVE_MS, LOBBY_PULSE_IDLE_MS, LOBBY_PULSE_LONG_IDLE_MS, LOBBY_PULSE_IDLE_AFTER_MS, LOBBY_PULSE_LONG_IDLE_AFTER_MS);
              return hidden ? Math.max(delay, APP_PULSE_BACKGROUND_MS) : Math.max(delay, APP_PULSE_SLOW_LATER_MS);
            }
            // game-live owns player/spectator liveness. The HTTP recovery path
            // refreshes persisted app state only occasionally while app-live is unavailable.
            if (this._isUnifiedOnlineGamePage && this._isUnifiedOnlineGamePage()) {
              return hidden ? APP_PULSE_SLOW_BACKGROUND_MS : APP_PULSE_SLOW_IDLE_MS;
            }
            if (hidden) return APP_PULSE_SLOW_BACKGROUND_MS;
            const count = Number(this._slowPresencePulseCount || 0) || 0;
            if (count >= 6) return APP_PULSE_SLOW_IDLE_MS;
            if (count >= 2) return APP_PULSE_SLOW_LATER_MS;
            return APP_PULSE_SLOW_INITIAL_MS;
          } catch (e) {}
          return APP_PULSE_SLOW_LATER_MS;
        },

    _needsInviteFallbackPolling: function () {
          try {
            if (this._lastAcceptsInvites !== false && localAcceptsInvitesPreference()) return true;
            const outgoing = this._loadOutgoingInvites ? this._loadOutgoingInvites() : [];
            return Array.isArray(outgoing) && outgoing.some((item) => item && item.gameId);
          } catch (e) { return true; }
        },

    _getUnifiedAppPulseInterval: function () {
          try {
            if (window.DhametAppLive && window.DhametAppLive.isConnected && window.DhametAppLive.isConnected()) return 0;
            const stateDelay = Number(this._getUnifiedAppStatePulseInterval ? this._getUnifiedAppStatePulseInterval() : 0) || 0;
            if (!stateDelay) return 0;
            const outgoingDelay = Number(this._getPendingOutgoingInvitePulseDelay ? this._getPendingOutgoingInvitePulseDelay() : 0) || 0;
            if (outgoingDelay > 0) return outgoingDelay;
            if (this._needsInviteFallbackPolling && this._needsInviteFallbackPolling()) return Math.min(stateDelay, APP_INVITE_FALLBACK_MS);
            return stateDelay;
          } catch (e) {}
          return APP_PULSE_SLOW_LATER_MS;
        },

    _buildUnifiedAppPulsePayload: function (force) {
          const ts = nowTs();
          const page = this._currentPageKey ? this._currentPageKey() : "app";
          const lobbyPage = this._isUnifiedLobbyPage ? this._isUnifiedLobbyPage(page) : (String(page || "").toLowerCase() === "loby" || String(page || "").toLowerCase() === "lobby");
          const pvcPage = isPvCGamePage();
          const onlineGamePage = this._isUnifiedOnlineGamePage ? this._isUnifiedOnlineGamePage() : (isGamePage() && !pvcPage);
          // Persisted active game ids are useful when opening an online game page,
          // but must not hijack lobby/mode/dashboard pulses. Non-game pages stay
          // available and do not run a periodic pulse.
          const rawGid = String(this.gameId || this._presenceRoomId || (onlineGamePage ? (this._getPersistedActiveGameId() || "") : "")).trim();
          const gid = pvcPage ? "" : rawGid;
          let status = this._presenceStatus || (gid ? (this.isSpectator ? "available" : "inPvP") : (pvcPage ? "vsComputer" : "available"));
          let role = this._presenceRole || (this.isSpectator ? "spectator" : (gid && status === "inPvP" ? "player" : null));
          let scope = this._resolveUnifiedPulseScope ? this._resolveUnifiedPulseScope(page, status, role, gid) : (lobbyPage ? "lobby-sync" : (gid ? "game-presence" : "presence-only"));
          if (scope === "lobby-sync" && lobbyPage && !gid && (status === "inPvP" || role === "player" || role === "spectator")) {
            status = "available";
            role = "lobby";
          }
          let outgoingGameIds = [];
          try {
            outgoingGameIds = (this._loadOutgoingInvites ? this._loadOutgoingInvites() : [])
              .map((x) => x && x.gameId ? String(x.gameId) : "")
              .filter(Boolean)
              .slice(-12);
          } catch (e) { outgoingGameIds = []; }
          const reasonText = String(this._lastUnifiedPulseReason || (Array.isArray(this._lastUnifiedPulseReasons) ? this._lastUnifiedPulseReasons.join(" ") : "") || (Array.isArray(this._pendingUnifiedPulseReasons) ? this._pendingUnifiedPulseReasons.join(" ") : "") || "").toLowerCase();
          const appLiveConnected = !!(window.DhametAppLive && window.DhametAppLive.isConnected && window.DhametAppLive.isConnected());
          const stateDelay = Number(this._getUnifiedAppStatePulseInterval ? this._getUnifiedAppStatePulseInterval() : 0) || APP_PULSE_SLOW_LATER_MS;
          const lastStatePulseAt = Number(this._lastFallbackStatePulseAt || 0) || 0;
          const periodicFallback = !force && /^(tick|visibility-hidden|visibility-return|ensure|app-live-fallback)/.test(reasonText || "tick");
          if (!appLiveConnected && periodicFallback && lastStatePulseAt > 0 && ts - lastStatePulseAt < stateDelay) {
            scope = "notifications-only";
          }
          const includeLobbyView = scope === "lobby-sync";
          const needFullPlayers = !!(
            includeLobbyView && (
              force ||
              /lobby-enter|lobby-open|return-lobby|manual-lobby-refresh|refresh-lobby|invite-toggle/.test(reasonText) ||
              !this._lastPlayersFullSyncAt ||
              ts - (Number(this._lastPlayersFullSyncAt || 0) || 0) > 60 * 1000
            )
          );
          const payload = {
            status,
            role,
            roomId: scope === "notifications-only" ? null : (gid || null),
            gameId: scope === "notifications-only" ? null : (gid || null),
            nickname: this.myNick || (this.myUid ? getSavedNickOrDefault(this.myUid) : ""),
            icon: this.myIcon || getSavedIconOrDefault(),
            registered: this._presenceRegistered !== false,
            acceptsInvites: this._lastAcceptsInvites === false ? false : localAcceptsInvitesPreference(),
            side: Number.isFinite(this.mySide) ? this.mySide : 0,
            page,
            mode: status,
            scope,
            pulseScope: scope,
            isSpectator: !!this.isSpectator || role === "spectator" || status === "spectating",
            hidden: !!(typeof document !== "undefined" && document.hidden),
            foreground: !(typeof document !== "undefined" && document.hidden),
            includeLobbyView,
            includePlayers: needFullPlayers,
            includeRooms: includeLobbyView,
            includeInvites: includeLobbyView || scope === "notifications-only",
            includeNotifications: true,
            includeCleanup: includeLobbyView,
            force: !!force,
            clientPulseId: [this.myUid || "anon", ts, Math.random().toString(36).slice(2, 8)].join(":"),
          };
          if (outgoingGameIds.length) payload.outgoingGameIds = outgoingGameIds;
          return payload;
        },



    _makeCompatSnapshot: function (value) {
          return {
            val: function () {
              try { return value == null ? null : JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
            },
            exists: function () { return value !== null && value !== undefined; },
          };
        },

    _syncMyUidFromAuth: function () {
          try {
            const liveUid = auth && auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid).trim() : "";
            if (!liveUid) return false;
            if (!this.myUid || String(this.myUid) !== liveUid) {
              this.myUid = liveUid;
              this._presenceRegistered = currentSessionIsRegistered();
              if (!this.myNick) this.myNick = getSavedNickOrDefault(liveUid);
              if (!this.myIcon) this.myIcon = getSavedIconOrDefault();
              return true;
            }
          } catch (e) {}
          return false;
        },

    _syncMyUidFromOfficialResult: function (result) {
          try {
            const uid = String((result && (result.uid || result.viewerUid)) || (result && result.view && (result.view.uid || result.view.viewerUid)) || "").trim();
            if (!uid) return false;
            if (!this.myUid || String(this.myUid) !== uid) {
              this.myUid = uid;
              this._presenceRegistered = currentSessionIsRegistered();
              if (!this.myNick) this.myNick = getSavedNickOrDefault(uid);
              if (!this.myIcon) this.myIcon = getSavedIconOrDefault();
              return true;
            }
          } catch (e) {}
          return false;
        },


    _activeOfficialGameForCurrentPlayer: function (view) {
          try {
            const uid = String(this.myUid || "").trim();
            const lobbyView = view && typeof view === "object" ? view : {};
            if (!uid) return null;

            // The Worker derives this map from the same filtered official room
            // list shown in the lobby. Prefer it so navigation and the visible
            // "return to match" room can never disagree about membership.
            const mapped = String((lobbyView.activePlayerRooms && lobbyView.activePlayerRooms[uid]) || "").trim();
            if (mapped) return mapped;

            const rooms = lobbyView.roomList && typeof lobbyView.roomList === "object"
              ? lobbyView.roomList
              : lobbyView;
            for (const [gameId, game] of Object.entries(rooms || {})) {
              if (!game || String(game.status || "") !== "active") continue;
              const whiteUid = String((game.players && game.players.white && game.players.white.uid) || "").trim();
              const blackUid = String((game.players && game.players.black && game.players.black.uid) || "").trim();
              if (uid === whiteUid || uid === blackUid) return String(gameId || "").trim() || null;
            }
          } catch (e) {}
          return null;
        },

    _applyOfficialLobbyView: function (view) {
          try {
            if (!view || typeof view !== "object") return false;
            if (view.myActiveRoom && typeof view.myActiveRoom === "object") {
              const activeRoomId = String(view.myActiveRoom.gameId || view.myActiveRoom.id || "").trim();
              if (activeRoomId) {
                view = Object.assign({}, view, {
                  roomList: Object.assign({}, view.roomList || {}, {
                    [activeRoomId]: Object.assign({}, view.myActiveRoom, {
                      gameId: activeRoomId,
                      ownerOnly: view.myActiveRoom.listed === false || view.myActiveRoom.ownerOnly === true,
                    }),
                  }),
                });
              }
            }
            try { this._syncMyUidFromAuth && this._syncMyUidFromAuth(); } catch (e) {}
            try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(view); } catch (e) {}
            this._lastOfficialLobbyView = view;
            this._lastOfficialLobbyViewAt = nowTs();
            if (view.players && typeof view.players === "object") this._lastPlayersFullSyncAt = nowTs();
            // Active matches are rendered as explicit return cards in the lobby.
            // Automatic navigation is reserved for newly accepted invitations,
            // which are delivered through inviteResults.
            if (view.players && this._lobbyPlayersCb) {
              try { this._lobbyPlayersCb(this._makeCompatSnapshot(view.players)); } catch (e) {}
            }
            if (view.roomList && this._lobbyRoomsCb) {
              try { this._lobbyRoomsCb(this._makeCompatSnapshot(view.roomList)); } catch (e) {}
            }
            if (view.invites && this._inviteOfficialHandler) {
              try { this._inviteOfficialHandler(view.invites); } catch (e) {}
            }
            return true;
          } catch (e) {
            return false;
          }
        },


    _applyPulseNotifications: async function (notifications) {
          try {
            const n = notifications && typeof notifications === "object" ? notifications : null;
            if (!n) return false;
            if (n.incomingInvites && this._inviteOfficialHandler) {
              try { this._inviteOfficialHandler(n.incomingInvites); } catch (e) {}
            }
            let acceptedHandled = false;
            if (n.outgoingGames) {
              try { acceptedHandled = !!(await this._applyOfficialOutgoingInviteUpdates(n.outgoingGames)); } catch (e) {}
            }
            if (!acceptedHandled && n.acceptedGameId) {
              try { await this._handleOutgoingInviteAccepted(String(n.acceptedGameId)); } catch (e) {}
            }
            return true;
          } catch (e) {
            return false;
          }
        },

    _applyOfficialOutgoingInviteUpdates: async function (outgoingGames) {
          try {
            const games = outgoingGames && typeof outgoingGames === "object" ? outgoingGames : {};
            for (const gid of Object.keys(games)) {
              const g = games[gid];
              if (!g) {
                try { this._untrackOutgoingInviteByGame(gid); } catch (e) {}
                continue;
              }
              const st = String(g.status || "");
              const acceptedAt = Number(g.acceptedAt || 0) || 0;
              if (acceptedAt > 0 && (st === "active" || st === "pending")) {
                try { await this._handleOutgoingInviteAccepted(gid); } catch (e) {}
                return true;
              }
              if (st === "rejected" || st === "ended") {
                try { this._untrackOutgoingInviteByGame(gid); } catch (e) {}
              }
            }
            return false;
          } catch (e) {
            return false;
          }
        },

    _appLiveLobbyMode: function () {
          try {
            const page = this._currentPageKey ? this._currentPageKey() : "app";
            return !!(this._isUnifiedLobbyPage && this._isUnifiedLobbyPage(page));
          } catch (e) {
            return false;
          }
        },

    _appLivePresencePayload: function () {
          try {
            const pulse = this._buildUnifiedAppPulsePayload ? this._buildUnifiedAppPulsePayload(false) : {};
            return {
              status: pulse.status || "available",
              role: pulse.role || null,
              roomId: pulse.roomId || pulse.gameId || null,
              nickname: pulse.nickname || this.myNick || "",
              icon: pulse.icon || this.myIcon || "",
              registered: pulse.registered !== false,
              acceptsInvites: pulse.acceptsInvites !== false,
              page: pulse.page || "app",
              mode: pulse.mode || pulse.status || "available",
              isSpectator: !!pulse.isSpectator,
              hidden: !!(typeof document !== "undefined" && document.hidden),
              foreground: !(typeof document !== "undefined" && document.hidden),
            };
          } catch (e) {
            return { status: "available", role: "lobby", page: "app", foreground: true };
          }
        },

    _activePlayerRoomsFromRoomList: function (roomList) {
          const mapped = {};
          try {
            for (const [gameId, room] of Object.entries(roomList && typeof roomList === "object" ? roomList : {})) {
              if (!room || String(room.status || "") !== "active") continue;
              const players = room.players && typeof room.players === "object" ? room.players : {};
              for (const side of ["white", "black"]) {
                const uid = String(players[side] && players[side].uid || "").trim();
                if (uid) mapped[uid] = String(gameId || "");
              }
            }
          } catch (e) {}
          return mapped;
        },

    _handleAppLiveSnapshot: async function (snapshot) {
          try {
            const src = snapshot && typeof snapshot === "object" ? snapshot : {};
            const roomList = src.roomList && typeof src.roomList === "object" ? Object.assign({}, src.roomList) : {};
            const myActiveRoom = src.myActiveRoom && typeof src.myActiveRoom === "object" ? Object.assign({}, src.myActiveRoom) : null;
            if (myActiveRoom) {
              const myRoomId = String(myActiveRoom.gameId || myActiveRoom.id || "").trim();
              if (myRoomId) roomList[myRoomId] = Object.assign({}, myActiveRoom, {
                gameId: myRoomId,
                ownerOnly: myActiveRoom.listed === false || myActiveRoom.ownerOnly === true,
              });
            }
            const view = {
              uid: src.uid || this.myUid || null,
              viewerUid: src.viewerUid || src.uid || this.myUid || null,
              players: src.players && typeof src.players === "object" ? src.players : {},
              roomList,
              activePlayerRooms: src.activePlayerRooms && typeof src.activePlayerRooms === "object"
                ? src.activePlayerRooms
                : this._activePlayerRoomsFromRoomList(roomList),
              myActiveRoom,
              invites: src.invites && typeof src.invites === "object" ? src.invites : {},
              generatedAt: Number(src.generatedAt || nowTs()) || nowTs(),
              source: src.source || "app-live-v1",
            };
            this._applyOfficialLobbyView(view);
            const results = src.inviteResults && typeof src.inviteResults === "object" ? src.inviteResults : {};
            await this._applyOfficialOutgoingInviteUpdates(results);
            for (const [gameId, result] of Object.entries(results)) {
              const status = String(result && result.status || "");
              if (status !== "active" && status !== "rejected" && status !== "ended" && status !== "expired") continue;
              try {
                if (window.DhametAppLive && typeof window.DhametAppLive.ackInviteResult === "function") {
                  window.DhametAppLive.ackInviteResult(gameId);
                }
              } catch (e) {}
            }
            return true;
          } catch (e) {
            try { Logger.warn("app_live_snapshot_failed", { err: String(e && (e.message || e)) }); } catch (_) {}
            return false;
          }
        },

    _startAppLive: function () {
          try {
            if (!this.myUid || !window.DhametAppLive || typeof window.DhametAppLive.start !== "function") return false;
            if (this._appLiveStarted) {
              window.DhametAppLive.refreshPresence(false);
              return true;
            }
            this._appLiveStarted = true;
            window.DhametAppLive.start({
              getPresence: () => this._appLivePresencePayload(),
              includeLobby: () => this._appLiveLobbyMode(),
              onSnapshot: (snapshot) => { this._handleAppLiveSnapshot(snapshot); },
              onState: (transport) => {
                try {
                  this._appLiveConnected = !!(transport && transport.connected);
                  if (this._appLiveConnected) {
                    if (this._unifiedAppPulseTimer) clearTimeout(this._unifiedAppPulseTimer);
                    this._unifiedAppPulseTimer = null;
                    this._unifiedAppPulseDueAt = 0;
                  } else if (this.myUid && this._scheduleUnifiedAppPulseAfter) {
                    this._scheduleUnifiedAppPulseAfter(10000);
                  }
                } catch (e) {}
              },
            });
            return true;
          } catch (e) {
            this._appLiveStarted = false;
            return false;
          }
        },

    _stopAppLive: function () {
          try {
            if (window.DhametAppLive && typeof window.DhametAppLive.stop === "function") window.DhametAppLive.stop();
          } catch (e) {}
          this._appLiveStarted = false;
          this._appLiveConnected = false;
        },

    _dispatchUnifiedAppPulseNow: async function (force, reason) {
          try {
            if (!this.myUid) return false;
            if (!requireAuthUid(this.myUid)) {
              try { this._stopUnifiedAppPulse(); } catch (e) {}
              return false;
            }
            const reasonInfo = this._consumeUnifiedPulseReasons ? this._consumeUnifiedPulseReasons(reason || (force ? "event" : "tick")) : { reason: reason || "tick", reasons: [reason || "tick"] };
            this._lastUnifiedPulseReason = reasonInfo.reason;
            this._lastUnifiedPulseReasons = reasonInfo.reasons;
            const payload = this._buildUnifiedAppPulsePayload(!!force);
            this._lastUnifiedPulsePayload = payload;
            payload.reason = reasonInfo.reason;
            payload.reasons = reasonInfo.reasons;
            payload.kind = payload.kind || "app-pulse";
            payload.action = reasonInfo.reason;
            let result = null;
            if (window.DhametGameRoomClient && typeof window.DhametGameRoomClient.commitAppPulse === "function") {
              result = await window.DhametGameRoomClient.commitAppPulse(payload);
            } else if (this._writeLobbyPresencePayload) {
              // Local static recovery path. Production
              // Cloudflare builds use /dhamet/api/lobby/pulse.
              const body = {
                updatedAt: nowTs(),
                status: payload.status,
                role: payload.role || undefined,
                roomId: payload.roomId || undefined,
                nickname: payload.nickname,
                icon: payload.icon,
                registered: payload.registered,
                acceptsInvites: payload.acceptsInvites,
                side: payload.side,
              };
              this._rememberPresenceWrite && this._rememberPresenceWrite("lobby", body);
              result = { ok: true, committed: true, fallback: true };
            }
            try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(result); } catch (e) {}
            this._lastUnifiedPulseAt = nowTs();
            if (result && payload.scope !== "notifications-only") this._lastFallbackStatePulseAt = this._lastUnifiedPulseAt;
            try {
              const scopeForCount = String(payload && payload.scope || "");
              if (scopeForCount === "presence-only") this._slowPresencePulseCount = (Number(this._slowPresencePulseCount || 0) || 0) + 1;
              else this._slowPresencePulseCount = 0;
            } catch (e) {}
            try {
              if (this._outInviteWatchStarted && typeof this._refreshOutgoingInviteWatches === "function") {
                this._refreshOutgoingInviteWatches();
              }
            } catch (e) {}
            if (result && result.presence) {
              try { this._rememberPresenceWrite("lobby", result.presence); } catch (e) {}
              try {
                const ps = String(result.presence.status || "");
                const pr = String(result.presence.role || "");
                const rid = String(result.presence.roomId || "").trim();
                this._applySessionState({
                  presenceStatus: ps || this._presenceStatus,
                  presenceRole: pr || this._presenceRole,
                  presenceRoomId: rid || null,
                });
              } catch (e) {}
            }
            if (result && result.reconciliation && result.reconciliation.action === "cleared-busy") {
              try {
                this._handleClearedBusyReconciliation(result.reconciliation.staleRoomId);
              } catch (error) {
                try { Logger.warn("cleared_busy_reconciliation_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
              }
            }
            if (result && result.notifications) {
              try { await this._applyPulseNotifications(result.notifications); } catch (e) {}
            }
            if (result && result.lobbyView && !result.lobbyView.error) {
              try { this._applyOfficialLobbyView(result.lobbyView); } catch (e) {}
              try { await this._applyOfficialOutgoingInviteUpdates(result.lobbyView.outgoingGames); } catch (e) {}
            }
            if (result && result.opponent) {
              try {
                this._oppOnline = !!result.opponent.online;
                if (result.opponent.lastSeenAt) this._oppLastSeenAt = result.opponent.lastSeenAt;
                if (result.opponent.online) {
                  this._oppOfflineSince = null;
                  this._oppLeftModalShown = false;
                } else if (!this._oppOfflineSince) {
                  this._oppOfflineSince = Number(result.opponent.absenceDetectedAt || 0) || nowTs();
                }
                const offlineFor = this._oppOfflineSince ? nowTs() - Number(this._oppOfflineSince || 0) : 0;
                if (offlineFor >= OPPONENT_ABSENCE_MS && !this._oppLeftModalShown) this._openOpponentAbsenceModal();
                this._updatePresenceUi && this._updatePresenceUi();
              } catch (e) {}
            } else {
              try { if (this.isActive && !this.isSpectator) this._checkOpponentAbsence(); } catch (e) {}
            }
            return result || true;
          } catch (e) {
            try { Logger.warn("unified_app_pulse_failed", { err: String(e && (e.message || e)) }); } catch (_) {}
            return false;
          }
        },

    _runUnifiedAppPulse: async function (force, reason) {
          try {
            const r = typeof force === "string" ? force : (reason || (force ? "event" : "tick"));
            this._rememberUnifiedPulseReason && this._rememberUnifiedPulseReason(r);
            if (!this.myUid) return false;
            if (!requireAuthUid(this.myUid)) {
              try { this._stopUnifiedAppPulse(); } catch (e) {}
              return false;
            }
            try {
              this._startAppLive && this._startAppLive();
              if (window.DhametAppLive && typeof window.DhametAppLive.refreshPresence === "function") {
                window.DhametAppLive.refreshPresence(!!force);
                if (/manual-lobby-refresh|refresh-lobby|lobby-enter|lobby-open|return-lobby/.test(String(r || "")) && typeof window.DhametAppLive.requestSnapshot === "function") {
                  window.DhametAppLive.requestSnapshot();
                }
                if (window.DhametAppLive.isConnected && window.DhametAppLive.isConnected()) {
                  this._lastUnifiedPulseAt = nowTs();
                  return { ok: true, committed: false, live: true, reason: r };
                }
                if (window.DhametAppLive.isLeader && !window.DhametAppLive.isLeader()) {
                  return { ok: true, committed: false, delegated: true, reason: "app-live-leader-fallback" };
                }
              }
            } catch (e) {}
            if (this._unifiedAppPulseInFlight) {
              this._scheduleUnifiedAppPulseAfter && this._scheduleUnifiedAppPulseAfter(this._getUnifiedAppPulseMinGap ? this._getUnifiedAppPulseMinGap() : PRESENCE_HEARTBEAT_MS);
              return { ok: true, deferred: true, reason: "in-flight" };
            }
            const at = nowTs();
            const minGap = this._getUnifiedAppPulseMinGap ? this._getUnifiedAppPulseMinGap() : PRESENCE_HEARTBEAT_MS;
            const last = Number(this._lastUnifiedPulseAt || 0) || 0;
            const remaining = last ? Math.max(0, minGap - (at - last)) : 0;
            const bypassMinGap = this._shouldBypassUnifiedPulseMinGap ? this._shouldBypassUnifiedPulseMinGap(!!force, r) : false;
            if (remaining > 0 && !bypassMinGap) {
              const interval = this._getUnifiedAppPulseInterval ? this._getUnifiedAppPulseInterval() : PRESENCE_HEARTBEAT_MS;
              if (interval > 0) this._scheduleUnifiedAppPulseAfter && this._scheduleUnifiedAppPulseAfter(remaining);
              return { ok: true, deferred: true, nextInMs: remaining };
            }
            try { if (this._unifiedAppPulseTimer) clearTimeout(this._unifiedAppPulseTimer); } catch (e) {}
            this._unifiedAppPulseTimer = null;
            this._unifiedAppPulseDueAt = 0;
            this._unifiedAppPulseInFlight = true;
            const res = await this._dispatchUnifiedAppPulseNow(!!force, r);
            this._unifiedAppPulseInFlight = false;
            const lastPayload = this._lastUnifiedPulsePayload || null;
            if (!this._shouldScheduleNextUnifiedPulse || this._shouldScheduleNextUnifiedPulse(lastPayload, res)) {
              const clientDelay = this._getUnifiedAppPulseInterval ? Number(this._getUnifiedAppPulseInterval() || 0) : PRESENCE_HEARTBEAT_MS;
              const minDelay = this._getUnifiedAppPulseMinGap ? Number(this._getUnifiedAppPulseMinGap() || 0) : 0;
              const nextDelay = clientDelay > 0 ? Math.max(minDelay || 0, clientDelay) : 0;
              if (nextDelay > 0) this._scheduleUnifiedAppPulseAfter && this._scheduleUnifiedAppPulseAfter(nextDelay);
            } else {
              try { if (this._unifiedAppPulseTimer) clearTimeout(this._unifiedAppPulseTimer); } catch (_) {}
              this._unifiedAppPulseTimer = null;
            }
            return res;
          } catch (e) {
            this._unifiedAppPulseInFlight = false;
            try { Logger.warn("unified_app_pulse_failed", { err: String(e && (e.message || e)) }); } catch (_) {}
            try { this._scheduleUnifiedAppPulseAfter && this._scheduleUnifiedAppPulseAfter(this._getUnifiedAppPulseInterval ? this._getUnifiedAppPulseInterval() : PRESENCE_HEARTBEAT_MS); } catch (_) {}
            return false;
          }
        },

    _ensureUnifiedAppPulse: function (reason, force) {
          try {
            try { this._bindUnifiedPulseActivityListeners && this._bindUnifiedPulseActivityListeners(); } catch (e) {}
            try { this._bindLobbyManualRefreshButton && this._bindLobbyManualRefreshButton(); } catch (e) {}
            if (!this.myUid) return false;
            this._unifiedPulseStarted = true;
            this._rememberUnifiedPulseReason && this._rememberUnifiedPulseReason(reason || "ensure");
            if (force !== false) {
              try { this._runUnifiedAppPulse(!!force, reason || "ensure"); } catch (e) {}
            } else if (!this._unifiedAppPulseTimer) {
              const last = Number(this._lastUnifiedPulseAt || 0) || 0;
              const minGap = this._getUnifiedAppPulseMinGap ? this._getUnifiedAppPulseMinGap() : PRESENCE_HEARTBEAT_MS;
              const delay = last ? Math.max(0, minGap - (nowTs() - last)) : 0;
              const interval = this._getUnifiedAppPulseInterval();
              if (interval > 0) this._scheduleUnifiedAppPulseAfter(delay || interval);
            }
            if (!this._unifiedPulseVisibilityBound && typeof document !== "undefined" && document.addEventListener) {
              this._unifiedPulseVisibilityBound = true;
              document.addEventListener("visibilitychange", () => {
                try {
                  this._rememberUnifiedPulseReason && this._rememberUnifiedPulseReason(document.hidden ? "visibility-hidden" : "visibility-return");
                  const last = Number(this._lastUnifiedPulseAt || 0) || 0;
                  const minGap = this._getUnifiedAppPulseMinGap ? this._getUnifiedAppPulseMinGap() : PRESENCE_HEARTBEAT_MS;
                  const delay = last ? Math.max(0, minGap - (nowTs() - last)) : 0;
                  const interval = this._getUnifiedAppPulseInterval();
                  if (interval > 0) this._scheduleUnifiedAppPulseAfter(document.hidden ? interval : delay);
                } catch (e) {}
              });
            }
            return true;
          } catch (e) {
            return false;
          }
        },

    _stopUnifiedAppPulse: function () {
          try {
            if (this._unifiedAppPulseTimer) clearTimeout(this._unifiedAppPulseTimer);
          } catch (e) {}
          this._unifiedAppPulseTimer = null;
          this._unifiedAppPulseDueAt = 0;
        },

    _sendUnifiedAppLeaveBeacon: function (reason) {
          try {
            if (!this.myUid) return false;
            const liveReason = String(reason || "pagehide");
            if (this._appLiveStarted && window.DhametAppLive) {
              if (/^pvc-exit$/i.test(liveReason)) {
                this._applySessionState({ presenceStatus: "available", presenceRole: "app", presenceRoomId: null });
                try { window.DhametAppLive.refreshPresence(true); } catch (e) {}
              }
              // Socket closure and the server-side disconnect grace replace
              // unload writes. Another tab can retain the shared connection.
              return true;
            }
            const payload = typeof this._buildUnifiedAppPulsePayload === "function"
              ? this._buildUnifiedAppPulsePayload(true)
              : {};
            const why = String(reason || "pagehide");
            const gid = String(payload.gameId || payload.roomId || this.gameId || this._presenceRoomId || "").trim();
            const softPageExit = /^(pagehide|beforeunload|visibility-hidden|tab-hidden)$/i.test(why);

            // Leaving a local computer game is a presence transition, not a global
            // leave. It should mark the browser available without starting a timer.
            if (/^pvc-exit$/i.test(why)) {
              payload.kind = "app-pulse";
              payload.leave = false;
              payload.status = "available";
              payload.role = "app";
              payload.roomId = null;
              payload.gameId = null;
              payload.scope = "presence-only";
            // Refreshing the page, switching tabs, or closing one window must not
            // mean that a player resigned/left the active match. Keep the active
            // game identity alive and let normal absence TTL handle real disconnects.
            } else if (softPageExit && gid && !this.isSpectator) {
              payload.kind = "app-pulse";
              payload.leave = false;
              payload.status = "inPvP";
              payload.role = "player";
              payload.roomId = gid;
              payload.gameId = gid;
              payload.scope = "game-presence";
            } else {
              payload.kind = "leave";
              payload.leave = true;
              payload.scope = payload.gameId || payload.roomId ? "game-presence" : "presence-only";
            }
            payload.includeLobbyView = false;
            payload.includePlayers = false;
            payload.includeRooms = false;
            payload.includeInvites = false;
            payload.includeCleanup = false;
            payload.hidden = true;
            payload.foreground = false;
            payload.force = true;
            payload.reason = why;
            const body = JSON.stringify(payload);
            if (typeof navigator !== "undefined" && navigator.sendBeacon) {
              try {
                const blob = new Blob([body], { type: "application/json" });
                if (navigator.sendBeacon("/dhamet/api/lobby/pulse", blob)) return true;
              } catch (e) {}
            }
            if (typeof fetch === "function") {
              try {
                fetch("/dhamet/api/lobby/pulse", {
                  method: "POST",
                  credentials: "same-origin",
                  keepalive: true,
                  headers: { "content-type": "application/json" },
                  body: body,
                }).catch(function () {});
                return true;
              } catch (e) {}
            }
          } catch (e) {}
          return false;
        },

    _writeLobbyPresencePayload: function (payload, ctx, force, onDenied) {
          // Browser-side writes to players/<uid> are not allowed. Presence is
          // committed only through /dhamet/api/lobby/pulse; this method updates local
          // presence state and triggers the unified pulse when the central
          // presence policy says the write is material or due.
          try {
            const body = payload || {};
            const core = typeof window !== "undefined" ? window.DhametPresence : null;
            const shouldWrite = !core || typeof core.shouldWritePresence !== "function" || core.shouldWritePresence({
              previous: this._lastLobbyPresencePayload || null,
              next: body,
              force: !!force,
              minIntervalMs: PRESENCE_HEARTBEAT_MS,
              lastWriteAt: this._lastLobbyPresenceWriteAt || 0,
              now: nowTs(),
            });
            if (!shouldWrite) return true;
            this._applySessionState({
              ...(body.status ? { presenceStatus: String(body.status) } : {}),
              ...(body.role !== undefined ? { presenceRole: body.role || null } : {}),
              ...(body.roomId !== undefined ? { presenceRoomId: body.roomId || null } : {}),
            });
            this._rememberPresenceWrite("lobby", body);
            if (typeof this._runUnifiedAppPulse === "function") this._runUnifiedAppPulse(true, ctx || "lobby-presence");
            return true;
          } catch (e) {
            return false;
          }
        },

    _markPlayerBusyWithRoom: async function (gameId, ctx, options) {
          const gid = String(gameId || "").trim();
          if (!gid || !this.myUid) return false;
          const cfg = options && typeof options === "object" ? options : {};
          this._applySessionState({
            presenceStatus: "inPvP",
            presenceRole: "player",
            presenceRoomId: gid,
          });
          if (!cfg.deferPulse) {
            try { await this._runUnifiedAppPulse(true, "enter-game"); } catch (e) {}
          }
          return true;
        },

    _markBusyIfActivePlayerRoom: async function (ctx, options) {
          const gid = this._getKnownActivePlayerRoomId ? this._getKnownActivePlayerRoomId() : "";
          if (!gid) return false;
          return await this._markPlayerBusyWithRoom(gid, ctx || "players.activeRoom", options);
        },

    _syncLobbyAvailabilityFromActiveGame: async function (options) {
          const cfg = options && typeof options === "object" ? options : {};
          const busy = await this._markBusyIfActivePlayerRoom("players.lobbyActiveRoom", cfg);
          if (busy) return true;
          await this._setLobbyStatus("available", cfg);
          return false;
        },

    initPresence: async function (options) {
          const cfg = options && typeof options === "object" ? options : {};
          const deferHeartbeat = !!cfg.deferHeartbeat;
          if (this._presenceInitPromise) {
            const pendingResult = await this._presenceInitPromise;
            if (pendingResult && !deferHeartbeat) {
              try { this._startPresenceHeartbeat(); } catch (e) {}
            }
            return pendingResult;
          }
          const self = this;
          const initPromise = (async function () {
          const ok = await ensureAuthReady();
          if (!ok) return false;

          try {
            const liveUid = auth && auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : "";
            if (this._presenceInited && this.myUid && liveUid && this.myUid !== liveUid) {
              try {
                this._stopPresenceHeartbeat();
              } catch (e) {}
              try {
                this._teardownGamePresence();
              } catch (e) {}
              try {
                if (this._presenceConnInfoRef && this._presenceConnInfoHandler) {
                  this._presenceConnInfoRef.off("value", this._presenceConnInfoHandler);
                }
              } catch (e) {}
              this._presenceConnInfoRef = null;
              this._presenceConnInfoHandler = null;
              this._presenceInited = false;
              this.presenceRef = null;
              this._spectatorRef = null;
              this._spectatorJoinedAt = 0;
              try {
                // No direct remove on logout/user switch. Presence expiry
                // and leave beacons are handled by /dhamet/api/lobby/pulse.
                this._sendUnifiedAppLeaveBeacon && this._sendUnifiedAppLeaveBeacon("user-switch");
              } catch (e) {}
            }
            if (this._presenceInited) {
              if (!deferHeartbeat) {
                try { this._startPresenceHeartbeat(); } catch (e) {}
              }
              return true;
            }
          } catch (e) {}

          if (!ok) return false;

          try {
            this.myUid = auth.currentUser.uid;

            this.myNick = getSavedNickOrDefault(this.myUid);
            this.myIcon = getSavedIconOrDefault();
            this._presenceRegistered = currentSessionIsRegistered();

            const initialPresenceStatus = isPvCGamePage() ? "vsComputer" : "available";
            this._applySessionState({
              presenceStatus: initialPresenceStatus,
              presenceRole: initialPresenceStatus === "available" ? "lobby" : null,
              presenceRoomId: null,
            });

            const serverNow = () => nowTs();
            const payload = () => ({
              status: this._presenceStatus || (isPvCGamePage() ? "vsComputer" : "available"),
              role:
                this._presenceRole ||
                (this._presenceStatus === "inPvP"
                  ? "player"
                  : this._presenceStatus === "spectating"
                    ? "spectator"
                    : this._presenceStatus === "available"
                      ? "lobby"
                      : null),
              roomId: this._presenceRoomId || null,
              nickname: this.myNick || getSavedNickOrDefault(this.myUid),
              icon: this.myIcon || getSavedIconOrDefault(),
              registered: this._presenceRegistered !== false,
              acceptsInvites: this._lastAcceptsInvites === false ? false : localAcceptsInvitesPreference(),
              updatedAt: serverNow(),
            });

            try {
              this._presenceConnInfoRef = null;
              this._presenceConnInfoHandler = null;
            } catch (e) {}
            try {
              this._rememberPresenceWrite && this._rememberPresenceWrite("lobby", payload());
            } catch (e) {}

            this._presenceInited = true;
            if (!deferHeartbeat) {
              try {
                this._startPresenceHeartbeat();
              } catch (e) {}
            }
            try {
              this._bindLifecycleCleanup();
            } catch (e) {}
            try {
              this._bindInvitePreferenceListener();
            } catch (e) {}
            return true;
          } catch (e) {
            return false;
          }

          }).call(this);
          this._presenceInitPromise = initPromise;
          try {
            return await initPromise;
          } finally {
            if (self._presenceInitPromise === initPromise) self._presenceInitPromise = null;
          }
        },

    _startPresenceHeartbeat: function () {
          // The app-wide WebSocket carries presence and invite events on every
          // authenticated page. HTTP pulse remains only as a failure fallback.
          try {
            if (this._startAppLive && this._startAppLive()) {
              try { window.DhametAppLive.refreshPresence(true); } catch (e) {}
              if (!window.DhametAppLive.isConnected || !window.DhametAppLive.isConnected()) {
                this._scheduleUnifiedAppPulseAfter && this._scheduleUnifiedAppPulseAfter(10000);
              }
              return true;
            }
          } catch (e) {}
          return this._ensureUnifiedAppPulse("app-live-fallback", true);
        },

    _stopPresenceHeartbeat: function () {
          try { this._stopAppLive && this._stopAppLive(); } catch (e) {}
          return this._stopUnifiedAppPulse();
        },

    _bindLifecycleCleanup: function () {
          try {
            if (this._lifecycleBound) return;
            this._lifecycleBound = true;
    
            let cleanupSent = false;
            const cleanup = () => {
              if (cleanupSent) return;
              cleanupSent = true;
              let internalNav = false;
              try {
                const ts = parseInt(ssGet("zamat.internalNavTs") || "0", 10);
                internalNav = !!(ts && Date.now() - ts < 2500);
              } catch (e) {}

              // Page unload must not perform direct realtime removals
              // or roomList touches from the browser. External exits are sent as a
              // best-effort unified pulse beacon; internal navigation lets the next
              // page send its immediate foreground pulse.
              try {
                if (isPvCGamePage()) this._sendUnifiedAppLeaveBeacon("pvc-exit");
                else if (!internalNav) this._sendUnifiedAppLeaveBeacon("pagehide");
              } catch (e) {}
              try {
                this._stopPresenceHeartbeat();
              } catch (e) {}
            };
    
            window.addEventListener("pagehide", cleanup, { capture: true });
            window.addEventListener("beforeunload", cleanup, { capture: true });
            window.addEventListener("pageshow", (event) => {
              try {
                cleanupSent = false;
                if (!event || !event.persisted) return;
                this._ensureUnifiedAppPulse("bfcache-restore", false);
                if (this.isActive && this.gameId) this.syncNow({ reason: "bfcache", repairPresence: false, notifyFailure: false });
              } catch (e) {}
            }, { capture: true });
            try {
              this._bindReconnectRecovery();
            } catch (e) {}
          } catch (e) {}
        },

    initInvitesPassive: async function (options) {
          try {
            const cfg = options && typeof options === "object" ? options : {};
            const deferHeartbeat = !!cfg.deferHeartbeat;
            const deferPulse = !!cfg.deferPulse;
            if (!ensureCloudflareAuth()) return;
            const authReady = await ensureAuthReady();
            if (!authReady) return;
            if (!this._presenceInited) {
              await this.initPresence({ deferHeartbeat });
            }
            const user = auth && auth.currentUser;
            if (!user) return;
    
            this.myUid = user.uid;
    
            if (this._invitesPassiveOn) return;
            this._invitesPassiveOn = true;
    
            if (typeof this._listenInvites === "function") {
              this._listenInvites({ deferPulse });
            }
    
            try {
              if (typeof this._startOutgoingInviteWatches === "function")
                this._startOutgoingInviteWatches();
            } catch (e) {}
            try {
              if (typeof this._refreshOutgoingInviteWatches === "function")
                this._refreshOutgoingInviteWatches();
            } catch (e) {}
          } catch (e) {}
        },

    _listenInvites: function (options) {
          try {
            this._bindInviteListener(options);
          } catch (e) {}
        },

    _bindInvitePreferenceListener: function () {
          // Invite preference is local UI state committed by the unified
          // app pulse. Do not open a realtime players/<uid>/acceptsInvites listener.
          try {
            this._restoreInviteToggleFromCache && this._restoreInviteToggleFromCache();
          } catch (e) {}
          return false;
        },

    _unbindInvitePreferenceListener: function () {
          try {
            if (this._invitePreferenceRef && this._invitePreferenceCb) {
              this._invitePreferenceRef.off("value", this._invitePreferenceCb);
            }
          } catch (e) {}
          this._invitePreferenceRef = null;
          this._invitePreferenceCb = null;
        },

    _setAcceptsInvites: async function (enabled) {
          // Invite preference is persisted by the unified app pulse,
          // not by a direct players/<uid> client update.
          try {
            this._lastAcceptsInvites = !!enabled;
            try { localStorage.setItem(INVITE_PREF_CACHE_KEY, enabled ? "1" : "0"); } catch (e) {}
            this._syncInviteToggleButton(!!enabled);
            await this._runUnifiedAppPulse(true, "invite-toggle");
            return true;
          } catch (e) {
            return false;
          }
        },

    _rejectInviteRoom: async function (inv, inviteRef) {
          try {
            if (inv && inv.gameId && window.DhametGameRoomClient && typeof window.DhametGameRoomClient.respondLobbyInvite === "function") {
              await window.DhametGameRoomClient.respondLobbyInvite({
                kind: "reject",
                gameId: inv.gameId,
                fromUid: inv.fromUid,
                inviteKey: inviteRef && inviteRef.key,
                nick: this.myNick || window.I18N.translateArgs("players.player"),
                reason: "rejected",
              });
              return true;
            }
          } catch (e) {}
          return false;
        },

    _isSuccessfulLobbyPulseResult: function (result) {
          try {
            const view = result && result.lobbyView;
            return !!(
              result &&
              result !== true &&
              result.ok !== false &&
              !result.deferred &&
              view &&
              !view.error &&
              view.players && typeof view.players === "object" &&
              view.roomList && typeof view.roomList === "object"
            );
          } catch (e) {
            return false;
          }
        },

    _showLobbyLoadFailure: function (force) {
          try {
            if (typeof document === "undefined") return false;
            const msg = window.I18N.translateArgs("lobby.loadFailed");
            let changed = false;
            ["playersList", "roomsList"].forEach((id) => {
              const el = document.getElementById(id);
              if (!el) return;
              const isLoading = !!el.querySelector(".z-loading");
              const alreadyFailed = !!el.querySelector("[data-lobby-load-error]");
              if (!force && !isLoading && !alreadyFailed) return;
              el.innerHTML = `<div class="z-empty" data-lobby-load-error="true">${msg}</div>`;
              changed = true;
            });
            return changed;
          } catch (e) {
            return false;
          }
        },

    _handleManualLobbyRefresh: async function () {
          try {
            const now = nowTs();
            const last = Number(this._lastManualLobbyRefreshAt || 0) || 0;
            if (last && now - last < 5000) return false;
            if (this._lobbyRefreshInFlight) return false;
            this._lastManualLobbyRefreshAt = now;
            const btn = typeof document !== "undefined" ? document.getElementById("btnLobbyManualRefresh") : null;
            this._lobbyRefreshInFlight = true;
            if (btn) btn.disabled = true;
            try {
              this._noteLobbyUserActivity && this._noteLobbyUserActivity("manual-lobby-refresh");
              const result = await this._runUnifiedAppPulse(true, "manual-lobby-refresh");
              const success = this._isSuccessfulLobbyPulseResult(result);
              if (!success) {
                const replacedLoading = this._showLobbyLoadFailure(false);
                if (!replacedLoading) {
                  try { showOnlineNotice(window.I18N.translateArgs("lobby.loadFailed")); } catch (e) {}
                }
                return false;
              }
              return true;
            } finally {
              this._lobbyRefreshInFlight = false;
              if (btn) btn.disabled = false;
            }
          } catch (e) {
            this._lobbyRefreshInFlight = false;
            try { const btn = document.getElementById("btnLobbyManualRefresh"); if (btn) btn.disabled = false; } catch (_) {}
            return false;
          }
        },

    _bindLobbyManualRefreshButton: function () {
          try {
            if (typeof document === "undefined") return null;
            const btn = document.getElementById("btnLobbyManualRefresh");
            if (!btn || btn.__zLobbyManualRefreshBound) return btn || null;
            btn.__zLobbyManualRefreshBound = true;
            btn.addEventListener("click", async (ev) => {
              try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
              await this._handleManualLobbyRefresh();
            });
            return btn;
          } catch (e) {
            return null;
          }
        },

    _restoreInviteToggleFromCache: function () {
          try {
            const cached = localStorage.getItem(INVITE_PREF_CACHE_KEY);
            this._syncInviteToggleButton(cached === "0" ? false : true);
          } catch (e) {
            try { this._syncInviteToggleButton(true); } catch (_) {}
          }
        },

    _bindInviteInlineToggle: function () {
          if (typeof document === "undefined") return null;
          const row = document.getElementById("inviteReceiveToggleRow");
          const btn = document.getElementById("btnInviteReceiveToggle");
          try { this._bindLobbyManualRefreshButton && this._bindLobbyManualRefreshButton(); } catch (e) {}
          if (!row || !btn) return null;
          if (!btn.__zInviteReceiveBound) {
            btn.__zInviteReceiveBound = true;
            btn.addEventListener("click", async (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              const next = !(this._lastAcceptsInvites !== false);
              btn.disabled = true;
              try {
                const ok = await this._setAcceptsInvites(next);
                if (ok) {
                  showOnlineNotice(window.I18N.translateArgs(next ? "online.invites.receivingEnabled" : "online.invites.receivingDisabled"));
                }
              } catch (e) {
              } finally {
                btn.disabled = false;
              }
            });
          }
          return { row, btn };
        },

    _syncInviteToggleButton: function (accepts) {
          this._lastAcceptsInvites = accepts !== false;
          try {
            if (accepts === false) localStorage.setItem(INVITE_PREF_CACHE_KEY, "0");
            else localStorage.setItem(INVITE_PREF_CACHE_KEY, "1");
          } catch (e) {}

          try {
            const old = this._inviteToggleEl;
            this._inviteToggleEl = null;
            old && old.parentNode && old.parentNode.removeChild(old);
          } catch (e) {}

          const parts = this._bindInviteInlineToggle();
          if (!parts) return;
          const enabled = accepts !== false;
          const row = parts.row;
          const btn = parts.btn;
          const state = btn.querySelector("[data-invite-toggle-state]") || btn;
          try {
            row.classList.toggle("is-disabled", !enabled);
            row.classList.toggle("is-enabled", enabled);
            btn.classList.toggle("is-disabled", !enabled);
            btn.classList.toggle("is-enabled", enabled);
            const key = enabled ? "online.invites.enabled" : "online.invites.disabled";
            btn.setAttribute("aria-pressed", enabled ? "true" : "false");
            btn.setAttribute("title", window.I18N.translateArgs(key));
            if (state && state.setAttribute) state.setAttribute("data-i18n", key);
            state.textContent = window.I18N.translateArgs(key);
          } catch (e) {}
        },

    _setLobbyStatus: async function (status, options) {
          try {
            const cfg = options && typeof options === "object" ? options : {};
            if (status === "available") {
              const busy = await this._markBusyIfActivePlayerRoom("players.lobbyStatus.activeRoom", cfg);
              if (busy) return;
            }
            this._applySessionState({
              presenceStatus: status,
              presenceRole:
                status === "available"
                  ? "lobby"
                  : status === "inPvP"
                    ? "player"
                    : status === "spectating"
                      ? "spectator"
                      : null,
              presenceRoomId: null,
            });
            if (!cfg.deferPulse) {
              try {
                if (this._startAppLive && this._startAppLive() && window.DhametAppLive) window.DhametAppLive.refreshPresence(true);
                else await this._runUnifiedAppPulse(true, "lobby-status");
              } catch (e) {}
            }
          } catch (e) {}
        },

    _clearPendingInviteWatcher: function () {
          this._pendingGameId = null;
        },

    _watchPendingInvite: function (gameId) {
          const gid = String(gameId || "").trim();
          if (!gid) return false;
          try { this._clearPendingInviteWatcher(); } catch (e) {}
          this._pendingGameId = gid;
          // Pending invite state is returned by official lobbyView inside the
          // unified app pulse. Do not open a separate games/<id> listener.
          try { this._trackOutgoingInvite && this._trackOutgoingInvite(gid); } catch (e) {}
          try { this._ensureUnifiedAppPulse("pending-invite-official-view", false); } catch (e) {}
          return true;
        },

    _bindInviteListener: function (options) {
          const cfg = options && typeof options === "object" ? options : {};
          const handler = async (snap) => {
            const inv = snap.val();
            if (!inv || !inv.gameId) return;

            try {
              const now = nowTs();
              const baseType = String((inv && (inv.type || inv.kind)) || "invite");
              if (baseType === "invite") {
                const createdAt = Number(inv.createdAt || 0);
                const expiresAt =
                  Number(inv.expiresAt || 0) ||
                  (createdAt ? createdAt + INVITE_TTL_MS : now + INVITE_TTL_MS);

                if (now >= expiresAt) {
                  try { await this._invalidateInviteLocally(inv, snap.ref); } catch (e) {}
                  return;
                }

                try {
                  let inMatch = !!(
                    this.isActive ||
                    this._presenceStatus === "inPvP" ||
                    this._presenceRole === "player" ||
                    this.gameId
                  );
                  if (inMatch) {
                    return;
                  }
                } catch (e) {}
              }
            } catch (e) {}

            const name = displayPlayerName(inv.fromUid, inv.fromNick);
            const title = window.I18N.translateArgs("online.newInviteTitle");
            const roomName = (inv.roomName || "").trim();
            const body = roomName
              ? window.I18N.translateArgs("online.newInviteBody", {
                  fromName: `<span class="z-player-name">${escapeHtml(name)}</span>`,
                  roomPart: window.I18N.translateArgs("online.newInviteRoomPart", { roomName: escapeHtml(roomName) }),
                })
              : window.I18N.translateArgs("online.newInviteBody", { fromName: `<span class="z-player-name">${escapeHtml(name)}</span>`, roomPart: "" });

            const canModal = typeof Modal !== "undefined" && Modal && typeof Modal.open === "function";
            const plainText = (html) => {
              try {
                return String(html || "")
                  .replace(/<[^>]*>/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();
              } catch (e) {
                return String(html || "");
              }
            };

            if (!canModal) {
              const msg = plainText(body);
              const ok = window.confirm(String(title || "") + "\n\n" + String(msg || ""));
              if (ok) {
                await this._acceptInviteLobby(inv, snap.ref);
              } else {
                await this._rejectInviteRoom(inv, snap.ref);
              }
              return;
            }

            Modal.open({
              title,
              body: `<div>${body}</div>`,
              modalClassName: "z-invite-modal",
              buttons: [
                {
                  label: window.I18N.translateArgs("actions.accept"),
                  className: "z-invite-choice z-invite-accept",
                  onClick: async () => {
                    Modal.close();

                    try {
                      const uid =
                        this.myUid || (auth && auth.currentUser && auth.currentUser.uid) || "";

                      if (!hasExplicitNick(uid)) {
                        const picked = ((await askNickname()) || "").trim();
                        if (picked) this.myNick = picked;
                        if (!this.myNick) this.myNick = getSavedNickOrDefault(uid);
                      } else {
                        const saved = (getSavedNick() || "").trim();
                        if (saved) this.myNick = saved;
                        if (!this.myNick) this.myNick = getSavedNickOrDefault(uid);
                      }
                    } catch (e) {}
                    await this._acceptInviteLobby(inv, snap.ref);
                  },
                },
                {
                  label: window.I18N.translateArgs("actions.reject"),
                  className: "z-invite-choice z-invite-reject",
                  onClick: async () => {
                    Modal.close();
                    await this._rejectInviteRoom(inv, snap.ref);
                  },
                },
              ],
            });
          };

          this._shownInviteKeys = this._shownInviteKeys || {};
          this._inviteOfficialHandler = (invites) => {
            try {
              const box = invites && typeof invites === "object" ? invites : {};
              Object.keys(box).sort().forEach((key) => {
                const inv = box[key];
                if (!inv || !inv.gameId) return;
                const status = String(inv.status || "pending");
                if (status !== "pending") return;
                const expiresAt = Number(inv.expiresAt || 0) || 0;
                if (expiresAt && nowTs() >= expiresAt) return;
                const modalKey = String(key || inv.inviteKey || inv.gameId);
                if (this._shownInviteKeys[modalKey]) return;
                this._shownInviteKeys[modalKey] = nowTs();
                const fakeRef = { key: modalKey };
                const fakeSnap = {
                  key: modalKey,
                  ref: fakeRef,
                  val: function () { return inv; },
                  exists: function () { return true; },
                };
                try { handler(fakeSnap); } catch (e) {}
              });
            } catch (e) {}
          };
          try {
            if (this._lastOfficialLobbyView && this._lastOfficialLobbyView.invites) this._inviteOfficialHandler(this._lastOfficialLobbyView.invites);
          } catch (e) {}
          if (!cfg.deferPulse) {
            try {
              this._ensureUnifiedAppPulse("official-invites", true);
            } catch (e) {}
          }
        },

    _loadOutgoingInvites: function () {
          try {
            const raw = localStorage.getItem("zamat.online.outInvites.v1");
            const arr = JSON.parse(raw || "[]");
            return Array.isArray(arr) ? arr : [];
          } catch (e) {
            return [];
          }
        },

    _saveOutgoingInvites: function (arr) {
          try {
            const clean = Array.isArray(arr) ? arr.slice(-50) : [];
            localStorage.setItem("zamat.online.outInvites.v1", JSON.stringify(clean));
          } catch (e) {}
        },

    _trackOutgoingInvite: function (meta) {
          try {
            if (!meta || !meta.gameId || !meta.toUid || !meta.inviteKey) return;
            const now = nowTs();
            const expiresAt = Number(meta.expiresAt || now + INVITE_TTL_MS);
            const createdAt = Number(meta.createdAt || now);
            const arr = this._loadOutgoingInvites();
            const kept = arr.filter((x) => x && x.gameId && x.gameId !== String(meta.gameId));
            kept.push({
              gameId: String(meta.gameId),
              toUid: String(meta.toUid),
              inviteKey: String(meta.inviteKey),
              createdAt,
              expiresAt,
            });
            this._saveOutgoingInvites(kept);
          } catch (e) {}
        },

    _untrackOutgoingInviteByGame: function (gameId) {
          try {
            if (!gameId) return;
            const arr = this._loadOutgoingInvites();
            const kept = arr.filter((x) => x && x.gameId && x.gameId !== String(gameId));
            this._saveOutgoingInvites(kept);
          } catch (e) {}
        },

    _discardLocalInvitesOnEnterMatch: function () {
          try {
            this._saveOutgoingInvites([]);
          } catch (e) {}
          try {
            const m = this._outInviteWatchMap || {};
            for (const gid of Object.keys(m)) {
              const w = m[gid];
              try { if (w && w.ref && w.cb) w.ref.off("value", w.cb); } catch (e) {}
            }
          } catch (e) {}
          this._outInviteWatchMap = {};
          this._outInviteWatchStarted = false;
        },

    _startOutgoingInviteWatches: function () {
          try {
            if (this._outInviteWatchStarted) return;
            if (!ensureCloudflareAuth()) return;
            this._outInviteWatchStarted = true;
            if (!this._outInviteWatchMap) this._outInviteWatchMap = {};
            try { this._refreshOutgoingInviteWatches(); } catch (e) {}
            // Invite results arrive through the app-wide live channel. The local
            // list is retained only for reload recovery and UI correlation.
          } catch (e) {}
        },

    _stopOutgoingInviteWatches: function () {
          try {
            if (this._outInviteWatchTimer) clearInterval(this._outInviteWatchTimer);
          } catch (e) {}
          this._outInviteWatchTimer = null;
          try {
            const m = this._outInviteWatchMap || {};
            for (const gid of Object.keys(m)) {
              const w = m[gid];
              try {
                if (w && w.ref && w.cb) w.ref.off("value", w.cb);
              } catch (e) {}
            }
          } catch (e) {}
          this._outInviteWatchMap = {};
          this._outInviteWatchStarted = false;
        },

    _refreshOutgoingInviteWatches: function () {
          try {
            const now = nowTs();
            let arr = [];
            try { arr = this._loadOutgoingInvites(); } catch (e) { arr = []; }
            arr = Array.isArray(arr) ? arr : [];
            const kept = [];
            for (const it of arr) {
              if (!it || !it.gameId) continue;
              const expiresAt = Number(it.expiresAt || 0);
              if (expiresAt && now >= expiresAt + 2500) continue;
              kept.push(it);
            }
            try { this._saveOutgoingInvites(kept); } catch (e) {}
            // No cloud polling here. The app-wide live channel delivers the
            // accepted/rejected result and the server retains it until ACK.
          } catch (e) {}
        },

    _handleOutgoingInviteAccepted: async function (gameId) {
          const gid = String(gameId || "").trim();
          if (!gid) return false;

          // Presence may already report an active room while this browser is
          // still on the lobby page. Suppress navigation only for an actual
          // in-page match session, never for lobby presence alone.
          if (isGamePage() && this.isActive && this.gameId) return false;
          if (this._acceptedGameNavigationId === gid) return true;
          this._acceptedGameNavigationId = gid;

          try {
            const watch = this._outInviteWatchMap && this._outInviteWatchMap[gid];
            if (watch && watch.ref && watch.cb) watch.ref.off("value", watch.cb);
            if (this._outInviteWatchMap) delete this._outInviteWatchMap[gid];
          } catch (_) {}
          try { this._untrackOutgoingInviteByGame && this._untrackOutgoingInviteByGame(gid); } catch (_) {}
          try { this._discardLocalInvitesOnEnterMatch(); } catch (_) {}

          try {
            if (!isGamePage()) {
              const navigated = this._goToGameAsPlayer(gid);
              if (!navigated) this._acceptedGameNavigationId = null;
              return !!navigated;
            }
            const started = await this._startInviterGame(gid);
            if (!started) this._acceptedGameNavigationId = null;
            return !!started;
          } catch (error) {
            this._acceptedGameNavigationId = null;
            try { Logger.warn("accepted_game_navigation_failed", { gameId: gid, error: String(error && (error.message || error)) }); } catch (_) {}
            return false;
          }
        },

    _touchRoomListActivity: function (gameId, force) {
          try {
            // Game requests now touch player presence and room activity server-side.
            // The browser only postpones the next lightweight game-presence pulse;
            // it must not send an extra /dhamet/api/lobby/pulse after every move/control event.
            if (typeof this._noteOnlineGameTransportActivity === "function") {
              this._noteOnlineGameTransportActivity(force ? "game-activity" : "game-touch");
            }
          } catch (e) {}
          return true;
        },


    _goToGameAsPlayer: function (gameId) {
          try {
            const gid = String(gameId || "").trim();
            if (!gid) return false;
            const inPages = (location.pathname || "").includes("/pages/");
            const base = inPages ? "./game.html" : "pages/game.html";
            const url = `${base}?pvp=1&gid=${encodeURIComponent(gid)}`;
            location.href = url;
            return true;
          } catch (e) {
            return false;
          }
        },

    _invalidateInviteLocally: async function (inv, inviteRef) {
          try {
            if (inv && inv.gameId && window.DhametGameRoomClient && typeof window.DhametGameRoomClient.respondLobbyInvite === "function") {
              await window.DhametGameRoomClient.respondLobbyInvite({
                kind: "reject",
                gameId: inv.gameId,
                fromUid: inv.fromUid,
                inviteKey: inviteRef && inviteRef.key,
                nick: this.myNick || window.I18N.translateArgs("players.player"),
                reason: "invalidated",
              });
              return true;
            }
          } catch (e) {}
          return false;
        },

    _validateInviteBeforeAccept: async function (inv, inviteRef) {
          try {
            if (!inv || !inv.gameId || !inv.fromUid) return { ok: false };
            const uid = String(this.myUid || "").trim();
            if (!uid) return { ok: false };
            if (String(inv.toUid || uid) !== uid) return { ok: false };
            if (String((inv.status || "pending")).trim() !== "pending") return { ok: false };
            const createdAt = Number(inv.createdAt || 0) || 0;
            const expiresAt = Number(inv.expiresAt || 0) || (createdAt ? createdAt + INVITE_TTL_MS : 0);
            if (expiresAt && nowTs() >= expiresAt) return { ok: false };
    
            // Browser pre-validation is intentionally shallow and must not perform
            // resync/lobby reads before accept. The authoritative accept endpoint
            // validates the invite, sender presence, recipient identity, and
            // pending GameRoom state server-side.
            return { ok: true, invite: inv, game: null };
          } catch (e) {
            return { ok: false };
          }
        },

    _isDefinitiveInviteAcceptFailure: function (error) {
          try {
            const status = Number(error && error.status || 0) || 0;
            const code = String(error && (error.code || (error.data && (error.data.code || error.data.error)) || error.message) || "").trim();
            if (!status || status >= 500 || code === "request-timeout") return false;
            return status >= 400 && status < 500;
          } catch (e) {
            return false;
          }
        },

    _recoverAmbiguousInviteAccept: async function () {
          try {
            if (typeof this._runUnifiedAppPulse === "function") {
              await this._runUnifiedAppPulse(true, "invite-accept-recovery");
              return true;
            }
          } catch (e) {}
          return false;
        },

    _acceptInviteLobby: async function (inv, inviteRef) {
          try {
            if (!inv || !inv.gameId) return;
            const ok = await this.initPresence();
            if (!ok) {
              showOnlineNotice(window.I18N.translateArgs("status.onlineInitFail"));
              return;
            }
    
            const validated = await this._validateInviteBeforeAccept(inv, inviteRef);
            if (!validated || !validated.ok) {
              try {
                await this._invalidateInviteLocally(inv, inviteRef);
              } catch (e) {}
              showOnlineNotice(window.I18N.translateArgs("online.inviteInvalidated"));
              return;
            }
    
            inv = validated.invite || inv;
            const gameId = inv.gameId;
            let accepted = null;
            try {
              if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.respondLobbyInvite !== "function") {
                throw new Error("lobby-invite-client-missing");
              }
              accepted = await window.DhametGameRoomClient.respondLobbyInvite({
                kind: "accept",
                gameId,
                fromUid: inv.fromUid,
                inviteKey: inviteRef && inviteRef.key,
                nick: this.myNick,
              });
            } catch (e) {
              // A timeout or transport/server failure is ambiguous: the
              // authoritative accept may already have committed. Never send a
              // destructive reject from this path. Refresh the official lobby
              // once so an accepted room can navigate normally.
              try { await this._recoverAmbiguousInviteAccept(); } catch (_e) {}
              const definitive = this._isDefinitiveInviteAcceptFailure(e);
              showOnlineNotice(definitive
                ? window.I18N.translateArgs("online.inviteInvalidated")
                : (window.I18N.translateArgs("status.reconnecting") || window.I18N.translateArgs("status.onlineInitFail")));
              return;
            }
            if (!accepted || accepted.ok === false) {
              try { await this._recoverAmbiguousInviteAccept(); } catch (e) {}
              showOnlineNotice(window.I18N.translateArgs("online.inviteInvalidated"));
              return;
            }

            try {
              this._syncMyUidFromAuth && this._syncMyUidFromAuth();
            } catch (e) {}

            try {
              this._applySessionState({
                presenceStatus: "inPvP",
                presenceRole: "player",
                presenceRoomId: gameId,
              });
              this._lastGameUserActivityAt = nowTs();
              this._rememberUnifiedPulseReason && this._rememberUnifiedPulseReason("accept-invite");
            } catch (e) {}
    
            try {
              this._discardLocalInvitesOnEnterMatch();
            } catch (e) {}
    
            this._goToGameAsPlayer(gameId);
          } catch (err) {
            handleDbError(err, window.I18N.translateArgs("online.inviteInvalidated"), { ctx: "invite.join" });
          }
        },
  };

  window.Online = Online;

  window.__ZAMAT_ONLINE_SHARED__ = {
    formatTpl: formatTpl,
    normalizeSouflaFx: normalizeSouflaFx,
    isPermissionDenied: isPermissionDenied,
    _ctx: _ctx,
    _spectatorMayWrite: _spectatorMayWrite,
    _dbErrorMessage: _dbErrorMessage,
    handleDbError: handleDbError,
    _shouldLogDenied: _shouldLogDenied,
    allowOnlineWrite: allowOnlineWrite,
    getAuthDebug: getAuthDebug,
    requireAuthUid: requireAuthUid,
    isGamePage: isGamePage,
    isPvCGamePage: isPvCGamePage,
    escapeHtml: escapeHtml,
    encodeSharedLogText: encodeSharedLogText,
    decodeSharedLogText: decodeSharedLogText,
    normalizeLogArrayForWrite: normalizeLogArrayForWrite,
    showOnlineNotice: showOnlineNotice,
    ensureCloudflareAuth: ensureCloudflareAuth,
    nowTs: nowTs,
    localNow: localNow,
    ssGet: ssGet,
    ssSet: ssSet,
    ssRemove: ssRemove,
    lsGet: lsGet,
    lsSet: lsSet,
    chatLastReadKey: chatLastReadKey,
    defaultNick: defaultNick,
    displayPlayerName: displayPlayerName,
    readMigrationVersion: readMigrationVersion,
    writeMigrationVersion: writeMigrationVersion,
    runMigrationsOnline: runMigrationsOnline,
    isPresenceFresh: isPresenceFresh,
    normalizeRoomVisibility: normalizeRoomVisibility,
    playerAcceptsInvites: playerAcceptsInvites,
    localAcceptsInvitesPreference: localAcceptsInvitesPreference,
    formatPresenceDisconnectElapsed: formatPresenceDisconnectElapsed,
    getNickFromSessionUser: getNickFromSessionUser,
    getSavedNick: getSavedNick,
    saveNickSession: saveNickSession,
    ensureAuthReady: ensureAuthReady,
    getSavedNickOrDefault: getSavedNickOrDefault,
    allowedUserIcons: allowedUserIcons,
    sanitizeUserIcon: sanitizeUserIcon,
    iconSrcForPage: iconSrcForPage,
    getSavedIconOrDefault: getSavedIconOrDefault,
    currentSessionIsRegistered: currentSessionIsRegistered,
    guestListIconByIndex: guestListIconByIndex,
    openOnlineTextPrompt: openOnlineTextPrompt,
    askNickname: askNickname,
    stripUndefined: stripUndefined,
    askRoomName: askRoomName,
    hasExplicitNick: hasExplicitNick,
    souflaToPlain: souflaToPlain,
    plainToSoufla: plainToSoufla,
    Logger: Logger,
    DENIED_LOG_TTL_MS: DENIED_LOG_TTL_MS,
    DENIED_LOG_MAX_KEYS: DENIED_LOG_MAX_KEYS,
    _DENIED_LOG_LAST: _DENIED_LOG_LAST,
    LOG_ENC_PREFIX: LOG_ENC_PREFIX,
        PERSIST_GAME_ID_KEY: PERSIST_GAME_ID_KEY,
    PERSIST_GAME_TS_KEY: PERSIST_GAME_TS_KEY,
    NICK_KEY: NICK_KEY,
    NICK_EXPLICIT_KEY: NICK_EXPLICIT_KEY,
    MIGRATION_VERSION_KEY: MIGRATION_VERSION_KEY,
    PRESENCE_STABLE_TTL_MS: PRESENCE_STABLE_TTL_MS,
    PRESENCE_LIST_TTL_MS: PRESENCE_LIST_TTL_MS,
    PRESENCE_ONLINE_TTL_MS: PRESENCE_ONLINE_TTL_MS,
    PRESENCE_HEARTBEAT_MS: PRESENCE_HEARTBEAT_MS,
    GAME_PRESENCE_HEARTBEAT_MS: GAME_PRESENCE_HEARTBEAT_MS,
    APP_PULSE_BACKGROUND_MS: APP_PULSE_BACKGROUND_MS,
    GAME_PRESENCE_ONLINE_TTL_MS: GAME_PRESENCE_ONLINE_TTL_MS,
    APP_PULSE_SLOW_INITIAL_MS: APP_PULSE_SLOW_INITIAL_MS,
    APP_PULSE_SLOW_LATER_MS: APP_PULSE_SLOW_LATER_MS,
    APP_PULSE_SLOW_IDLE_MS: APP_PULSE_SLOW_IDLE_MS,
    APP_PULSE_SLOW_BACKGROUND_MS: APP_PULSE_SLOW_BACKGROUND_MS,
    SPECTATOR_COUNT_STALE_MS: SPECTATOR_COUNT_STALE_MS,
    INVITE_PREF_CACHE_KEY: INVITE_PREF_CACHE_KEY,
    ROOM_VISIBILITY_PUBLIC: ROOM_VISIBILITY_PUBLIC,
    ROOM_VISIBILITY_PRIVATE: ROOM_VISIBILITY_PRIVATE,
    INVITE_TTL_MS: INVITE_TTL_MS,
    OPPONENT_ABSENCE_MS: OPPONENT_ABSENCE_MS,
    MOVE_SYNC_STALL_MS: MOVE_SYNC_STALL_MS,
    MOVE_SYNC_WARN_AFTER_MS: MOVE_SYNC_WARN_AFTER_MS,
    MOVE_SYNC_WATCHDOG_MS: MOVE_SYNC_WATCHDOG_MS,
    ASSET_PREFIX: ASSET_PREFIX,
    getDb: function () { return db; },
    getAuth: function () { return auth; },
    setDb: function (v) { db = v; },
    setAuth: function (v) { auth = v; }
  };

  window.addEventListener("load", function () {
    if (window.__ZAMAT_ONLINE_FULL_LOADED__) return;
    try { Online._restoreInviteToggleFromCache(); } catch (_) {}
    try { Online.initInvitesPassive(); } catch (_) {}

    var modeLink = document.getElementById("goPvP");
    if (modeLink && !modeLink.__zModeLinkBound) {
      modeLink.__zModeLinkBound = true;
      modeLink.addEventListener("click", async function (ev) {
        ev.preventDefault();
        try {
          if (await ensureAuthReady() && auth && auth.currentUser && auth.currentUser.uid) {
            location.href = "./loby.html";
            return;
          }
          var msg = window.I18N.translateArgs("status.onlineInitFail", "تعذر تهيئة اللعب عبر الإنترنت.");
          var extra = window.I18N.translateArgs("status.onlineInitHelp", "يرجى تسجيل الدخول أو بدء جلسة ضيف عبر Cloudflare.");
          if (window.Modal && typeof Modal.open === "function") {
            Modal.alert({
              title: window.I18N.translateArgs("modals.errorTitle", "خطأ"),
              body: "<div style='line-height:1.7'>" + msg + "<br/>" + extra + "</div>",
              okLabel: window.I18N.translateArgs("actions.ok", "موافق"),
              okClassName: "ok",
            });
          } else {
            alert(msg + "\n\n" + extra);
          }
        } catch (_) {}
      }, true);
      try { Online.initInvitesPassive(); } catch (_) {}
    }
  });
})();
