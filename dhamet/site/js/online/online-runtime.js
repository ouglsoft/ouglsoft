/*
 * Dhamet Online PvP runtime.
 *
 * Owns PvP in-match orchestration, move submission, outbox reconciliation,
 * resync, in-match controls, online soufla, spectator/chat/RTC hooks, and
 * coordination with the GameRoom transport and lobby runtime.
 */
(function () {
  const S = window.__ZAMAT_ONLINE_SHARED__;
  const Online = window.Online;
  if (!S || !Online) {
    try {
      const missing = [];
      if (!Online) missing.push("window.Online");
      if (!S) missing.push("window.__ZAMAT_ONLINE_SHARED__");
      console.error(
        "[ZAMAT] lobby-runtime.js did not complete initialization. Missing:",
        missing.join(", ")
      );
    } catch (e) {}
    return;
  }
  const Logger = S.Logger || window.Logger;
  const auth = new Proxy({}, {
    get: function (_target, prop) {
      const a = S.getAuth && S.getAuth();
      const v = a && a[prop];
      return typeof v === "function" ? v.bind(a) : v;
    }
  });
  const {
    ASSET_PREFIX,
    GAME_PRESENCE_ONLINE_TTL_MS,
    INVITE_TTL_MS,
    MOVE_SYNC_STALL_MS,
    MOVE_SYNC_WARN_AFTER_MS,
    MOVE_SYNC_WATCHDOG_MS,
    OPPONENT_ABSENCE_MS,
    PRESENCE_LIST_TTL_MS,
    ROOM_VISIBILITY_PRIVATE,
    SPECTATOR_COUNT_STALE_MS,
    askRoomName,
    chatLastReadKey,
    decodeSharedLogText,
    displayPlayerName,
    encodeSharedLogText,
    ensureAuthReady,
    escapeHtml,
    formatPresenceDisconnectElapsed,
    formatTpl,
    allowOnlineWrite,
    guestListIconByIndex,
    handleDbError,
    iconSrcForPage,
    isGamePage,
    isPermissionDenied,
    isPresenceFresh,
    localNow,
    lsGet,
    lsSet,
    normalizeRoomVisibility,
    nowTs,
    plainToSoufla,
    playerAcceptsInvites,
    requireAuthUid,
    showOnlineNotice,
    souflaToPlain
  } = S;

  window.__ZAMAT_ONLINE_FULL_LOADED__ = true;
  const SPECTATOR_RECONNECT_REGISTRATION_MS = 95 * 1000;
  const SPECTATOR_RECONNECT_RETRY_MS = 30 * 1000;

  function gameCommitErrorDetails(err) {
    const data = err && err.data && typeof err.data === 'object' ? err.data : {};
    return {
      status: Number(err && err.status) || 0,
      code: String((err && (err.code || err.message)) || data.code || data.error || '').trim(),
      error: String(data.error || '').trim(),
      reason: String(data.reason || '').trim(),
      data,
    };
  }

  function isNonRetriableGameCommitError(err) {
    try {
      const details = gameCommitErrorDetails(err);
      if (details.status >= 400 && details.status < 500 && details.status !== 429) return true;
      const text = [details.code, details.error, details.reason].join(' ');
      return /invalid-move-intent|rule-validation-failed|forced-opening-mismatch|illegal-move|illegal-segment|jumps-mismatch|turn-mismatch|snapshot-turn-mismatch|empty-source|invalid-move-path|invalid-current-board|invalid-game-record|state-build-failed|not-a-player|player-side-mismatch|not-a-participant|permission|forbidden|not-active|not-found|transport-missing/.test(text);
    } catch (_) { return false; }
  }

  function isRetriableGameCommitError(err) {
    try {
      const details = gameCommitErrorDetails(err);
      if (details.status === 429 || details.status >= 500) return true;
      if (details.status > 0) return false;
      const text = [details.code, details.error, details.reason].join(' ');
      return /request-timeout|network|failed to fetch|fetch failed|load failed|connection|offline/i.test(text);
    } catch (_) { return false; }
  }

  function isDefinitiveGameEntryError(err) {
    try {
      const details = gameCommitErrorDetails(err);
      if (details.status === 404 || details.status === 410) return true;
      if (details.status === 403) {
        const denied = [details.code, details.error, details.reason].join(' ');
        return /game\/not-a-participant|live\/not-authorized|spectator\/not-allowed|forbidden|not-a-participant/.test(denied);
      }
      const text = [details.code, details.error, details.reason].join(' ');
      return /game\/not-found|game\/expired|game\/deleted|game\/not-active|match\/not-found/.test(text);
    } catch (_) { return false; }
  }

  function lobbyStatusInfo(player, activePlayerRooms, uid) {
    // Guard retained for regression: busy display depends on !!roomListRoomId && roomId matching.
    const resolver = window.DhametPresence && typeof window.DhametPresence.resolvePublicPresenceState === "function"
      ? window.DhametPresence.resolvePublicPresenceState
      : null;
    const resolved = resolver
      ? resolver(player, activePlayerRooms, uid)
      : { state: "available", status: "available", acceptsInvites: playerAcceptsInvites(player), inOnlineMatch: false, canInvite: true };
    const status = String(resolved.state || resolved.status || "available");
    const key = status === "invitesDisabled"
      ? "lobby.invitesDisabled"
      : (status === "inPvP"
          ? "online.status.inPvP"
          : (status === "vsComputer" ? "online.status.vsComputer" : "online.status.available"));
    return {
      status,
      label: window.I18N.translateArgs(key),
      acceptsInvites: resolved.acceptsInvites !== false,
      inOnlineMatch: !!resolved.inOnlineMatch,
      canInvite: status === "available" || status === "vsComputer",
    };
  }

  function activeRoomMapFromView(view) {
    try {
      if (view && view.activePlayerRooms && typeof view.activePlayerRooms === "object") return view.activePlayerRooms;
    } catch (e) {}
    return {};
  }

  function currentStateRecord(data) {
    if (data && data.state && typeof data.state === "object") return data.state;
    if (data && data.states && data.ply != null && data.states[data.ply] && typeof data.states[data.ply] === "object") {
      return data.states[data.ply];
    }
    return null;
  }

  function deferredPromotionQueue(stateRecord) {
    const State = window.DhametState;
    if (!State || typeof State.normalizeDeferredPromotions !== "function") {
      throw new Error("Dhamet online runtime requires DhametState.normalizeDeferredPromotions");
    }
    return State.normalizeDeferredPromotions(stateRecord || {});
  }

  function snapshotWithPromotionQueue(snapshot, stateRecord) {
    const queue = deferredPromotionQueue(stateRecord);
    return Object.assign({}, snapshot || {}, {
      deferredPromotions: queue,
      deferredPromotion: queue.length ? Object.assign({}, queue[0]) : null,
    });
  }

  Object.assign(Online, {
    _captureAsyncContext: function (gameId) {
          return {
            gameId: String(gameId || this.gameId || ""),
            epochToken: window.DhametMatchCoordinator ? DhametMatchCoordinator.token() : null,
            postMatch: !!this._inPostMatch,
          };
        },

    _isAsyncContextCurrent: function (context, options) {
          const ctx = context && typeof context === "object" ? context : {};
          const opts = options && typeof options === "object" ? options : {};
          try {
            if (ctx.epochToken && window.DhametMatchCoordinator && !DhametMatchCoordinator.isCurrent(ctx.epochToken)) return false;
          } catch (e) { return false; }
          if (!opts.allowInactive && !this.isActive) return false;
          if (ctx.gameId && String(this.gameId || "") !== String(ctx.gameId)) return false;
          if (!opts.ignorePostMatch && !!ctx.postMatch !== !!this._inPostMatch) return false;
          return true;
        },

    _beginEntryRequest: function (gameId) {
          this._entryRequestSeq = Number(this._entryRequestSeq || 0) + 1;
          return Object.freeze({ id: this._entryRequestSeq, gameId: String(gameId || "") });
        },

    _isEntryRequestCurrent: function (request) {
          return !!request && Number(request.id) === Number(this._entryRequestSeq || 0);
        },

    _resolveSlotDisplayName: function (side, fallback) {
          try {
            if (window.ZGamePlayers && typeof window.ZGamePlayers.resolveSlot === "function") {
              const slot = window.ZGamePlayers.resolveSlot(side);
              const name = slot && slot.name ? String(slot.name || "").trim() : "";
              if (name) return name;
            }
          } catch (e) {}
          return String(fallback || "").trim();
        },

    _displayNameForGameUid: function (uid, fallback) {
          try {
            const want = String(uid || "").trim();
            const players = this._lastGameData && this._lastGameData.players ? this._lastGameData.players : null;
            if (want && players) {
              const white = players.white || {};
              const black = players.black || {};
              const whiteUid = white.uid ? String(white.uid) : "";
              const blackUid = black.uid ? String(black.uid) : "";
              if (want === blackUid) return displayPlayerName(black.uid, black.nickname);
              if (want === whiteUid) return displayPlayerName(white.uid, white.nickname);
            }
          } catch (e) {}
          try {
            if (uid && this.myUid && String(uid) === String(this.myUid)) {
              return window.I18N.translateArgs("players.you") || "You";
            }
          } catch (e) {}
          return String(fallback || "").trim();
        },

    _getGameSlotUid: function (side, data) {
          try {
            const g = data || this._lastGameData || null;
            const players = g && g.players ? g.players : null;
            if (!players) return "";
            if (side === "top") return players.black && players.black.uid ? String(players.black.uid) : "";
            if (side === "bot") return players.white && players.white.uid ? String(players.white.uid) : "";
          } catch (e) {}
          return "";
        },

    _getGameSlotPresence: function (side, data) {
          try {
            const g = data || this._lastGameData || null;
            const uid = this._getGameSlotUid(side, g);
            const presMap = g && g.presence ? g.presence : null;
            if (!uid) return { online: false, disconnectedSince: null };
    
            if (this.myUid && String(uid) === String(this.myUid)) {
              return {
                online: !!this._selfConnected,
                disconnectedSince: this._selfConnected ? null : this._selfOfflineSince || nowTs(),
              };
            }
    
            const pres = presMap && presMap[uid] ? presMap[uid] : null;
            const lastSeen = Number((pres && (pres.updatedAt || pres.joinedAt)) || 0) || 0;
            const online = !!(pres && isPresenceFresh(lastSeen, GAME_PRESENCE_ONLINE_TTL_MS));
            return {
              online,
              disconnectedSince: online
                ? null
                : this._oppOfflineSince || (lastSeen ? Math.min(nowTs(), lastSeen + GAME_PRESENCE_ONLINE_TTL_MS) : nowTs()),
            };
          } catch (e) {}
          return { online: false, disconnectedSince: null };
        },

    _opponentIsRealtimeAvailable: function () {
          try {
            return !!(this.isActive && !this.isSpectator && this._selfConnected && this._oppOnline);
          } catch (e) {}
          return false;
        },

    _installViewHooksOnce: function () {
          if (this._viewHooksInstalled) return;
          this._viewHooksInstalled = true;
    
          const N = 9;
    
          try {
            if (!window.__zamat_orig_toViewRC) window.__zamat_orig_toViewRC = window.toViewRC;
            if (!window.__zamat_orig_fromViewRC) window.__zamat_orig_fromViewRC = window.fromViewRC;
            if (!window.__zamat_orig_drawCoords) window.__zamat_orig_drawCoords = window.drawCoords;
          } catch (e) {}
    
          window.toViewRC = function (r, c) {
            try {
              if (window.Online && window.Online.isActive && window.Online.mySide === +1) {
                return [N - 1 - r, N - 1 - c];
              }
            } catch (e) {}
            return [r, c];
          };
    
          window.fromViewRC = function (r, c) {
            try {
              if (window.Online && window.Online.isActive && window.Online.mySide === +1) {
                return [N - 1 - r, N - 1 - c];
              }
            } catch (e) {}
            return [r, c];
          };
    
          if (typeof window.drawCoords === "function") {
            window.drawCoords = function (ctx, W, H) {
              try {
                ctx.save();
                ctx.fillStyle =
                  getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
                ctx.font = "12px Calibri, Carlito, Segoe UI, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const stepX = W / N;
                const stepY = H / N;
                for (let r0 = 0; r0 < N; r0++) {
                  for (let c0 = 0; c0 < N; c0++) {
                    const [vr, vc] = window.toViewRC(r0, c0);
                    const x = vc * stepX + stepX / 2;
                    const y = vr * stepY + stepY / 2;
                    ctx.fillText(`${vr}.${vc}`, x, y);
                  }
                }
                ctx.restore();
              } catch (e) {
                try {
                  (window.__zamat_orig_drawCoords || function () {})(ctx, W, H);
                } catch (e) {}
              }
            };
          }
        },

    _setButtonsVisualDisabled: function (on) {
          const disableIds = ["btnHint", "btnExportHuman"];
          disableIds.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (on) {
              if (el.dataset._oldDisplay == null) el.dataset._oldDisplay = el.style.display || "";
              el.style.display = "none";
            } else {
              el.style.display = el.dataset._oldDisplay || "";
            }
          });
        },

    start: function () {
          return this.startOnline();
        },

    _ensurePresenceUi: function () {
          if (this._presenceUiReady) return;
          try {
            const wrap = document.getElementById("onlinePresence");
            if (!wrap) return;
    
            wrap.innerHTML = "";
            this._presenceWrap = wrap;
    
            const mkChip = () => {
              const chip = document.createElement("span");
              chip.className = "presence-chip";
    
              const nm = document.createElement("span");
              nm.className = "presence-name";
              nm.setAttribute("data-presence-name", "1");
    
              const st = document.createElement("span");
              st.className = "presence-status";
              st.setAttribute("data-presence-status", "1");
    
              chip.appendChild(nm);
              chip.appendChild(st);
              return chip;
            };
    
            this._presenceChipTop = mkChip();
            this._presenceChipBot = mkChip();
            wrap.appendChild(this._presenceChipTop);
            wrap.appendChild(this._presenceChipBot);
    
            this._presenceUiReady = true;
            this._updatePresenceUi();
          } catch (e) {}
        },

    _clearPresenceUi: function () {
          try {
            const wrap = document.getElementById("onlinePresence");
            if (wrap) {
              wrap.innerHTML = "";
              wrap.style.display = "none";
            }
          } catch (e) {}
    
          this._presenceUiReady = false;
          try {
            if (this._presenceTicker) clearInterval(this._presenceTicker);
          } catch (e) {}
          this._presenceTicker = null;
          this._presenceWrap = null;
          this._presenceChipTop = null;
          this._presenceChipBot = null;
        },

    _syncPresenceTicker: function () {
          try {
            const needTicker = !!(!this._topPresenceOnline || !this._botPresenceOnline);
            if (needTicker && !this._presenceTicker) {
              this._presenceTicker = setInterval(() => {
                try {
                  this._updatePresenceUi();
                } catch (e) {}
              }, 1000);
            } else if (!needTicker && this._presenceTicker) {
              clearInterval(this._presenceTicker);
              this._presenceTicker = null;
            }
          } catch (e) {}
        },

    _updatePresenceUi: function () {
          try {
            const wrap = this._presenceWrap || document.getElementById("onlinePresence");
            if (wrap) wrap.style.display = this.isActive ? "flex" : "none";
          } catch (e) {}
    
          const topPresence = this._getGameSlotPresence("top");
          const botPresence = this._getGameSlotPresence("bot");
    
          try {
            this._topPresenceOnline = !!topPresence.online;
            this._botPresenceOnline = !!botPresence.online;
            this._topPresenceOfflineSince = topPresence.disconnectedSince || null;
            this._botPresenceOfflineSince = botPresence.disconnectedSince || null;
          } catch (e) {}
    
          try {
            this._syncPresenceTicker();
          } catch (e) {}
          try {
            if (window.Mobile && typeof window.Mobile.syncGameHeadNow === "function") window.Mobile.syncGameHeadNow();
          } catch (e) {}
    
          if (!this._presenceUiReady) return;
    
          const setChip = (chipEl, nameText, online, disconnectedSince) => {
            try {
              if (!chipEl) return;
              const nm = chipEl.querySelector('[data-presence-name="1"]');
              const st = chipEl.querySelector('[data-presence-status="1"]');
              if (chipEl) chipEl.dir = document.documentElement.dir || "ltr";
              if (nm) nm.textContent = nameText || "";
              if (st) {
                if (online) {
                  st.textContent = `(${String(window.I18N.translateArgs("online.presence.online"))})`;
                } else {
                  const label = window.I18N.translateArgs("online.presence.disconnected");
                  const timer = formatPresenceDisconnectElapsed(disconnectedSince || nowTs());
                  st.textContent = `(${String(label)} ${timer})`;
                }
                try {
                  st.classList.toggle("z-presence-online", !!online);
                  st.classList.toggle("z-presence-offline", !online);
                } catch (e) {}
              }
            } catch (e) {}
          };
    
          setChip(this._presenceChipTop, this._topDisplayName || "", !!topPresence.online, topPresence.disconnectedSince);
          setChip(this._presenceChipBot, this._botDisplayName || "", !!botPresence.online, botPresence.disconnectedSince);
        },

    _ensureSyncIssueUi: function () {
          try {
            const notice = document.getElementById("syncIssueNotice");
            if (notice && !notice.textContent) {
              notice.textContent = window.I18N.translateArgs("online.syncIssueNotice");
            }
          } catch (e) {}
        },

    _setSyncIssueState: function (show) {
          try {
            this._ensureSyncIssueUi();
          } catch (e) {}
    
          const shouldShow = !!(
            show &&
            this.isActive &&
            !this.isSpectator &&
            this._opponentIsRealtimeAvailable()
          );
          this._syncIssueVisible = shouldShow;
    
          try {
            const notice = document.getElementById("syncIssueNotice");
            if (notice) {
              notice.hidden = !shouldShow;
              notice.classList.toggle("is-visible", shouldShow);
              if (shouldShow) {
                notice.textContent = window.I18N.translateArgs("online.syncIssueNotice");
              }
            }
          } catch (e) {}
    
          try {
            const btn = document.getElementById("btnSync");
            if (btn) btn.classList.toggle("z-sync-issue", shouldShow);
          } catch (e) {}
        },

    _startMoveCommitWatchdog: function () {
          try {
            if (!this.isActive) return;
            if (!this._moveCommitStartedAt) this._moveCommitStartedAt = nowTs();
            if (this._moveCommitWatchdogTimer) return;
            this._moveCommitWatchdogTimer = setInterval(() => {
              try {
                this._checkMoveCommitHealth();
              } catch (e) {}
            }, MOVE_SYNC_WATCHDOG_MS);
          } catch (e) {}
        },

    _stopMoveCommitWatchdog: function () {
          try {
            if (this._moveCommitWatchdogTimer) clearInterval(this._moveCommitWatchdogTimer);
          } catch (e) {}
          this._moveCommitWatchdogTimer = null;
          this._moveCommitStartedAt = 0;
          this._moveCommitEscalatedAt = 0;
          try {
            this._setSyncIssueState(false);
          } catch (e) {}
        },

    _checkMoveCommitHealth: function () {
          try {
            if (!this.isActive || !this._awaitingLocalCommit) {
              this._stopMoveCommitWatchdog();
              return;
            }
    
            const startedAt = Number(this._moveCommitStartedAt || 0) || 0;
            if (!startedAt) {
              this._moveCommitStartedAt = nowTs();
              return;
            }
    
            const now = nowTs();
            const elapsed = Math.max(0, now - startedAt);
            const opponentAvailable = this._opponentIsRealtimeAvailable();
    
            if (!this._moveCommitEscalatedAt && elapsed >= MOVE_SYNC_STALL_MS) {
              this._moveCommitEscalatedAt = now;
              try {
                this._requestOfficialSync({ reason: "commit-watchdog", notifyFailure: false });
              } catch (e) {}
              try {
                const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
                if (browserOffline) {
                  this._moveRetryPausedOffline = true;
                } else if (
                  this._selfConnected &&
                  this._moveRetryArgs &&
                  this._moveRetryArgs.from != null &&
                  this._moveRetryArgs.to != null &&
                  typeof this._moveRetryArgs.nextTurn === "number" &&
                  !this._moveRetryTimer &&
                  !this._moveRetryGaveUp
                ) {
                  const at = (this._moveRetryAttempt || 0) + 1;
                  this.sendMoveToCloudflare(
                    this._moveRetryArgs.from,
                    this._moveRetryArgs.to,
                    this._moveRetryArgs.nextTurn,
                    at,
                  );
                }
              } catch (e) {}
            }
    
            const shouldWarn = !!(
              opponentAvailable &&
              this._moveCommitEscalatedAt &&
              elapsed >= MOVE_SYNC_WARN_AFTER_MS
            );
            this._setSyncIssueState(shouldWarn);
          } catch (e) {}
        },

    _beginLocalCommitWait: function () {
          try {
            if (this._awaitingLocalCommit) return;
            this._awaitingLocalCommit = true;
            this._expectedMoveIndex = (this.moveIndex || 0) + 1;
            this._moveCommitStartedAt = nowTs();
            this._moveCommitEscalatedAt = 0;
            try {
              this._clearMoveRetry();
            } catch (e) {}
            try {
              this._setSyncIssueState(false);
            } catch (e) {}
            try {
              this._startMoveCommitWatchdog();
            } catch (e) {}
          } catch (e) {}
        },

    _markLocalCommitSettled: function () {
          try {
            this._awaitingLocalCommit = false;
            this._expectedMoveIndex = null;
            this._moveCommitClientId = null;
            this._moveCommitBaseIndex = null;
          } catch (e) {}
          try { this._clearPendingMoveOutbox(); } catch (e) {}
          try {
            this._clearMoveRetry();
          } catch (e) {}
          try {
            this._stopMoveCommitWatchdog();
          } catch (e) {}
        },

    _commitOfficialMatchEnd: async function (kind, reason) {
          if (!allowOnlineWrite()) return { ok: false, committed: false, error: "write-not-allowed" };
          if (!this.isActive || !this.gameId || this.isSpectator) return { ok: false, committed: false, error: "not-active" };
          if (!requireAuthUid(this.myUid)) return { ok: false, committed: false, error: "auth-required" };

          const asyncContext = this._captureAsyncContext(this.gameId);
          const payload = {
            gameId: asyncContext.gameId,
            clientEndId: "end:" + (this.myUid || "anon") + ":" + this.gameId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 10),
            baseMoveIndex: Number(this.moveIndex || 0) || 0,
            kind: kind || "resign",
            by: this.mySide || null,
            nick: this.myNick || "",
            reason: reason || "",
          };

          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitMatchEnd !== "function") {
            throw new Error("gameroom-match-end-transport-missing");
          }

          const res = await window.DhametGameRoomClient.commitMatchEnd(payload);
          if (!this._isAsyncContextCurrent(asyncContext)) {
            return { ok: false, committed: false, ignored: true, error: "stale-context" };
          }
          const g = res && res.game ? res.game : null;
          if (g) this._lastGameData = g;
          if (res && res.moveIndex != null) this.moveIndex = Number(res.moveIndex) || this.moveIndex || 0;
          if (res && res.ply != null) this.ply = Number(res.ply) || this.ply || 0;
          if (!res || res.committed === false) {
            try { this._forceResync(); } catch (e) {}
            return Object.assign({ ok: false, committed: false }, res || {});
          }
          try { this._touchRoomListActivity(true); } catch (e) {}
          return res;
        },

        _endByAbsence: async function () {
          if (!this.gameId || !this.myUid) return null;
          try {
            const res = await this._commitOfficialMatchEnd("opponent-absent", "opponent_absent");
            const endedGame = res && res.committed !== false && res.game && res.game.status === "ended"
              ? res.game
              : null;
            return endedGame;
          } catch (e) {
            handleDbError(e, window.I18N.translateArgs("online.endFail"), { ctx: "matchEnd.absence" });
            return null;
          }
        },

    _endByAbsenceAndEnterPostMatch: async function () {
          const endedGame = await this._endByAbsence();
          if (!endedGame) {
            try { await this.syncNow(); } catch (e) {}
            return false;
          }
          this._lastGameData = endedGame;
          return this._enterPostMatch({
            game: endedGame,
            result: endedGame.result || null,
            winner: endedGame.winner,
            reason: endedGame.endedReason,
            endedBy: endedGame.endedBy || null,
            players: endedGame.players || null,
          }) !== false;
        },

    refreshPresenceUi: function () {
          try {
            this._ensurePresenceUi();
            this._updatePresenceUi();
          } catch (e) {}
        },

    _buildGamePresencePayload: function () {
          const ts = nowTs();
          if (!this._gamePresenceJoinedAt) this._gamePresenceJoinedAt = ts;
          return {
            uid: this.myUid,
            nickname: this.myNick || "",
            side: Number.isFinite(this.mySide) ? this.mySide : 0,
            joinedAt: this._gamePresenceJoinedAt || ts,
            updatedAt: ts,
          };
        },

    _writeFullGamePresence: function (ctx, force) {
          // The app channel owns global presence and game-live owns match
          // presence. This method only publishes a material state transition.
          try {
            this._rememberPresenceWrite && this._rememberPresenceWrite("game", this._buildGamePresencePayload());
            if (window.DhametAppLive && typeof window.DhametAppLive.refreshPresence === "function") {
              window.DhametAppLive.refreshPresence(!!force);
              return true;
            }
            this._runUnifiedAppPulse && this._runUnifiedAppPulse(!!force, ctx || "game-presence-fallback");
            return true;
          } catch (e) {
            return false;
          }
        },

    _startGamePresenceHeartbeat: function () {
          // The authenticated game-live socket is the heartbeat. No HTTP timer.
          this._gamePresenceHeartbeatTimer = null;
          return true;
        },

    _stopGamePresenceHeartbeat: function () {
          this._gamePresenceHeartbeatTimer = null;
        },

    _startOpponentAbsenceWatcher: function () {
          // Presence transitions arrive in official game snapshots from the
          // game-live socket. No independent polling request is required.
          this._oppAbsenceWatchTimer = null;
          try { this._checkOpponentAbsence(); } catch (e) {}
          return true;
        },

    _stopOpponentAbsenceWatcher: function () {
          this._oppAbsenceWatchTimer = null;
          try { this._oppOfflineSince = null; } catch (e) {}
          try { this._oppLeftModalShown = false; } catch (e) {}
        },

    _checkOpponentAbsence: function () {
          try {
            if (this.isSpectator) return;
            if (!this.isActive || !this.gameRef) return;
    
            const g = this._lastGameData;
            try {
              if (g && g.status && g.status !== "active") return;
            } catch (e) {}
    
            try {
              if (this._localEndedOnline) return;
            } catch (e) {}
    
            const now = nowTs();
            const oppUid = g ? this._getOpponentInfoFromData(g).uid : null;
            const pres = oppUid && g && g.presence ? g.presence[oppUid] : null;
            const lastSeen = Number((pres && (pres.updatedAt || pres.connectedAt || pres.joinedAt)) || 0) || 0;
            const disconnectedAt = Number(pres && pres.disconnectedAt || 0) || 0;
            const hasSocketState = !!(pres && Object.prototype.hasOwnProperty.call(pres, "online"));
            const oppOnline = hasSocketState
              ? pres.online === true && !disconnectedAt
              : !!(pres && isPresenceFresh(lastSeen, GAME_PRESENCE_ONLINE_TTL_MS));
    
            const previousOnline = this._oppOnline;
            this._oppOnline = oppOnline;
            if (lastSeen) this._oppLastSeenAt = lastSeen;
            try { this._voiceSyncOpponentAvailability(oppUid, oppOnline, previousOnline); } catch (e) {}
    
            if (oppOnline) {
              this._oppOfflineSince = null;
              this._oppLeftModalShown = false;
              try {
                this._updatePresenceUi();
              } catch (e) {}
              return;
            }
    
            if (!this._oppOfflineSince) {
              this._oppOfflineSince = disconnectedAt || (lastSeen
                ? Math.min(now, lastSeen + GAME_PRESENCE_ONLINE_TTL_MS)
                : now);
            }
    
            try {
              this._updatePresenceUi();
            } catch (e) {}
    
            const dt = now - this._oppOfflineSince;
            if (dt >= OPPONENT_ABSENCE_MS && !this._oppLeftModalShown) {
              this._openOpponentAbsenceModal();
            }
          } catch (e) {}
        },

    _openOpponentAbsenceModal: function () {
          try {
            if (this._oppLeftModalShown) return;
            this._oppLeftModalShown = true;
    
            let opp = "";
            try {
              opp = String(this._oppName || "").trim();
            } catch (e) {}
            if (!opp) opp = window.I18N.translateArgs("online.opponent", "Opponent");
    
            const titleText = window.I18N.translateArgs("online.absenceTitle");
            const bodyText = formatTpl(
              window.I18N.translateArgs("online.absencePrompt"),
              { player: opp },
            );
    
            if (typeof Modal !== "undefined" && Modal && typeof Modal.open === "function") {
              const div = document.createElement("div");
              div.style.whiteSpace = "pre-wrap";
              div.textContent = bodyText;
    
              Modal.open({
                title: titleText,
                body: div,
                buttons: [
                  {
                    label: window.I18N.translateArgs("actions.wait"),
                    className: "primary",
                    onClick: () => {
                      try {
                        Modal.close();
                      } catch (e) {}
                      try {
                        this.syncNow();
                      } catch (e) {}
                    },
                  },
                  {
                    label: window.I18N.translateArgs("buttons.endMatch"),
                    className: "danger",
                    onClick: () => {
                      try {
                        Modal.close();
                      } catch (e) {}
                      try {
                        this._endByAbsenceAndEnterPostMatch();
                      } catch (e) {}
                    },
                  },
                ],
              });
              return;
            }
    
            const msg =
              titleText +
              "\n\n" +
              bodyText +
              "\n\n" +
              window.I18N.translateArgs("actions.wait") +
              " = OK\n" +
              window.I18N.translateArgs("buttons.endMatch") +
              " = Cancel";
    
            const ok = confirm(msg);
            if (ok) {
              try {
                this.syncNow();
              } catch (e) {}
            } else {
              try {
                this._endByAbsenceAndEnterPostMatch();
              } catch (e) {}
            }
          } catch (e) {}
        },

    _applyEntryOfficialState: async function (gameId, initialGame, reason) {
          const gid = String(gameId || "").trim();
          if (!gid) return false;
          const access = this._lastGameAccess || null;
          if (initialGame && typeof initialGame === "object") {
            const version = access && access.version != null ? access.version : initialGame.__transportVersion;
            const official = Object.assign({}, initialGame, { __transportVersion: version });
            const applied = this._ingestOfficialGame(official, {
              source: String(reason || "entry") + ":initial-read",
              gameId: gid,
              version,
              rejectDuplicate: false,
            });
            if (applied) {
              try { this._reconcilePendingMoveOutbox && this._reconcilePendingMoveOutbox(official); } catch (_) {}
              return true;
            }
          }
          return await this.syncNow({
            reason: String(reason || "entry") + ":fallback",
            repairPresence: false,
            notifyFailure: false,
          });
        },

    _startInviterGame: async function (gameId, entryRequest, initialGame) {
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          this._applySessionState({
            active: true,
            spectator: false,
            side: -1,
            gameId,
            postMatch: false,
            postMatchShown: false,
            presenceStatus: "inPvP",
            presenceRole: "player",
            presenceRoomId: gameId,
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.ONLINE_PLAYER : null,
            reason: "online-inviter-enter",
          });
          try { this._bindCaptureDraftLifecycle && this._bindCaptureDraftLifecycle(); } catch (e) {}
          try {
            this._discardLocalInvitesOnEnterMatch && this._discardLocalInvitesOnEnterMatch();
          } catch (e) {}
    
          try {
            this._pendingSteps = [];
            this._cachedSouflaPlain = null;
            this._awaitingLocalCommit = false;
            this._expectedMoveIndex = null;
            this._clearMoveRetry();
          } catch (e) {}
    
          const asyncContext = this._captureAsyncContext(gameId);
          this._setOnlineButtonsState(true, { keepBlocked: true });
    
          try {
            if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
          } catch (e) {}
    
          this._applySessionState({ gameRef: this._makeOfficialGameRef(gameId) }); // Official /dhamet/api/game/live and /dhamet/api/game/resync endpoints provide live state.
    
          let synced = false;
          try { synced = await this._applyEntryOfficialState(gameId, initialGame, "inviter-entry"); } catch (e) { synced = false; }
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          if (!synced) return await this._abortOnlineEntry("inviter-sync-failed");
          try { this._startPresenceHeartbeat(); } catch (e) {}
          this._setOnlineButtonsState(true);
          try {
            this._bindInviteListener();
          } catch (e) {}
          this._bindGameListeners();
          try {
            await this._initRoomComms();
          } catch (e) {}
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          try {
            this._persistActiveGame();
          } catch (e) {}
          return true;
        },

    startOnline: async function () {
          const ok = await this.initPresence();
          if (!ok) {
            showOnlineNotice(window.I18N.translateArgs("status.onlineInitFail"));
            return;
          }
          try { this._syncMyUidFromAuth && this._syncMyUidFromAuth(); } catch (e) {}
    
          this._lobbyOpenedAt = localNow();
          this._lobbyModalOpen = true;
    
          try { await this._ensureCurrentNickname(); } catch (e) {}
    
          await this._setLobbyStatus("available");
    
          this._bindInviteListener();
          this._openLobbyModal();
        },

    _openLobbyModal: function () {
          const wrap = document.createElement("div");
          wrap.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px;">
              <div style="font-weight:700;">${window.I18N.translateArgs("lobby.playersTitle")}</div>
              <div id="playersList" style="display:flex; flex-direction:column; gap:8px;"></div>
            </div>
          `;
    
          Modal.open({
            title: window.I18N.translateArgs("lobby.playersTitle"),
            body: wrap,
            buttons: [
              {
                label: window.I18N.translateArgs("actions.close"),
                className: "ghost",
                onClick: () => {
                  this._lobbyModalOpen = false;
                  Modal.close();
                  try { this._stopUnifiedAppPulse && this._stopUnifiedAppPulse(); } catch (e) {}
                },
              },
            ],
          });
    
          const listEl = wrap.querySelector("#playersList");
    
          const render = (players) => {
            listEl.innerHTML = "";
            let entries = Object.entries(players || {}).filter(([playerUid]) => playerUid !== this.myUid);
    
            const NOW = Date.now();
            const MAX_AGE_MS = PRESENCE_LIST_TTL_MS;
            entries = entries.filter(([, p]) => {
              const ts = p && typeof p.updatedAt === "number" ? p.updatedAt : 0;
              return ts && NOW - ts <= MAX_AGE_MS;
            });
    
            if (!entries.length) {
              listEl.innerHTML = `<div class="muted">${window.I18N.translateArgs("online.noPlayers")}</div>`;
              return;
            }
    
            entries.forEach(([uid, p]) => {
              const nick = displayPlayerName(uid, p && p.nickname);
              const statusInfo = lobbyStatusInfo(p, activeRoomMapFromView(this._lastOfficialLobbyView), uid);
              const stLabel = statusInfo.label;
    
              const row = document.createElement("div");
              row.style.display = "flex";
              row.style.alignItems = "center";
              row.style.justifyContent = "space-between";
              row.style.gap = "10px";
              row.innerHTML = `
                <div style="display:flex; flex-direction:column;">
                  <div style="font-weight:700;">${escapeHtml(nick)}</div>
                  <div class="muted" style="font-size:var(--fs-body);">${escapeHtml(stLabel)}</div>
                </div>
                          <button class="btn ok" ${statusInfo.canInvite ? "" : "disabled"}>${window.I18N.translateArgs("actions.invite")}</button>
    
              `;
    
              row.querySelector("button").onclick = async () => {
                this._lobbyModalOpen = false;
                Modal.close();
                await this._createGame(uid);
              };
    
              listEl.appendChild(row);
            });
          };
    
          const showLoadFail = () => {
            const msg = window.I18N.translateArgs("online.playersLoadFail");
            Modal.open({
              title: window.I18N.translateArgs("modals.errorTitle"),
              body: `<div>${msg}</div>`,
              buttons: [
                {
                  label: window.I18N.translateArgs("actions.close"),
                  className: "primary",
                  onClick: () => {
                    Modal.close();
                  },
                },
              ],
            });
          };

          (async () => {
            try {
              const cachedView = this._lastOfficialLobbyView && typeof this._lastOfficialLobbyView === "object" ? this._lastOfficialLobbyView : null;
              const cachedFresh = !!(
                cachedView && cachedView.players &&
                nowTs() - (Number(this._lastOfficialLobbyViewAt || 0) || 0) < 10000
              );
              if (cachedFresh) {
                render(cachedView.players || {});
                return;
              }
              if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.readLobbyView !== "function") {
                throw new Error("official-lobby-view-missing");
              }
              const res = await window.DhametGameRoomClient.readLobbyView({ players: true, rooms: true, invites: false });
              try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(res); } catch (e) {}
              const view = res && res.view ? res.view : {};
              try { this._applyOfficialLobbyView && this._applyOfficialLobbyView(view); } catch (e) {}
              render((view && view.players) || {});
            } catch (err) {
              showLoadFail();
            }
          })();
        },

    _createGame: async function (opponentUid) {
          const ok = await this.initPresence();
          if (!ok) {
            showOnlineNotice(window.I18N.translateArgs("status.onlineInitFail"));
            return;
          }
    
          try {
            const activeRoomId = String(this.gameId || this._presenceRoomId || (this._getPersistedActiveGameId && this._getPersistedActiveGameId()) || "").trim();
            if (activeRoomId) {
              const shouldContinue = await this._confirmLeaveActiveMatchBeforeInvite(activeRoomId);
              if (!shouldContinue) return;
            }
          } catch (e) {}
    
          try {
          } catch (e) {}
    
          let opponentNick = "";
          let opponentStatus = "";
          let opponentRole = "";
          let opponentUpdatedAt = 0;
          let opponentRoomId = "";
          let opponentAcceptsInvites = true;
          let pv = null;
          try {
            if (this._lastOfficialLobbyView && this._lastOfficialLobbyView.players) {
              pv = this._lastOfficialLobbyView.players[opponentUid] || null;
            }
            opponentNick = (pv && pv.nickname) || "";
            opponentStatus = (pv && pv.status) || "";
            opponentRole = (pv && pv.role) || "";
            opponentUpdatedAt = Number((pv && pv.updatedAt) || 0) || 0;
            opponentRoomId = (pv && pv.roomId) || "";
            opponentAcceptsInvites = playerAcceptsInvites(pv);
          } catch (e) {}
    
          try {
            if (pv) {
              const fresh = isPresenceFresh(opponentUpdatedAt, PRESENCE_LIST_TTL_MS);
              if (!fresh) {
                showOnlineNotice(window.I18N.translateArgs("online.inviteInvalidated"));
                return;
              }
              if (!opponentAcceptsInvites) {
                showOnlineNotice(window.I18N.translateArgs("online.invites.notAccepting"));
                return;
              }
              if ((opponentStatus === "inPvP" || opponentRole === "player") && opponentRoomId) {
                showOnlineNotice(window.I18N.translateArgs("online.inviteInvalidated"));
                return;
              }
            }
          } catch (e) {}
    
          const roomSetup = await askRoomName();
          const roomName = String((roomSetup && roomSetup.roomName) || "").trim();
          const visibility = normalizeRoomVisibility(roomSetup && roomSetup.visibility);
          if (!roomName) {
            return;
          }
    
          let createResult = null;
          try {
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.createLobbyInvite !== "function") {
              throw new Error("lobby-invite-client-missing");
            }
            createResult = await window.DhametGameRoomClient.createLobbyInvite({
              opponentUid,
              opponentNick,
              roomName,
              visibility,
              nick: this.myNick,
            });
          } catch (err) {
            handleDbError(err, window.I18N.translateArgs("online.inviteSendFail"), { ctx: "invite.send.official" });
            return;
          }

          const gameId = String((createResult && createResult.gameId) || "").trim();
          const inviteKey = String((createResult && createResult.inviteKey) || (this.myUid + "_" + gameId));
          const createdAt = Number((createResult && createResult.invite && createResult.invite.createdAt) || nowTs()) || nowTs();
          const expiresAt = Number((createResult && createResult.invite && createResult.invite.expiresAt) || (createdAt + INVITE_TTL_MS)) || (createdAt + INVITE_TTL_MS);
          if (!gameId) {
            showOnlineNotice(window.I18N.translateArgs("online.inviteSendFail"));
            return;
          }

          try {
            this._trackOutgoingInvite({ gameId, toUid: opponentUid, inviteKey, createdAt, expiresAt });
          } catch (e) {}
    
          // The sender cannot know that the other browser accepted until it
          // asks the official lobby endpoint. Reuse the single unified pulse
          // timer with a short 5/10/15/20-second backoff while this invite is
          // pending; no parallel watcher or realtime listener is created.
          try {
            const fastDelay = this._getPendingOutgoingInvitePulseDelay ? this._getPendingOutgoingInvitePulseDelay() : 5 * 1000;
            this._scheduleUnifiedAppPulseNoLaterThan && this._scheduleUnifiedAppPulseNoLaterThan(fastDelay || 5 * 1000);
          } catch (e) {}
        },

    _returnToActiveMatch: async function (gameId) {
          const gid = String(gameId || this.gameId || this._presenceRoomId || "").trim();
          if (!gid) return false;
          try {
            if (isGamePage && isGamePage()) {
              try { await this._enterGameFromId(gid, false); } catch (e) {}
              return true;
            }
          } catch (e) {}
          try {
            const inPages = (location.pathname || "").includes("/pages/");
            location.href = (inPages ? "game.html" : "pages/game.html") + "?gid=" + encodeURIComponent(gid);
            return true;
          } catch (e) {
            return false;
          }
        },

    _leaveActiveMatchForInvite: async function (gameId) {
          const gid = String(gameId || this.gameId || this._presenceRoomId || "").trim();
          if (!gid || !this.myUid) return true;
          try {
            if (!this.gameId) this._applySessionState({ gameId: gid });
            const res = await this._commitOfficialMatchEnd("leave", "ended_by_player");
            if (!res || res.committed === false || !res.game || res.game.status !== "ended") {
              try { this._forceResync && this._forceResync(); } catch (e) {}
              return false;
            }
            try { this._lastGameData = res.game; } catch (e) {}
            try { this._teardownRoomComms && this._teardownRoomComms(); } catch (e) {}
            try { this.gameRef && this.gameRef.off && this.gameRef.off(); } catch (e) {}
            try { this._clearPersistedActiveGame && this._clearPersistedActiveGame(); } catch (e) {}
            this._applySessionState({
              active: false,
              spectator: false,
              gameId: null,
              gameRef: null,
              side: null,
              presenceStatus: "available",
              presenceRole: "lobby",
              presenceRoomId: null,
            });
            return true;
          } catch (e) {
            handleDbError(e, window.I18N.translateArgs("online.endFail"), { ctx: "invite.leaveActiveMatch" });
            return false;
          }
        },

    _confirmLeaveActiveMatchBeforeInvite: function (gameId) {
          const gid = String(gameId || this.gameId || this._presenceRoomId || "").trim();
          return new Promise((resolve) => {
            let settled = false;
            const done = (value) => {
              if (settled) return;
              settled = true;
              resolve(!!value);
            };
            const text = window.I18N.translateArgs("online.invites.leaveActivePrompt");
            if (!(typeof Modal !== "undefined" && Modal && typeof Modal.open === "function")) {
              if (confirm(text)) {
                this._leaveActiveMatchForInvite(gid).then(done).catch(() => done(false));
              } else {
                done(false);
              }
              return;
            }
            const body = document.createElement("div");
            body.style.whiteSpace = "pre-wrap";
            body.textContent = text;
            Modal.open({
              title: window.I18N.translateArgs("online.invites.activeMatchTitle"),
              body,
              allowEsc: true,
              onClose: (reason) => { if (reason !== "action") done(false); },
              buttons: [
                {
                  label: window.I18N.translateArgs("online.invites.leaveAndSend"),
                  className: "danger",
                  onClick: async () => {
                    try { if (Modal.setButtonsDisabled) Modal.setButtonsDisabled(true); } catch (e) {}
                    const ok = await this._leaveActiveMatchForInvite(gid);
                    done(ok);
                    try { Modal.close("action"); } catch (e) {}
                  },
                },
                {
                  label: window.I18N.translateArgs("online.invites.returnToMatch"),
                  className: "ok",
                  onClick: async () => {
                    done(false);
                    try { Modal.close("action"); } catch (e) {}
                    try { await this._returnToActiveMatch(gid); } catch (e) {}
                  },
                },
                {
                  label: window.I18N.translateArgs("actions.cancel"),
                  className: "ghost",
                  onClick: () => {
                    done(false);
                    try { Modal.close("action"); } catch (e) {}
                  },
                },
              ],
            });
          });
        },

    _joinGame: async function (gameId, entryRequest, initialGame) {
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          this._applySessionState({
            active: true,
            spectator: false,
            side: +1,
            gameId,
            postMatch: false,
            postMatchShown: false,
            presenceStatus: "inPvP",
            presenceRole: "player",
            presenceRoomId: gameId,
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.ONLINE_PLAYER : null,
            reason: "online-join-enter",
          });
          try { this._bindCaptureDraftLifecycle && this._bindCaptureDraftLifecycle(); } catch (e) {}
          try {
            this._discardLocalInvitesOnEnterMatch && this._discardLocalInvitesOnEnterMatch();
          } catch (e) {}
    
          const asyncContext = this._captureAsyncContext(gameId);
          this._setOnlineButtonsState(true, { keepBlocked: true });
          try {
            this._syncMyUidFromAuth && this._syncMyUidFromAuth();
          } catch (e) {}
          try {
            this._pendingSteps = [];
            this._cachedSouflaPlain = null;
            this._markLocalCommitSettled();
          } catch (e) {}
    
          try {
            if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
          } catch (e) {}
    
          this._applySessionState({ gameRef: this._makeOfficialGameRef(gameId) }); // Official /dhamet/api/game/live and /dhamet/api/game/resync endpoints provide live state.
    
    
          // Game activation is official in /dhamet/api/lobby/invite. Joining performs
          // one authoritative resync only; it validates the room and applies the
          // initial board state without a separate roomList/presence refresh.
          let joinedOk = false;
          try {
            joinedOk = await this._applyEntryOfficialState(gameId, initialGame, "join-entry");
            try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(this._lastGameAccess); } catch (e) {}
          } catch (e) {
            joinedOk = false;
          }
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          if (!joinedOk) return await this._abortOnlineEntry("join-sync-failed");
          try { this._startPresenceHeartbeat(); } catch (e) {}
          this._setOnlineButtonsState(true);
          try { this._bindInviteListener(); } catch (e) {}
    
          this._bindGameListeners();
          try {
            await this._initRoomComms();
          } catch (e) {}
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          try {
            this._persistActiveGame();
          } catch (e) {}
          return true;
        },

    _applyUiHold: function (on) {
          try {
            if (on) this._uiHoldGeneration = Number(this._uiHoldGeneration || 0) + 1;
            var root = document.documentElement;
            if (!root || !root.classList) return;
            if (on) {
              root.classList.add("ui-hold");
              root.classList.add("role-pending");
            } else {
              root.classList.remove("ui-hold");
              root.classList.remove("role-pending");
              root.classList.add("ui-ready");
            }
          } catch (e) {}
        },

    _releaseUiHoldSoon: function () {
          // Role/input blocking is owned by the entry transition itself. Once an
          // official state has been accepted, release it synchronously so a
          // missed animation frame can never leave the board or navigation
          // controls permanently locked.
          try { this._applyUiHold(false); } catch (e) {}
          try { if (window.UI && typeof UI.updateAll === "function") UI.updateAll(); } catch (e) {}
          return true;
        },

    _buildOnlineActionState: function (online) {
          const on = online !== false;
          const uiBlocked = !!this._gameLiveRecoveryActive || !!(document.documentElement && document.documentElement.classList.contains("ui-hold"));
          let canUndo = false;
          if (on && !this.isSpectator && !uiBlocked && !this._inPostMatch) {
            try {
              canUndo = !!(
                window.DhametControl &&
                typeof DhametControl.canRequestUndo === "function" &&
                DhametControl.canRequestUndo(this._lastGameData, this.mySide).ok
              );
            } catch (_) { canUndo = false; }
          }
          return {
            online: on,
            spectator: on && !!this.isSpectator,
            uiBlocked,
            postMatch: on && !!this._inPostMatch,
            inChain: !!(typeof Game !== "undefined" && Game.inChain),
            myTurn: !on || !!(typeof Game !== "undefined" && Game.player === this.mySide),
            canUndo,
            canClaimSoufla: on && !this.isSpectator && !!(typeof Game !== "undefined" && Game.availableSouflaForHuman),
            isSyncing: on && !!this._resyncInFlight,
          };
        },

    _applyOnlineActionState: function (online) {
          const state = this._buildOnlineActionState(online);
          if (window.DhametActionStateView && typeof window.DhametActionStateView.applyModeState === "function") {
            return window.DhametActionStateView.applyModeState(state);
          }
          document.body.classList.toggle("mode-pvp", !!state.online);
          window.ZamatControls?.mount?.(!!state.online, !!state.spectator);
          return state;
        },

    _setOnlineButtonsState: function (on, options) {
          const stateOptions = options && typeof options === "object" ? options : {};
          try {
            this._applyUiHold(!!(on && stateOptions.keepBlocked));
          } catch (e) {}
          try {
            this._setButtonsVisualDisabled(!!on);
          } catch (e) {}

          try {
            this._applyOnlineActionState(!!on);
          } catch (error) {
            try { Logger.warn("online_action_state_apply_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
          }

          try {
            const btnEnd = document.getElementById("btnEndOnline");
            if (btnEnd) {
              const showEnd = !!on && !this.isSpectator;
              if (showEnd) btnEnd.onclick = () => this.confirmLeaveRoom();
              else btnEnd.onclick = null;
            }
          } catch (e) {}

          try {
            this._setSyncIssueState(this._syncIssueVisible);
          } catch (e) {}

          if (!on) {
            try {
              const btnChat = document.getElementById("btnChat");
              if (btnChat) delete btnChat.dataset.badge;
            } catch (e) {}
          }

          if (on) {
            try {
              this.refreshPvpControls();
            } catch (e) {}
          } else {
            try {
              if (typeof applyLanguage === "function") {
                applyLanguage(document.documentElement.lang || "ar");
              }
            } catch (e) {}
          }
          if (!stateOptions.keepBlocked) {
            try { this._releaseUiHoldSoon(); } catch (e) {}
          }
        },

    endOnline: async function () {
          const asyncContext = this._captureAsyncContext(this.gameId);
          const who = this.myNick || window.I18N.translateArgs("players.player");
          let res = null;
          let requestError = null;

          try {
            res = await this._commitOfficialMatchEnd("leave", "ended_by_player");
          } catch (error) {
            requestError = error;
            const serverGame = error && error.data && error.data.game;
            if (serverGame && serverGame.status === "ended") res = { ok: true, committed: true, game: serverGame };
          }

          if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return false;

          let endedGame = res && res.game && res.game.status === "ended"
            ? res.game
            : this._lastGameData && this._lastGameData.status === "ended"
              ? this._lastGameData
              : null;
          if (!endedGame) {
            // Resolve ambiguous transport responses against the official room
            // once before showing an error. This prevents a false failure notice
            // when the end action committed but the response was interrupted.
            try {
              await this.syncNow({ reason: "end-confirm", repairPresence: false, notifyFailure: false });
              if (this._lastGameData && this._lastGameData.status === "ended") endedGame = this._lastGameData;
            } catch (e) {}
          }

          if (!endedGame) {
            try { Logger.warn("official_match_end_failed", { gameId: asyncContext.gameId, error: String(requestError && (requestError.message || requestError) || (res && res.error) || "not-ended") }); } catch (_) {}
            try { showOnlineNotice(window.I18N.translateArgs("online.endFail")); } catch (_) {}
            return false;
          }

          this._localEndedOnline = true;
          this._lastGameData = endedGame;
          this._enterPostMatch({
            game: endedGame,
            reason: endedGame.endedReason || "ended_by_player",
            byUid: this.myUid,
            byNick: who,
            endedBy: endedGame.endedBy || null,
            result: endedGame.result || null,
            winner: endedGame.winner,
            players: endedGame.players || null,
          });
          return true;
        },

    _clearPostMatchSession: function () {
          try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (e) {}
          try { this._clearPendingMoveOutbox && this._clearPendingMoveOutbox(); } catch (e) {}
          try { sessionStorage.removeItem("zamat.internalNavTs"); } catch (e) {}
          try { this._clearPersistedActiveGame && this._clearPersistedActiveGame(); } catch (e) {}
        },

    _buildOnlineEndPresentation: function (meta) {
          const info = meta && typeof meta === "object" ? meta : {};
          const gameData = info.game && typeof info.game === "object"
            ? info.game
            : (this._lastGameData && typeof this._lastGameData === "object" ? this._lastGameData : {});
          const result = info.result && typeof info.result === "object"
            ? info.result
            : (gameData.result && typeof gameData.result === "object" ? gameData.result : {});
          const resultMeta = result.meta && typeof result.meta === "object" ? result.meta : {};
          const reason = String(result.reason || info.reason || info.endedReason || gameData.endedReason || "ended").trim();
          const winnerValue = info.winner != null ? info.winner : (gameData.winner != null ? gameData.winner : result.winner);
          const winner = Number(winnerValue) === TOP || Number(winnerValue) === BOT ? Number(winnerValue) : null;
          const players = info.players || gameData.players || {};
          const endedBy = info.endedBy || gameData.endedBy || null;
          const endedBySide = endedBy && (Number(endedBy.side) === TOP || Number(endedBy.side) === BOT)
            ? Number(endedBy.side)
            : null;
          const actionKind = String(resultMeta.kind || (gameData.lastMove && gameData.lastMove.action) || info.kind || "").trim();
          const resultStatus = String(result.status || "").toLowerCase();
          const countsAsResult = resultMeta.countsAsResult !== false;
          const rejectionReason = String(resultMeta.rejectionReason || "").trim();
          const missingOfficial = info.missingOfficial === true || reason === "room_unavailable";

          const rowForSide = (side) => side === BOT ? players.white : side === TOP ? players.black : null;
          const nameForSide = (side) => {
            const row = rowForSide(side);
            const name = row ? displayPlayerName(row.uid, row.nickname) : "";
            if (name) return name;
            try {
              if (typeof Game !== "undefined" && Game && Game.names) {
                const fallback = side === BOT ? Game.names.bot : side === TOP ? Game.names.top : "";
                if (String(fallback || "").trim()) return String(fallback).trim();
              }
            } catch (e) {}
            return window.I18N.translateArgs("players.player");
          };
          const actorName = (() => {
            if (endedBy) {
              const direct = displayPlayerName(endedBy.uid, endedBy.nickname);
              if (direct) return direct;
            }
            if (endedBySide != null) return nameForSide(endedBySide);
            const direct = displayPlayerName(info.byUid, info.byNick);
            return direct || "";
          })();
          const otherSide = endedBySide === TOP ? BOT : endedBySide === BOT ? TOP : null;
          const otherName = otherSide != null ? nameForSide(otherSide) : window.I18N.translateArgs("online.opponent");
          const winnerName = winner != null ? nameForSide(winner) : "";
          const loserSide = winner === TOP ? BOT : winner === BOT ? TOP : null;
          const loserName = loserSide != null ? nameForSide(loserSide) : window.I18N.translateArgs("players.player");
          const isDraw = resultStatus === "draw" || reason === "draw" || reason === "one_king_each";
          const isAbsence = reason === "opponent_absent" || reason === "opponent_absent_late" || actionKind === "opponent-absent";
          const isManual = isAbsence || reason === "ended_by_player" || reason === "late_exit" || ["leave", "resign"].includes(actionKind);
          const adminCounted = countsAsResult && (reason === "late_exit" || reason === "opponent_absent_late" || resultMeta.adjudicated === true);

          const lines = [];
          const add = (text) => {
            const clean = String(text || "").trim();
            if (clean && !lines.includes(clean)) lines.push(clean);
          };

          if (missingOfficial) {
            add(window.I18N.translateArgs("online.endPresentation.roomUnavailable"));
          } else if (winner != null) {
            add(formatTpl(window.I18N.translateArgs("online.endPresentation.winner"), { player: winnerName }));
          } else if (isDraw) {
            add(window.I18N.translateArgs("online.endPresentation.draw"));
          } else if (isManual && actorName) {
            add(isAbsence
              ? formatTpl(window.I18N.translateArgs("online.endPresentation.endedByAbsence"), { player: actorName, opponent: otherName })
              : formatTpl(window.I18N.translateArgs("online.endPresentation.endedBy"), { player: actorName }));
          } else {
            add(window.I18N.translateArgs("online.endPresentation.noRecordedResult"));
          }

          if (!missingOfficial) {
            if (reason === "no_pieces") {
              add(formatTpl(window.I18N.translateArgs("online.endPresentation.reason.noPieces"), { player: loserName }));
            } else if (reason === "no_legal_moves") {
              add(formatTpl(window.I18N.translateArgs("online.endPresentation.reason.noLegalMoves"), { player: loserName }));
            } else if (reason === "one_king_each") {
              add(window.I18N.translateArgs("online.endPresentation.reason.oneKingEach"));
            }

            if (winner != null && isManual) {
              add(isAbsence
                ? formatTpl(window.I18N.translateArgs("online.endPresentation.endedByAbsence"), { player: actorName || window.I18N.translateArgs("players.player"), opponent: otherName })
                : formatTpl(window.I18N.translateArgs("online.endPresentation.endedBy"), { player: actorName || window.I18N.translateArgs("players.player") }));
            }

            if (countsAsResult === false) {
              const key = rejectionReason === "administrative_early_or_midgame"
                ? "online.resultNotCounted.early"
                : rejectionReason === "administrative_position_not_clear"
                  ? "online.resultNotCounted.unclear"
                  : "online.resultNotCounted.generic";
              add(window.I18N.translateArgs(key));
            } else if (adminCounted) {
              add(window.I18N.translateArgs("online.endPresentation.reason.positionDecisive"));
            }
          }

          const primary = lines[0] || window.I18N.translateArgs("online.endPresentation.noRecordedResult");
          return {
            title: window.I18N.translateArgs("online.pvpEndTitle"),
            primary,
            details: lines.slice(1),
            text: lines.join("\n\n"),
            reason,
            winner,
            countsAsResult,
          };
        },

    _enterPostMatch: function (meta) {
          const info = meta && typeof meta === "object" ? meta : {};
          const presentation = this._buildOnlineEndPresentation(info);
          const winner = presentation.winner;

          this._applySessionState({
            postMatch: true,
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.POST_MATCH : null,
            presenceStatus: "available",
            presenceRole: "lobby",
            presenceRoomId: null,
            newEpoch: false,
            reason: "online-post-match",
          });
          if (this._postMatchShown) return true;
          this._applySessionState({ postMatchShown: true });

          try { this._stopUnifiedAppPulse && this._stopUnifiedAppPulse(); } catch (e) {}
          try { this._applyUiHold(false); } catch (e) {}
          try { this._clearPostMatchSession(); } catch (e) {}
          try { this._stopOpponentAbsenceWatcher && this._stopOpponentAbsenceWatcher(); } catch (e) {}
          try { this._markLocalCommitSettled && this._markLocalCommitSettled(); } catch (e) {}
          try { this._unbindGameLiveSubscription && this._unbindGameLiveSubscription(); } catch (e) {}
          try { this._teardownRoomComms && this._teardownRoomComms(); } catch (e) {}
          try { this._teardownGamePresence && this._teardownGamePresence(); } catch (e) {}
          try {
            if (typeof Game !== "undefined" && Game) {
              Game.gameOver = true;
              Game.winner = winner === TOP || winner === BOT ? winner : null;
              Game.terminationReason = presentation.reason;
              Game.endStatusText = presentation.primary;
              Game.inChain = false;
              Game.chainPos = null;
              Game.awaitingPenalty = false;
              Game.souflaPending = null;
              Game.availableSouflaForHuman = null;
              Game.killTimer && Game.killTimer.hardStop && Game.killTimer.hardStop();
            }
          } catch (e) {}
          try { if (typeof Input !== "undefined" && Input) Input.selected = null; } catch (e) {}
          try { if (typeof UI !== "undefined" && UI && typeof UI.updateStatus === "function") UI.updateStatus(); } catch (e) {}
          try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}

          try {
            if (typeof UI !== "undefined" && UI && typeof UI.showOnlineGameOverModal === "function") {
              const opened = UI.showOnlineGameOverModal(presentation);
              if (opened !== false) return true;
            }
          } catch (e) {}

          try { showOnlineNotice(presentation.text, { allowSpectator: true }); } catch (e) {}
          return true;
        },

    _getOpponentInfoFromData: function (data) {
          try {
            const players = data && data.players ? data.players : data;
            if (!players) return { uid: null, nick: "" };
            const w = players.white || {};
            const b = players.black || {};
            if (this.myUid) {
              if (w.uid === this.myUid) return { uid: b.uid || null, nick: displayPlayerName(b.uid, b.nickname) };
              if (b.uid === this.myUid) return { uid: w.uid || null, nick: displayPlayerName(w.uid, w.nickname) };
            }
            if (this.mySide === -1) return { uid: b.uid || null, nick: displayPlayerName(b.uid, b.nickname) };
            if (this.mySide === +1) return { uid: w.uid || null, nick: displayPlayerName(w.uid, w.nickname) };
            if (w.uid) return { uid: w.uid || null, nick: displayPlayerName(w.uid, w.nickname) };
            if (b.uid) return { uid: b.uid || null, nick: displayPlayerName(b.uid, b.nickname) };
          } catch (e) {}
          return { uid: null, nick: "" };
        },

    _exitOnlineSessionTo: async function (pageName) {
          this._applySessionState({
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.LEAVING : null,
            reason: "online-exit",
          });
          try { if (typeof Modal !== "undefined" && Modal && Modal.close) Modal.close("state-change"); } catch (e) {}
          try { this._clearPostMatchSession(); } catch (e) {}

          const gid = this.gameId || this._presenceRoomId;
          const uid = this.myUid;
          const wasSpectator = !!this.isSpectator;
          try { if (gid && uid && wasSpectator) await this._removeSpectatorRegistration(gid, uid); } catch (e) {}
          try { this._unbindGameLiveSubscription && this._unbindGameLiveSubscription(); } catch (e) {}
          try { this._teardownRoomComms && this._teardownRoomComms(); } catch (e) {}
          try { this._teardownGamePresence && this._teardownGamePresence(); } catch (e) {}
          try { this.gameRef && this.gameRef.off && this.gameRef.off(); } catch (e) {}
          try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (e) {}
          try { this._clearPersistedActiveGame && this._clearPersistedActiveGame(); } catch (e) {}
          try { this._markLocalCommitSettled && this._markLocalCommitSettled(); } catch (e) {}

          this._applySessionState({
            active: false,
            spectator: false,
            gameId: null,
            gameRef: null,
            side: null,
            postMatch: false,
            postMatchShown: false,
            presenceRoomId: null,
          });
          try { if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: false }); } catch (e) {}
          try { await this._setLobbyStatus("available"); } catch (e) {}

          try {
            const inPages = (location.pathname || "").includes("/pages/");
            const cleanPage = String(pageName || "mode.html").replace(/^.*\//, "");
            const target = inPages ? cleanPage : "pages/" + cleanPage;
            if (typeof location.replace === "function") location.replace(target);
            else location.href = target;
          } catch (e) {}
          return true;
        },

    exitToLobby: async function () {
          return this._exitOnlineSessionTo("loby.html");
        },

    confirmLeaveRoom: async function () {
          try {
            if (!this.isActive || this.isSpectator) {
              try {
                await this.leaveRoom();
              } catch (e) {}
              return;
            }
    
            if (window.UI && typeof window.UI.confirmMatchExit === "function") {
              await window.UI.confirmMatchExit(async () => {
                await this.leaveRoom();
              });
              return;
            }
    
            const msg =
              (window.I18N && typeof window.I18N.text === "function" ? window.I18N.text("modals.endMatch.confirm") || "" : "") ||
              "هل تريد إنهاء المباراة؟";
            if (confirm(msg)) {
              await this.leaveRoom();
            }
          } catch (e) {
            try {
              await this.leaveRoom();
            } catch (e) {}
          }
        },

    leaveRoom: async function () {
          try {
            const gid = this.gameId || this._presenceRoomId;
            const uid = this.myUid;
            const asyncContext = this._captureAsyncContext(gid);
    
            if (!gid || !uid) {
              try {
                const back = (location.pathname || "").includes("/pages/")
                  ? "./loby.html"
                  : "pages/loby.html";
                location.href = back;
              } catch (e) {}
              return;
            }
    
            if (this.isSpectator) {
              try { await this._removeSpectatorRegistration(gid, uid); } catch (e) {}
              if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return;
              try { await this.exitToLobby(); } catch (e) {}
              return;
            }

            try { await this.endOnline(); } catch (e) {}
            return;
          } catch (e) {}
        },


    _gameLiveActionsBlocked: function () {
          return !!(this.isActive && this._gameLiveRecoveryActive);
        },

    _notifyGameLiveRecovery: function () {
          try {
            const at = nowTs();
            if (this._gameLiveRecoveryNoticeAt && at - this._gameLiveRecoveryNoticeAt < 10000) return false;
            this._gameLiveRecoveryNoticeAt = at;
            showOnlineNotice(window.I18N.translateArgs("status.reconnecting") || window.I18N.translateArgs("status.onlineInitFail"), { allowSpectator: true });
            return true;
          } catch (e) { return false; }
        },

    _maybeRestoreSpectatorRegistration: function (expectedGameId) {
          try {
            const gid = String(expectedGameId || this.gameId || "").trim();
            if (!this.isActive || !this.isSpectator || !gid || String(this.gameId || "") !== gid) return Promise.resolve(false);
            const disconnectedAt = Number(this._gameDisconnectedAt || 0) || 0;
            const at = nowTs();
            if (!disconnectedAt || at - disconnectedAt < SPECTATOR_RECONNECT_REGISTRATION_MS) return Promise.resolve(false);
            if (this._spectatorRecoveryRegistrationPromise) return this._spectatorRecoveryRegistrationPromise;
            if (this._spectatorRecoveryRegistrationAttemptAt && at - this._spectatorRecoveryRegistrationAttemptAt < SPECTATOR_RECONNECT_RETRY_MS) return Promise.resolve(false);
            this._spectatorRecoveryRegistrationAttemptAt = at;
            this._lastSpectatorRegistration = null;
            const context = this._captureAsyncContext(gid);
            const promise = Promise.resolve(this._registerSpectatorInRoom(gid)).then(async (registration) => {
              if (!this._isAsyncContextCurrent(context, { ignorePostMatch: true }) || !this.isSpectator) return false;
              if (registration && registration.ok) {
                this._spectatorRecoveryRegistrationAttemptAt = 0;
                this._unbindGameLiveSubscription();
                this._bindGameLiveSubscription(gid);
                this._scheduleGameLiveRecoverySync(250);
                return true;
              }
              if (registration && registration.reason === "full") {
                showOnlineNotice(window.I18N.translateArgs("lobby.spectatorFull"), { allowSpectator: true });
                await this._abortOnlineEntry("spectator-reconnect-full");
                return false;
              }
              const registrationError = registration && registration.error;
              if (registrationError && this._isDefinitiveGameEntryError(registrationError)) {
                await this._showUnavailableGameAndLeave();
                return false;
              }
              return false;
            }).catch((error) => {
              try { Logger.warn("spectator_reconnect_registration_failed", { gameId: gid, err: String(error && (error.message || error)) }); } catch (_) {}
              return false;
            }).finally(() => {
              if (this._spectatorRecoveryRegistrationPromise === promise) this._spectatorRecoveryRegistrationPromise = null;
            });
            this._spectatorRecoveryRegistrationPromise = promise;
            return promise;
          } catch (e) { return Promise.resolve(false); }
        },

    _scheduleGameLiveRecoverySync: function (delayMs) {
          try {
            if (!this._gameLiveRecoveryActive || !this.isActive || !this.gameId) return false;
            if (this._gameLiveRecoveryTimer) clearTimeout(this._gameLiveRecoveryTimer);
            const expectedGameId = String(this._gameLiveRecoveryGameId || this.gameId || "");
            const delay = Math.max(250, Number(delayMs || 0) || 2000);
            this._gameLiveRecoveryTimer = setTimeout(() => {
              this._gameLiveRecoveryTimer = null;
              if (!this._gameLiveRecoveryActive || !this.isActive || String(this.gameId || "") !== expectedGameId) return;
              if (typeof navigator !== "undefined" && navigator.onLine === false) {
                this._scheduleGameLiveRecoverySync(10000);
                return;
              }
              const attempt = Math.max(0, Number(this._gameLiveRecoveryAttempt || 0) || 0);
              this._gameLiveRecoveryAttempt = attempt + 1;
              Promise.resolve(this.syncNow({
                reason: "game-live-recovery-" + (attempt + 1),
                discardCaptureDraft: true,
                repairPresence: false,
                notifyFailure: false,
              })).then((applied) => {
                if (!this._gameLiveRecoveryActive || String(this.gameId || "") !== expectedGameId) return;
                if (applied && this._gameLiveSocketOpen) {
                  this._finishGameLiveRecovery("socket-and-sync-restored");
                  return;
                }
                if (!applied && this.isSpectator) {
                  this._maybeRestoreSpectatorRegistration(expectedGameId).catch(() => false);
                }
                const delays = [5000, 10000, 15000];
                this._scheduleGameLiveRecoverySync(delays[Math.min(attempt, delays.length - 1)]);
              }).catch(() => {
                if (this._gameLiveRecoveryActive) this._scheduleGameLiveRecoverySync(15000);
              });
            }, delay);
            return true;
          } catch (e) { return false; }
        },

    _startGameLiveRecovery: function (reason) {
          try {
            if (!this.isActive || !this.gameId) return false;
            const gid = String(this.gameId || "");
            if (this._gameLiveRecoveryGameId && String(this._gameLiveRecoveryGameId) !== gid) this._stopGameLiveRecovery("game-changed");
            this._gameLiveRecoveryActive = true;
            this._gameLiveRecoveryGameId = gid;
            this._gameLiveSocketOpen = false;
            this._gameLiveRecoveryAttempt = 0;
            this._spectatorRecoveryRegistrationAttemptAt = 0;
            this._noteReconnectLoss && this._noteReconnectLoss(reason || "game-live");
            this._notifyGameLiveRecovery();
            try { this._applyUiHold(true); } catch (e) {}
            try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}
            this._scheduleGameLiveRecoverySync(2000);
            return true;
          } catch (e) { return false; }
        },

    _handleGameLiveOpenRecovery: function () {
          try {
            this._gameLiveSocketOpen = true;
            if (!this._gameLiveRecoveryActive) return false;
            this._scheduleGameLiveRecoverySync(250);
            return true;
          } catch (e) { return false; }
        },

    _finishGameLiveRecovery: function () {
          try {
            if (this._gameLiveRecoveryTimer) clearTimeout(this._gameLiveRecoveryTimer);
          } catch (e) {}
          this._gameLiveRecoveryTimer = null;
          this._gameLiveRecoveryActive = false;
          this._gameLiveRecoveryAttempt = 0;
          this._spectatorRecoveryRegistrationAttemptAt = 0;
          this._spectatorRecoveryRegistrationPromise = null;
          this._gameLiveRecoveryGameId = null;
          this._gameDisconnectedAt = null;
          try { this._applyUiHold(false); } catch (e) {}
          try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}
          return true;
        },

    _stopGameLiveRecovery: function () {
          try { if (this._gameLiveRecoveryTimer) clearTimeout(this._gameLiveRecoveryTimer); } catch (e) {}
          this._gameLiveRecoveryTimer = null;
          this._gameLiveRecoveryActive = false;
          this._gameLiveRecoveryAttempt = 0;
          this._spectatorRecoveryRegistrationAttemptAt = 0;
          this._spectatorRecoveryRegistrationPromise = null;
          this._gameLiveRecoveryGameId = null;
          this._gameLiveSocketOpen = false;
          try { this._applyUiHold(false); } catch (e) {}
          try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}
          return true;
        },

    _unbindGameLiveSubscription: function () {
          try {
            if (this._gameLiveSub && typeof this._gameLiveSub.close === "function") this._gameLiveSub.close();
          } catch (e) {}
          this._gameLiveSub = null;
          this._gameLiveSocketOpen = false;
        },

    _handleTerminalGameLiveClose: function (event, liveContext) {
          try {
            if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return false;
            if (this._postMatchShown || this._localEndedOnline) return true;
            const code = Number(event && event.code || 0) || 0;
            this._stopGameLiveRecovery("terminal-close");
            if (code === 4001) {
              try { showOnlineNotice(window.I18N.translateArgs("status.onlineInitFail"), { allowSpectator: true }); } catch (e) {}
              try { this.exitToLobby && this.exitToLobby(); } catch (e) {}
              return true;
            }
            if (code === 4003 || code === 4004) {
              try { this._showUnavailableGameAndLeave && this._showUnavailableGameAndLeave(); } catch (e) {}
              return true;
            }
          } catch (e) {}
          return false;
        },

    _bindGameLiveSubscription: function (gameId) {
          const gid = String(gameId || this.gameId || "").trim();
          if (!gid) return false;
          this._unbindGameLiveSubscription();
          const liveContext = this._captureAsyncContext(gid);
          const onLiveGame = (data, envelope) => {
            if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
            if (!data) {
              try { this._verifyMissingOfficialGame(); } catch (e) {}
              return;
            }
            try {
              const applied = this._ingestOfficialGame(data, {
                source: "live",
                gameId: gid,
                version: envelope && envelope.version,
                rejectDuplicate: true,
              });
              if (applied && this._gameLiveRecoveryActive && this._gameLiveSocketOpen) {
                this._finishGameLiveRecovery("live-state-restored");
              } else if (!applied && this._lastOfficialIngestFailureReason === "apply-failed") {
                this._requestOfficialSync({
                  reason: "live-state-apply-failed",
                  notifyFailure: false,
                });
              }
            } catch (e) {
              try { Logger.warn("official_live_apply_failed", { gameId: gid, err: String(e && (e.message || e)) }); } catch (_) {}
            }
          };
          const onLiveChat = (value) => {
            if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
            this._pendingChatLiveSnapshot = value;
            try {
              if (this._chat && typeof this._chat._applySnapshot === "function") this._chat._applySnapshot(value);
            } catch (e) {}
          };
          const onLiveRtc = (value) => {
            if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
            this._lastRtcLiveSnapshot = value;
            try {
              if (this._voice && this._voice.enabled && typeof this._voiceApplyRtcSnapshot === "function") this._voiceApplyRtcSnapshot(value);
              else if (typeof this._voiceMaybeAutoListenFromSnapshot === "function") this._voiceMaybeAutoListenFromSnapshot(value);
            } catch (e) {}
          };
          try {
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.subscribeGameLive !== "function") throw new Error("live-client-missing");
            this._gameLiveSub = window.DhametGameRoomClient.subscribeGameLive({
              gameId: gid,
              onData: onLiveGame,
              onChatData: onLiveChat,
              onRtcData: onLiveRtc,
              onOpen: () => {
                try {
                  if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
                  this._handleGameLiveOpenRecovery && this._handleGameLiveOpenRecovery();
                } catch (e) {}
              },
              onClose: (event, meta) => {
                try {
                  if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
                  if (meta && meta.terminal) this._handleTerminalGameLiveClose(event, liveContext);
                  else this._startGameLiveRecovery && this._startGameLiveRecovery("game-live");
                } catch (e) {}
              },
              onReconnect: () => {
                try {
                  if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
                  this._handleGameLiveOpenRecovery && this._handleGameLiveOpenRecovery();
                  if (this._voice && this._voice.enabled) {
                    this._voiceParticipantsReady = false;
                    this._setVoiceSocketState(true);
                    this._voiceCommitParticipant({ reason: "reconnect" }).catch((error) => {
                      try { Logger.warn("voice_participant_reconnect_failed", { gameId: gid, err: String(error && (error.message || error)) }); } catch (_) {}
                    });
                  }
                } catch (e) {}
              },
              onError: (event) => {
                try {
                  if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
                  this._noteReconnectLoss && this._noteReconnectLoss("game-live");
                  Logger.warn("game_live_transport_error", { gameId: gid, type: String(event && event.type || "error") });
                } catch (e) {}
              },
            });
            return true;
          } catch (e) {
            Logger.warn("game_live_subscribe_failed", { gameId: gid, err: String(e && (e.message || e)) });
            try { this._startGameLiveRecovery && this._startGameLiveRecovery("live-subscribe-failed"); } catch (_) {}
            return false;
          }
        },

    _bindGameListeners: function () {
          const gid = String(this.gameId || "").trim();
          if (!gid) return;
          try {
            if (this.gameRef && typeof this.gameRef.off === "function") this.gameRef.off();
          } catch (e) {}
          try {
            this._setupGamePresence();
          } catch (e) {}
          try {
            this._startOpponentAbsenceWatcher();
          } catch (e) {}
          this._bindGameLiveSubscription(gid);
          try {
            this._installViewHooksOnce();
          } catch (e) {}
        },

    _resumeOfficialTurn: function (nextPlayer) {
          if (typeof nextPlayer === "number") Game.player = nextPlayer;
          Turn.ctx = null;
          Turn.start();
          if (typeof UI !== "undefined" && UI && typeof UI.updateAll === "function") UI.updateAll();
        },

    _installOfficialSouflaState: function (data) {
          const official = data && data.soufla && typeof data.soufla === "object" ? data.soufla : null;
          const rawPending = official && official.pending && typeof official.pending === "object"
            ? official.pending
            : official && Array.isArray(official.offenders)
              ? official
              : null;
          const pending = rawPending ? plainToSoufla(rawPending) : null;
          const availableFor = official && official.availableFor != null
            ? Number(official.availableFor)
            : pending && pending.penalizer != null
              ? Number(pending.penalizer)
              : null;
          const claimable = !!(
            pending &&
            !this.isSpectator &&
            availableFor === Number(this.mySide)
          );
          // An official Soufla right is optional until its owner presses the
          // Soufla button. Merely receiving that right must never pause the
          // turn or block board input. Preserve an already-open choice modal,
          // but otherwise expose only the claimable right.
          const choiceOpen = !!(claimable && Game.awaitingPenalty && Game.souflaPending);
          Game.awaitingPenalty = choiceOpen;
          Game.souflaPending = choiceOpen ? pending : null;
          Game.availableSouflaForHuman = claimable ? pending : null;
          return pending;
        },

    _applyRemoteState: function (data, options) {
          this._isApplyingRemote = true;
          let officialBoardInstalled = false;
          try {
            const applyOptions = options && typeof options === "object" ? options : {};
            const skipFx = !!applyOptions.skipFx;
            const remoteMI = Number(
              (data && (data.moveIndex ?? (data.lastMove && data.lastMove.moveIndex))) ?? 0,
            );

            if (
              this._awaitingLocalCommit &&
              Number.isFinite(this._expectedMoveIndex) &&
              remoteMI < this._expectedMoveIndex
            ) {
              return false;
            }
            const snap = data && data.state ? data.state.snapshot : null;
            const board = snap && snap.board;
            const validBoard = Array.isArray(board) && board.length === 9 && board.every((row) => Array.isArray(row) && row.length === 9);
            if (!snap || !validBoard || snap.inChain) {
              throw new Error("official/invalid-turn-boundary-snapshot");
            }

            if (typeof resetTransientGameState === "function") resetTransientGameState();
            restoreSnapshot(snap, { redraw: false, visual: false });

            const rules = window.DhametRules || null;
            const boardApplied = rules && typeof rules.boardsEqual === "function"
              ? rules.boardsEqual(Game.board, board)
              : JSON.stringify(Game.board) === JSON.stringify(board);
            if (!boardApplied) throw new Error("official/snapshot-board-not-applied");
            officialBoardInstalled = true;

            const lm = data && data.lastMove ? data.lastMove : null;
            const curSide = typeof snap.player === "number"
              ? snap.player
              : typeof data.turn === "number"
                ? data.turn
                : null;
            const lastSide = curSide != null ? -curSide : lm && typeof lm.by === "number" ? lm.by : null;

            // Previous-move markers are presentation metadata. A malformed or
            // unavailable visual helper must never discard an already verified
            // official board or leave the canvas without its pieces.
            try {
              if (lm && lm.kind === "undo" && typeof Visual !== "undefined" && Visual) {
                const fr = lm.undoneFrom != null ? lm.undoneFrom : null;
                const path = Array.isArray(lm.undonePath) ? lm.undonePath : null;
                if (fr != null && path && path.length && typeof Visual.setUndoMovePath === "function") {
                  Visual.setUndoMovePath(fr, path, true);
                } else if (fr != null && path && path.length && typeof Visual.setUndoMove === "function") {
                  Visual.setUndoMove(fr, path[path.length - 1], true);
                } else if (typeof Visual.setUndoMove === "function") {
                  Visual.setUndoMove(null, null, true);
                }
                if (typeof Visual.markTurnBoundary === "function") Visual.markTurnBoundary();
              } else {
                if (lastSide != null) Game.lastMoveSide = lastSide;
                let from = null;
                let path = null;
                if (lm && lm.from != null && Array.isArray(lm.path) && lm.path.length) {
                  from = lm.from;
                  path = lm.path;
                } else {
                  from = snap.lastMoveFrom != null
                    ? snap.lastMoveFrom
                    : snap.lastMovedFrom != null
                      ? snap.lastMovedFrom
                      : null;
                  path = Array.isArray(snap.lastMovePath) && snap.lastMovePath.length
                    ? snap.lastMovePath
                    : snap.lastMovedTo != null
                      ? [snap.lastMovedTo]
                      : null;
                }
                if (from != null && path && path.length && typeof Visual !== "undefined" && Visual) {
                  if (typeof Visual.setLastMovePath === "function") Visual.setLastMovePath(from, path, lastSide);
                  else if (typeof Visual.setLastMove === "function") Visual.setLastMove(from, path[path.length - 1], lastSide);
                  if (typeof Visual.markTurnBoundary === "function") Visual.markTurnBoundary();
                } else if (typeof Visual !== "undefined" && Visual && typeof Visual.setLastMove === "function") {
                  Visual.setLastMove(null, null);
                }
              }
            } catch (error) {
              try { Logger.warn("official_move_visual_ignored", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
            }

            try {
              if (typeof UI !== "undefined" && UI && typeof UI.updateCounts === "function") {
                let top = 0;
                let bot = 0;
                let tKings = 0;
                let bKings = 0;
                for (const row of Game.board) {
                  for (const value of row) {
                    if (!value) continue;
                    if (value > 0) {
                      top++;
                      if (Math.abs(value) === 2) tKings++;
                    } else {
                      bot++;
                      if (Math.abs(value) === 2) bKings++;
                    }
                  }
                }
                UI.updateCounts({ top, bot, tKings, bKings });
              }
            } catch (error) {
              try { Logger.warn("official_piece_counts_ignored", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
            }

            const queue = deferredPromotionQueue(data && data.state);
            Game.deferredPromotions = queue;
            Game.deferredPromotion = queue.length ? Object.assign({}, queue[0]) : null;

            if (!skipFx && data.state && Array.isArray(data.state.capturedOrder)) {
              try {
                if (typeof Visual !== "undefined" && Visual && typeof Visual.setCapturedOrder === "function") {
                  Visual.setCapturedOrder(data.state.capturedOrder, true);
                }
              } catch (error) {
                try { Logger.warn("official_captured_order_ignored", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
              }
            }

            this._installOfficialSouflaState(data);

            const moveFxIndex = lm && typeof lm.moveIndex === "number" ? lm.moveIndex : 0;
            const officialSouflaFx = lm && lm.kind === "soufla" && lm.souflaMeta && lm.souflaMeta.fx
              ? lm.souflaMeta.fx
              : null;
            try {
              if (!skipFx && officialSouflaFx && typeof Visual !== "undefined" && Visual) {
                if (typeof Visual.applySouflaFXBatch === "function") {
                  Visual.applySouflaFXBatch(officialSouflaFx, { noDraw: true });
                  this._lastSouflaFXMoveIndex = moveFxIndex || this._lastSouflaFXMoveIndex;
                }
              } else if (
                !skipFx &&
                this._lastSouflaFXMoveIndex != null &&
                moveFxIndex &&
                moveFxIndex > this._lastSouflaFXMoveIndex
              ) {
                if (typeof Visual !== "undefined" && Visual && typeof Visual.clearSouflaFX === "function") {
                  Visual.clearSouflaFX(true);
                }
                this._lastSouflaFXMoveIndex = null;
              }
            } catch (error) {
              try { Logger.warn("official_soufla_visual_ignored", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
            }

            // Resume only after the authoritative board and turn-owned state
            // have been installed. This canonical path performs the one redraw
            // that reveals the pieces and releases the board for the correct side.
            this._resumeOfficialTurn();

            try {
              if (moveFxIndex && moveFxIndex > (this._lastSeenMoveModal || 0)) {
                this._lastSeenMoveModal = moveFxIndex;
                if (lm.kind === "soufla" && lm.decision) this._showSouflaModalFromLastMove(lm);
                else if (lm.kind === "undo") showOnlineNotice(window.I18N.translateArgs("undo.applied"));
              }
            } catch (error) {
              try { Logger.warn("official_move_notice_ignored", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
            }
            return true;
          } catch (error) {
            // Once a verified official board has been restored, never leave the
            // canvas empty merely because turn orchestration or presentation
            // metadata failed. Draw it while the normal sync fallback retries.
            if (officialBoardInstalled) {
              try {
                if (typeof UI !== "undefined" && UI && typeof UI.updateAll === "function") UI.updateAll();
              } catch (_) {}
            }
            try {
              Logger.warn("official_state_apply_failed", {
                gameId: this.gameId,
                error: String(error && (error.message || error)),
              });
            } catch (_) {}
            return false;
          } finally {
            this._isApplyingRemote = false;
          }
        },

    _isMissingGameError: function (error) {
          const status = Number(error && error.status || 0) || 0;
          const code = String(error && (error.code || error.message) || "").toLowerCase();
          return status === 404 || code.includes("not-found") || code.includes("game-not-found");
        },

    _normalizeOfficialSyncOptions: function (opts) {
          const cfg = opts && typeof opts === "object" ? opts : {};
          const reason = String(cfg.reason || "sync").trim() || "sync";
          return {
            reasons: [reason],
            discardCaptureDraft: !!cfg.discardCaptureDraft,
            repairPresence: cfg.repairPresence === true,
            notifyFailure: cfg.notifyFailure !== false,
          };
        },

    _mergeOfficialSyncOptions: function (target, incoming) {
          const current = target && typeof target === "object" ? target : this._normalizeOfficialSyncOptions({});
          const next = incoming && typeof incoming === "object" && Array.isArray(incoming.reasons)
            ? incoming
            : this._normalizeOfficialSyncOptions(incoming);
          const reasons = Array.isArray(current.reasons) ? current.reasons : [];
          (next.reasons || []).forEach((reason) => {
            const value = String(reason || "").trim();
            if (value && !reasons.includes(value)) reasons.push(value);
          });
          current.reasons = reasons.length ? reasons : ["sync"];
          current.discardCaptureDraft = !!(current.discardCaptureDraft || next.discardCaptureDraft);
          current.repairPresence = !!(current.repairPresence || next.repairPresence);
          current.notifyFailure = !!(current.notifyFailure || next.notifyFailure);
          return current;
        },

    _requestOfficialSync: function (opts) {
          const requested = this._normalizeOfficialSyncOptions(opts);
          if (!this.isActive || !this.gameId) return Promise.resolve(false);
          const expectedGameId = String(this.gameId || "");
          const existing = this._resyncInFlight;
          if (existing && this._isAsyncContextCurrent(existing.context) && existing.promise) {
            existing.options = this._mergeOfficialSyncOptions(existing.options, requested);
            try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}
            return existing.promise;
          }

          const asyncContext = this._captureAsyncContext(expectedGameId);
          const flight = { context: asyncContext, options: requested, promise: null };
          const client = window.DhametGameRoomClient;
          if (!client || typeof client.resyncGame !== "function") return Promise.resolve(false);

          const reasonText = () => (flight.options.reasons || ["sync"]).join("+");
          const promise = Promise.resolve(client.resyncGame({
            gameId: expectedGameId,
            baseMoveIndex: Number(this.moveIndex || 0) || 0,
          })).then(async (res) => {
            if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return false;
            const data = res && res.game ? Object.assign({}, res.game, { __transportVersion: res.version }) : null;
            if (!data) return false;
            if (!this._isCurrentUserPlayerInGame(data) && !this.isSpectator) {
              await this._showUnavailableGameAndLeave();
              return false;
            }

            const applied = this._ingestOfficialGame(data, {
              source: "sync:" + reasonText(),
              gameId: expectedGameId,
              version: res && res.version,
              rejectDuplicate: false,
              allowPendingRollback: !!this._moveRetryGaveUp,
            });

            try { this._reconcilePendingMoveOutbox && this._reconcilePendingMoveOutbox(data); } catch (e) {}
            if (flight.options.discardCaptureDraft) {
              try { this._clearCaptureDraft(); } catch (e) {}
            }
            if (applied) {
              try { this._noteOnlineGameTransportActivity && this._noteOnlineGameTransportActivity("resync"); } catch (e) {}
              if (flight.options.repairPresence && !this.isSpectator) {
                try { this._writeFullGamePresence("gamePresence.sync", false); } catch (e) {}
              }
            }
            return !!applied;
          }).catch(async (error) => {
            if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return false;
            if (this._isMissingGameError(error)) {
              await this._showUnavailableGameAndLeave();
              return false;
            }
            try {
              Logger.warn("official_sync_failed", {
                gameId: expectedGameId,
                reasons: (flight.options.reasons || []).slice(),
                err: String(error && (error.message || error)),
              });
            } catch (_) {}
            if (flight.options.notifyFailure) showOnlineNotice(window.I18N.translateArgs("online.syncFail"));
            return false;
          }).finally(() => {
            if (this._resyncInFlight === flight) this._resyncInFlight = null;
            try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}
          });

          flight.promise = promise;
          this._resyncInFlight = flight;
          try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}
          return promise;
        },

    syncNow: function (opts) {
          const cfg = opts && typeof opts === "object" ? opts : {};
          return this._requestOfficialSync({
            reason: cfg.reason || "sync-now",
            discardCaptureDraft: !!cfg.discardCaptureDraft,
            repairPresence: cfg.repairPresence === true,
            notifyFailure: cfg.notifyFailure !== false,
          });
        },

    _removeSpectatorRegistration: async function (gameId, uid) {
          const gid = String(gameId || "").trim();
          const userId = String(uid || this.myUid || "").trim();
          if (!gid || !userId) return false;
          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitSpectator !== "function") {
            Logger.warn("spectator_leave_client_missing", { gameId: gid });
            return false;
          }

          try {
            const result = await window.DhametGameRoomClient.commitSpectator({
              kind: "leave",
              gameId: gid,
              nickname: this.myNick || "",
              clientSpectatorId: [userId, gid, "leave", nowTs()].join(":"),
            });
            if (!this.isActive || String(this.gameId || "") === gid) {
              this._spectatorRef = null;
              this._spectatorJoinedAt = 0;
            }
            return !!(result && result.ok !== false);
          } catch (e) {
            handleDbError(e, "", { ctx: "spectator.leave" });
            return false;
          }
        },

    _registerSpectatorInRoom: async function (gameId) {
          const gid = String(gameId || this.gameId || this._presenceRoomId || "").trim();
          const uid = String(this.myUid || "").trim();
          if (!gid || !uid) return { ok: false, reason: "invalid" };
          const at = nowTs();
          const cache = this._lastSpectatorRegistration || null;
          if (cache && cache.ok && cache.gameId === gid && cache.uid === uid && at - (Number(cache.at || 0) || 0) < 30 * 1000) {
            return { ok: true, gameId: gid, uid, ref: null, count: Number(cache.count || 0) || 0, cached: true };
          }
          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitSpectator !== "function") {
            return { ok: false, reason: "client_missing" };
          }

          const nick = this.myNick || window.I18N.translateArgs("players.player");
          const fallbackJoinedAt = Number(this._spectatorJoinedAt || 0) || at;
          try {
            const result = await window.DhametGameRoomClient.commitSpectator({
              kind: "join",
              gameId: gid,
              nickname: nick,
              joinedAt: fallbackJoinedAt,
              clientSpectatorId: [uid, gid, "join", fallbackJoinedAt].join(":"),
            });
            if (!result || result.ok === false) {
              const resultCode = String((result && (result.error || result.code)) || "");
              return {
                ok: false,
                reason: /player-cannot/.test(resultCode) ? "player" : (/full/.test(resultCode) ? "full" : "error"),
                error: result,
                game: result && result.game ? result.game : null,
              };
            }
            const own = result.spectator || { uid, nickname: nick, joinedAt: fallbackJoinedAt };
            this._spectatorJoinedAt = Number(own.joinedAt || fallbackJoinedAt) || fallbackJoinedAt;
            this._spectatorRef = null;
            const count = Number(result.count || result.spectatorCount || 0) || 0;
            this._lastSpectatorRegistration = { ok: true, gameId: gid, uid, at, count };
            return { ok: true, gameId: gid, uid, ref: null, count, game: result.game || null };
          } catch (e) {
            const code = String((e && (e.code || e.message)) || "");
            const playerConflict = /player-cannot/.test(code);
            if (!playerConflict) {
              handleDbError(e, window.I18N.translateArgs("online.errors.spectatorJoinFailed"), { ctx: "spectator.join" });
            }
            return {
              ok: false,
              reason: playerConflict ? "player" : (/full/.test(code) ? "full" : "error"),
              error: e,
              game: e && e.data && e.data.game ? e.data.game : null,
            };
          }
        },

    _ensureSpectatorRegistration: async function (gameId) {
          if (!this.isSpectator) return false;
          const result = await this._registerSpectatorInRoom(gameId);
          return !!(result && result.ok);
        },

    _setupGamePresence: function () {
          if (!this.isActive || !this.gameRef) return;
          if (!this._gamePresenceJoinedAt) this._gamePresenceJoinedAt = nowTs();
          try { this._writeFullGamePresence("game-enter", true); } catch (e) {}
          try { this._startGamePresenceHeartbeat(); } catch (e) {}
        },

    _teardownGamePresence: function () {
          try { this._unbindGameLiveSubscription && this._unbindGameLiveSubscription(); } catch (e) {}
          try { this._stopGamePresenceHeartbeat(); } catch (e) {}
          try {
            if (this._gameConnInfoRef && this._gameConnInfoHandler) {
              this._gameConnInfoRef.off("value", this._gameConnInfoHandler);
            }
          } catch (e) {}
          this._gameConnInfoRef = null;
          this._gameConnInfoHandler = null;
          // No direct presenceRef.remove(). Leave/expiry is handled by
          // /dhamet/api/lobby/pulse and smart cleanup.
          this.presenceRef = null;
          this._gamePresenceJoinedAt = 0;
          try { this._stopMoveCommitWatchdog(); } catch (e) {}
          this._oppOfflineSince = null;
          this._selfOfflineSince = null;
          this._oppLeftModalShown = false;
          try {
            this._oppOnline = false;
            this._selfConnected = true;
            this._updatePresenceUi();
          } catch (e) {}
        },

    refreshPvpControls: function () {
          if (!this.isActive) return;
          try {
            this._applyOnlineActionState(true);
          } catch (error) {
            try { Logger.warn("pvp_controls_state_failed", { error: String(error && (error.message || error)) }); } catch (_) {}
          }
    
          const btnSpk = document.getElementById("btnSpk");
          const btnMic = document.getElementById("btnMic");
          const btnChat = document.getElementById("btnChat");
    
          const v = this._voice || {};
          const micMuted = !!v.micMuted;
          const spkMuted = !!v.speakerMuted;
    
          const setBtn = (btn, iconFile, label) => {
            if (!btn) return;
            try {
              const img = btn.querySelector("img.btn-ico");
              if (img && iconFile) img.setAttribute("src", "../assets/icons/" + iconFile);
            } catch (e) {}
            try {
              const tEl = btn.querySelector(".btn-text");
              if (tEl) tEl.textContent = String(label || "");
            } catch (e) {}
            try {
              const sr = btn.querySelector(".sr-only");
              if (sr) sr.textContent = String(label || "");
            } catch (e) {}
            try {
              btn.setAttribute("aria-label", String(label || ""));
            } catch (e) {}
          };
    
          if (btnChat) {
            setBtn(btnChat, "chat.svg", window.I18N.translateArgs("pvp.chat.open"));
          }
          setBtn(
            btnSpk,
            spkMuted ? "volume-off.svg" : "volume-on.svg",
            spkMuted ? window.I18N.translateArgs("pvp.voice.spkOff") : window.I18N.translateArgs("pvp.voice.spkOn"),
          );
    
          setBtn(
            btnMic,
            micMuted ? "mic-off.svg" : "mic-on.svg",
            micMuted ? window.I18N.translateArgs("pvp.voice.micOff") : window.I18N.translateArgs("pvp.voice.micOn"),
          );
    
        },

    toggleSpeaker: async function () {
          try {
            if (this.isSpectator) return;
            this._voice = this._voice || {
              enabled: false,
              speakerMuted: false,
              micMuted: true,
              peers: new Map(),
              remoteAudioEls: new Map(),
              callIds: new Map(),
              reconnectTimers: new Map(),
            };
    
            if (!this._voice.enabled) {
              // Speaker is enabled by default, but the RTC session itself starts
              // only when a player opens the microphone. Toggling the speaker
              // before that should not start WebRTC or request permissions.
              this._voice.speakerMuted = !this._voice.speakerMuted;
              try { this.refreshPvpControls(); } catch (e) {}
              return;
            }
    
            this._voice.speakerMuted = !this._voice.speakerMuted;
    
            try {
              if (this._voice.remoteAudioEls && this._voice.remoteAudioEls.forEach) {
                this._voice.remoteAudioEls.forEach((el) => {
                  try {
                    el.muted = !!this._voice.speakerMuted;
                  } catch (e) {}
                });
              }
            } catch (e) {}
    
            try {
              this._voiceKickAudio();
            } catch (e) {}
            try {
              this.refreshPvpControls();
            } catch (e) {}
          } catch (e) {}
        },

    toggleMic: async function () {
          try {
            if (this.isSpectator) return;
            this._voice = this._voice || {
              enabled: false,
              speakerMuted: false,
              micMuted: true,
              peers: new Map(),
              remoteAudioEls: new Map(),
              callIds: new Map(),
              reconnectTimers: new Map(),
              role: this.isSpectator ? "spectator" : "player",
            };
    
            const wantUnmute = !!this._voice.micMuted;
            let ready = !!this._voice.enabled;
    
            if (wantUnmute && ready && !this._voice.localStream) {
              try {
                this._voiceLeave();
              } catch (e) {}
              ready = false;
            }
    
            if (!ready) {
              try {
                ready = !!(
                  await this._voiceJoin({
                    noMicPrompt: !wantUnmute,
                    allowSpectatorMic: false,
                    desiredMicMuted: !wantUnmute,
                  })
                );
              } catch (e) {
                ready = false;
              }
              if (!ready || (wantUnmute && !this._voice.localStream)) {
                try {
                  this._voice.micMuted = true;
                } catch (e) {}
                try {
                  this.refreshPvpControls();
                } catch (e) {}
                return;
              }
            }
    
            this._voice.micMuted = !wantUnmute;
    
            try {
              const s = this._voice.localStream;
              if (s) {
                s.getAudioTracks().forEach((t) => {
                  t.enabled = !this._voice.micMuted;
                });
              }
            } catch (e) {}
    
            try {
              if (
                window.DhametGameRoomClient &&
                typeof window.DhametGameRoomClient.commitRtcParticipant === "function" &&
                this.myUid &&
                requireAuthUid(this.myUid) &&
                this._voice &&
                !this._voice.writeDenied
              ) {
                const nextMicMuted = !!this._voice.micMuted;
                if (this._voiceLastParticipantMicMuted !== nextMicMuted) {
                  this._voiceLastParticipantMicMuted = nextMicMuted;
                  window.DhametGameRoomClient.commitRtcParticipant({
                    gameId: this.gameId,
                    nickname: this.myNick || "",
                    micMuted: nextMicMuted,
                    clientSignalId: [this.myUid || "u", this.gameId || "g", "mic", Date.now()].join(":"),
                  }).catch((error) => { this._voiceHandleWriteFailure(error, "participant-mic"); });
                }
              }
            } catch (e) {}
            try {
              this._voiceKickAudio();
            } catch (e) {}
            try {
              this.refreshPvpControls();
            } catch (e) {}
          } catch (e) {}
        },

    _voiceKickAudio: function () {
          try {
            try {
              if (!this._voice) return;
              if (!this._voice._audioCtx && (window.AudioContext || window.webkitAudioContext)) {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                this._voice._audioCtx = new Ctx();
              }
              if (this._voice._audioCtx && this._voice._audioCtx.state === "suspended") {
                this._voice._audioCtx.resume().catch(() => {});
              }
            } catch (e) {}
    
            if (this._voice && this._voice.remoteAudioEls && this._voice.remoteAudioEls.forEach) {
              this._voice.remoteAudioEls.forEach((el) => {
                try {
                  el.muted = !!this._voice.speakerMuted;
                  el.volume = 1;
                  const p = el.play && el.play();
                  if (p && p.catch) p.catch(() => {});
                } catch (e) {}
              });
            }
          } catch (e) {}
        },

    openChatModal: async function () {
          try {
            if (!this.isActive) return;
    
            this._chat = this._chat || {
              messages: [],
              unread: 0,
              isOpen: false,
              lastSendAt: 0,
              _myLastReadTs: 0,
              _otherLastReadTs: 0,
            };
    
            try {
              if ((!this._chat || typeof this._chat._applySnapshot !== "function") && typeof this._initRoomComms === "function") {
                await this._initRoomComms();
              }
            } catch (e) {}
    
            const _chatRoleLabel = (role) => {
              try {
                const lang = document.documentElement.lang || "ar";
                if (role === "spectator") return lang === "fr" ? "spectateur" : lang === "en" ? "spectator" : "مشاهد";
                return lang === "fr" ? "joueur" : lang === "en" ? "player" : "لاعب";
              } catch (e) {
                return role === "spectator" ? "spectator" : "player";
              }
            };
    
            const _chatMessageRole = (m) => {
              try {
                const role = String((m && m.role) || "").trim();
                if (role === "player" || role === "spectator") return role;
                const uid = String((m && m.fromUid) || "").trim();
                const g = this._lastGameData && this._lastGameData.players ? this._lastGameData.players : null;
                const wuid = g && g.white && g.white.uid ? String(g.white.uid) : "";
                const buid = g && g.black && g.black.uid ? String(g.black.uid) : "";
                if (uid && (uid === wuid || uid === buid)) return "player";
              } catch (e) {}
              return "spectator";
            };
    
            const _chatDisplayName = (m) => {
              try {
                const fallback = String((m && m.fromNick) || "").trim() || window.I18N.translateArgs("online.player");
                const base = this._displayNameForGameUid(m && m.fromUid, fallback) || fallback;
                return `${base} (${_chatRoleLabel(_chatMessageRole(m))})`;
              } catch (e) {
                return String((m && m.fromNick) || "").trim() || window.I18N.translateArgs("online.player");
              }
            };
            const _chatDir = () => {
              try {
                return ((document.documentElement && document.documentElement.dir) || "rtl").toLowerCase() === "rtl" ? "rtl" : "ltr";
              } catch (e) {
                return "rtl";
              }
            };
    
            try {
            const btn = document.getElementById("btnChat");
            if (btn) delete btn.dataset.badge;
            } catch (e) {}
            this._chat.unread = 0;
            this._chat.isOpen = true;
    
            const whitePlayer = this._lastGameData && this._lastGameData.players && this._lastGameData.players.white;
            const blackPlayer = this._lastGameData && this._lastGameData.players && this._lastGameData.players.black;
            const wName = whitePlayer ? displayPlayerName(whitePlayer.uid, whitePlayer.nickname) : "";
            const bName = blackPlayer ? displayPlayerName(blackPlayer.uid, blackPlayer.nickname) : "";
            const oppName = this._getOpponentInfoFromData(this._lastGameData).nick || window.I18N.translateArgs("online.opponent");
            const roomLabel = wName && bName ? wName + " × " + bName : oppName;
            const title = `${window.I18N.translateArgs("pvp.chat.title")} — ${roomLabel}`;
    
            const wrap = document.createElement("div");
            wrap.className = "pvp-chat";
            const chatDir = _chatDir();
            wrap.setAttribute("dir", chatDir);
    
            const list = document.createElement("div");
            list.className = "pvp-chat-list";
            list.setAttribute("dir", chatDir);
    
            let stickToBottom = true;
            try {
              list.addEventListener("scroll", () => {
                try {
                  const gap = list.scrollHeight - list.scrollTop - list.clientHeight;
                  stickToBottom = gap < 80;
                } catch (e) {}
              });
            } catch (e) {}
    
            const form = document.createElement("div");
            form.className = "pvp-chat-form";
            form.setAttribute("dir", chatDir);
    
            const input = document.createElement("input");
            input.type = "text";
            input.maxLength = 200;
            input.placeholder = window.I18N.translateArgs("pvp.chat.placeholder");
            input.className = "pvp-chat-input";
            input.setAttribute("dir", chatDir);
    
            const send = document.createElement("button");
            send.className = "btn primary pvp-chat-send";
            send.textContent = window.I18N.translateArgs("pvp.chat.send");
            send.type = "button";
    
            form.appendChild(input);
            form.appendChild(send);
    
            wrap.appendChild(list);
            wrap.appendChild(form);
    
            const render = () => {
              try {
                const prevBottomGap = (() => {
                  try {
                    return list.scrollHeight - list.scrollTop - list.clientHeight;
                  } catch (e) {
                    return 0;
                  }
                })();
                const keepScroll = !stickToBottom;
                list.innerHTML = "";
                const arr = this._chat && Array.isArray(this._chat.messages) ? this._chat.messages : [];
                const last = arr.slice(-250);
                if (!last.length) {
                  const empty = document.createElement("div");
                  empty.className = "pvp-chat-empty";
                  empty.style.textAlign = "center";
                  empty.style.opacity = "0.7";
                  empty.style.padding = "18px 8px";
                  empty.textContent = window.I18N.translateArgs("pvp.chat.empty");
                  list.appendChild(empty);
                  return;
                }
    
                last.forEach((m) => {
                  const row = document.createElement("div");
                  const mine = m.fromUid === this.myUid;
                  row.className = "pvp-msg " + (mine ? "me" : "them");
    
                  const bubble = document.createElement("div");
                  bubble.className = "pvp-bubble";
    
                  const from = document.createElement("div");
                  from.className = "pvp-from";
                  from.textContent = `${_chatDisplayName(m)}:`;
                  from.title = _chatDisplayName(m);
    
                  const body = document.createElement("div");
                  body.className = "pvp-text";
                  body.textContent = m.text || "";
    
                  bubble.appendChild(from);
                  bubble.appendChild(body);
    
                  row.appendChild(bubble);
                  list.appendChild(row);
                });
    
                if (stickToBottom) {
                  list.scrollTop = list.scrollHeight + 9999;
                } else if (keepScroll) {
                  try {
                    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight - prevBottomGap);
                  } catch (e) {}
                }
              } catch (e) {}
            };
    
            const markReadToLatest = (readOpts) => {
              try {
                const arr = this._chat && Array.isArray(this._chat.messages) ? this._chat.messages : [];
                let latest = 0;
                for (const m of arr) {
                  const ts = m && typeof m.ts === "number" ? m.ts : 0;
                  if (ts > latest) latest = ts;
                }
                if (latest > 0) this._chatMarkRead(latest, readOpts || {});
              } catch (e) {}
            };
    
            const trySend = async () => {
              try {
                const txt = (input.value || "").trim();
                if (!txt) return;
                if (txt.length > 200) {
                  showOnlineNotice(window.I18N.translateArgs("pvp.chat.tooLong"), { allowSpectator: true });
                  return;
                }
                const now = Date.now();
                if (now - (this._chat.lastSendAt || 0) < 1200) {
                  showOnlineNotice(window.I18N.translateArgs("pvp.chat.rateLimit"), { allowSpectator: true });
                  return;
                }
                this._chat.lastSendAt = now;
                input.value = "";
    
                if ((!this._chat || typeof this._chat._applySnapshot !== "function") && typeof this._initRoomComms === "function") {
                  try { await this._initRoomComms(); } catch (e) {}
                }

                if (this.isSpectator) {
                  try {
                    await this._ensureSpectatorRegistration(this.gameId);
                  } catch (e) {}
                }
    
                if (!this.myUid || !this.gameId || !window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitChat !== "function") {
                  throw new Error("chat_transport_unavailable");
                }
                await window.DhametGameRoomClient.commitChat({
                  gameId: this.gameId,
                  text: txt,
                  nickname: this.myNick || "",
                  clientChatId: [this.myUid || "u", this.gameId || "g", Date.now(), Math.random().toString(36).slice(2, 8)].join(":"),
                });
                try { this._noteOnlineGameTransportActivity && this._noteOnlineGameTransportActivity("chat"); } catch (e) {}
              } catch (e) {
                showOnlineNotice(window.I18N.translateArgs("pvp.chat.failed"), { allowSpectator: true });
              }
            };
    
            send.addEventListener("click", trySend);
            input.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                trySend();
              }
            });
    
            render();
            this._chat._render = render;
    
            markReadToLatest();
    
            Modal.open({
              title,
              body: wrap,
              buttons: [],
              allowSpectator: true,
              modalClassName: "z-chat-modal",
              focusSelector: ".pvp-chat-input",
              onClose: () => {
                try {
                  this._chat.isOpen = false;
                  markReadToLatest({ force: true });
                } catch (e) {}
              },
            });
          } catch (e) {}
        },

    _chatMarkRead: async function (ts, opts) {
          try {
            if (!this.myUid) return;
            ts = Number(ts) || 0;
            if (!ts) return;
            opts = opts || {};
            this._chat = this._chat || {
              messages: [],
              unread: 0,
              isOpen: false,
              lastSendAt: 0,
              _myLastReadTs: 0,
              _otherLastReadTs: 0,
            };
            const cur = Number(this._chat._myLastReadTs || 0);
            if (ts <= cur) return;
            this._chat._myLastReadTs = ts;
            this._chat._pendingReadTs = Math.max(Number(this._chat._pendingReadTs || 0) || 0, ts);
            try { lsSet(chatLastReadKey(this.gameId, this.myUid), String(ts)); } catch (e) {}
            const force = !!opts.force;
            const asyncContext = this._captureAsyncContext(this.gameId);
            const chatState = this._chat;
            const sendNow = async () => {
              try {
                if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true }) || this._chat !== chatState) return;
                const pending = Number(chatState && chatState._pendingReadTs || 0) || 0;
                if (!pending) return;
                if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitChatRead !== "function") return;
                chatState._pendingReadTs = 0;
                chatState._lastReadCommitAt = Date.now();
                await window.DhametGameRoomClient.commitChatRead({
                  gameId: asyncContext.gameId,
                  lastReadTs: pending,
                  clientChatId: [this.myUid || "u", this.gameId || "g", "read", pending].join(":"),
                });
              } catch (e) {}
            };
            const now = Date.now();
            const last = Number(this._chat._lastReadCommitAt || 0) || 0;
            if (force || (last && now - last >= 15 * 1000)) {
              try { if (this._chat._readCommitTimer) clearTimeout(this._chat._readCommitTimer); } catch (e) {}
              this._chat._readCommitTimer = null;
              await sendNow();
              return;
            }
            if (!this._chat._readCommitTimer) {
              const base = last || now;
              const delay = Math.max(1000, 15 * 1000 - (now - base));
              this._chat._readCommitTimer = setTimeout(() => {
                try { this._chat._readCommitTimer = null; } catch (e) {}
                sendNow();
              }, delay);
            }
          } catch (e) {}
        },

    _initRoomComms: async function () {
          try {
            if (!this.isActive || !this.gameId) return;
            if (this.isSpectator) {
              try { await this._ensureSpectatorRegistration(this.gameId); } catch (e) {}
            }
            this._chat = this._chat || {
              messages: [],
              unread: 0,
              isOpen: false,
              lastSendAt: 0,
              _myLastReadTs: 0,
              _otherLastReadTs: 0,
            };

            try {
              const lts = Number(lsGet(chatLastReadKey(this.gameId, this.myUid)) || 0) || 0;
              if (lts) this._chat._myLastReadTs = Math.max(Number(this._chat._myLastReadTs || 0), lts);
            } catch (e) {}

            const applyChatSnapshot = (chatValue) => {
              try {
                const root = chatValue && typeof chatValue === "object" ? chatValue : {};
                const rawMessages = root.messages && typeof root.messages === "object" ? root.messages : {};
                const rawReads = root.reads && typeof root.reads === "object" ? root.reads : {};
                const seeded = [];
                const seen = new Set();
                Object.keys(rawMessages).forEach((id) => {
                  try {
                    const m = rawMessages[id] || {};
                    const msgTs = typeof m.ts === "number" ? m.ts : nowTs();
                    seeded.push({
                      id,
                      fromUid: m.fromUid || "",
                      fromNick: m.fromNick || "",
                      role: (m && (m.role === "player" || m.role === "spectator")) ? m.role : "",
                      text: typeof m.text === "string" ? m.text : String(m.text || ""),
                      ts: msgTs,
                    });
                    seen.add(id);
                  } catch (e) {}
                });
                seeded.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
                this._chat.messages = seeded.slice(-500);
                this._chat._seenIds = seen;
                this._chat._gameId = this.gameId;
                this._chat._readMap = this._chat._readMap || Object.create(null);
                let myRead = Number(this._chat._myLastReadTs || 0) || 0;
                let otherRead = 0;
                Object.keys(rawReads).forEach((uid) => {
                  try {
                    const rec = rawReads[uid] || {};
                    const ts = Number(rec.lastReadTs || 0) || 0;
                    this._chat._readMap[uid] = ts;
                    if (uid === this.myUid) myRead = Math.max(myRead, ts);
                    else otherRead = Math.max(otherRead, ts);
                  } catch (e) {}
                });
                myRead = Math.max(myRead, Number(this._chat._myLastReadTs || 0) || 0, Number(this._chat._pendingReadTs || 0) || 0);
                this._chat._myLastReadTs = myRead;
                this._chat._otherLastReadTs = otherRead;
                let unread = 0;
                for (const m of this._chat.messages) {
                  if (m && m.fromUid && m.fromUid !== this.myUid && Number(m.ts || 0) > myRead) unread += 1;
                }
                this._chat.unread = this._chat.isOpen ? 0 : unread;
                try {
                  const btnChat = document.getElementById("btnChat");
                  if (btnChat) {
                    if (this._chat.unread > 0) btnChat.dataset.badge = this._chat.unread > 99 ? "99+" : String(this._chat.unread);
                    else delete btnChat.dataset.badge;
                  }
                } catch (e) {}
                if (this._chat.isOpen && this._chat._render) {
                  this._chat._render();
                  const latest = this._chat.messages.reduce((max, m) => Math.max(max, Number(m && m.ts || 0)), 0);
                  if (latest > 0) this._chatMarkRead(latest);
                }
              } catch (e) {}
            };
            this._chat._applySnapshot = applyChatSnapshot;

            try {
              if (this._pendingChatLiveSnapshot) applyChatSnapshot(this._pendingChatLiveSnapshot);
            } catch (e) {}


            if (typeof RTCPeerConnection !== "undefined") {
              try {
                this._voice = this._voice || {
                  enabled: false,
                  speakerMuted: false,
                  micMuted: true,
                  peers: new Map(),
                  remoteAudioEls: new Map(),
                  callIds: new Map(),
                  reconnectTimers: new Map(),
                  role: this.isSpectator ? "spectator" : "player",
                };
                // Voice chat is opt-in. Do not join RTC or ask for microphone at
                // match start; the first microphone click starts the session.
                // Watch multiplexed RTC updates on game-live so this player can
                // auto-listen if the opponent starts talking first.
                if (!this.isSpectator && typeof this._voiceWatchRemoteStart === "function") this._voiceWatchRemoteStart();
              } catch (e) {}
            }

            try { this.refreshPvpControls(); } catch (e) {}
          } catch (e) {}
        },

    _teardownRoomComms: function () {
          this._pendingChatLiveSnapshot = null;
          this._chatMsgHandler = null;
          this._chatRef = null;
          this._chatMessagesRef = null;
          this._chatMessagesQuery = null;
          this._chatReadsRef = null;
          this._chatMyReadRef = null;
          this._chatReadsHandler = null;

          try { this._voiceLeave(); } catch (e) {}
          this._voiceRemoteStartWatchEnabled = false;
          this._lastRtcLiveSnapshot = null;

          try {
            const btn = document.getElementById("btnChat");
            if (btn) delete btn.dataset.badge;
          } catch (e) {}
        },

    _voiceReleaseLocalStream: function () {
          try {
            if (this._voice && this._voice.localStream) {
              this._voice.localStream.getTracks().forEach((t) => {
                try {
                  t.stop();
                } catch (e) {}
              });
            }
          } catch (e) {}
          try {
            if (this._voice) this._voice.localStream = null;
          } catch (e) {}
        },

    _voiceShowFailureNotice: function (kind, error) {
          try {
            const rawKind = String(kind || "generic").trim().toLowerCase();
            const keyByKind = {
              permission: "pvp.voice.failure.permission",
              "no-device": "pvp.voice.failure.noDevice",
              busy: "pvp.voice.failure.busy",
              unsupported: "pvp.voice.failure.unsupported",
              session: "pvp.voice.failure.session",
              service: "pvp.voice.failure.service",
              generic: "pvp.voice.failure.generic",
            };
            const resolvedKind = keyByKind[rawKind] ? rawKind : "generic";
            try {
              Logger.warn("voice_start_failed", {
                kind: resolvedKind,
                name: String(error && error.name || ""),
                code: String(error && error.code || ""),
                status: Number(error && error.status || 0) || 0,
              });
            } catch (_) {}
            showOnlineNotice(
              window.I18N.translateArgs(keyByKind[resolvedKind]),
              {
                title: window.I18N.translateArgs("pvp.voice.failedTitle"),
                allowSpectator: true,
              },
            );
          } catch (e) {}
        },

    _voiceCommitParticipant: async function (opts) {
          opts = opts || {};
          if (!this.isActive || !this.gameId || this.isSpectator || !this._voice) return false;
          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitRtcParticipant !== "function") {
            const missing = new Error("rtc_transport_unavailable");
            missing.code = "rtc_transport_unavailable";
            throw missing;
          }
          const res = await window.DhametGameRoomClient.commitRtcParticipant({
            gameId: this.gameId,
            nickname: this.myNick || "",
            micMuted: !!this._voice.micMuted,
            clientSignalId: [this.myUid || "u", this.gameId || "g", opts.reason || "participant", Date.now()].join(":"),
          });
          if (!res || res.ok === false) {
            const failed = new Error((res && res.error) || "rtc_participant_failed");
            failed.code = (res && res.error) || "rtc_participant_failed";
            throw failed;
          }
          this._voiceParticipantsReady = true;
          this._voiceLastParticipantMicMuted = !!this._voice.micMuted;
          if (this._voice) this._voice.writeDenied = false;
          return true;
        },

    _voiceHandleWriteFailure: function (error, context) {
          try {
            const status = Number(error && error.status || 0) || 0;
            const code = String(error && (error.code || error.message) || "");
            const permanent = status === 401 || status === 403 || status === 404 ||
              (status === 409 && /game-not-active|not-player|not-authorized/i.test(code));
            if (permanent && this._voice) {
              this._voice.writeDenied = true;
              this._voiceParticipantsReady = false;
            }
            try {
              const at = Date.now();
              const logKey = [String(context || "rtc"), status, code].join(":");
              this._voice = this._voice || {};
              this._voice.transportFailureLogAt = this._voice.transportFailureLogAt || new Map();
              const lastLogAt = Number(this._voice.transportFailureLogAt.get(logKey) || 0) || 0;
              if (at - lastLogAt >= 15000) {
                this._voice.transportFailureLogAt.set(logKey, at);
                Logger.warn("voice_transport_write_failed", {
                  context: String(context || "rtc"),
                  status,
                  code,
                  permanent,
                });
              }
            } catch (_) {}
            return permanent;
          } catch (e) {
            return false;
          }
        },

    _voiceRememberSignal: function (seenKey) {
          try {
            const key = String(seenKey || "");
            if (!key) return false;
            this._voiceSeenSignals = this._voiceSeenSignals || new Set();
            this._voiceSeenSignalOrder = this._voiceSeenSignalOrder || [];
            if (this._voiceSeenSignals.has(key)) return false;
            this._voiceSeenSignals.add(key);
            this._voiceSeenSignalOrder.push(key);
            while (this._voiceSeenSignalOrder.length > 512) {
              const oldest = this._voiceSeenSignalOrder.shift();
              if (oldest) this._voiceSeenSignals.delete(oldest);
            }
            return true;
          } catch (e) {
            return false;
          }
        },

    _setVoiceSocketState: function (active) {
          try {
            const sub = this._gameLiveSub;
            if (!sub || typeof sub.send !== "function") return false;
            return sub.send({ type: "voice-state", active: active === true });
          } catch (e) {
            return false;
          }
        },

    _voiceSyncOpponentAvailability: function (oppUid, online, previousOnline) {
          try {
            const uid = String(oppUid || "");
            if (!uid || !this._voice || !this._voice.enabled) return;
            if (!online) {
              if (previousOnline !== false) this._voiceDropPeer(uid);
              return;
            }
            if (previousOnline === false) {
              this._voiceClearReconnect(uid, { reset: true });
              if (this._voiceKnownParticipants && this._voiceKnownParticipants.has(uid)) {
                this._voiceConnectTo(uid);
              }
            }
          } catch (e) {}
        },

    _voiceWatchRemoteStart: function () {
          try {
            if (!this.isActive || !this.gameId || this.isSpectator) return false;
            this._voiceRemoteStartWatchEnabled = true;
            if (this._lastRtcLiveSnapshot) this._voiceMaybeAutoListenFromSnapshot(this._lastRtcLiveSnapshot);
            return true;
          } catch (e) {
            return false;
          }
        },

    _voiceMaybeAutoListenFromSnapshot: function (value) {
          try {
            if (!this.isActive || !this.gameId || this.isSpectator) return false;
            if (this._voice && this._voice.enabled) return true;
            if (this._voiceRemoteStartWatchEnabled === false) return false;
            const root = value && typeof value === "object" ? value : {};
            const participants = root.participants && typeof root.participants === "object" ? root.participants : {};
            const hasRemotePlayer = Object.keys(participants).some((uid) => {
              const rec = participants[uid];
              return String(uid) !== String(this.myUid || "") && rec && String(rec.role || "player") === "player";
            });
            if (!hasRemotePlayer) return false;
            this._voiceJoin({ noMicPrompt: true, allowSpectatorMic: false, passiveListen: true }).catch(() => {});
            return true;
          } catch (e) {
            return false;
          }
        },


    _voiceJoin: async function (opts) {
          opts = opts || {};
          if (!this.isActive || !this.gameId || this.isSpectator) return false;
    
          this._voice = this._voice || {
            enabled: false,
            speakerMuted: false,
            micMuted: true,
            peers: new Map(),
            remoteAudioEls: new Map(),
            callIds: new Map(),
            reconnectTimers: new Map(),
            role: this.isSpectator ? "spectator" : "player",
          };
          this._voice.peers = this._voice.peers || new Map();
          this._voice.remoteAudioEls = this._voice.remoteAudioEls || new Map();
          this._voice.callIds = this._voice.callIds || new Map();
          this._voice.reconnectTimers = this._voice.reconnectTimers || new Map();
          if (opts && Object.prototype.hasOwnProperty.call(opts, "desiredMicMuted")) {
            this._voice.micMuted = !!opts.desiredMicMuted;
          }
          if (this._voice.enabled) return true;
          this._voiceRemoteStartWatchEnabled = false;
    
          let authReady = false;
          try {
            authReady = await ensureAuthReady();
          } catch (e) {}
          if (!authReady || !requireAuthUid(this.myUid)) {
            this._voiceShowFailureNotice("session");
            return false;
          }
    
          let acquiredLocalStream = false;
          if (!opts.noMicPrompt) {
            if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
              this._voiceShowFailureNotice("unsupported");
              return false;
            }
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              this._voice.localStream = stream;
              acquiredLocalStream = true;
    
              try {
                stream.getAudioTracks().forEach((t) => {
                  t.enabled = !this._voice.micMuted;
                });
              } catch (e) {}
            } catch (e) {
              this._voice.localStream = null;
              this._voice.micMuted = true;
              const mediaErrorName = String(e && e.name || "");
              const kind = /^(NotAllowedError|SecurityError)$/.test(mediaErrorName)
                ? "permission"
                : /^(NotFoundError|DevicesNotFoundError)$/.test(mediaErrorName)
                  ? "no-device"
                  : /^(NotReadableError|TrackStartError|AbortError)$/.test(mediaErrorName)
                    ? "busy"
                    : /^(NotSupportedError|TypeError)$/.test(mediaErrorName)
                      ? "unsupported"
                      : "generic";
              this._voiceShowFailureNotice(kind, e);
              return false;
            }
          }
    
          try {
            if (this._voice) this._voice.writeDenied = false;
          } catch (e) {}
    
          try {
            this._voice.iceServers = await this._voiceFetchIceServers();
          } catch (e) {
            this._voice.iceServers = this._voiceDefaultIceServers();
          }
          this._voice.joinedAt = Date.now();
    
          this._rtcRef = null;
          this._voiceParticipantsRef = null;
          this._voiceSignalsToMeRef = null;
          this._voiceKnownParticipants = new Set();
          this._voiceSeenSignals = this._voiceSeenSignals || new Set();
          this._voiceSeenSignalOrder = this._voiceSeenSignalOrder || [];
          try { if (this.myUid) this._voiceKnownParticipants.add(this.myUid); } catch (e) {}

          this._voiceParticipantsReady = false;
          try {
            await this._voiceCommitParticipant({ reason: "participant" });
          } catch (e) {
            this._voiceHandleWriteFailure(e, "participant-join");
            if (acquiredLocalStream) this._voiceReleaseLocalStream();
            this._voiceShowFailureNotice("service", e);
            return false;
          }

          try {
            if (!document.getElementById("pvpAudio")) {
              const c = document.createElement("div");
              c.id = "pvpAudio";
              c.style.display = "none";
              document.body.appendChild(c);
            }
          } catch (e) {}

          const applyRtcSnapshot = async (rtcValue) => {
            try {
              const root = rtcValue && typeof rtcValue === "object" ? rtcValue : {};
              const participants = root.participants && typeof root.participants === "object" ? root.participants : {};
              const nextKnown = new Set();
              if (this.myUid) nextKnown.add(String(this.myUid));
              Object.keys(participants).forEach((uid) => {
                try {
                  const rec = participants[uid];
                  if (!rec || String(uid) === String(this.myUid)) return;
                  if (String(rec.role || "") !== "player") return;
                  nextKnown.add(String(uid));
                  if (!this._voiceKnownParticipants || !this._voiceKnownParticipants.has(String(uid))) {
                    this._voiceConnectTo(String(uid));
                  }
                } catch (e) {}
              });
              try {
                if (this._voiceKnownParticipants && this._voiceKnownParticipants.forEach) {
                  this._voiceKnownParticipants.forEach((uid) => {
                    try {
                      if (String(uid) !== String(this.myUid) && !nextKnown.has(String(uid))) this._voiceDropPeer(String(uid));
                    } catch (e) {}
                  });
                }
              } catch (e) {}
              this._voiceKnownParticipants = nextKnown;

              const incomingRoot = root.signals && root.signals[this.myUid] && typeof root.signals[this.myUid] === "object"
                ? root.signals[this.myUid]
                : {};
              for (const fromUid of Object.keys(incomingRoot)) {
                const queue = incomingRoot[fromUid] && typeof incomingRoot[fromUid] === "object" ? incomingRoot[fromUid] : {};
                const ackIds = [];
                const ids = Object.keys(queue).sort((a, b) => {
                  const av = queue[a] && typeof queue[a].ts === "number" ? queue[a].ts : 0;
                  const bv = queue[b] && typeof queue[b].ts === "number" ? queue[b].ts : 0;
                  return av - bv || String(a).localeCompare(String(b));
                });
                for (const signalId of ids) {
                  try {
                    const seenKey = String(fromUid) + ":" + String(signalId);
                    const isNewSignal = this._voiceRememberSignal(seenKey);
                    if (isNewSignal) {
                      const msg = queue[signalId];
                      if (!msg) continue;
                      await this._voiceHandleSignal(fromUid, msg);
                    }
                    // A duplicate means a previous ACK was lost or not committed.
                    // Re-ACK it without re-running its WebRTC side effects.
                    ackIds.push(signalId);
                  } catch (e) {}
                }
                if (ackIds.length && window.DhametGameRoomClient) {
                  if (typeof window.DhametGameRoomClient.commitRtcAcks === "function") {
                    try {
                      await window.DhametGameRoomClient.commitRtcAcks({
                        gameId: this.gameId,
                        fromUid: fromUid,
                        signalIds: ackIds,
                      });
                    } catch (error) {
                      this._voiceHandleWriteFailure(error, "ack-batch");
                    }
                  } else if (typeof window.DhametGameRoomClient.commitRtcAck === "function") {
                    const ackResults = await Promise.allSettled(ackIds.map((signalId) =>
                      window.DhametGameRoomClient.commitRtcAck({
                        gameId: this.gameId,
                        fromUid: fromUid,
                        signalId: signalId,
                      })
                    ));
                    ackResults.forEach((result) => {
                      if (result && result.status === "rejected") {
                        this._voiceHandleWriteFailure(result.reason, "ack");
                      }
                    });
                  }
                }
              }
            } catch (e) {}
          };
          let rtcSnapshotRunning = false;
          let rtcSnapshotQueued = false;
          let rtcSnapshotPending = null;
          const queueRtcSnapshot = (value) => {
            rtcSnapshotPending = value;
            rtcSnapshotQueued = true;
            if (rtcSnapshotRunning) return;
            rtcSnapshotRunning = true;
            Promise.resolve().then(async () => {
              while (rtcSnapshotQueued) {
                const nextValue = rtcSnapshotPending;
                rtcSnapshotPending = null;
                rtcSnapshotQueued = false;
                if (!this.isActive || !this._voice || !this._voice.enabled) break;
                await applyRtcSnapshot(nextValue);
              }
            }).catch(() => {}).finally(() => {
              rtcSnapshotRunning = false;
              if (rtcSnapshotQueued && this.isActive && this._voice && this._voice.enabled) {
                queueRtcSnapshot(rtcSnapshotPending);
              }
            });
          };
          this._voiceApplyRtcSnapshot = queueRtcSnapshot;

          try {
            if (this._lastRtcLiveSnapshot) queueRtcSnapshot(this._lastRtcLiveSnapshot);
          } catch (e) {}


          this._voice.enabled = true;
          this._setVoiceSocketState(true);
          try {
            this.refreshPvpControls();
          } catch (e) {}
          return true;
        },

    _voiceLeave: function () {
          try {
            if (!this._voice) return;
            this._setVoiceSocketState(false);
            this._voice.enabled = false;
            this._voiceParticipantsReady = false;
            this._voiceLastParticipantMicMuted = null;
    
            this._voiceApplyRtcSnapshot = null;
            this._voiceParticipantsHandler = null;
            this._voiceParticipantsRemovedHandler = null;
            this._voiceSignalsRootHandler = null;
            this._voiceSignalHandlers = null;
            try {
              if (this._voiceIceBatches && this._voiceIceBatches.forEach) {
                this._voiceIceBatches.forEach((entry) => {
                  try { if (entry && entry.timer) clearTimeout(entry.timer); } catch (e) {}
                });
              }
            } catch (e) {}
            this._voiceIceBatches = new Map();
            this._voicePendingRemoteIce = new Map();
    
            try {
              if (this._voice.reconnectTimers && this._voice.reconnectTimers.forEach) {
                this._voice.reconnectTimers.forEach((timer) => {
                  try {
                    clearTimeout(timer);
                  } catch (e) {}
                });
              }
            } catch (e) {}
            this._voice.reconnectTimers = new Map();
            this._voice.reconnectAttempts = new Map();
            this._voice.reconnectInFlight = new Set();
            this._voice.connectInFlight = new Set();
            this._voiceSeenSignals = new Set();
            this._voiceSeenSignalOrder = [];
    
            try {
              if (this._voice.peers && this._voice.peers.forEach) {
                this._voice.peers.forEach((pc) => {
                  try {
                    pc.close();
                  } catch (e) {}
                });
              }
            } catch (e) {}
            try {
              if (this._voice.peers) this._voice.peers.clear();
            } catch (e) {}
    
            try {
              if (this._voice.remoteAudioEls && this._voice.remoteAudioEls.forEach) {
                this._voice.remoteAudioEls.forEach((el) => {
                  try {
                    el.remove();
                  } catch (e) {}
                });
              }
            } catch (e) {}
            try {
              if (this._voice.remoteAudioEls) this._voice.remoteAudioEls.clear();
            } catch (e) {}
    
            try {
              this._voiceReleaseLocalStream();
            } catch (e) {}
            this._voice.callIds = new Map();
    
            try {
              if (window.DhametGameRoomClient && typeof window.DhametGameRoomClient.commitRtcLeave === "function" && this.gameId) {
                window.DhametGameRoomClient.commitRtcLeave({
                  gameId: this.gameId,
                  clientSignalId: [this.myUid || "u", this.gameId || "g", "leave", Date.now()].join(":"),
                }).catch(() => {});
              }
            } catch (e) {}
          } catch (e) {}
        },

    _voiceDefaultIceServers: function () {
          return [
            {
              urls: [
                "stun:stun.cloudflare.com:3478",
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
              ],
            },
          ];
        },

    _voiceFilterIceServers: function (iceServers) {
          const fallback = this._voiceDefaultIceServers();
          try {
            if (!Array.isArray(iceServers) || !iceServers.length) return fallback;
            const filtered = iceServers
              .map((server) => {
                if (!server) return null;
                let urls = [];
                if (Array.isArray(server.urls)) urls = server.urls.slice();
                else if (server.urls) urls = [server.urls];
                urls = urls.filter(
                  (url) => typeof url === "string" && !/^(turn|turns):[^?]*:53(?:\?|$)/i.test(url),
                );
                if (!urls.length) return null;
                const out = { urls: urls.length === 1 ? urls[0] : urls };
                if (typeof server.username === "string") out.username = server.username;
                if (typeof server.credential === "string") out.credential = server.credential;
                return out;
              })
              .filter(Boolean);
            return filtered.length ? filtered : fallback;
          } catch (e) {
            return fallback;
          }
        },

    _voiceFetchIceServers: async function () {
          const fallback = this._voiceDefaultIceServers();
          try {
            const baseUrl = String((window.ZAMAT_TURN_URL || window.ZAMAT_TURN_ENDPOINT || "/dhamet/api/turn") || "").trim();
            if (!baseUrl || !this.gameId || !this.isActive || this.isSpectator) return fallback;
            const sep = baseUrl.includes("?") ? "&" : "?";
            const url = baseUrl + sep + "gameId=" + encodeURIComponent(String(this.gameId));
            const res = await fetch(url, {
              method: "GET",
              headers: { Accept: "application/json" },
              credentials: "same-origin",
              cache: "no-store",
            });
            if (!res || !res.ok) return fallback;
            const data = await res.json().catch(() => null);
            try {
              if (this._voice) {
                this._voice.iceMode = String(data && data.mode || "stun-only");
                this._voice.turnAvailable = !!(data && data.turnAvailable);
                this._voice.credentialMode = String(data && data.credentialMode || "none");
                this._voice.iceExpiresAt = Number(data && data.expiresAt || 0) || 0;
                this._voice.iceFetchedAt = Date.now();
              }
              if (data && data.turnAvailable === false && !this._voiceTurnUnavailableLogged) {
                this._voiceTurnUnavailableLogged = true;
                try { Logger.warn("voice_turn_unavailable", { mode: String(data.mode || "stun-only"), reason: String(data.reason || "turn-not-configured") }); } catch (_) {}
              }
            } catch (_) {}
            const iceServers = this._voiceFilterIceServers(data && data.iceServers);
            return iceServers;
          } catch (e) {
            return fallback;
          }
        },

    _voiceNewCallId: function (otherUid) {
          try {
            if (window.crypto && typeof window.crypto.randomUUID === "function") {
              return String(window.crypto.randomUUID()) + ":" + String(otherUid || "");
            }
          } catch (e) {}
          return [Date.now(), String(this.myUid || ""), String(otherUid || ""), Math.random().toString(36).slice(2)].join(":");
        },

    _voiceClearReconnect: function (otherUid, opts) {
          opts = opts || {};
          try {
            const timer = this._voice && this._voice.reconnectTimers && this._voice.reconnectTimers.get(otherUid);
            if (timer) clearTimeout(timer);
          } catch (e) {}
          try {
            if (this._voice && this._voice.reconnectTimers) this._voice.reconnectTimers.delete(otherUid);
            if (opts.reset && this._voice) {
              try { this._voice.reconnectAttempts && this._voice.reconnectAttempts.delete(otherUid); } catch (_) {}
              try { this._voice.reconnectInFlight && this._voice.reconnectInFlight.delete(otherUid); } catch (_) {}
            }
          } catch (e) {}
        },

    _voiceScheduleReconnect: function (otherUid, reason) {
          try {
            const uid = String(otherUid || "");
            if (!uid || !this._voice || !this._voice.enabled || this.isSpectator) return;
            if (this._oppOnline === false) return;
            if (String(this.myUid || "") >= uid) return;
            try {
              if (this._voiceKnownParticipants && !this._voiceKnownParticipants.has(uid)) return;
            } catch (_) {}

            this._voice.reconnectTimers = this._voice.reconnectTimers || new Map();
            this._voice.reconnectAttempts = this._voice.reconnectAttempts || new Map();
            this._voice.reconnectInFlight = this._voice.reconnectInFlight || new Set();
            if (this._voice.reconnectTimers.has(uid) || this._voice.reconnectInFlight.has(uid)) return;

            const attempts = Math.max(0, Number(this._voice.reconnectAttempts.get(uid) || 0) || 0);
            const maxAttempts = 3;
            if (attempts >= maxAttempts) return;
            const delays = reason === "failed" ? [1500, 5000, 12000] : [4000, 8000, 15000];
            const delay = delays[Math.min(attempts, delays.length - 1)];
            const asyncContext = this._captureAsyncContext(this.gameId);
            const timer = setTimeout(async () => {
              try {
                if (this._voice && this._voice.reconnectTimers) this._voice.reconnectTimers.delete(uid);
                if (!this._isAsyncContextCurrent(asyncContext)) return;
                if (!this._voice || !this._voice.enabled || this._oppOnline === false) return;
                try {
                  if (this._voiceKnownParticipants && !this._voiceKnownParticipants.has(uid)) return;
                } catch (_) {}

                const currentAttempts = Math.max(0, Number(this._voice.reconnectAttempts.get(uid) || 0) || 0);
                if (currentAttempts >= maxAttempts) return;
                this._voice.reconnectInFlight.add(uid);
                this._voice.reconnectAttempts.set(uid, currentAttempts + 1);
                await this._voiceRestartPeer(uid, reason);
              } catch (e) {
              } finally {
                try { this._voice && this._voice.reconnectInFlight && this._voice.reconnectInFlight.delete(uid); } catch (_) {}
                try {
                  const pc = this._voice && this._voice.peers && this._voice.peers.get(uid);
                  const state = pc && pc.connectionState;
                  const used = Number(this._voice && this._voice.reconnectAttempts && this._voice.reconnectAttempts.get(uid) || 0) || 0;
                  if (this._voice && this._voice.enabled && this._oppOnline !== false &&
                      (state === "failed" || state === "disconnected") && used < maxAttempts) {
                    this._voiceScheduleReconnect(uid, state);
                  }
                } catch (_) {}
              }
            }, delay);
            this._voice.reconnectTimers.set(uid, timer);
          } catch (e) {}
        },

    _voiceRestartPeer: async function (otherUid, reason) {
          try {
            const uid = String(otherUid || "");
            if (!uid || !this._voice || !this._voice.enabled || this._oppOnline === false) return false;
            if (String(this.myUid || "") >= uid) return false;
            const current = this._voice.peers && this._voice.peers.get(uid);
            if (current && current.connectionState === "connected") return true;

            let pc = current;
            if (!pc || pc.signalingState === "closed") {
              pc = this._voiceEnsurePeer(uid, { forceNew: true, preserveReconnectState: true });
            }
            if (pc && pc.signalingState !== "stable") {
              try { this._voiceDropPeer(uid, { preserveCallId: false, preserveReconnectState: true }); } catch (e) {}
              pc = this._voiceEnsurePeer(uid, { forceNew: true, preserveReconnectState: true });
            }
            if (!pc) return false;

            const callId = this._voiceNewCallId(uid);
            try { this._voice.callIds.set(uid, callId); } catch (e) {}
            const offer = await pc.createOffer({ iceRestart: true });
            if (!this._voice || this._voice.peers.get(uid) !== pc || this._oppOnline === false) return false;
            await pc.setLocalDescription(offer);
            return this._voiceSendSignal(uid, { type: "offer", sdp: offer.sdp, callId: callId, restart: !!reason }) !== false;
          } catch (e) {
            return false;
          }
        },

    _voiceQueueIceSignal: function (toUid, payload) {
          try {
            if (!this.gameId || !toUid || !this.myUid) return false;
            if (!requireAuthUid(this.myUid)) return false;
            if (!this._voiceParticipantsReady || this._oppOnline === false) return false;
            try {
              if (this._voiceKnownParticipants && !this._voiceKnownParticipants.has(String(toUid))) return false;
            } catch (e) {}
            this._voiceIceBatches = this._voiceIceBatches || new Map();
            const key = String(toUid);
            const entry = this._voiceIceBatches.get(key) || {
              signals: [],
              timer: null,
              asyncContext: this._captureAsyncContext(this.gameId),
            };
            const sig = Object.assign({ ts: Date.now() }, payload || {});
            try {
              const currentCallId = sig.callId || (this._voice && this._voice.callIds && this._voice.callIds.get(key));
              if (currentCallId) sig.callId = currentCallId;
            } catch (e) {}
            entry.signals.push(sig);
            this._voiceIceBatches.set(key, entry);
            const flush = () => {
              try {
                const cur = this._voiceIceBatches && this._voiceIceBatches.get(key);
                if (!cur) return;
                this._voiceIceBatches.delete(key);
                if (!this._isAsyncContextCurrent(cur.asyncContext) || this._oppOnline === false) return;
                const signals = (cur.signals || []).splice(0, 16).filter(Boolean);
                if (!signals.length) return;
                if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitRtcSignal !== "function") return;
                window.DhametGameRoomClient.commitRtcSignal({
                  kind: "signals-batch",
                  gameId: cur.asyncContext.gameId,
                  toUid: key,
                  signals: signals,
                  clientSignalId: [this.myUid || "u", key, "icebatch", Date.now(), Math.random().toString(36).slice(2, 8)].join(":"),
                }).catch((error) => { this._voiceHandleWriteFailure(error, "ice-batch"); });
              } catch (e) {}
            };
            if (!entry.timer) {
              entry.timer = setTimeout(flush, 150);
            }
            if (entry.signals.length >= 8) {
              try { clearTimeout(entry.timer); } catch (e) {}
              entry.timer = null;
              flush();
            }
            return true;
          } catch (e) {
            return false;
          }
        },

    _voiceSendSignal: function (toUid, payload) {
          try {
            if (!this.gameId) return false;
            if (!toUid || !this.myUid || this._oppOnline === false) return false;
            if (this._voice && this._voice.writeDenied) return false;
            if (payload && payload.type === "ice") {
              return this._voiceQueueIceSignal(toUid, payload);
            }
    
            if (!requireAuthUid(this.myUid)) return false;
            if (!this._voiceParticipantsReady) return false;
            try {
              if (this._voiceKnownParticipants && !this._voiceKnownParticipants.has(String(toUid)))
                return false;
            } catch (e) {}
    
            const msg = Object.assign({ ts: Date.now() }, payload || {});
            try {
              const currentCallId = msg.callId || (this._voice && this._voice.callIds && this._voice.callIds.get(String(toUid)));
              if (currentCallId) msg.callId = currentCallId;
            } catch (e) {}
    
            try {
              if (msg && typeof msg.sdp === "string" && msg.sdp.length > 4900) {
                const sdp = msg.sdp;
                try {
                  delete msg.sdp;
                } catch (e) {
                  msg.sdp = null;
                }
                const parts = [];
                const CHUNK = 4000;
                for (let i = 0; i < sdp.length; i += CHUNK) parts.push(sdp.slice(i, i + CHUNK));
                msg.sdpParts = parts;
                msg.sdpChunked = true;
              }
            } catch (e) {}
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitRtcSignal !== "function") return false;
            window.DhametGameRoomClient.commitRtcSignal({
              gameId: this.gameId,
              toUid: String(toUid),
              signal: msg,
              clientSignalId: [this.myUid || "u", String(toUid || "to"), Date.now(), Math.random().toString(36).slice(2, 8)].join(":"),
            }).catch((error) => { this._voiceHandleWriteFailure(error, "signal"); });
            return true;
          } catch (e) {
            return false;
          }
        },

    _voiceRemoteIceKey: function (otherUid, callId) {
          return String(otherUid || "") + "::" + String(callId || "");
        },

    _voiceQueueRemoteIce: function (otherUid, callId, candidate) {
          try {
            if (!otherUid || !candidate) return false;
            this._voicePendingRemoteIce = this._voicePendingRemoteIce || new Map();
            const key = this._voiceRemoteIceKey(otherUid, callId);
            const queue = this._voicePendingRemoteIce.get(key) || [];
            queue.push(candidate);
            if (queue.length > 64) queue.splice(0, queue.length - 64);
            this._voicePendingRemoteIce.set(key, queue);
            return true;
          } catch (e) {
            return false;
          }
        },

    _voiceFlushRemoteIce: async function (otherUid, callId, pc) {
          try {
            if (!otherUid || !pc || !pc.remoteDescription) return false;
            this._voicePendingRemoteIce = this._voicePendingRemoteIce || new Map();
            const key = this._voiceRemoteIceKey(otherUid, callId);
            const queue = this._voicePendingRemoteIce.get(key) || [];
            if (!queue.length) return true;
            this._voicePendingRemoteIce.delete(key);
            for (const candidate of queue) {
              try { await pc.addIceCandidate(candidate); } catch (_) {}
            }
            return true;
          } catch (e) {
            return false;
          }
        },

    _voiceEnsurePeer: function (otherUid, opts) {
          opts = opts || {};
          this._voice = this._voice || {
            enabled: false,
            speakerMuted: false,
            micMuted: true,
            peers: new Map(),
            remoteAudioEls: new Map(),
            callIds: new Map(),
            reconnectTimers: new Map(),
            role: this.isSpectator ? "spectator" : "player",
          };
          this._voice.peers = this._voice.peers || new Map();
          this._voice.remoteAudioEls = this._voice.remoteAudioEls || new Map();
          this._voice.callIds = this._voice.callIds || new Map();
          this._voice.reconnectTimers = this._voice.reconnectTimers || new Map();
          if (!opts.forceNew && this._voice.peers && this._voice.peers.has(otherUid))
            return this._voice.peers.get(otherUid);
    
          if (opts.forceNew) {
            try {
              this._voiceDropPeer(otherUid, {
                preserveCallId: true,
                preserveReconnectState: !!opts.preserveReconnectState,
              });
            } catch (e) {}
          }
    
          const pc = new RTCPeerConnection({
            iceServers: this._voiceFilterIceServers(this._voice.iceServers),
          });
    
          try {
            if (this._voice.localStream) {
              this._voice.localStream
                .getTracks()
                .forEach((track) => pc.addTrack(track, this._voice.localStream));
            } else {
              try {
                pc.addTransceiver("audio", { direction: "recvonly" });
              } catch (e) {}
            }
          } catch (e) {}
    
          pc.onicecandidate = (ev) => {
            try {
              if (!this._voice || this._voice.peers.get(otherUid) !== pc || this._oppOnline === false) return;
              if (ev.candidate) this._voiceSendSignal(otherUid, { type: "ice", candidate: ev.candidate });
            } catch (e) {}
          };
    
          pc.ontrack = (ev) => {
            try {
              if (!this._voice || this._voice.peers.get(otherUid) !== pc) return;
              const stream = ev.streams && ev.streams[0] ? ev.streams[0] : null;
              if (!stream) return;
    
              let el = this._voice.remoteAudioEls.get(otherUid);
              if (!el) {
                el = document.createElement("audio");
                el.autoplay = true;
                el.playsInline = true;
                el.muted = !!this._voice.speakerMuted;
                this._voice.remoteAudioEls.set(otherUid, el);
                const holder = document.getElementById("pvpAudio") || document.body;
                holder.appendChild(el);
              }
              el.srcObject = stream;
              try {
                el.volume = 1;
                const p = el.play && el.play();
                if (p && p.catch) p.catch(() => {});
              } catch (e) {}
              try {
                this._voiceKickAudio();
              } catch (e) {}
            } catch (e) {}
          };
    
          pc.onconnectionstatechange = () => {
            try {
              if (!this._voice || this._voice.peers.get(otherUid) !== pc) return;
              const state = pc.connectionState;
              if (state === "connected") {
                this._voiceClearReconnect(otherUid, { reset: true });
              } else if (state === "failed" || state === "disconnected") {
                this._voiceScheduleReconnect(otherUid, state);
              } else if (state === "closed") {
                this._voiceClearReconnect(otherUid);
              }
            } catch (e) {}
            try {
              this.refreshPvpControls();
            } catch (e) {}
          };
    
          this._voice.peers.set(otherUid, pc);
          return pc;
        },

    _voiceConnectTo: async function (otherUid) {
          const uid = String(otherUid || "");
          if (!uid || !this._voice || !this._voice.enabled || this.isSpectator || this._oppOnline === false) return false;
          if (String(this.myUid || "") >= uid) return false;
          this._voice.connectInFlight = this._voice.connectInFlight || new Set();
          if (this._voice.connectInFlight.has(uid)) return false;
          this._voice.connectInFlight.add(uid);
          try {
            const pc = this._voiceEnsurePeer(uid);
            if (!pc || pc.signalingState !== "stable") return false;
            const callId = this._voiceNewCallId(uid);
            try { this._voice.callIds.set(uid, callId); } catch (e) {}
            const offer = await pc.createOffer();
            if (!this._voice || this._voice.peers.get(uid) !== pc || this._oppOnline === false) return false;
            await pc.setLocalDescription(offer);
            return this._voiceSendSignal(uid, { type: "offer", sdp: offer.sdp, callId: callId }) !== false;
          } catch (e) {
            return false;
          } finally {
            try { this._voice && this._voice.connectInFlight && this._voice.connectInFlight.delete(uid); } catch (_) {}
          }
        },

    _voiceDropPeer: function (uid, opts) {
          opts = opts || {};
          try {
            if (!this._voice) return;
            try {
              this._voiceClearReconnect(uid, { reset: !opts.preserveReconnectState });
            } catch (e) {}
            try {
              const batch = this._voiceIceBatches && this._voiceIceBatches.get(String(uid));
              if (batch && batch.timer) clearTimeout(batch.timer);
              if (this._voiceIceBatches) this._voiceIceBatches.delete(String(uid));
            } catch (e) {}
            try { this._voice.connectInFlight && this._voice.connectInFlight.delete(String(uid)); } catch (e) {}
            const pc = this._voice.peers && this._voice.peers.get(uid);
            if (pc) {
              try {
                pc.close();
              } catch (e) {}
            }
            try {
              this._voice.peers && this._voice.peers.delete(uid);
            } catch (e) {}
            const el = this._voice.remoteAudioEls && this._voice.remoteAudioEls.get(uid);
            if (el) {
              try {
                el.remove();
              } catch (e) {}
            }
            try {
              this._voice.remoteAudioEls && this._voice.remoteAudioEls.delete(uid);
            } catch (e) {}
            if (!opts.preserveCallId) {
              try {
                this._voice.callIds && this._voice.callIds.delete(uid);
              } catch (e) {}
            }
            try {
              if (this._voicePendingRemoteIce && this._voicePendingRemoteIce.forEach) {
                const prefix = String(uid || "") + "::";
                Array.from(this._voicePendingRemoteIce.keys()).forEach((key) => {
                  if (String(key).indexOf(prefix) === 0) this._voicePendingRemoteIce.delete(key);
                });
              }
            } catch (e) {}
          } catch (e) {}
        },

    _voiceHandleSignal: async function (fromUid, msg) {
          if (!msg || !fromUid || !this._voice || !this._voice.enabled || this.isSpectator) return;
    
          try {
            if (!msg.sdp && msg.sdpParts && Array.isArray(msg.sdpParts)) {
              msg.sdp = msg.sdpParts.join("");
            }
          } catch (e) {}
    
          try {
            const incomingCallId = msg.callId ? String(msg.callId) : "";
            const knownCallId = this._voice.callIds && this._voice.callIds.get(fromUid);
    
            if (msg.type === "offer" && msg.sdp) {
              if (incomingCallId && knownCallId && knownCallId !== incomingCallId) {
                try {
                  this._voiceDropPeer(fromUid, { preserveCallId: true });
                } catch (e) {}
              }
              try {
                this._voice.callIds.set(fromUid, incomingCallId || knownCallId || this._voiceNewCallId(fromUid));
              } catch (e) {}
    
              const pc = this._voiceEnsurePeer(fromUid);
              const iOffer = String(this.myUid || "") < String(fromUid || "");
              if (iOffer && pc.signalingState !== "stable") return;
    
              await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
              await this._voiceFlushRemoteIce(fromUid, this._voice.callIds.get(fromUid), pc);
              const ans = await pc.createAnswer();
              await pc.setLocalDescription(ans);
              this._voiceSendSignal(fromUid, {
                type: "answer",
                sdp: ans.sdp,
                callId: this._voice.callIds.get(fromUid),
              });
              return;
            }
    
            if (incomingCallId && knownCallId && incomingCallId !== knownCallId) {
              return;
            }
    
            const pc = this._voiceEnsurePeer(fromUid);
    
            if (msg.type === "answer" && msg.sdp) {
              await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
              await this._voiceFlushRemoteIce(fromUid, knownCallId || incomingCallId, pc);
              return;
            }
    
            if (msg.type === "ice" && msg.candidate) {
              const callId = incomingCallId || knownCallId || "";
              if (!pc.remoteDescription) {
                this._voiceQueueRemoteIce(fromUid, callId, msg.candidate);
                return;
              }
              try { await pc.addIceCandidate(msg.candidate); } catch (e) {}
              return;
            }
          } catch (e) {}
        },

    _handlePresence: function (data) {
          if (!data) return;
          const oppUid = this._getOpponentInfoFromData(data).uid;
          if (!oppUid) return;
    
          const pres = data.presence ? data.presence[oppUid] : null;
          const now = nowTs();
          const tsRaw = pres && (pres.updatedAt || pres.joinedAt);
          const lastSeen = Number(tsRaw || 0) || 0;
          const online = !!(pres && isPresenceFresh(lastSeen, GAME_PRESENCE_ONLINE_TTL_MS));
    
          try {
            const previousOnline = this._oppOnline;
            this._oppOnline = online;
            this._oppLastSeenAt = lastSeen || this._oppLastSeenAt || 0;
            if (pres) this._oppName = displayPlayerName(this._getGameSlotUid(this.mySide === -1 ? "top" : "bot"), pres.nickname);
            try {
              if (online) {
                this._oppOfflineSince = null;
                this._oppLeftModalShown = false;
              } else {
                if (!this._oppOfflineSince) {
                  this._oppOfflineSince = lastSeen
                    ? Math.min(now, lastSeen + GAME_PRESENCE_ONLINE_TTL_MS)
                    : now;
                }
              }
            } catch (e) {}
            this._updatePresenceUi();
            try { this._voiceSyncOpponentAvailability(oppUid, online, previousOnline); } catch (e) {}
            try {
              this._checkMoveCommitHealth();
            } catch (e) {}
          } catch (e) {}
        },

    _onlineDisplayNameForSide: function (side, data) {
          try {
            const g = data || this._lastGameData || {};
            const players = g.players || {};
            const row = Number(side) === -1 ? players.white : Number(side) === 1 ? players.black : null;
            if (row) return displayPlayerName(row.uid, row.nickname);
          } catch (_) {}
          return window.I18N.translateArgs("players.player");
        },

    _souflaPressDisplayId: function (actorUid, baseMoveIndex, offenderIdx) {
          const raw = String(actorUid || "player");
          let hash = 2166136261;
          for (let i = 0; i < raw.length; i += 1) {
            hash ^= raw.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          const actorToken = String(1000 + ((hash >>> 0) % 9000));
          return ["soufla-press", String(this.gameId || ""), actorToken, Number(baseMoveIndex || 0), Number(offenderIdx == null ? -1 : offenderIdx)].join(":");
        },

    recordSouflaButtonPress: function (pending) {
          try {
            if (!this.isActive || this.isSpectator || !pending) return false;
            const offenders = Array.isArray(pending.offenders) ? pending.offenders : [];
            const offenderIdx = offenders.length ? Number(offenders[0]) : -1;
            const displayId = this._souflaPressDisplayId(this.myUid, this.moveIndex, offenderIdx);
            const list = Array.isArray(this._localDisplayLogEvents) ? this._localDisplayLogEvents : (this._localDisplayLogEvents = []);
            if (!list.some((ev) => ev && ev.displayId === displayId)) {
              list.push({
                kind: "soufla_pressed",
                actor: window.I18N.translateArgs("players.you") || "You",
                side: this.mySide,
                ts: nowTs(),
                displayId,
              });
              if (list.length > 12) list.splice(0, list.length - 12);
            }
            this._lastRenderedLogKey = "";
            this._renderSharedLog(this._lastGameData && this._lastGameData.log || []);
            return true;
          } catch (_) { return false; }
        },

    _renderSharedLog: function (logArr) {
          try {
            const arr = Array.isArray(logArr) ? logArr : [];
            const gameKey = String(this.gameId || "");
            if (this._displayLogGameId !== gameKey) {
              this._displayLogGameId = gameKey;
              this._localDisplayLogEvents = [];
              this._lastRenderedLogKey = "";
            }
            const localEvents = Array.isArray(this._localDisplayLogEvents) ? this._localDisplayLogEvents : [];
            const last = arr.length ? arr[arr.length - 1] : null;
            const localLast = localEvents.length ? localEvents[localEvents.length - 1] : null;
            const key = `${arr.length}:${last && (last.id || last.ts) ? (last.id || last.ts) : ""}:${localEvents.length}:${localLast && localLast.displayId || ""}`;
            if (key === this._lastRenderedLogKey) return;
            this._lastRenderedLogKey = key;

            const gameData = this._lastGameData || {};
            const playerNameFor = (uid, side) => {
              try {
                const want = String(uid || "");
                if (!this.isSpectator && want && this.myUid && want === String(this.myUid)) {
                  return window.I18N.translateArgs("players.you") || "You";
                }
                const players = gameData.players || {};
                const white = players.white || {};
                const black = players.black || {};
                if (want && want === String(white.uid || "")) return displayPlayerName(white.uid, white.nickname);
                if (want && want === String(black.uid || "")) return displayPlayerName(black.uid, black.nickname);
              } catch (_) {}
              return this._onlineDisplayNameForSide(side, gameData);
            };
            const convertOfficialEvent = (it) => {
              if (!it || typeof it !== "object") return [];
              const type = String(it.type || it.kind || "");
              const data = it.data && typeof it.data === "object" ? it.data : {};
              const ts = Number(it.ts || 0) || nowTs();
              const actor = playerNameFor(it.actor, it.side);

              if (type === "invite_sent" || type === "invite_accepted" || type === "invite_rejected") return [];
              if (type === "soufla.detected") return [];
              if (type === "game.created") {
                const baseId = String(it.id || type);
                return [
                  { kind: "game_started", ts, displayId: baseId + ":started" },
                  { kind: "opening_started", ts: ts + 1, displayId: baseId + ":opening" },
                ];
              }
              if (type === "turn.applied") {
                const move = data.move && typeof data.move === "object" ? data.move : {};
                const from = data.from != null ? data.from : move.from;
                const to = data.to != null ? data.to : move.to;
                if (from == null || to == null) return [];
                const baseId = String(it.id || "turn");
                const out = [];
                const promotions = Array.isArray(data.promotions) ? data.promotions : [];
                promotions.forEach((promotion, index) => {
                  const idx = promotion && promotion.idx != null ? Number(promotion.idx) : null;
                  const side = promotion && promotion.side != null ? Number(promotion.side) : it.side;
                  if (idx != null && Number.isFinite(idx)) {
                    out.push({ kind: "promote", actor: playerNameFor(it.actor, side), side, idx, ts: Math.max(0, ts - 1), displayId: baseId + ":promote:" + index });
                  }
                });
                out.push({ kind: "turn", actor, side: it.side, from, to, captures: Number(data.captures || 0) || 0, ts, displayId: baseId });
                if (Number(it.ply || 0) === 10) out.push({ kind: "opening_ended", ts: ts + 1, displayId: baseId + ":opening-ended" });
                return out;
              }
              if (type === "undo.applied") {
                const requesterUid = data.requesterUid || it.actor;
                return [{ kind: "undo", side: it.side, actor: playerNameFor(requesterUid, it.side), ts, displayId: it.id || "" }];
              }
              if (type === "soufla.resolved") {
                const decision = data.result && data.result.decision ? data.result.decision : {};
                const offenderIdx = data.offenderIdx != null ? Number(data.offenderIdx) : Number(decision.offenderIdx);
                const baseMoveIndex = Math.max(0, Number(it.moveIndex || 0) - 1);
                const pressed = {
                  kind: "soufla_pressed", actor, side: it.side, ts: Math.max(0, ts - 1),
                  displayId: this._souflaPressDisplayId(it.actor, baseMoveIndex, offenderIdx),
                };
                if (String(data.penalty || decision.kind || "") === "remove") {
                  return [pressed, { kind: "soufla_remove", actor, side: it.side, idx: offenderIdx, ts, displayId: it.id || "" }];
                }
                const path = Array.isArray(decision.path) ? decision.path : [];
                const to = path.length ? path[path.length - 1] : offenderIdx;
                const captures = Array.isArray(decision.jumps) ? decision.jumps.length : Number(decision.captures || 0) || 0;
                return [pressed, { kind: "soufla_force", actor, side: it.side, from: offenderIdx, to, captures, ts, displayId: it.id || "" }];
              }
              if (type === "turn" || type === "move") {
                const from = it.from != null ? it.from : it.f;
                const to = it.to != null ? it.to : it.t;
                const side = it.side != null ? it.side : (it.by != null ? it.by : it.s);
                if (from != null && to != null) return [{ kind: "turn", actor: playerNameFor(it.actor, side), side, from, to, captures: Number(it.captures != null ? it.captures : it.c || 0) || 0, ts, displayId: it.id || "" }];
              }
              if (type === "undo") return [{ kind: "undo", side: it.side != null ? it.side : it.by, actor, ts, displayId: it.id || "" }];
              if (type === "soufla_remove" && it.idx != null) return [{ kind: "soufla_remove", actor, side: it.side != null ? it.side : it.by, idx: it.idx, ts, displayId: it.id || "" }];
              if (type === "soufla_force") return [{ kind: "soufla_force", actor, side: it.side != null ? it.side : it.by, from: it.from, to: Array.isArray(it.path) && it.path.length ? it.path[it.path.length - 1] : it.to, captures: Number(it.captures || 0) || 0, ts, displayId: it.id || "" }];
              if (type === "actor_i18n" && it.key === "log.soufla.pressed") return [{ kind: "soufla_pressed", actor, side: it.side, ts, displayId: it.id || "" }];
              if (type === "actor_i18n" && it.key) return [{ kind: "actor_i18n", actor, key: it.key, vars: it.vars || {}, ts, displayId: it.id || "" }];
              if (type === "i18n" && it.key) return [{ kind: "i18n", key: it.key, vars: it.vars || {}, ts, displayId: it.id || "" }];

              // Legacy display records are decoded, but opaque identifiers and
              // unknown structured objects are never exposed to the player.
              if (typeof it.text === "string") {
                const dec = decodeSharedLogText(it.text);
                if (dec) {
                  dec.ts = ts;
                  dec.displayId = it.id || "";
                  if (dec.kind === "actor_i18n") dec.actor = playerNameFor(it.actor, it.side);
                  if (dec.kind === "turn") dec.actor = playerNameFor(it.actor, dec.side);
                  return [dec];
                }
              }
              return [];
            };

            const officialEvents = arr.slice(-80).flatMap(convertOfficialEvent);
            const merged = officialEvents.concat(localEvents);
            const byId = new Map();
            const withoutId = [];
            for (const ev of merged) {
              if (!ev) continue;
              const id = String(ev.displayId || "");
              if (id) byId.set(id, ev);
              else withoutId.push(ev);
            }
            const evs = withoutId.concat(Array.from(byId.values())).sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0)).slice(-100);

            if (window.LogMgr && typeof window.LogMgr.setEvents === "function") {
              window.LogMgr.setEvents(evs);
              return;
            }

            const logEl = document.getElementById("log");
            if (!logEl) return;
            logEl.innerHTML = "";
            evs.slice().reverse().forEach((ev) => {
              const row = document.createElement("div");
              row.className = "log-item";
              const timeEl = document.createElement("span");
              timeEl.className = "time";
              timeEl.textContent = ev.ts ? new Date(ev.ts).toLocaleTimeString("en-GB", { hour12: false }) : "";
              const msgEl = document.createElement("span");
              msgEl.className = "msg";
              if (ev.kind === "actor_i18n") {
                const actorEl = document.createElement("span");
                actorEl.className = "actor-word";
                actorEl.textContent = String(ev.actor || "");
                msgEl.appendChild(actorEl);
                msgEl.appendChild(document.createTextNode(`: ${window.I18N.translateArgs(ev.key, ev.vars || {})}`));
              } else if (ev.kind === "i18n") {
                msgEl.textContent = window.I18N.translateArgs(ev.key, ev.vars || {});
              } else {
                msgEl.textContent = "";
              }
              if (!msgEl.textContent) return;
              row.appendChild(timeEl);
              row.appendChild(document.createTextNode(" "));
              row.appendChild(msgEl);
              logEl.appendChild(row);
            });
          } catch (e) {}
        },

    _showSouflaModalFromLastMove: function (lastMove) {
          try {
            if (!window.DhametSouflaView || typeof DhametSouflaView.showAppliedSummary !== "function") {
              throw new Error("shared-soufla-summary-missing");
            }
            return DhametSouflaView.showAppliedSummary(lastMove, {
              mySide: this.mySide,
              t: (key, vars) => window.I18N.translateArgs(key, vars && typeof vars === "object" ? vars : {}),
              rcStr: typeof rcStr === "function" ? rcStr : undefined,
              Modal: typeof Modal !== "undefined" ? Modal : null,
            });
          } catch (e) {
            try { Logger.warn("shared_soufla_summary_failed", { err: String(e && (e.message || e)) }); } catch (_) {}
            return false;
          }
        },

    discardLastLocalStepAfterUndo: function () {
          try {
            if (Array.isArray(this._pendingSteps) && this._pendingSteps.length) {
              this._pendingSteps.pop();
            }
          } catch (e) {}
          try {
            this._cachedSouflaPlain = null;
          } catch (e) {}
          try {
            if (!this._pendingSteps || !this._pendingSteps.length) {
              this._pendingSteps = [];
              this._markLocalCommitSettled();
            }
          } catch (e) {}
          try { this._scheduleCaptureDraftSave(); } catch (e) {}
        },

    recordLocalStep: function (fromIdx, toIdx, isCapture, jumpedIdx) {
          if (!this.isActive || this._isApplyingRemote) return;
          if (this._gameLiveActionsBlocked && this._gameLiveActionsBlocked()) {
            this._notifyGameLiveRecovery && this._notifyGameLiveRecovery();
            return false;
          }
          if (!this._pendingSteps) this._pendingSteps = [];
          this._pendingSteps.push({
            from: fromIdx,
            to: toIdx,
            capture: !!isCapture,
            jumped: jumpedIdx != null ? jumpedIdx : null,
          });
          try { this._bindCaptureDraftLifecycle(); } catch (e) {}
          try { this._scheduleCaptureDraftSave(); } catch (e) {}
        },

    clearPendingLocalMove: function () {
          this._pendingSteps = [];
          this._cachedSouflaPlain = null;
          try { this._clearCaptureDraft(); } catch (e) {}
          try { this._clearPendingMoveOutbox(); } catch (e) {}
          try {
            this._markLocalCommitSettled();
          } catch (e) {}
        },

    _pendingMoveOutboxKey: function () {
          const gid = String(this.gameId || "").trim();
          return gid ? "zamat.pendingMove." + gid : "";
        },

    _savePendingMoveOutbox: function (entry) {
          try {
            const key = this._pendingMoveOutboxKey && this._pendingMoveOutboxKey();
            if (!key || !entry) return;
            sessionStorage.setItem(key, JSON.stringify(entry));
            this._pendingMoveOutbox = entry;
          } catch (e) {
            this._pendingMoveOutbox = entry || null;
          }
        },

    _readPendingMoveOutbox: function () {
          try {
            if (this._pendingMoveOutbox) return this._pendingMoveOutbox;
            const key = this._pendingMoveOutboxKey && this._pendingMoveOutboxKey();
            if (!key) return null;
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.gameId !== this.gameId || !parsed.clientMoveId || !parsed.payload) return null;
            this._pendingMoveOutbox = parsed;
            return parsed;
          } catch (e) { return this._pendingMoveOutbox || null; }
        },

    _clearPendingMoveOutbox: function () {
          try {
            const key = this._pendingMoveOutboxKey && this._pendingMoveOutboxKey();
            if (key) sessionStorage.removeItem(key);
          } catch (e) {}
          this._pendingMoveOutbox = null;
        },

    _officialGameHasClientMove: function (game, clientMoveId) {
          try {
            const id = String(clientMoveId || "");
            if (!game || !id) return false;
            const ledger = game.appliedClientActions && typeof game.appliedClientActions === "object"
              ? game.appliedClientActions
              : null;
            if (ledger && ledger["move:" + id]) return true;
            const lastMove = game.lastMove || null;
            return !!(lastMove && String(lastMove.clientMoveId || "") === id);
          } catch (e) { return false; }
        },

    _reconcileLocalCommitAgainstOfficialGame: function (game, opts) {
          try {
            if (!this._awaitingLocalCommit || !game) return "none";
            const cfg = opts && typeof opts === "object" ? opts : {};
            const outbox = this._readPendingMoveOutbox && this._readPendingMoveOutbox();
            const clientMoveId = String(
              (outbox && outbox.clientMoveId) || this._moveCommitClientId || ""
            );
            if (clientMoveId && this._officialGameHasClientMove(game, clientMoveId)) {
              try { this._markLocalCommitSettled(); } catch (e) {}
              return "applied";
            }
            const base = Number(
              (outbox && outbox.baseMoveIndex) != null
                ? outbox.baseMoveIndex
                : this._moveCommitBaseIndex
            );
            const remoteIndex = Number(game.moveIndex || 0) || 0;
            if (Number.isFinite(base) && remoteIndex !== base) {
              this._pendingSteps = [];
              this._cachedSouflaPlain = null;
              try { this._markLocalCommitSettled(); } catch (e) {}
              if (cfg.notifyConflict !== false) {
                try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
              }
              return "superseded";
            }
            return "pending";
          } catch (e) { return "none"; }
        },

    _commitMoveRequest: function (payload, expectedGameId, clientMoveId) {
          const client = window.DhametGameRoomClient;
          if (!client || typeof client.commitMove !== "function") {
            const missing = new Error("gameroom-transport-missing");
            missing.code = "gameroom-transport-missing";
            missing.status = 0;
            return Promise.reject(missing);
          }
          const gameId = String(expectedGameId || "");
          const moveId = String(clientMoveId || "");
          const key = gameId + ":" + moveId;
          const existing = this._moveCommitInFlight;
          if (existing && existing.key === key && existing.promise) return existing.promise;
          if (existing && existing.promise) {
            const busy = new Error("move-commit-already-in-flight");
            busy.code = "move-commit-already-in-flight";
            busy.status = 0;
            return Promise.reject(busy);
          }
          const flight = { key, gameId, clientMoveId: moveId, promise: null };
          const promise = Promise.resolve(client.commitMove(payload)).finally(() => {
            if (this._moveCommitInFlight === flight) this._moveCommitInFlight = null;
          });
          flight.promise = promise;
          this._moveCommitInFlight = flight;
          return promise;
        },

    _reconcilePendingMoveOutbox: function (game) {
          try {
            const outbox = this._readPendingMoveOutbox && this._readPendingMoveOutbox();
            if (!outbox || !game) return;
            const clientMoveId = String(outbox.clientMoveId || "");
            const appliedById = this._officialGameHasClientMove(game, clientMoveId);
            const remoteIndex = Number(game.moveIndex || 0) || 0;
            const base = Number(outbox.baseMoveIndex || 0) || 0;
            if (appliedById) {
              this._clearPendingMoveOutbox();
              try { this._markLocalCommitSettled(); } catch (e) {}
              return;
            }
            if (remoteIndex !== base) {
              this._clearPendingMoveOutbox();
              this._pendingSteps = [];
              this._cachedSouflaPlain = null;
              try { this._markLocalCommitSettled(); } catch (e) {}
              try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
              return;
            }
            const activeFlight = this._moveCommitInFlight;
            const flightKey = String(this.gameId || "") + ":" + clientMoveId;
            if (activeFlight && activeFlight.key === flightKey) return;
            if (outbox.replayedAfterResync) return;
            outbox.replayedAfterResync = true;
            outbox.replayedAt = nowTs();
            this._savePendingMoveOutbox(outbox);
            const asyncContext = this._captureAsyncContext(this.gameId);
            this._commitMoveRequest(outbox.payload, this.gameId, clientMoveId)
              .then((res) => {
                if (!this._isAsyncContextCurrent(asyncContext)) return;
                const g = res && res.game ? res.game : null;
                if (res && res.committed !== false) {
                  try { if (g) this._lastGameData = g; } catch (e) {}
                  this._clearPendingMoveOutbox();
                  try { this._markLocalCommitSettled(); } catch (e) {}
                  return;
                }
                try {
                  this._moveRetryGaveUp = true;
                  if (g) this._ingestOfficialGame(g, {
                    source: "outbox-replay-not-committed",
                    gameId: this.gameId,
                    rejectDuplicate: false,
                    allowPendingRollback: true,
                  });
                } catch (e) {}
                this._pendingSteps = [];
                try { this._markLocalCommitSettled(); } catch (e) {}
              })
              .catch((err) => {
                if (!this._isAsyncContextCurrent(asyncContext)) return;
                if (isNonRetriableGameCommitError(err)) {
                  try {
                    const official = err && err.data && err.data.game ? err.data.game : game;
                    this._moveRetryGaveUp = true;
                    this._ingestOfficialGame(official, {
                      source: "outbox-replay-rejected",
                      gameId: this.gameId,
                      rejectDuplicate: false,
                      allowPendingRollback: true,
                    });
                  } catch (e) {}
                  this._pendingSteps = [];
                  try { this._markLocalCommitSettled(); } catch (e) {}
                  return;
                }
                if (isRetriableGameCommitError(err)) {
                  try {
                    const current = this._readPendingMoveOutbox && this._readPendingMoveOutbox();
                    if (current && String(current.clientMoveId || "") === clientMoveId) {
                      current.replayedAfterResync = false;
                      current.lastReplayFailedAt = nowTs();
                      this._savePendingMoveOutbox(current);
                    }
                  } catch (e) {}
                }
              });
          } catch (e) {}
        },

    _clearMoveRetry: function () {
          try {
            if (this._moveRetryTimer) clearTimeout(this._moveRetryTimer);
          } catch (e) {}
          this._moveRetryTimer = null;
          this._moveRetryAttempt = 0;
          this._moveRetryArgs = null;
          this._moveRetryNotified = false;
          this._moveRetryWarned = false;
          this._moveRetryGaveUp = false;
          this._moveRetryDidResync = false;
        },

    _forceResync: function (reason) {
          const asyncContext = this._captureAsyncContext(this.gameId);
          if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return Promise.resolve(false);
          return this._requestOfficialSync({
            reason: reason || "automatic",
            repairPresence: false,
            notifyFailure: false,
          });
        },

    _scheduleMoveRetry: function (from, to, nextTurn) {
          if (!this.isActive || !this.gameRef || !this.gameId) return;
          const expectedGameId = String(this.gameId || "");
          const epochToken = window.DhametMatchCoordinator ? DhametMatchCoordinator.token() : null;

          this._moveRetryArgs = { from: from, to: to, nextTurn: nextTurn };
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            this._moveRetryPausedOffline = true;
            return;
          }
          try { if (this._moveRetryTimer) clearTimeout(this._moveRetryTimer); } catch (e) {}

          const MAX_MOVE_SEND_RETRIES = 3;
          if (this._moveRetryGaveUp) return;
          const attempt = (this._moveRetryAttempt || 0) + 1;
          this._moveRetryAttempt = attempt;
          if (attempt > MAX_MOVE_SEND_RETRIES) {
            this._moveRetryGaveUp = true;
            try {
              this._requestOfficialSync({
                reason: "move-retry-exhausted",
                discardCaptureDraft: true,
                repairPresence: false,
                notifyFailure: true,
              });
            } catch (e) {}
            return;
          }
          const delay = Math.min(15000, 250 * Math.pow(2, Math.min(6, attempt - 1)));

          this._moveRetryTimer = setTimeout(() => {
            try { this._moveRetryTimer = null; } catch (e) {}
            if (epochToken && !DhametMatchCoordinator.isCurrent(epochToken)) return;
            if (!this.isActive || String(this.gameId || "") !== expectedGameId) return;
            if (!this._awaitingLocalCommit || this._moveRetryGaveUp) return;
            try { this.sendMoveToCloudflare(from, to, nextTurn, attempt); } catch (e) {}
          }, delay);
        },

    cacheSouflaPending: function (pending) {
          this._cachedSouflaPlain = pending ? souflaToPlain(pending) : null;
        },

    sendMoveToCloudflare: function (_from, _to, nextTurn, _attempt) {
          if (this._gameLiveActionsBlocked && this._gameLiveActionsBlocked()) {
            this._notifyGameLiveRecovery && this._notifyGameLiveRecovery();
            return Promise.resolve(false);
          }
          if (!allowOnlineWrite()) return;
          if (!this.isActive || !this.gameRef || !this.gameId) return;
          if (!requireAuthUid(this.myUid)) {
            try { this.syncNow({ reason: "auth-recovery", repairPresence: false, notifyFailure: false }); } catch (e) {}
            try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
            return;
          }

          const attempt = Number.isFinite(_attempt) ? _attempt : 0;
          const expectedGameId = String(this.gameId || "");
          const activeFlight = this._moveCommitInFlight;
          if (
            activeFlight &&
            activeFlight.gameId === expectedGameId &&
            this._moveCommitClientId &&
            activeFlight.clientMoveId === String(this._moveCommitClientId)
          ) return activeFlight.promise;
          const epochToken = window.DhametMatchCoordinator ? DhametMatchCoordinator.token() : null;
          const taskIsCurrent = function () {
            return !!(
              self.isActive &&
              String(self.gameId || "") === expectedGameId &&
              (!epochToken || DhametMatchCoordinator.isCurrent(epochToken))
            );
          };

          let steps = Array.isArray(this._pendingSteps) ? this._pendingSteps.slice() : [];
          if (window.DhametMove && typeof window.DhametMove.normalizeSteps === "function") {
            steps = window.DhametMove.normalizeSteps(steps, _from, _to);
          } else if (!steps.length) {
            const fr = Number.isFinite(_from) ? _from : null;
            const to = Number.isFinite(_to) ? _to : null;
            if (fr == null || to == null) return;
            steps = [{ from: fr, to: to, capture: false, jumped: null }];
          }
          if (!steps.length) return;

          if (!this._moveCommitClientId) {
            this._moveCommitClientId =
              window.DhametGameRoomClient && typeof window.DhametGameRoomClient.createClientMoveId === "function"
                ? window.DhametGameRoomClient.createClientMoveId(this.myUid || "anon", expectedGameId, nowTs())
                : [this.myUid || "anon", expectedGameId, nowTs(), Math.random().toString(36).slice(2, 10)].join(":");
            this._moveCommitBaseIndex = Number(this.moveIndex || 0) || 0;
          }

          const move =
            window.DhametMove && typeof window.DhametMove.normalizeMove === "function"
              ? window.DhametMove.normalizeMove({
                  steps: steps,
                  by: -nextTurn,
                  ts: nowTs(),
                  clientMoveId: this._moveCommitClientId,
                })
              : {
                  kind: "move",
                  by: -nextTurn,
                  from: steps[0].from,
                  to: steps[steps.length - 1].to,
                  path: steps.map((s) => s.to),
                  jumps: steps.filter((s) => s.jumped != null).map((s) => s.jumped),
                  ts: nowTs(),
                };
          if (!move) return;

          const logEntry =
            window.DhametEvents && typeof window.DhametEvents.createTurnAppliedEvent === "function"
              ? window.DhametEvents.createTurnAppliedEvent({
                  move: move,
                  side: move.by,
                  actor: this.myUid || null,
                  moveIndex: (Number(this.moveIndex || 0) || 0) + 1,
                  ply: (Number((this.currentGame && this.currentGame.ply) || 0) || 0) + 1,
                  captures: move.jumps && move.jumps.length ? move.jumps.length : 0,
                  text: encodeSharedLogText({
                    kind: "turn",
                    side: move.by,
                    from: move.from,
                    to: move.to,
                    captures: move.jumps && move.jumps.length ? move.jumps.length : 0,
                  }),
                })
              : {
                  ts: nowTs(),
                  type: "turn",
                  text: encodeSharedLogText({
                    kind: "turn",
                    side: move.by,
                    from: move.from,
                    to: move.to,
                    captures: move.jumps && move.jumps.length ? move.jumps.length : 0,
                  }),
                };

          const payload =
            window.DhametGameRoomClient && typeof window.DhametGameRoomClient.createCommitPayload === "function"
              ? window.DhametGameRoomClient.createCommitPayload({
                  gameId: expectedGameId,
                  clientMoveId: this._moveCommitClientId,
                  baseMoveIndex: this._moveCommitBaseIndex,
                  steps: steps,
                  by: move.by,
                  ts: move.ts,
                  nextTurn: nextTurn,
                  logEntry: logEntry,
                })
              : {
                  gameId: expectedGameId,
                  clientMoveId: this._moveCommitClientId,
                  baseMoveIndex: this._moveCommitBaseIndex,
                  move: Object.assign({}, move, { clientMoveId: this._moveCommitClientId }),
                  nextTurn: nextTurn,
                  logEntry: logEntry,
                };
          if (!payload) return;

          try { if (!this._awaitingLocalCommit) this._beginLocalCommitWait(); } catch (e) {}
          this._pendingSteps = [];
          this._cachedSouflaPlain = null;
          try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (e) {}
          try {
            self._savePendingMoveOutbox && self._savePendingMoveOutbox({
              gameId: expectedGameId,
              clientMoveId: self._moveCommitClientId,
              baseMoveIndex: self._moveCommitBaseIndex,
              expectedMoveIndex: (Number(self._moveCommitBaseIndex || 0) || 0) + 1,
              steps: steps,
              by: move.by,
              createdAt: nowTs(),
              attempts: attempt,
              payload: payload,
            });
          } catch (e) {}

          const retryOrFail = function (err, serverGame, response) {
            if (!taskIsCurrent()) return;
            const clientMoveId = String(self._moveCommitClientId || (payload && payload.clientMoveId) || "");
            const remoteMi = Number((serverGame && serverGame.moveIndex) || 0) || 0;
            const appliedById = !!(serverGame && self._officialGameHasClientMove(serverGame, clientMoveId));
            if (appliedById) {
              try {
                self._ingestOfficialGame(serverGame, {
                  source: "move-already-applied",
                  gameId: expectedGameId,
                  version: serverGame.__transportVersion,
                  rejectDuplicate: false,
                });
              } catch (e) {}
              try { self._markLocalCommitSettled(); } catch (e) {}
              return;
            }

            const logicalRejection = !!(
              (response && response.committed === false) ||
              (err && (isPermissionDenied(err) || isNonRetriableGameCommitError(err)))
            );
            if (logicalRejection) {
              self._moveRetryGaveUp = true;
              try {
                const details = err ? gameCommitErrorDetails(err) : {
                  status: 200,
                  code: "move-not-committed",
                  error: "",
                  reason: String((response && response.reason) || "not-committed"),
                };
                Logger.warn("official_move_rejected", {
                  gameId: expectedGameId,
                  clientMoveId,
                  baseMoveIndex: Number(self._moveCommitBaseIndex || 0) || 0,
                  officialMoveIndex: remoteMi,
                  status: details.status,
                  code: details.code,
                  error: details.error,
                  reason: details.reason,
                });
              } catch (e) {}
              try {
                if (serverGame) self._ingestOfficialGame(serverGame, {
                  source: "move-commit-rejected",
                  gameId: expectedGameId,
                  version: serverGame.__transportVersion,
                  rejectDuplicate: false,
                  allowPendingRollback: true,
                  suppressMoveConflictNotice: true,
                });
              } catch (e) {}
              self._pendingSteps = [];
              self._cachedSouflaPlain = null;
              try { self._markLocalCommitSettled(); } catch (e) {}
              try { if (err) handleDbError(err, null, { ctx: "move.gameRoom" }); } catch (e) {}
              try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
              if (!serverGame) {
                try { self._forceResync("move-rejected-without-state"); } catch (e) {}
              }
              return;
            }

            const retryable = !!(err && isRetriableGameCommitError(err));
            if (!retryable) {
              self._moveRetryGaveUp = true;
              try { if (err) handleDbError(err, null, { ctx: "move.gameRoom" }); } catch (e) {}
              try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
              try { self._forceResync("move-send-unknown-failure"); } catch (e) {}
              return;
            }

            self._pendingSteps = steps.concat(self._pendingSteps || []);
            const MAX_MOVE_SEND_RETRIES = 3;
            if (attempt >= MAX_MOVE_SEND_RETRIES) {
              self._moveRetryGaveUp = true;
              try {
                const outbox = self._readPendingMoveOutbox && self._readPendingMoveOutbox();
                if (outbox) {
                  outbox.retryGaveUpAt = nowTs();
                  outbox.attempts = attempt;
                  self._savePendingMoveOutbox(outbox);
                }
              } catch (e) {}
              try { if (err) handleDbError(err, null, { ctx: "move.gameRoom" }); } catch (e) {}
              try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
              try { self._forceResync("move-send-gave-up"); } catch (e) {}
              return;
            }
            try {
              if (!self._moveRetryNotified) {
                self._moveRetryNotified = true;
                showOnlineNotice(window.I18N.translateArgs("status.moveSendFail"));
              }
            } catch (e) {}
            try { self._scheduleMoveRetry(_from, _to, nextTurn); } catch (e) {}
          };

          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitMove !== "function") {
            const missing = new Error("gameroom-transport-missing");
            missing.code = "gameroom-transport-missing";
            missing.status = 0;
            retryOrFail(missing, null, null);
            return Promise.resolve(false);
          }

          return this._commitMoveRequest(payload, expectedGameId, this._moveCommitClientId)
            .then(function (res) {
              if (!taskIsCurrent()) return;
              const g = res && res.game ? res.game : null;
              if (!res || res.committed === false) {
                retryOrFail(null, g, res);
                return;
              }
              try {
                if (g) self._ingestOfficialGame(g, {
                  source: "move-commit",
                  gameId: expectedGameId,
                  version: res.version,
                  rejectDuplicate: false,
                });
              } catch (e) {}
              try { if (res.moveIndex) self.moveIndex = Number(res.moveIndex) || self.moveIndex || 0; } catch (e) {}
              try { self._clearPendingMoveOutbox && self._clearPendingMoveOutbox(); } catch (e) {}
              try { self._markLocalCommitSettled(); } catch (e) {}
              try { self._touchRoomListActivity(true); } catch (e) {}
            })
            .catch(function (err) {
              retryOrFail(err, err && err.data && err.data.game ? err.data.game : null, null);
            });
        },

    sendSouflaDecisionToCloudflare: function (decision, pending) {
          if (this._gameLiveActionsBlocked && this._gameLiveActionsBlocked()) {
            this._notifyGameLiveRecovery && this._notifyGameLiveRecovery();
            return Promise.resolve(false);
          }
          if (!allowOnlineWrite()) return;
          if (!this.isActive || !this.gameId || !decision || !pending || this.isSpectator) return;
          const expectedGameId = String(this.gameId || "");
          const epochToken = window.DhametMatchCoordinator ? DhametMatchCoordinator.token() : null;
          const taskIsCurrent = () => !!(
            this.isActive &&
            String(this.gameId || "") === expectedGameId &&
            (!epochToken || DhametMatchCoordinator.isCurrent(epochToken))
          );

          const payload =
            window.DhametGameRoomClient && typeof window.DhametGameRoomClient.createSouflaDecisionPayload === "function"
              ? window.DhametGameRoomClient.createSouflaDecisionPayload({
                  gameId: expectedGameId,
                  clientDecisionId: "sf:" + (this.myUid || "anon") + ":" + expectedGameId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 10),
                  baseMoveIndex: Number(this.moveIndex || 0) || 0,
                  by: pending.penalizer,
                  decision: decision,
                })
              : {
                  gameId: expectedGameId,
                  clientDecisionId: "sf:" + (this.myUid || "anon") + ":" + expectedGameId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 10),
                  baseMoveIndex: Number(this.moveIndex || 0) || 0,
                  by: pending.penalizer,
                  decision: decision,
                };
          this._cachedSouflaPlain = null;

          const fail = (err, serverGame) => {
            if (!taskIsCurrent()) return;
            try {
              if (serverGame) this._ingestOfficialGame(serverGame, {
                source: "soufla-commit-rejected",
                gameId: expectedGameId,
                version: serverGame.__transportVersion,
                rejectDuplicate: false,
              });
            } catch (e) {}
            try { handleDbError(err || new Error("soufla-not-committed"), window.I18N.translateArgs("soufla.sendFailed"), { ctx: "soufla.send" }); } catch (e) {}
            try { this._forceResync("soufla-commit-failed"); } catch (e) {}
          };

          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitSouflaDecision !== "function") {
            fail(new Error("gameroom-soufla-transport-missing"), null);
            return;
          }

          window.DhametGameRoomClient.commitSouflaDecision(payload)
            .then((res) => {
              if (!taskIsCurrent()) return;
              const g = res && res.game ? res.game : null;
              if (!res || res.committed === false) {
                fail(null, g);
                return;
              }
              try {
                if (g) this._ingestOfficialGame(g, {
                  source: "soufla-commit",
                  gameId: expectedGameId,
                  version: res.version,
                  rejectDuplicate: false,
                });
              } catch (e) {}
              try { if (res.moveIndex) this.moveIndex = Number(res.moveIndex) || this.moveIndex || 0; } catch (e) {}
              try { if (res.ply) this.ply = Number(res.ply) || this.ply || 0; } catch (e) {}
              try { this._touchRoomListActivity(true); } catch (e) {}
            })
            .catch((err) => fail(err, err && err.data && err.data.game ? err.data.game : null));
        },

    _undoWaitKeyOf: function (ur) {
          try {
            if (!ur) return null;
            const a = ur.requesterUid != null ? String(ur.requesterUid) : "";
            let b = ur.requestedAt;
            if (b != null && typeof b === "object") {
              try {
                b = JSON.stringify(b);
              } catch (e) {
                b = String(b);
              }
            }
            b = b != null ? String(b) : "";
            const c = ur.ply != null ? String(ur.ply) : "";
            if (!a && !b && !c) return null;
            return `${a}|${b}|${c}`;
          } catch (e) {
            return null;
          }
        },

    _openUndoWaitModal: function (ur) {
          try {
            if (!ur) return;
            if (ur.status !== "pending" && ur.status !== "active") return;
            if (!ur.requesterUid || ur.requesterUid !== this.myUid) return;
    
            const key = this._undoWaitKeyOf(ur);
            if (!key) return;
    
            if (this._undoWaitOpen) return;
            if (this._undoWaitDismissedKey && this._undoWaitDismissedKey === key) return;
    
            this._undoWaitOpen = true;
            this._undoWaitKey = key;
    
            showOnlineNotice(window.I18N.translateArgs("undo.wait.body"), {
              title: window.I18N.translateArgs("modals.undo.title"),
              onClose: (reason) => {
                const k = this._undoWaitKey;
                this._undoWaitOpen = false;
                this._undoWaitKey = null;
    
                if (this._undoWaitAutoClose) {
                  this._undoWaitAutoClose = false;
                } else if (k && reason !== "replaced" && reason !== "state-change") {
                  this._undoWaitDismissedKey = k;
                }
    
                try {
                  Modal.clearBackdropTag();
                } catch (e) {}
              },
            });
    
            try {
              Modal.setBackdropTag("undo-wait");
            } catch (e) {}
          } catch (e) {}
        },

    _closeUndoWaitModal: function () {
          try {
            if (!this._undoWaitOpen) {
              this._undoWaitKey = null;
              return;
            }
    
            if (Modal.isOpen() && Modal.getBackdropTag() === "undo-wait") {
              this._undoWaitAutoClose = true;
              Modal.close();
              return;
            }
    
            this._undoWaitOpen = false;
            this._undoWaitKey = null;
            this._undoWaitAutoClose = false;
          } catch (e) {
            this._undoWaitOpen = false;
            this._undoWaitKey = null;
            this._undoWaitAutoClose = false;
          }
        },

    requestUndo: function () {
          if (this._gameLiveActionsBlocked && this._gameLiveActionsBlocked()) {
            this._notifyGameLiveRecovery && this._notifyGameLiveRecovery();
            return;
          }
          if (!this.isActive || !this.gameId) return;
          if (this.isSpectator) return;

          if (!allowOnlineWrite()) return;

          let undoCheck = null;
          try {
            undoCheck = window.DhametControl && typeof DhametControl.canRequestUndo === "function"
              ? DhametControl.canRequestUndo(this._lastGameData, this.mySide)
              : null;
          } catch (_) { undoCheck = null; }
          if (!undoCheck || !undoCheck.ok) {
            const error = undoCheck && undoCheck.error;
            const ownMoveError = error === "control/not-last-mover";
            const openingError = error === "control/opening-undo-disabled";
            showOnlineNotice(
              window.I18N.translateArgs(
                openingError ? "modals.undo.notAllowedBody" : ownMoveError ? "ui.undoOwnLastOnly" : "ui.noUndo"
              ),
              { title: window.I18N.translateArgs(openingError ? "modals.undo.notAllowedTitle" : "modals.undo.title") },
            );
            return;
          }

          const asyncContext = this._captureAsyncContext(this.gameId);
          const payload = {
            gameId: asyncContext.gameId,
            clientActionId: "undo:req:" + (this.myUid || "anon") + ":" + this.gameId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 10),
            baseMoveIndex: Number(this.moveIndex || 0) || 0,
            kind: "undo-request",
            by: this.mySide || null,
            nick: this.myNick || "",
          };

          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitControlAction !== "function") {
            handleDbError(new Error("gameroom-control-transport-missing"), window.I18N.translateArgs("undo.requestFailed"), { ctx: "undo.request" });
            return;
          }

          window.DhametGameRoomClient.commitControlAction(payload)
            .then((res) => {
              if (!this._isAsyncContextCurrent(asyncContext)) return;
              const g = res && res.game ? res.game : null;
              if (!res || res.committed === false) {
                try { if (g) this._lastGameData = g; } catch (e) {}
                try { this._forceResync(); } catch (e) {}
                showOnlineNotice(window.I18N.translateArgs("undo.requestFailed"), { title: window.I18N.translateArgs("modals.undo.title") });
                return;
              }
              try { if (g) this._lastGameData = g; } catch (e) {}
              try { if (res.moveIndex != null) this.moveIndex = Number(res.moveIndex) || this.moveIndex || 0; } catch (e) {}
              try { if (res.ply != null) this.ply = Number(res.ply) || this.ply || 0; } catch (e) {}
              try { this._touchRoomListActivity(true); } catch (e) {}
              try { if (g && g.undoRequest) this._openUndoWaitModal(g.undoRequest); } catch (e) {}
            })
            .catch((e) => {
              if (!this._isAsyncContextCurrent(asyncContext)) return;
              handleDbError(e, window.I18N.translateArgs("undo.requestFailed"), { ctx: "undo.request" });
              try { this._forceResync(); } catch (_) {}
            });
        },

    _handleUndoRequest: function (data) {
          const ur = data && data.undoRequest ? data.undoRequest : null;
          if (!ur) {
            this._closeUndoWaitModal();
            return;
          }
    
          if ((ur.status === "pending" || ur.status === "active") && ur.requesterUid === this.myUid) {
            this._openUndoWaitModal(ur);
            return;
          }
    
          if (
            (ur.status === "pending" || ur.status === "active") &&
            ur.requesterUid &&
            ur.requesterUid !== this.myUid
          ) {
            const name = ur.requesterNick || window.I18N.translateArgs("online.opponent");
            Modal.twoAction({
              title: window.I18N.translateArgs("undo.request.title"),
              body: `<div>${formatTpl(window.I18N.translateArgs("undo.request.body"), { name: `<span class="z-player-name">${escapeHtml(name)}</span>` })}</div>`,
              firstLabel: window.I18N.translateArgs("actions.accept"),
              firstClassName: "ok",
              onFirst: () => {
                this._respondUndo(true);
              },
              secondLabel: window.I18N.translateArgs("actions.reject"),
              secondClassName: "ghost",
              onSecond: () => {
                this._respondUndo(false);
              },
            });
            return;
          }
    
          if (ur.status === "accepted") {
            if (ur.requesterUid === this.myUid) this._closeUndoWaitModal();
            try { this._forceResync(); } catch (e) {}
            return;
          }
    
          if (ur.status === "rejected" && ur.requesterUid === this.myUid) {
            this._closeUndoWaitModal();
            const key = this._undoWaitKeyOf(ur) || [ur.requesterUid || "", ur.respondedAt || ur.requestedAt || "", "rejected"].join("|");
            if (!this._lastUndoRejectedKey || this._lastUndoRejectedKey !== key) {
              this._lastUndoRejectedKey = key;
              showOnlineNotice(window.I18N.translateArgs("undo.rejected"), { title: window.I18N.translateArgs("undo.rejectedTitle") });
            }
          }
        },

    _respondUndo: function (accept) {
          if (this._gameLiveActionsBlocked && this._gameLiveActionsBlocked()) {
            this._notifyGameLiveRecovery && this._notifyGameLiveRecovery();
            return;
          }
          if (!allowOnlineWrite()) return;
          if (!this.isActive || !this.gameId) return;
          if (this.isSpectator) return;

          const asyncContext = this._captureAsyncContext(this.gameId);
          const payload = {
            gameId: asyncContext.gameId,
            clientActionId: "undo:resp:" + (this.myUid || "anon") + ":" + this.gameId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 10),
            baseMoveIndex: Number(this.moveIndex || 0) || 0,
            kind: "undo-respond",
            by: this.mySide || null,
            nick: this.myNick || "",
            accept: !!accept,
          };

          if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitControlAction !== "function") {
            handleDbError(new Error("gameroom-control-transport-missing"), window.I18N.translateArgs("undo.failed"), { ctx: "undo.respond" });
            return;
          }

          window.DhametGameRoomClient.commitControlAction(payload)
            .then((res) => {
              if (!this._isAsyncContextCurrent(asyncContext)) return;
              const g = res && res.game ? res.game : null;
              if (!res || res.committed === false) {
                try { if (g) this._lastGameData = g; } catch (e) {}
                try { this._forceResync(); } catch (e) {}
                showOnlineNotice(window.I18N.translateArgs("undo.notCommitted"));
                return;
              }
              try { if (g) this._lastGameData = g; } catch (e) {}
              try { if (res.moveIndex != null) this.moveIndex = Number(res.moveIndex) || this.moveIndex || 0; } catch (e) {}
              try { if (res.ply != null) this.ply = Number(res.ply) || this.ply || 0; } catch (e) {}
              try { this._touchRoomListActivity(true); } catch (e) {}
            })
            .catch((e) => {
              if (!this._isAsyncContextCurrent(asyncContext)) return;
              handleDbError(e, window.I18N.translateArgs("undo.failed"), { ctx: "undo.respond" });
              try { this._forceResync(); } catch (_) {}
            });
        },

    _goToGameAsSpectator: function (gameId) {
          try {
            const inPages = (location.pathname || "").includes("/pages/");
            const base = inPages ? "./game.html" : "pages/game.html";
            const url = `${base}?spectate=${encodeURIComponent(String(gameId || ""))}`;
            location.href = url;
          } catch (e) {}
        },

    initLobbyPage: async function (opts) {
          opts = opts || {};
          const roomsEl = document.getElementById(opts.roomsListId || "roomsList");
          try {
            if (window.ZLeaderboard && typeof window.ZLeaderboard.bindOpeners === "function") {
              window.ZLeaderboard.bindOpeners(document);
            }
          } catch (_) {}
    
          const playersEl = document.getElementById(opts.playersListId || "playersList");
    
          try {
            const setLoading = (el, msg) => {
              if (!el) return;
              el.innerHTML = `<div class="z-empty z-loading">${msg || ""}</div>`;
            };
            setLoading(playersEl, window.I18N.translateArgs("lobby.loadingPlayers"));
            setLoading(roomsEl, window.I18N.translateArgs("lobby.loadingRooms"));
          } catch (e) {}
    
          const ok = await this.initPresence({ deferHeartbeat: true });
          if (!ok) {
            try { this._showLobbyLoadFailure && this._showLobbyLoadFailure(true); } catch (e) {}
            return false;
          }
    
          try { await this._ensureCurrentNickname(); } catch (e) {}
    
          await this._syncLobbyAvailabilityFromActiveGame({ deferPulse: true });

          try {
            await this.initInvitesPassive({ deferHeartbeat: true, deferPulse: true });
          } catch (e) {}
    
          try {
            if (this._lobbyPlayersRef && this._lobbyPlayersCb) {
              try { this._lobbyPlayersRef.off && this._lobbyPlayersRef.off("value", this._lobbyPlayersCb); } catch (e) {}
            }
            this._lobbyPlayersRef = null;
    
            const cb = (snap) => {
              this._lobbyPlayersLastSnap = snap || null;
              const all = snap && snap.val ? snap.val() : null;
              const rows = [];
    
              if (all) {
                for (const [uid, p] of Object.entries(all)) {
                  if (!p) continue;
                  const isSelf = uid === this.myUid;
                  const ts = Number(p.updatedAt || 0);
                  if (!isPresenceFresh(ts, PRESENCE_LIST_TTL_MS)) {
                    if (!isSelf) continue;
                  }
    
                  const nick = displayPlayerName(uid, p.nickname);
                  const statusInfo = lobbyStatusInfo(p, this._lobbyActivePlayerRooms || {}, uid);
                  const canInvite = !isSelf && statusInfo.canInvite;
                  rows.push({
                    uid,
                    nick,
                    st: statusInfo.status,
                    stLabel: statusInfo.label,
                    canInvite,
                    acceptsInvites: statusInfo.acceptsInvites,
                    inOnlineMatch: statusInfo.inOnlineMatch,
                    icon: p.icon,
                    registered: p.registered !== false,
                    isSelf
                  });
                }
              }
    
              rows.sort((a, b) => a.nick.localeCompare(b.nick));
              let guestIndex = 0;
              rows.forEach((r) => {
                if (r.registered === false) {
                  r.icon = guestListIconByIndex(guestIndex);
                  guestIndex += 1;
                } else {
                  r.icon = iconSrcForPage(r.icon);
                }
              });
    
              if (!playersEl) return;
              if (!rows.length) {
                playersEl.innerHTML = `<div class="z-empty">${window.I18N.translateArgs("lobby.emptyPlayers")}</div>`;
                return;
              }
    
              playersEl.innerHTML = rows
                .map((r) => {
                  const playerStatusClass = r.st === "available"
                    ? "is-available"
                    : (r.st === "vsComputer"
                        ? "is-computer"
                        : (r.st === "inPvP" ? "is-online" : "is-no-invites"));
                  const statusMarkup = `<span class="z-player-status ${playerStatusClass}">${escapeHtml(r.stLabel)}</span>`;
                  if (r.isSelf) {
                    return `
                      <div class="z-row z-player-row ${playerStatusClass} is-self" data-uid="${r.uid}">
                        <div class="z-row-main">
                          <div class="z-row-title"><img class="z-avatar" src="${r.icon}" alt="" /><span class="z-player-name">${escapeHtml(r.nick)}</span>${statusMarkup}</div>
                        </div>
                        <div class="z-row-actions">
                          <span class="z-self">${window.I18N.translateArgs("players.you")}</span>
                        </div>
                      </div>
                    `;
                  }

                  const dis = r.canInvite ? "" : 'disabled aria-disabled="true"';
                  const inviteButtonClass = r.canInvite
                    ? "btn small ok z-invite-btn is-invite-active"
                    : "btn small z-invite-btn is-invite-disabled";
                  const title = r.canInvite ? "" : `title="${window.I18N.translateArgs(r.st === "inPvP" ? "lobby.inviteDisabled" : "lobby.invitesDisabled")}"`;
                  const inviteLabel = window.I18N.translateArgs("actions.invite");
                  return `
                    <div class="z-row z-player-row ${playerStatusClass}" data-uid="${r.uid}">
                      <div class="z-row-main">
                        <div class="z-row-title"><img class="z-avatar" src="${r.icon}" alt="" /><span class="z-player-name">${escapeHtml(r.nick)}</span>${statusMarkup}</div>
                      </div>
                      <div class="z-row-actions">
                        <button class="${inviteButtonClass}" data-action="invite" ${dis} ${title}>
                          <span>${inviteLabel}</span>
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join("");
              Array.from(playersEl.querySelectorAll("button[data-action='invite']")).forEach((btn) => {
                btn.addEventListener("click", async (ev) => {
                  const row = ev.currentTarget.closest(".z-row");
                  const uid = row ? row.getAttribute("data-uid") : "";
                  if (!uid) return;
                  try {
                    await this._createGame(uid);
                  } catch (e) {}
                });
              });
            };
    
            this._lobbyPlayersCb = cb;
            try {
              if (this._lastOfficialLobbyView && this._lastOfficialLobbyView.players) {
                this._applyOfficialLobbyView(this._lastOfficialLobbyView);
              }
            } catch (e) {}
          } catch (e) {}
    
          try {
            if (this._lobbyRoomsRef && this._lobbyRoomsCb) {
              try { this._lobbyRoomsRef.off && this._lobbyRoomsRef.off("value", this._lobbyRoomsCb); } catch (e) {}
            }
            this._lobbyRoomsRef = null;
    
            const cbG = (snap) => {
              const all = snap && snap.val ? snap.val() : null;
              const rooms = [];
    
              const activePlayerRooms = {};
              if (all) {
                for (const [gid, g] of Object.entries(all)) {
                  if (!g || g.status !== "active") continue;
                  const wuid = g.players && g.players.white ? g.players.white.uid || "" : "";
                  const buid = g.players && g.players.black ? g.players.black.uid || "" : "";
                  if (!wuid || !buid) continue;
                  activePlayerRooms[String(wuid)] = String(gid);
                  activePlayerRooms[String(buid)] = String(gid);
    
                  const name = (g.roomName || g.name || "").trim() || window.I18N.translateArgs("lobby.roomDefault");
                  const w = g.players && g.players.white ? displayPlayerName(g.players.white.uid, g.players.white.nickname) : "";
                  const b = g.players && g.players.black ? displayPlayerName(g.players.black.uid, g.players.black.nickname) : "";
                  const spectatorCount = Math.max(0, Math.min(3, Number(g.spectatorCount || 0) || 0));
                  const spectatorCountUpdatedAt = Number(g.spectatorCountUpdatedAt || 0) || 0;
                  const spectatorCountFresh = isPresenceFresh(spectatorCountUpdatedAt, SPECTATOR_COUNT_STALE_MS);
                  const visibility = normalizeRoomVisibility(g.visibility);
                  const reconnectGraceUntil = Number(g.reconnectGraceUntil || 0) || 0;
                  const reconnecting = g.reconnecting === true && reconnectGraceUntil > nowTs();
                  rooms.push({
                    gid, name, w, b, wuid, buid, visibility,
                    ownerOnly: g.ownerOnly === true || g.listed === false,
                    reconnecting,
                    reconnectGraceUntil,
                    createdAt: g.createdAt || g.acceptedAt || 0,
                    spectatorCount, spectatorCountUpdatedAt, spectatorCountFresh
                  });
                }
              }
              this._lobbyActivePlayerRooms = activePlayerRooms;
              try {
                if (this._lobbyPlayersLastSnap && this._lobbyPlayersCb) this._lobbyPlayersCb(this._lobbyPlayersLastSnap);
              } catch (e) {}
              rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
              if (!roomsEl) return;
              if (!rooms.length) {
                roomsEl.innerHTML = `<div class="z-empty">${window.I18N.translateArgs("lobby.emptyRooms")}</div>`;
                return;
              }
    
              try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(this._lastOfficialLobbyView || null); } catch (e) {}
              try { if (!this.myUid) this._syncMyUidFromAuth && this._syncMyUidFromAuth(); } catch (e) {}
              roomsEl.innerHTML = rooms
                .map((r) => {
                  const meUid = String(this.myUid || "").trim();
                  const isMePlayer = meUid && (meUid === String(r.wuid || "") || meUid === String(r.buid || ""));
                  const joinBtn = isMePlayer
                    ? `<button class="btn small primary" data-action="join" data-gid="${r.gid}">
                         <img class="btn-ico" src="${ASSET_PREFIX}assets/icons/play.svg" alt="" aria-hidden="true" />
                         <span>${window.I18N.translateArgs("lobby.returnToMatch")}</span>
                       </button>`
                    : "";
                  const isPrivateRoom = r.visibility === ROOM_VISIBILITY_PRIVATE;
                  const spectatorFull = !isMePlayer && !isPrivateRoom && !!r.spectatorCountFresh && Number(r.spectatorCount || 0) >= 3;
                  const spectatorDisabled = spectatorFull || isPrivateRoom ? 'disabled aria-disabled="true"' : "";
                  const spectatorTitle = spectatorFull ? `title="${window.I18N.translateArgs("lobby.spectatorFull")}"` : isPrivateRoom ? `title="${window.I18N.translateArgs("lobby.privateRoom")}"` : "";
                  const spectatorLabel = isPrivateRoom ? window.I18N.translateArgs("lobby.privateRoom") : window.I18N.translateArgs("lobby.spectate");
                  const spectateBtn = !isMePlayer
                    ? `<button class="btn small secondary" data-action="spectate" data-gid="${r.gid}" ${spectatorDisabled} ${spectatorTitle}>
                         <img class="btn-ico" src="${ASSET_PREFIX}assets/icons/watch.svg" alt="" aria-hidden="true" />
                         <span>${spectatorLabel}</span>
                       </button>`
                    : "";
                  const roomStateLabel = r.reconnecting ? window.I18N.translateArgs("lobby.reconnectingRoom") : "";
                  const roomStateClass = r.reconnecting
                    ? "is-reconnecting"
                    : (r.ownerOnly ? "is-private" : "is-live");
                  const roomPlayers = [r.w, r.b]
                    .filter(Boolean)
                    .map((name) => escapeHtml(name))
                    .join(" · ");
                  const roomInline = roomPlayers
                    ? `<span class="z-row-inline-sub">• ${roomPlayers}</span>`
                    : "";
                  return `
                    <div class="z-row z-room-row ${roomStateClass}${r.ownerOnly ? " z-room-owner-only" : ""}${r.reconnecting ? " z-room-reconnecting" : ""}" data-gid="${r.gid}">
                      <div class="z-row-main">
                        <div class="z-row-title z-room-title"><span class="z-row-status-dot ${roomStateClass}" aria-hidden="true"></span><span>${window.I18N.translateArgs("lobby.roomLabel")} : </span><span>${escapeHtml(r.name)}</span>${roomInline}</div>
                      </div>
                      <div class="z-row-actions">
                        ${joinBtn || spectateBtn}
                      </div>
                    </div>
                  `;
                })
                .join("");

              Array.from(roomsEl.querySelectorAll("button[data-action='join']")).forEach((btn) => {
                btn.addEventListener("click", (ev) => {
                  const gid = ev.currentTarget.getAttribute("data-gid");
                  if (gid) this._goToGameAsPlayer(gid);
                });
              });
              Array.from(roomsEl.querySelectorAll("button[data-action='spectate']")).forEach((btn) => {
                btn.addEventListener("click", (ev) => {
                  if (ev.currentTarget.disabled) return;
                  const gid = ev.currentTarget.getAttribute("data-gid");
                  if (gid) this._goToGameAsSpectator(gid);
                });
              });
            };
    
            this._lobbyRoomsCb = cbG;
            try {
              if (this._lastOfficialLobbyView && this._lastOfficialLobbyView.roomList) {
                this._applyOfficialLobbyView(this._lastOfficialLobbyView);
              }
            } catch (e) {}
          } catch (e) {}

          try { this._ensureUnifiedAppPulse && this._ensureUnifiedAppPulse("lobby-ready", false); } catch (e) {}
          let firstResult = false;
          try { firstResult = await this._runUnifiedAppPulse(true, "lobby-enter"); } catch (e) {}
          const loaded = this._isSuccessfulLobbyPulseResult && this._isSuccessfulLobbyPulseResult(firstResult);
          if (!loaded) {
            try { this._showLobbyLoadFailure && this._showLobbyLoadFailure(true); } catch (e) {}
          }
          return !!loaded;
        },

    _isCurrentUserPlayerInGame: function (g) {
          try {
            const uid = String(this.myUid || (auth && auth.currentUser && auth.currentUser.uid) || "").trim();
            if (!uid || !g || !g.players) return false;
            const wuid = String((g.players.white && g.players.white.uid) || "").trim();
            const buid = String((g.players.black && g.players.black.uid) || "").trim();
            return uid === wuid || uid === buid;
          } catch (e) {
            return false;
          }
        },

    _setOnlineEntryLoading: function (enabled, messageKey) {
          try {
            if (typeof document === "undefined" || !isGamePage()) return false;
            let overlay = document.getElementById("zOnlineEntryOverlay");
            if (enabled && !overlay) {
              overlay = document.createElement("div");
              overlay.id = "zOnlineEntryOverlay";
              overlay.className = "z-online-entry-overlay";
              overlay.setAttribute("role", "status");
              overlay.setAttribute("aria-live", "polite");
              const text = document.createElement("div");
              text.className = "z-online-entry-overlay-text";
              overlay.appendChild(text);
              (document.body || document.documentElement).appendChild(overlay);
            }
            if (!overlay) return false;
            const textEl = overlay.querySelector(".z-online-entry-overlay-text");
            if (textEl) textEl.textContent = window.I18N.translateArgs(messageKey || "status.loadingMatch");
            overlay.hidden = !enabled;
            document.body && document.body.classList.toggle("z-online-entry-pending", !!enabled);
            return true;
          } catch (e) { return false; }
        },

    _isDefinitiveGameEntryError: function (error) {
          return isDefinitiveGameEntryError(error);
        },

    _showUnavailableGameAndLeave: async function () {
          try { this._setOnlineEntryLoading(false); } catch (e) {}
          try { this._clearPersistedActiveGame && this._clearPersistedActiveGame(); } catch (e) {}
          await this._abortOnlineEntry("official-game-unavailable", { redirect: false });
          let redirected = false;
          const goToLobby = () => {
            if (redirected) return;
            redirected = true;
            try {
              if (typeof location !== "undefined" && isGamePage()) {
                const back = (location.pathname || "").includes("/pages/") ? "./loby.html" : "pages/loby.html";
                if (typeof location.replace === "function") location.replace(back);
                else location.href = back;
              }
            } catch (e) {}
          };
          try {
            const hasModal = typeof Modal !== "undefined" && Modal && typeof Modal.alert === "function";
            showOnlineNotice(window.I18N.translateArgs("online.errors.noGame"), {
              allowSpectator: true,
              blocking: true,
              onClick: goToLobby,
              onClose: goToLobby,
            });
            if (!hasModal) goToLobby();
          } catch (e) {
            goToLobby();
          }
          return false;
        },

    _makeOfficialGameSnapshot: function (value) {
          return {
            val: function () {
              try { return value == null ? null : JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
            },
            exists: function () { return value !== null && value !== undefined; },
          };
        },

    _readOfficialGame: async function (gameId) {
          const gid = String(gameId || this.gameId || "").trim();
          if (!gid) return null;
          this._lastOfficialReadError = null;
          try {
            if (window.DhametGameRoomClient && typeof window.DhametGameRoomClient.resyncGame === "function") {
              const res = await window.DhametGameRoomClient.resyncGame({ gameId: gid, baseMoveIndex: this.moveIndex || 0 });
              try { this._lastGameAccess = res || null; } catch (e) {}
              try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(res); } catch (e) {}
              try { if (res && res.game) this._noteOnlineGameTransportActivity && this._noteOnlineGameTransportActivity("resync"); } catch (e) {}
              return res && res.game ? Object.assign({}, res.game, { __transportVersion: res.version }) : null;
            }
          } catch (e) {
            try { this._lastGameAccess = e && e.data ? e.data : null; } catch (_) {}
            try { this._lastOfficialReadError = e || new Error("official-read-failed"); } catch (_) {}
            throw e;
          }
          return null;
        },

    _makeOfficialGameRef: function (gameId) {
          const gid = String(gameId || "").trim();
          return {
            off: function () { return true; },
            once: async function () {
              const g = await self._readOfficialGame(gid);
              return self._makeOfficialGameSnapshot(g);
            },
          };
        },

    _refreshStaleRoomBeforeEntry: async function (gameId) {
          const gid = String(gameId || "").trim();
          this._lastOfficialReadError = null;
          if (!gid) return null;
          try { this._lastGameAccess = null; } catch (e) {}
          try {
            this._syncMyUidFromAuth && this._syncMyUidFromAuth();
          } catch (e) {}
          try {
            if (window.DhametGameRoomClient && typeof window.DhametGameRoomClient.resyncGame === "function") {
              const res = await window.DhametGameRoomClient.resyncGame({ gameId: gid, baseMoveIndex: 0 });
              try { this._lastGameAccess = res || null; } catch (e) {}
              try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(res); } catch (e) {}
              try { if (res && res.game) this._noteOnlineGameTransportActivity && this._noteOnlineGameTransportActivity("resync"); } catch (e) {}
              if (res && res.game) return res.game;
            }
          } catch (e) {
            try { this._lastGameAccess = e && e.data ? e.data : null; } catch (_) {}
            try { this._lastOfficialReadError = e || new Error("official-entry-read-failed"); } catch (_) {}
          }
          // Entry must never promote a cached lobby/game copy to official state
          // after a failed authoritative read. Keep the page blocked and retry
          // instead of applying a potentially stale or incomplete board.
          return null;
        },


    _autoEnterFromUrl: async function () {
          if (!isGamePage()) return;
          try {
            const requested = window.DhametMatchMode && typeof DhametMatchMode.requestedOnlineInfo === "function"
              ? DhametMatchMode.requestedOnlineInfo()
              : null;
            const gameId = requested && requested.gameId ? requested.gameId : "";
            if (!gameId) return;
            await this._enterGameFromId(gameId, !!requested.spectator);
          } catch (e) {
            try { Logger.warn("online_auto_enter_failed", { err: String(e && (e.message || e)) }); } catch (_) {}
          }
        },

    _enterGameFromId: async function (gameId, forceSpectator) {
          const entryRequest = this._beginEntryRequest(gameId);
          try { this._setOnlineEntryLoading(true, "status.loadingMatch"); } catch (e) {}
          const ok = await this.initPresence({ deferHeartbeat: true });
          if (!this._isEntryRequestCurrent(entryRequest)) return false;
          if (!ok) {
            try { this._setOnlineEntryLoading(false); } catch (e) {}
            showOnlineNotice(window.I18N.translateArgs("status.onlineInitFail"));
            return;
          }
    
          let preparedSpectatorRegistration = null;
          let g = null;
          if (forceSpectator) {
            preparedSpectatorRegistration = await this._registerSpectatorInRoom(gameId);
            if (!this._isEntryRequestCurrent(entryRequest)) {
              try {
                if (preparedSpectatorRegistration && preparedSpectatorRegistration.ok) {
                  await this._removeSpectatorRegistration(gameId, this.myUid);
                }
              } catch (e) {}
              return false;
            }
            if (preparedSpectatorRegistration && preparedSpectatorRegistration.ok) {
              await this._startSpectator(gameId, entryRequest, preparedSpectatorRegistration.game || null, preparedSpectatorRegistration);
              return;
            }
            if (!preparedSpectatorRegistration || preparedSpectatorRegistration.reason !== "player") {
              await this._startSpectator(gameId, entryRequest, null, preparedSpectatorRegistration);
              return;
            }
            g = preparedSpectatorRegistration.game || null;
          }

          if (!g) g = await this._refreshStaleRoomBeforeEntry(gameId);
          if (!this._isEntryRequestCurrent(entryRequest)) return false;
          if (!g) {
            if (this._lastOfficialReadError) {
              if (this._isDefinitiveGameEntryError(this._lastOfficialReadError)) {
                await this._showUnavailableGameAndLeave();
                return false;
              }
              try { this._setOnlineEntryLoading(true, "status.reconnecting"); } catch (e) {}
              try { showOnlineNotice(window.I18N.translateArgs("status.reconnecting"), { allowSpectator: true }); } catch (e) {}
              return false;
            }
            await this._showUnavailableGameAndLeave();
            return false;
          }
          try { this._setOnlineEntryLoading(false); } catch (e) {}
    
          const statusText = String((g && g.status) || "").trim();
          if (statusText && statusText !== "active" && statusText !== "pending") {
            await this._showUnavailableGameAndLeave();
            return;
          }
    
          const wuid = g.players && g.players.white && g.players.white.uid ? String(g.players.white.uid) : "";
          const buid = g.players && g.players.black && g.players.black.uid ? String(g.players.black.uid) : "";
          const access = this._lastGameAccess || null;
          const accessSideRaw = access && access.side != null ? access.side : null;
          const accessSide = Number(accessSideRaw);
          const accessUid = String((access && (access.uid || access.viewerUid)) || "").trim();
          if (accessUid) {
            try { this.myUid = accessUid; } catch (e) {}
          }
          const uid = String(this.myUid || accessUid || "").trim();
          const isPlayerByAccess = access && (access.role === "player" || accessSide === -1 || accessSide === 1);
          const amPlayer = !!(isPlayerByAccess || (uid && (uid === wuid || uid === buid)));
    
          if (!amPlayer || forceSpectator) {
            if (forceSpectator && amPlayer) {
              // A player should always return to the match; do not register a player as spectator.
            } else {
              if (statusText !== "active") {
                await this._showUnavailableGameAndLeave();
                return;
              }
              await this._startSpectator(gameId, entryRequest, g);
              return;
            }
          }
    
          if (!g.acceptedAt || statusText !== "active") {
            showOnlineNotice(window.I18N.translateArgs("online.waitingAcceptance"));
            return;
          }
    
          if (accessSide === -1 || uid === wuid) {
            await this._startInviterGame(gameId, entryRequest, g);
          } else {
            await this._joinGame(gameId, entryRequest, g);
          }
        },

    _startSpectator: async function (gameId, entryRequest, initialGame, preparedRegistration) {
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          const ok = await this.initPresence({ deferHeartbeat: true });
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          if (!ok) return false;
    
          const registration = preparedRegistration || await this._registerSpectatorInRoom(gameId);
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) {
            try { if (registration && registration.ok) await this._removeSpectatorRegistration(gameId, this.myUid); } catch (e) {}
            return false;
          }
          if (!registration || !registration.ok) {
            const registrationError = registration && registration.error;
            if (registrationError && this._isDefinitiveGameEntryError(registrationError)) {
              await this._showUnavailableGameAndLeave();
              return false;
            }
            const msg = registration && registration.reason === "full"
              ? window.I18N.translateArgs("lobby.spectatorFull")
              : window.I18N.translateArgs("online.errors.spectatorJoinFailed");
            showOnlineNotice(msg, { allowSpectator: true });
            this._applySessionState({
              active: false,
              spectator: false,
              side: null,
              gameId: null,
              gameRef: null,
            });
            this._setOnlineButtonsState(false);
            if (typeof location !== "undefined" && isGamePage()) {
              const back = (location.pathname || "").includes("/pages/") ? "./loby.html" : "pages/loby.html";
              location.href = back;
            }
            return false;
          }
    
          this._applySessionState({
            active: true,
            spectator: true,
            side: 0,
            gameId,
            postMatch: false,
            postMatchShown: false,
            presenceStatus: "spectating",
            presenceRole: "spectator",
            presenceRoomId: gameId,
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.ONLINE_SPECTATOR : null,
            reason: "online-spectator-enter",
          });
          this._applySessionState({ gameRef: this._makeOfficialGameRef(gameId) }); // Official /dhamet/api/game/live and /dhamet/api/game/resync endpoints provide live state.
    
          const asyncContext = this._captureAsyncContext(gameId);
          this._setOnlineButtonsState(true, { keepBlocked: true });
    
          try {
            if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
          } catch (e) {
            Logger.warn("spectator_presentation_reset_failed", { gameId, err: String(e && (e.message || e)) });
          }
          let officialGame = initialGame || (registration && registration.game) || null;
          if (!officialGame) officialGame = await this._refreshStaleRoomBeforeEntry(gameId);
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          const synced = await this._applyEntryOfficialState(gameId, officialGame, "spectator-entry");
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          if (!synced) return await this._abortOnlineEntry("spectator-sync-failed");
          try { this._startPresenceHeartbeat(); } catch (e) {}
          this._setOnlineButtonsState(true);
    
          try {
            this._bindInviteListener();
          } catch (e) {}
          this._bindGameListeners();
          try {
            await this._initRoomComms();
          } catch (e) {
            handleDbError(e, "", { ctx: "rtc.initSpectator" });
          }
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          try {
            this._persistActiveGame();
          } catch (e) {}
          return true;
        },
    _abortOnlineEntry: async function (reason, options) {
          const abortOptions = options && typeof options === "object" ? options : {};
          const gid = String(this.gameId || this._presenceRoomId || "").trim();
          const uid = String(this.myUid || "").trim();
          const wasSpectator = !!this.isSpectator;
          this._applySessionState({
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.LEAVING : null,
            reason: reason || "online-entry-aborted",
          });
          try { if (typeof Modal !== "undefined" && Modal && Modal.close) Modal.close("state-change"); } catch (e) {}
          try { this._unbindGameLiveSubscription && this._unbindGameLiveSubscription(); } catch (e) {}
          try { this.gameRef && this.gameRef.off && this.gameRef.off(); } catch (e) {}
          try { this._teardownRoomComms && this._teardownRoomComms(); } catch (e) {}
          try {
            if (gid && uid && wasSpectator) await this._removeSpectatorRegistration(gid, uid);
          } catch (e) {}
          try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (e) {}
          try { this._clearPendingMoveOutbox && this._clearPendingMoveOutbox(); } catch (e) {}
          try { this._markLocalCommitSettled && this._markLocalCommitSettled(); } catch (e) {}
          try { this._clearPersistedActiveGame && this._clearPersistedActiveGame(); } catch (e) {}

          this._applySessionState({
            active: false,
            spectator: false,
            gameId: null,
            gameRef: null,
            side: null,
            presenceRoomId: null,
          });

          try {
            if (typeof history !== "undefined" && history.replaceState && typeof location !== "undefined") {
              history.replaceState(null, "", (location.pathname || "") + (location.hash || ""));
            }
          } catch (e) {}
          try { this._setOnlineButtonsState(false); } catch (e) {}
          try { await this._setLobbyStatus("available"); } catch (e) {}

          if (abortOptions.redirect !== false) {
            try {
              if (typeof location !== "undefined" && isGamePage()) {
                const back = (location.pathname || "").includes("/pages/") ? "./loby.html" : "pages/loby.html";
                if (typeof location.replace === "function") location.replace(back);
                else location.href = back;
              }
            } catch (e) {}
          }
          return false;
        },

    _officialCursor: function (data, meta) {
          const source = meta && typeof meta === "object" ? meta : {};
          return {
            gameId: String(source.gameId || this.gameId || ""),
            moveIndex: Number((data && data.moveIndex) || 0) || 0,
            version: Number(source.version != null ? source.version : (data && data.__transportVersion)),
          };
        },

    _prepareOfficialState: function (data) {
          if (!data || typeof data !== "object") return data;
          const stateSnap =
            (data.state && data.state.snapshot) ||
            (data.states && data.ply != null && data.states[data.ply] && data.states[data.ply].snapshot) ||
            null;
          if (!stateSnap) return data;
          const stateRecord = currentStateRecord(data) || {};
          const queue = deferredPromotionQueue(stateRecord);
          return Object.assign({}, data, {
            state: Object.assign({}, stateRecord, {
              snapshot: snapshotWithPromotionQueue(stateSnap, stateRecord),
              deferredPromotions: queue,
              deferredPromotion: queue.length ? Object.assign({}, queue[0]) : null,
            }),
          });
        },

    _verifyMissingOfficialGame: function () {
          if (!this.isActive || !this.gameId) return;
          const asyncContext = this._captureAsyncContext(this.gameId);
          if (this._missingGameVerification && this._isAsyncContextCurrent(this._missingGameVerification.context, { ignorePostMatch: true })) return;
          const verification = { context: asyncContext };
          this._missingGameVerification = verification;
          const client = window.DhametGameRoomClient;
          const done = () => {
            if (this._missingGameVerification === verification) this._missingGameVerification = null;
          };
          if (!client || typeof client.resyncGame !== "function") {
            done();
            if (this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) this._handleMissingOfficialGame();
            return;
          }
          Promise.resolve(client.resyncGame({ gameId: asyncContext.gameId, baseMoveIndex: this.moveIndex || 0 }))
            .then((res) => {
              if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return;
              const data = res && res.game ? Object.assign({}, res.game, { __transportVersion: res.version }) : null;
              if (data) {
                this._ingestOfficialGame(data, { source: "verify-missing", gameId: asyncContext.gameId, version: res.version, rejectDuplicate: false });
              } else {
                this._handleMissingOfficialGame();
              }
            })
            .catch((error) => {
              if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return;
              const status = Number(error && error.status);
              const code = String((error && (error.code || error.message)) || "");
              if (status === 404 || /not-found/.test(code)) this._handleMissingOfficialGame();
              else try { Logger.warn("official_missing_verification_failed", { gameId: asyncContext.gameId, err: code }); } catch (_) {}
            })
            .finally(done);
        },

    _handleMissingOfficialGame: function () {
          if (!this.isActive) return false;
          const asyncContext = this._captureAsyncContext(this.gameId);
          if (!this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return false;
          return this._enterPostMatch({
            missingOfficial: true,
            reason: "room_unavailable",
            winner: null,
            result: null,
            game: null,
          });
        },

    _ingestOfficialGame: function (rawData, meta) {
          this._lastOfficialIngestFailureReason = "";
          if (!rawData || typeof rawData !== "object") {
            this._lastOfficialIngestFailureReason = "invalid-input";
            return false;
          }
          const source = meta && typeof meta === "object" ? meta : {};
          const remoteMi = Number(rawData.moveIndex || 0) || 0;
          const localBaseMoveIndex = Number(this.moveIndex || 0) || 0;
          const isTerminalState = !!(rawData.status && rawData.status !== "active");
          if (
            this._awaitingLocalCommit &&
            Number.isFinite(this._expectedMoveIndex) &&
            remoteMi < this._expectedMoveIndex &&
            !isTerminalState
          ) {
            const allowPendingRollback = !!(source.allowPendingRollback || this._moveRetryGaveUp);
            if (!allowPendingRollback) {
              try { Logger.info("official_state_held_for_local_commit", { gameId: this.gameId, remoteMi, expected: this._expectedMoveIndex, source: source.source || "" }); } catch (_) {}
              this._lastOfficialIngestFailureReason = "pending-local-commit";
              return false;
            }
            // The official state is still at the pre-move boundary after all
            // retries were exhausted. Roll the speculative browser state back
            // to that authoritative snapshot instead of leaving the turn and
            // board locked indefinitely.
            try { this._pendingSteps = []; } catch (_) {}
            try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (_) {}
            try { this._markLocalCommitSettled(); } catch (_) {}
          }

          const data = this._prepareOfficialState(rawData);
          const stateSnap = data && data.state && data.state.snapshot;
          if (data.status === "active" && stateSnap && stateSnap.inChain) {
            try { Logger.warn("official_partial_turn_rejected", { gameId: this.gameId, moveIndex: remoteMi, reason: "official-snapshots-must-be-turn-boundaries" }); } catch (_) {}
            this._lastOfficialIngestFailureReason = "partial-turn";
            return false;
          }

          const cursor = this._officialCursor(data, source);
          const coordinator = window.DhametMatchCoordinator || null;
          const gateOptions = {
            expectedGameId: this.gameId,
            allowGameChange: false,
            rejectDuplicate: source.rejectDuplicate !== false,
          };
          let cursorNeedsCommit = false;
          let gate = { accepted: true };
          try {
            if (coordinator && typeof coordinator.inspectRemote === "function") {
              gate = coordinator.inspectRemote(cursor, gateOptions);
              cursorNeedsCommit = true;
            } else if (
              coordinator &&
              typeof coordinator.normalizeCursor === "function" &&
              typeof coordinator.compareCursor === "function" &&
              typeof coordinator.getRemoteCursor === "function"
            ) {
              // A mixed cached document can briefly pair the new online runtime
              // with the previous coordinator. Inspect its public cursor without
              // mutating it, then use acceptRemote only after a successful apply.
              const nextCursor = coordinator.normalizeCursor(cursor);
              const currentCursor = coordinator.getRemoteCursor();
              const differentExpectedGame = gateOptions.expectedGameId && nextCursor.gameId && nextCursor.gameId !== String(gateOptions.expectedGameId);
              const differentCurrentGame = currentCursor && nextCursor.gameId && currentCursor.gameId && nextCursor.gameId !== currentCursor.gameId;
              const order = coordinator.compareCursor(nextCursor, currentCursor);
              if (differentExpectedGame || (differentCurrentGame && !gateOptions.allowGameChange)) {
                gate = { accepted: false, reason: "different-game", cursor: nextCursor, current: currentCursor };
              } else if (currentCursor && order < 0) {
                gate = { accepted: false, reason: "stale", cursor: nextCursor, current: currentCursor };
              } else if (currentCursor && order === 0 && gateOptions.rejectDuplicate) {
                gate = { accepted: false, reason: "duplicate", cursor: nextCursor, current: currentCursor };
              } else {
                gate = { accepted: true, reason: order > 0 ? "newer" : "same-or-first", cursor: nextCursor, current: currentCursor };
                cursorNeedsCommit = true;
              }
            }
          } catch (e) {
            try { Logger.warn("official_state_gate_failed", { gameId: this.gameId, error: String(e && (e.message || e)) }); } catch (_) {}
          }
          if (!gate.accepted) {
            try { Logger.info("official_state_rejected", { gameId: this.gameId, reason: gate.reason, cursor, source: source.source || "" }); } catch (_) {}
            this._lastOfficialIngestFailureReason = gate.reason || "cursor-rejected";
            return false;
          }
          const commitOfficialCursor = () => {
            if (!cursorNeedsCommit || !coordinator) return true;
            try {
              const committed = typeof coordinator.commitRemote === "function"
                ? coordinator.commitRemote(cursor, Object.assign({}, gateOptions, { rejectDuplicate: false }))
                : coordinator.acceptRemote(cursor, Object.assign({}, gateOptions, { rejectDuplicate: false }));
              if (committed && committed.accepted) return true;
              this._lastOfficialIngestFailureReason = committed && committed.reason ? committed.reason : "cursor-commit-failed";
              try { Logger.warn("official_state_cursor_commit_failed", { gameId: this.gameId, reason: this._lastOfficialIngestFailureReason, cursor }); } catch (_) {}
              return false;
            } catch (error) {
              this._lastOfficialIngestFailureReason = "cursor-commit-failed";
              try { Logger.warn("official_state_cursor_commit_failed", { gameId: this.gameId, error: String(error && (error.message || error)), cursor }); } catch (_) {}
              return false;
            }
          };


          if (data.status && data.status !== "active") {
            let enteredPostMatch = false;
            try {
              enteredPostMatch = this._enterPostMatch({
                reason: data.endedReason || data.status,
                endedBy: data.endedBy || null,
                byUid: data.endedBy && data.endedBy.uid,
                byNick: data.endedBy && data.endedBy.nickname,
                result: data.result || null,
                winner: data.winner,
                game: data,
                players: data.players || null,
              }) !== false;
            } catch (error) {
              this._lastOfficialIngestFailureReason = "apply-failed";
              try { Logger.warn("official_terminal_state_apply_failed", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
              return false;
            }
            if (!enteredPostMatch) {
              this._lastOfficialIngestFailureReason = "apply-failed";
              return false;
            }
            if (!commitOfficialCursor()) return false;
            this._lastGameData = data;
            this.moveIndex = remoteMi;
            this.ply = Number(data.ply || 0) || 0;
            try { this._reconcileLocalCommitAgainstOfficialGame(data, { notifyConflict: false }); } catch (e) {}
            return true;
          }

          const preserveLocalCapture = !!(
            stateSnap &&
            Game && Game.inChain &&
            Array.isArray(this._pendingSteps) && this._pendingSteps.length &&
            remoteMi === localBaseMoveIndex
          );
          let restoreCaptureDraft = false;
          if (preserveLocalCapture) {
            try { this._scheduleCaptureDraftSave(); } catch (e) {}
          } else if (stateSnap) {
            const stateApplied = this._applyRemoteState(data, { skipFx: !!source.skipFx });
            if (!stateApplied) {
              this._lastOfficialIngestFailureReason = "apply-failed";
              return false;
            }
            restoreCaptureDraft = true;
          } else if (typeof data.turn === "number") {
            try {
              this._installOfficialSouflaState(data);
              this._resumeOfficialTurn(data.turn);
            } catch (error) {
              this._lastOfficialIngestFailureReason = "apply-failed";
              try { Logger.warn("official_turn_only_resume_failed", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
              return false;
            }
          }

          if (!commitOfficialCursor()) return false;

          // Publish transport and match metadata only after the authoritative
          // board/turn state has been installed. A failed visual application
          // must not make the browser claim a move index it is not displaying.
          this._lastGameData = data;
          this.moveIndex = remoteMi;
          this.ply = Number(data.ply || 0) || 0;

          try {
            const w = data.players && data.players.white ? displayPlayerName(data.players.white.uid, data.players.white.nickname) : "";
            const b = data.players && data.players.black ? displayPlayerName(data.players.black.uid, data.players.black.nickname) : "";
            Game.names.bot = w || "";
            Game.names.top = b || "";
            if (window.ZGamePlayers && typeof window.ZGamePlayers.refresh === "function") window.ZGamePlayers.refresh();
            this._topDisplayName = this._resolveSlotDisplayName("top", Game.names.top || window.I18N.translateArgs("players.player"));
            this._botDisplayName = this._resolveSlotDisplayName("bot", Game.names.bot || window.I18N.translateArgs("players.player"));
            this._ensurePresenceUi();
            this._updatePresenceUi();
          } catch (e) {}

          try { this._renderSharedLog(data.log || []); } catch (e) {}
          try { this._handlePresence(data); } catch (e) {}
          try { this._handleUndoRequest(data); } catch (e) {}
          if (restoreCaptureDraft) {
            try { this._restoreCaptureDraftIfValid && this._restoreCaptureDraftIfValid(data); } catch (e) {}
          }
          try {
            this._reconcileLocalCommitAgainstOfficialGame(data, {
              notifyConflict: source.suppressMoveConflictNotice !== true,
            });
          } catch (e) {}
          try { this._applyUiHold(false); } catch (e) {}
          try { this.refreshPvpControls && this.refreshPvpControls(); } catch (e) {}
          return true;
        },

    _captureDraftKey: function () {
          const gid = String(this.gameId || "").trim();
          return gid ? "zamat.captureDraft." + gid : "";
        },

    _clearCaptureDraft: function () {
          try {
            const key = this._captureDraftKey();
            if (key) sessionStorage.removeItem(key);
          } catch (e) {}
          this._captureDraft = null;
        },

    _captureTimerElapsed: function () {
          try {
            if (!Game || !Game.killTimer) return 0;
            const timer = Game.killTimer;
            return Math.max(0, Number(timer.elapsedMs || 0) + (timer.running ? performance.now() - Number(timer.startTs || 0) : 0));
          } catch (e) { return 0; }
        },

    _saveCaptureDraftNow: function () {
          if (!this.isActive || this.isSpectator || !this.gameId) return false;
          if (!Game || !Game.inChain || Game.chainPos == null || !Turn || !Turn.ctx) {
            this._clearCaptureDraft();
            return false;
          }
          const steps = Array.isArray(this._pendingSteps) ? this._pendingSteps.slice() : [];
          if (!steps.length || !steps.some((step) => !!step.capture)) {
            this._clearCaptureDraft();
            return false;
          }
          try {
            const base = Turn.ctx.snapshot;
            const coordinator = window.DhametMatchCoordinator;
            if (!base || !coordinator || typeof coordinator.boardFingerprint !== "function") return false;
            const draft = {
              schema: 1,
              gameId: String(this.gameId),
              baseMoveIndex: Number(this.moveIndex || 0) || 0,
              side: Number(Game.player),
              baseFingerprint: coordinator.boardFingerprint(base),
              steps,
              snapshot: snapshotState(),
              history: JSON.parse(JSON.stringify(Array.isArray(Game.history) ? Game.history : [])),
              capturedOrder: Visual && typeof Visual.getCapturedOrder === "function" ? Visual.getCapturedOrder() : [],
              timerElapsedMs: this._captureTimerElapsed(),
              savedAt: Date.now(),
            };
            const key = this._captureDraftKey();
            if (!key) return false;
            sessionStorage.setItem(key, JSON.stringify(draft));
            this._captureDraft = { gameId: String(this.gameId), draft };
            return true;
          } catch (e) {
            try { Logger.warn("capture_draft_save_failed", { gameId: this.gameId, err: String(e && (e.message || e)) }); } catch (_) {}
            return false;
          }
        },

    _scheduleCaptureDraftSave: function () {
          if (this._captureDraftSaveQueued) return;
          this._captureDraftSaveQueued = true;
          const asyncContext = this._captureAsyncContext(this.gameId);
          const run = () => {
            this._captureDraftSaveQueued = false;
            if (this._isAsyncContextCurrent(asyncContext)) this._saveCaptureDraftNow();
          };
          try {
            if (typeof queueMicrotask === "function") queueMicrotask(run);
            else Promise.resolve().then(run);
          } catch (e) { setTimeout(run, 0); }
        },

    _readCaptureDraft: function () {
          try {
            if (this._captureDraft && this._captureDraft.gameId === String(this.gameId || "")) return this._captureDraft.draft;
            if (this._captureDraft && this._captureDraft.gameId !== String(this.gameId || "")) this._captureDraft = null;
            const key = this._captureDraftKey();
            if (!key) return null;
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const draft = JSON.parse(raw);
            this._captureDraft = { gameId: String(this.gameId), draft };
            return draft;
          } catch (e) { return null; }
        },

    _restoreCaptureDraftIfValid: function (officialData) {
          if (!this.isActive || this.isSpectator || !officialData || !officialData.state || !officialData.state.snapshot) return false;
          const draft = this._readCaptureDraft();
          if (!draft) return false;
          const fail = (reason) => {
            try { Logger.info("capture_draft_rejected", { gameId: this.gameId, reason }); } catch (_) {}
            this._clearCaptureDraft();
            return false;
          };
          const coordinator = window.DhametMatchCoordinator;
          if (!coordinator || typeof coordinator.validateCaptureDraft !== "function") return fail("coordinator");
          const validation = coordinator.validateCaptureDraft({
            draft,
            officialSnapshot: officialData.state.snapshot,
            gameId: this.gameId,
            moveIndex: officialData.moveIndex,
            mySide: this.mySide,
            hasOutbox: !!(this._readPendingMoveOutbox && this._readPendingMoveOutbox()),
            rules: window.DhametRules,
            now: Date.now(),
          });
          if (!validation || !validation.valid) return fail(validation && validation.reason ? validation.reason : "invalid");

          try {
            const rebuilt = Object.assign({}, officialData.state.snapshot, {
              board: validation.board || draft.snapshot.board,
              inChain: true,
              chainPos: Number(validation.steps[validation.steps.length - 1].to),
              lastMovedFrom: Number(validation.steps[validation.steps.length - 1].from),
              lastMovedTo: Number(validation.steps[validation.steps.length - 1].to),
              lastMoveFrom: Number(validation.steps[0].from),
              lastMovePath: validation.steps.map((step) => Number(step.to)),
              turnCtx: {
                Lmax: Number(draft.snapshot.turnCtx.Lmax || 0),
                candidates: Array.isArray(draft.snapshot.turnCtx.candidates) ? draft.snapshot.turnCtx.candidates.slice() : [],
                startedFrom: Number(validation.steps[0].from),
                capturesDone: validation.steps.length,
                longestByPiece: Array.isArray(draft.snapshot.turnCtx.longestByPiece) ? draft.snapshot.turnCtx.longestByPiece.slice() : [],
                snapshot: officialData.state.snapshot,
              },
            });
            restoreSnapshot(rebuilt, { redraw: false, visual: false });
            Game.history = [];
            if (Visual && typeof Visual.clearCapturedOrder === "function") Visual.clearCapturedOrder();
            if (Game.killTimer) {
              Game.killTimer.stop();
              Game.killTimer.elapsedMs = Math.max(0, Number(draft.timerElapsedMs || 0));
              if (Game.player === this.mySide) Game.killTimer.start();
            }
            this._pendingSteps = validation.steps;
            if (window.UI && typeof UI.restoreCaptureContinuationVisualState === "function") UI.restoreCaptureContinuationVisualState();
            else if (Visual && typeof Visual.draw === "function") Visual.draw();
            try { Logger.info("capture_draft_restored", { gameId: this.gameId, steps: this._pendingSteps.length }); } catch (_) {}
            return true;
          } catch (e) {
            return fail("restore");
          }
        },

    _bindCaptureDraftLifecycle: function () {
          if (this._captureDraftLifecycleBound) return;
          this._captureDraftLifecycleBound = true;
          const flush = () => {
            try { this._saveCaptureDraftNow(); } catch (e) {}
          };
          window.addEventListener("pagehide", flush, { capture: true });
          window.addEventListener("beforeunload", flush, { capture: true });
        },

  });

  window.addEventListener("load", function () {
    try { Online._restoreInviteToggleFromCache(); } catch (_) {}
    if (isGamePage()) {
      let requestedOnline = false;
      try {
        const info = window.DhametMatchMode && typeof DhametMatchMode.requestedOnlineInfo === "function"
          ? DhametMatchMode.requestedOnlineInfo()
          : null;
        requestedOnline = !!(info && info.gameId);
      } catch (_) {}
      if (requestedOnline) {
        try { Online._autoEnterFromUrl(); } catch (_) {}
      } else {
        try { Online.initInvitesPassive(); } catch (_) {}
      }
      return;
    }
    if (document.getElementById("roomsList") && document.getElementById("playersList")) {
      Online.initLobbyPage({ roomsListId: "roomsList", playersListId: "playersList" }).catch(function () {
        var msg = window.I18N.translateArgs("status.onlineInitFail");
        var playersEl = document.getElementById("playersList");
        var roomsEl = document.getElementById("roomsList");
        if (playersEl) playersEl.innerHTML = '<div class="z-empty">' + msg + '</div>';
        if (roomsEl) roomsEl.innerHTML = '<div class="z-empty">' + msg + '</div>';
      });
      return;
    }
    try { Online.initInvitesPassive(); } catch (_) {}
  });
})();
