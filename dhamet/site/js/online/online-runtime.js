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
    try { console.error("[ZAMAT] lobby-runtime.js must be loaded before the online runtime"); } catch (e) {}
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
    GAME_PRESENCE_HEARTBEAT_MS,
    GAME_PRESENCE_ONLINE_TTL_MS,
    INVITE_TTL_MS,
    MOVE_SYNC_STALL_MS,
    MOVE_SYNC_WARN_AFTER_MS,
    MOVE_SYNC_WATCHDOG_MS,
    OPPONENT_ABSENCE_MS,
    PRESENCE_LIST_TTL_MS,
    ROOM_VISIBILITY_PRIVATE,
    SPECTATOR_COUNT_STALE_MS,
    askNickname,
    askRoomName,
    chatLastReadKey,
    decodeSharedLogText,
    defaultNick,
    encodeSharedLogText,
    ensureAuthReady,
    escapeHtml,
    formatPresenceDisconnectElapsed,
    formatTpl,
    getSavedNick,
    getSavedNickOrDefault,
    allowOnlineWrite,
    guestListIconByIndex,
    handleDbError,
    hasExplicitNick,
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
    souflaToPlain,
    tryFinalizeTrainingOnExit
  } = S;

  window.__ZAMAT_ONLINE_FULL_LOADED__ = true;

  function isNonRetriableGameCommitError(err) {
    try {
      const status = Number(err && err.status);
      const data = err && err.data && typeof err.data === 'object' ? err.data : {};
      const code = String((err && (err.code || err.message)) || data.code || data.error || '').trim();
      const inner = String(data.error || data.reason || '').trim();
      if (status === 403 || /not-a-player|player-side-mismatch|not-a-participant|permission|forbidden/.test(code + ' ' + inner)) return true;
      if (status === 400 && /invalid-move-intent|rule-validation-failed|forced-opening-mismatch|illegal-move|jumps-mismatch|turn-mismatch|snapshot-turn-mismatch|empty-source|invalid-move-path/.test(code + ' ' + inner)) return true;
      return false;
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
              const whiteUid = players.white && players.white.uid ? String(players.white.uid) : "";
              const blackUid = players.black && players.black.uid ? String(players.black.uid) : "";
              if (want === blackUid) return this._resolveSlotDisplayName("top", fallback);
              if (want === whiteUid) return this._resolveSlotDisplayName("bot", fallback);
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
          const self = this;
    
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
                  getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() ||
                  "#475569";
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
              notice.textContent =
                window.I18N.translateArgs("online.syncIssueNotice") ||
                "يفضل تحديث الصفحة، توجد مشكلة في المزامنة";
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
                notice.textContent =
                  window.I18N.translateArgs("online.syncIssueNotice") ||
                  "يفضل تحديث الصفحة، توجد مشكلة في المزامنة";
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
          try { this._touchRoomListActivity(this.gameId, true); } catch (e) {}
          return res;
        },

        _endByAbsence: async function () {
          if (!this.gameId || !this.myUid) return false;
          try {
            const res = await this._commitOfficialMatchEnd("opponent-absent", "opponent_absent");
            const ended = !!(res && res.committed !== false && res.game && res.game.status === "ended");
            if (ended) {
              try { await this._runUnifiedAppPulse(true); } catch (e) {}
            }
            return ended;
          } catch (e) {
            handleDbError(e, window.I18N.translateArgs("online.endFail"), { ctx: "matchEnd.absence" });
            return false;
          }
        },

    _endByAbsenceAndEnterPostMatch: async function () {
          const ended = await this._endByAbsence();
          if (!ended) {
            try {
              await this.syncNow();
            } catch (e) {}
            return false;
          }
    
          try {
            await this._notifyMatchEndWatchers(this.gameId, "opponent_absent", this.myNick);
          } catch (e) {}
          this._enterPostMatch({ reason: "opponent_absent", winner: this.mySide });
          return true;
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
          // Game presence is included in the unified app pulse. The
          // browser must not write games/<id>/presence/<uid> directly.
          try {
            const payload = this._buildGamePresencePayload();
            const core = typeof window !== "undefined" ? window.DhametPresence : null;
            const shouldWrite = !core || typeof core.shouldWritePresence !== "function" || core.shouldWritePresence({
              previous: this._lastGamePresencePayload || null,
              next: payload,
              force: !!force,
              minIntervalMs: GAME_PRESENCE_HEARTBEAT_MS,
              lastWriteAt: this._lastGamePresenceWriteAt || 0,
              now: nowTs(),
            });
            if (shouldWrite) {
              this._rememberPresenceWrite && this._rememberPresenceWrite("game", payload);
              this._runUnifiedAppPulse && this._runUnifiedAppPulse(!!force, ctx || "game-presence");
            }
            return true;
          } catch (e) {
            return false;
          }
        },

    _startGamePresenceHeartbeat: function () {
          // Game presence is included in the single unified app
          // pulse. No separate game heartbeat is started.
          try { return this._ensureUnifiedAppPulse && this._ensureUnifiedAppPulse("game-presence", true); } catch (e) {}
          return false;
        },

    _stopGamePresenceHeartbeat: function () {
          this._gamePresenceHeartbeatTimer = null;
        },

    _startOpponentAbsenceWatcher: function () {
          // Opponent absence is evaluated inside the unified app pulse and
          // rechecked locally from the latest game snapshot. No separate polling.
          try { return this._ensureUnifiedAppPulse && this._ensureUnifiedAppPulse("absence", false); } catch (e) {}
          return false;
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
            const lastSeen = Number((pres && (pres.updatedAt || pres.joinedAt)) || 0) || 0;
            const oppOnline = !!(pres && isPresenceFresh(lastSeen, GAME_PRESENCE_ONLINE_TTL_MS));
    
            this._oppOnline = oppOnline;
            if (lastSeen) this._oppLastSeenAt = lastSeen;
    
            if (oppOnline) {
              this._oppOfflineSince = null;
              this._oppLeftModalShown = false;
              try {
                this._updatePresenceUi();
              } catch (e) {}
              return;
            }
    
            if (!this._oppOfflineSince) {
              this._oppOfflineSince = lastSeen
                ? Math.min(now, lastSeen + GAME_PRESENCE_ONLINE_TTL_MS)
                : now;
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

    _buildInitialSnapshot: function () {
          try {
            if (typeof createInitialBoard !== "function") return null;
            if (typeof BOT !== "number") return null;
    
            const board = createInitialBoard();
            const player = BOT;
    
            return {
              board,
              player,
              inChain: false,
              chainPos: null,
              lastMovedTo: null,
              lastMovedFrom: null,
              lastMoveFrom: null,
              lastMovePath: null,
              moveCount: 0,
              forcedEnabled: true,
              forcedPly: 0,
            };
          } catch (e) {
            return null;
          }
        },

    _startInviterGame: async function (gameId, entryRequest) {
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          this._applySessionState({
            active: true,
            spectator: false,
            side: -1,
            gameId,
            postMatch: false,
            postMatchShown: false,
            lastRematchSeq: null,
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
            this._lastTrainLoggedMoveIndex = 0;
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
            await this._runUnifiedAppPulse(true, "enter-game");
          } catch (e) {}
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
    
          try {
            if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
          } catch (e) {}
    
          this._applySessionState({ gameRef: this._makeOfficialGameRef(gameId) }); // Official /dhamet/api/game/live and /dhamet/api/game/resync endpoints provide live state.
    
          let synced = false;
          try { synced = await this.syncNow({ repairPresence: false }); } catch (e) { synced = false; }
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          if (!synced) return await this._abortOnlineEntry("inviter-sync-failed");
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
    
          try {
            const picked = ((await askNickname()) || "").trim();
            if (picked) this.myNick = picked;
            if (!this.myNick) this.myNick = getSavedNickOrDefault(this.myUid);
          } catch (e) {}
    
          await this._setLobbyStatus("available");
    
          this._bindInviteListener();
          this._openLobbyModal();
        },

    _openLobbyModal: function () {
          const wrap = document.createElement("div");
          wrap.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px;">
              <div style="font-weight:700;">${window.I18N.translateArgs("online.playersTitle")}</div>
              <div id="playersList" style="display:flex; flex-direction:column; gap:8px;"></div>
            </div>
          `;
    
          Modal.open({
            title: window.I18N.translateArgs("online.playersTitle"),
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
            let entries = Object.entries(players || {}).filter(([uid]) => uid !== this.myUid);
    
            const NOW = Date.now();
            const MAX_AGE_MS = PRESENCE_LIST_TTL_MS;
            entries = entries.filter(([uid, p]) => {
              const ts = p && typeof p.updatedAt === "number" ? p.updatedAt : 0;
              return ts && NOW - ts <= MAX_AGE_MS;
            });
    
            if (!entries.length) {
              listEl.innerHTML = `<div class="muted">${window.I18N.translateArgs("online.noPlayers")}</div>`;
              return;
            }
    
            entries.forEach(([uid, p]) => {
              const nick = p && p.nickname ? p.nickname : uid.slice(0, 6);
              const st = p && p.status ? p.status : "available";
              const statusInfo = lobbyStatusInfo(p, activeRoomMapFromView(this._lastOfficialLobbyView), uid);
              const acceptsInvites = statusInfo.acceptsInvites;
              const stLabel = statusInfo.label;
    
              const row = document.createElement("div");
              row.style.display = "flex";
              row.style.alignItems = "center";
              row.style.justifyContent = "space-between";
              row.style.gap = "10px";
              row.innerHTML = `
                <div style="display:flex; flex-direction:column;">
                  <div style="font-weight:700;">${nick}</div>
                  <div class="muted" style="font-size:var(--fs-body);">${stLabel}</div>
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
            this._clearPendingInviteWatcher && this._clearPendingInviteWatcher();
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
    
          // Do not start a fast sender-side watch after sending the invite.
          // The accepted game is picked up from notifications.outgoingGames
          // on the next existing unified pulse.
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
            const text = window.I18N.translateArgs("online.invites.leaveActivePrompt", "أنت الآن في مباراة أونلاين نشطة. هل تريد مغادرة المباراة الحالية وإرسال الدعوة؟");
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
              title: window.I18N.translateArgs("online.pvpEndTitle", "نهاية المباراة"),
              body,
              allowEsc: true,
              onClose: (reason) => { if (reason !== "action") done(false); },
              buttons: [
                {
                  label: window.I18N.translateArgs("online.invites.leaveAndSend", "المغادرة والإرسال"),
                  className: "danger",
                  onClick: async () => {
                    try { if (Modal.setButtonsDisabled) Modal.setButtonsDisabled(true); } catch (e) {}
                    const ok = await this._leaveActiveMatchForInvite(gid);
                    done(ok);
                    try { Modal.close("action"); } catch (e) {}
                  },
                },
                {
                  label: window.I18N.translateArgs("online.invites.returnToMatch", "العودة إلى المباراة"),
                  className: "ok",
                  onClick: async () => {
                    done(false);
                    try { Modal.close("action"); } catch (e) {}
                    try { await this._returnToActiveMatch(gid); } catch (e) {}
                  },
                },
                {
                  label: window.I18N.translateArgs("actions.cancel", "إلغاء"),
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

    _joinGame: async function (gameId, entryRequest) {
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          this._applySessionState({
            active: true,
            spectator: false,
            side: +1,
            gameId,
            postMatch: false,
            postMatchShown: false,
            lastRematchSeq: null,
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
          await this._runUnifiedAppPulse(true, "enter-game");
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
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
            joinedOk = await this.syncNow({ reason: "join", repairPresence: false, notifyFailure: false });
            try { this._syncMyUidFromOfficialResult && this._syncMyUidFromOfficialResult(this._lastGameAccess); } catch (e) {}
          } catch (e) {
            joinedOk = false;
          }
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          if (!joinedOk) return await this._abortOnlineEntry("join-sync-failed");
          this._setOnlineButtonsState(true);
    
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
          try {
            var root = document.documentElement;
            if (!root || !root.classList) return;
            var self = this;
            var generation = Number(this._uiHoldGeneration || 0);
            var done = function () {
              try {
                if (generation !== Number(self._uiHoldGeneration || 0)) return;
                root.classList.remove("ui-hold");
                root.classList.remove("role-pending");
                root.classList.add("ui-ready");
                if (window.UI && typeof UI.updateAll === "function") UI.updateAll();
              } catch (e) {}
            };
            if (window.requestAnimationFrame) {
              requestAnimationFrame(function () {
                requestAnimationFrame(done);
              });
            } else {
              setTimeout(done, 0);
            }
          } catch (e) {}
        },

    _buildOnlineActionState: function (online) {
          const on = online !== false;
          const uiBlocked = !!(document.documentElement && document.documentElement.classList.contains("ui-hold"));
          return {
            online: on,
            spectator: on && !!this.isSpectator,
            uiBlocked,
            postMatch: on && !!this._inPostMatch,
            inChain: !!(typeof Game !== "undefined" && Game.inChain),
            myTurn: !on || !!(typeof Game !== "undefined" && Game.player === this.mySide),
            canUndo: on && !this.isSpectator && Number(this.moveIndex || 0) > 0,
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
            this._applyUiHold(true);
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

    _notifyMatchEndWatchers: async function (gameId, reason, fromNick) {
          // User events are not written by the browser. Match-end
          // state is authoritative in GameRoom and is delivered by listeners/broadcasts.
          return false;
        },

    endOnline: async function () {
          const asyncContext = this._captureAsyncContext(this.gameId);
          try {
            this._localEndedOnline = true;
          } catch (e) {}

          try {
            await tryFinalizeTrainingOnExit("abort", 900);
          } catch (e) {}
          if (!this._isAsyncContextCurrent(asyncContext)) return;

          const who = this.myNick || window.I18N.translateArgs("players.player");
          let res = null;
          try {
            // A player ending an active official PvP match closes the match neutrally.
            // GameRoom may adjudicate a winner only if the original late-exit
            // board conditions show a nearly decided position. The browser does
            // not write status, winner, result, log, or board state directly.
            res = await this._commitOfficialMatchEnd("leave", "ended_by_player");
          } catch (e) {
            try {
              showOnlineNotice(window.I18N.translateArgs("online.endFail"));
            } catch (_) {}
            handleDbError(e, window.I18N.translateArgs("online.endFail"), { ctx: "matchEnd.resign" });
            return;
          }

          if (!res || res.committed === false || !res.game || res.game.status !== "ended") {
            try { showOnlineNotice(window.I18N.translateArgs("online.endFail")); } catch (e) {}
            try { this._forceResync(); } catch (e) {}
            return;
          }

          try {
            if (this.gameId) this._lastGameData = res.game;
          } catch (e) {}

          try {
            await this._notifyMatchEndWatchers(this.gameId, res.game.endedReason || "ended_by_player", who);
          } catch (e) {}

          try {
            this._enterPostMatch({ reason: res.game.endedReason || "ended_by_player", byUid: this.myUid, byNick: who, endedBy: res.game.endedBy || null });
          } catch (e) {}
        },

    _clearPostMatchSession: function () {
          try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (e) {}
          try { this._clearPendingMoveOutbox && this._clearPendingMoveOutbox(); } catch (e) {}
          try { sessionStorage.removeItem("zamat.internalNavTs"); } catch (e) {}
          try { localStorage.removeItem("zamat.activeGameId"); } catch (e) {}
          try { localStorage.removeItem("zamat.activeGameTs"); } catch (e) {}
        },

    _enterPostMatch: function (meta) {
          try {
            this._clearPostMatchSession();
          } catch (e) {}
          this._applySessionState({
            postMatch: true,
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.POST_MATCH : null,
            newEpoch: false,
            reason: "online-post-match",
          });
    
          if (this._postMatchShown) return;
          this._applySessionState({ postMatchShown: true });
          const asyncContext = this._captureAsyncContext(this.gameId);
    
          const reason = (meta && (meta.reason || meta.endedReason)) || null;
          const endedBy = (meta && (meta.endedBy || meta.ended_by)) || null;
    
          const byUid = (meta && meta.byUid) || (endedBy && endedBy.uid) || null;
          let byNick = (meta && meta.byNick) || (endedBy && endedBy.nickname) || "";
          try {
            byNick = String(byNick || "").trim();
          } catch (e) {}
          if (!byNick) byNick = window.I18N.translateArgs("online.opponent", "Opponent");
    
          let winner = null;
          try {
            const g = this._lastGameData;
            if (g && typeof g.winner !== "undefined") winner = g.winner;
          } catch (e) {}
          try {
            if (winner == null && typeof Game !== "undefined" && typeof Game.winner !== "undefined")
              winner = Game.winner;
          } catch (e) {}
          try {
            if (winner === 0) winner = null;
          } catch (e) {}
    
          try {
            const rr = String(reason || "").trim();
            if (rr === "ended_by_player") {
              try {
                tryFinalizeTrainingOnExit("abort", 900);
              } catch (e) {}
            } else if (rr === "opponent_absent") {
              try {
                tryFinalizeTrainingOnExit("disconnect", 900);
              } catch (e) {}
            }
          } catch (e) {}
    
          if (reason === "ended_by_player") {
            if (byUid && this.myUid && byUid === this.myUid) {
              try {
                showOnlineNotice(window.I18N.translateArgs("buttons.endOnline"));
              } catch (e) {}
              return;
            }
    
            const title = window.I18N.translateArgs("online.pvpEndTitle", window.I18N.translateArgs("modals.gameOver.drawTitle"));
            const body = formatTpl(window.I18N.translateArgs("online.matchEndedByPlayer", "Player {player} ended the match{reason}."), {
              player: byNick,
              reason: "",
            });
    
            const go = async () => {
              try {
                if (!this._isAsyncContextCurrent(asyncContext)) return;
                await this.exitToMode();
              } catch (e) {}
            };
    
            try {
              if (typeof Modal !== "undefined" && Modal && typeof Modal.alert === "function") {
                Modal.alert({
                  title,
                  text: body,
                  okLabel: window.I18N.translateArgs("actions.ok", "OK"),
                  okClassName: "ok",
                  allowSpectator: true,
                  priority: 90,
                  blocking: true,
                  onClick: go,
                  onClose: (reason) => {
                    if (reason === "dismiss") go();
                  },
                });
                return;
              }
            } catch (e) {}
    
            try {
              showOnlineNotice(body);
            } catch (e) {}
            try {
              go();
            } catch (e) {}
            return;
          }
    
          if (!this._isNaturalOnlineEndReason(reason)) {
            try {
              const msg = reason === "opponent_absent"
                ? formatTpl(window.I18N.translateArgs("online.matchEndedByPlayer"), {
                    player: byNick || this.myNick || window.I18N.translateArgs("players.player"),
                    reason: window.I18N.translateArgs("online.matchEndedReason.absent"),
                  })
                : window.I18N.translateArgs("online.errors.noGame");
              showOnlineNotice(msg, { allowSpectator: true });
            } catch (e) {}
            try {
              setTimeout(() => {
                try { if (this._isAsyncContextCurrent(asyncContext)) this.exitToMode(); } catch (e) {}
              }, 900);
            } catch (e) {}
            return;
          }
    
          try {
            if (typeof UI !== "undefined" && UI && typeof UI.showGameOverModal === "function") {
              UI.showGameOverModal(winner == null ? null : winner);
              return;
            }
          } catch (e) {}
    
          try {
            showOnlineNotice(window.I18N.translateArgs("modals.gameOver.drawTitle"));
          } catch (e) {}
        },

    _onRematchStarted: function () {
          this._applySessionState({ postMatch: false, postMatchShown: false });
          this._localEndedOnline = false;
          this._rematchRequestedAt = 0;
          this._rematchPending = false;
          this._pendingSteps = [];
          this._cachedSouflaPlain = null;
          try { this._clearCaptureDraft(); } catch (e) {}
          try { this._clearPendingMoveOutbox(); } catch (e) {}
          try { this._markLocalCommitSettled(); } catch (e) {}
          try {
            if (typeof Modal !== "undefined" && Modal && typeof Modal.close === "function") Modal.close("state-change");
          } catch (e) {}
          try {
            if (window.DhametMatchCoordinator) {
              this._applySessionState({
                phase: this.isSpectator ? DhametMatchCoordinator.phases.ONLINE_SPECTATOR : DhametMatchCoordinator.phases.ONLINE_PLAYER,
                reason: "online-rematch",
              });
              DhametMatchCoordinator.resetPresentation({ draw: true });
            }
          } catch (e) {}
          try {
            Turn && (Turn.ctx = null);
            Game.inChain = false;
            Game.chainPos = null;
            Game.killTimer && Game.killTimer.hardStop && Game.killTimer.hardStop();
          } catch (e) {}
          try { this._setOnlineButtonsState(true, { keepBlocked: true }); } catch (e) {}
        },

    _getOpponentInfoFromData: function (data) {
          try {
            const players = data && data.players ? data.players : data;
            if (!players) return { uid: null, nick: "" };
            const w = players.white || {};
            const b = players.black || {};
            if (this.myUid) {
              if (w.uid === this.myUid) return { uid: b.uid || null, nick: b.nickname || "" };
              if (b.uid === this.myUid) return { uid: w.uid || null, nick: w.nickname || "" };
            }
            if (this.mySide === -1) return { uid: b.uid || null, nick: b.nickname || "" };
            if (this.mySide === +1) return { uid: w.uid || null, nick: w.nickname || "" };
            if (w.uid) return { uid: w.uid || null, nick: w.nickname || "" };
            if (b.uid) return { uid: b.uid || null, nick: b.nickname || "" };
          } catch (e) {}
          return { uid: null, nick: "" };
        },

    _getOpponentInfo: async function () {
          let opp = { uid: null, nick: "" };
          try {
            opp = this._getOpponentInfoFromData(this._lastGameData);
          } catch (e) {}
          if (!opp.uid && this.gameRef) {
            try {
              const ps = await this.gameRef.child("players").once("value");
              const pl = ps && ps.val ? ps.val() : null;
              opp = this._getOpponentInfoFromData(pl);
            } catch (e) {}
          }
          return opp;
        },


    _commitOfficialRematch: async function (kind, options) {
          if (!this.gameId || !window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitRematch !== "function") {
            throw new Error("rematch/client-unavailable");
          }
          const opts = options && typeof options === "object" ? options : {};
          const ts = Date.now();
          const baseMoveIndex = Number(
            opts.baseMoveIndex != null
              ? opts.baseMoveIndex
              : ((this._lastGameData && this._lastGameData.moveIndex) || 0)
          ) || 0;
          const clientRematchId =
            opts.clientRematchId ||
            ["rematch", kind || "action", this.myUid || "anon", this.gameId || "game", ts, Math.random().toString(36).slice(2, 8)].join(":");
          return window.DhametGameRoomClient.commitRematch({
            gameId: opts.gameId || this.gameId,
            kind,
            clientRematchId,
            baseMoveIndex,
            by: this.mySide,
            nick: opts.nick || this.myNick || window.I18N.translateArgs("players.player"),
            accept: opts.accept,
            reason: opts.reason,
          });
        },

    _respondOfficialRematch: async function (accept, requestLike) {
          const req = requestLike && typeof requestLike === "object" ? requestLike : {};
          const targetGameId = String(req.gameId || this.gameId || "");
          const asyncContext = this._captureAsyncContext(targetGameId);
          const me = this.myNick || window.I18N.translateArgs("players.player");
          const data = await this._commitOfficialRematch("rematch-respond", {
            gameId: targetGameId,
            accept: !!accept,
            nick: me,
          });
          if (!this._isAsyncContextCurrent(asyncContext)) return data;
          try { this._noteOnlineGameTransportActivity && this._noteOnlineGameTransportActivity("rematch"); } catch (e) {}
          if (data && data.game) {
            const applied = this._ingestOfficialGame(data.game, {
              source: "rematch-response",
              gameId: targetGameId,
              version: data.version != null ? data.version : data.game.__transportVersion,
              rejectDuplicate: false,
            });
            if (!applied) try { this._forceResync("rematch-response"); } catch (e) {}
          } else if (accept) {
            try { this._forceResync("rematch-response-missing-game"); } catch (e) {}
          }
          showOnlineNotice(window.I18N.translateArgs(accept ? "online.rematch.accepted" : "online.rematch.rejected"));
          return data;
        },

    _handleOfficialRematchRequest: function (data) {
          try {
            const rr = data && data.rematchRequest;
            if (!rr || typeof rr !== "object") {
              this._officialRematchPromptKey = null;
              return;
            }
            const status = String(rr.status || "").toLowerCase();
            const requesterUid = String(rr.requesterUid || "");
            const key = [status, requesterUid, rr.requestedAt || 0, rr.respondedAt || 0].join(":");

            if (status === "pending" || status === "active") {
              if (requesterUid && requesterUid === String(this.myUid || "")) {
                this._rematchPending = true;
                return;
              }
              if (this.isSpectator || !this.isActive || !this.gameId) return;
              if (this._officialRematchPromptKey === key) return;
              this._officialRematchPromptKey = key;

              const fromName = rr.requesterNick || window.I18N.translateArgs("players.player");
              const title = window.I18N.translateArgs("online.rematch.title");
              const body = window.I18N.translateArgs("online.rematch.body", { fromName });
              const plainText = (html) => {
                try {
                  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                } catch (e) {
                  return String(html || "");
                }
              };

              let modalSettled = false;
              const accept = async () => {
                modalSettled = true;
                try { await this._respondOfficialRematch(true, rr); }
                catch (e) {
                  try { handleDbError(e); } catch (_) {}
                  showOnlineNotice(window.I18N.translateArgs("online.rematch.resetFail"));
                }
              };
              const reject = async () => {
                modalSettled = true;
                try { await this._respondOfficialRematch(false, rr); }
                catch (e) {
                  try { handleDbError(e); } catch (_) {}
                  showOnlineNotice(window.I18N.translateArgs("online.rematch.rejected"));
                }
              };

              if (typeof Modal === "undefined" || !Modal || typeof Modal.open !== "function") {
                const ok = window.confirm(String(title || "") + "\n\n" + plainText(body));
                if (ok) accept();
                else reject();
                return;
              }

              Modal.open({
                title,
                body: `<div>${body}</div>`,
                priority: 75,
                blocking: true,
                buttons: [
                  { label: window.I18N.translateArgs("actions.accept"), className: "ok", onClick: async () => { modalSettled = true; Modal.close("action"); await accept(); } },
                  { label: window.I18N.translateArgs("actions.reject"), className: "ghost", onClick: async () => { modalSettled = true; Modal.close("action"); await reject(); } },
                ],
                onClose: async (reason) => {
                  if (modalSettled || reason === "replaced" || reason === "state-change") return;
                  try { await reject(); } catch (e) {}
                },
              });
              return;
            }

            if (status === "rejected" && requesterUid && requesterUid === String(this.myUid || "")) {
              if (this._officialRematchRejectedKey === key) return;
              this._officialRematchRejectedKey = key;
              this._rematchPending = false;
              showOnlineNotice(window.I18N.translateArgs("online.rematch.rejected"));
              try { this.exitToMode(); } catch (e) {}
            }
          } catch (e) {}
        },

    requestRematch: async function () {
          if (!this.isActive || !this.gameId) return;
          if (this.isSpectator) return;

          const now = Date.now();
          if (this._rematchRequestedAt && now - this._rematchRequestedAt < 1500) return;
          this._rematchRequestedAt = now;
          const asyncContext = this._captureAsyncContext(this.gameId);

          let opp = { uid: null, nick: "" };
          try { opp = await this._getOpponentInfo(); } catch (e) {}
          if (!this._isAsyncContextCurrent(asyncContext)) return;
          if (!opp.uid) {
            showOnlineNotice(window.I18N.translateArgs("online.noOpponent"));
            return;
          }

          const who = this.myNick || window.I18N.translateArgs("players.player");
          try {
            const data = await this._commitOfficialRematch("rematch-request", { nick: who });
            if (!this._isAsyncContextCurrent(asyncContext)) return;
            if (data && data.game) {
              this._ingestOfficialGame(data.game, {
                source: "rematch-request",
                gameId: asyncContext.gameId,
                version: data.version != null ? data.version : data.game.__transportVersion,
                rejectDuplicate: false,
              });
            }
            this._rematchPending = true;
            showOnlineNotice(window.I18N.translateArgs("online.rematch.sent"));
          } catch (e) {
            try { handleDbError(e); } catch (e2) {}
            showOnlineNotice(window.I18N.translateArgs("online.rematch.fail"));
            try {
              const st = this._lastGameData && this._lastGameData.status;
              const ended = !!(this._inPostMatch || this._localEndedOnline || (st && st !== "active"));
              if (ended) {
                try { await this.exitToMode(); } catch (e2) {}
              }
            } catch (e2) {}
          }
        },

    _resetRoomForRematch: async function (gameId, actorNick) {
          const data = await this._commitOfficialRematch("rematch-respond", {
            gameId,
            accept: true,
            nick: actorNick || this.myNick || window.I18N.translateArgs("players.player"),
          });
          return data;
        },

    _acceptRematchInvite: async function (inv, snapRef) {
          if (!this.isActive || !this.gameId || (inv && inv.gameId && inv.gameId !== this.gameId)) return;
          if (this.isSpectator) return;

          const asyncContext = this._captureAsyncContext(this.gameId);
          const me = this.myNick || window.I18N.translateArgs("players.player");
          try {
            const data = await this._resetRoomForRematch(asyncContext.gameId, me);
            if (!this._isAsyncContextCurrent(asyncContext)) return;
            if (data && data.game) {
              const applied = this._ingestOfficialGame(data.game, {
                source: "rematch-accept",
                gameId: asyncContext.gameId,
                version: data.version != null ? data.version : data.game.__transportVersion,
                rejectDuplicate: false,
              });
              if (!applied) this._forceResync("rematch-accept");
            } else {
              this._forceResync("rematch-accept-missing-game");
            }
          } catch (e) {
            if (!this._isAsyncContextCurrent(asyncContext)) return;
            try { handleDbError(e); } catch (e2) {}
            showOnlineNotice(window.I18N.translateArgs("online.rematch.resetFail"));
          }
        },

    _rejectRematchInvite: async function (inv, snapRef) {
          const asyncContext = this._captureAsyncContext((inv && inv.gameId) || this.gameId);
          try {
            if (this.isActive && this.gameId && (!inv || !inv.gameId || inv.gameId === this.gameId)) {
              await this._respondOfficialRematch(false, inv || {});
            } else {
              showOnlineNotice(window.I18N.translateArgs("online.rematch.rejected"));
            }
          } catch (e) {
            try { handleDbError(e); } catch (e2) {}
            showOnlineNotice(window.I18N.translateArgs("online.rematch.rejected"));
          }
          if (!this._isAsyncContextCurrent(asyncContext)) return;
          try { await this.exitToMode(); } catch (e) {}
        },

    exitToMode: async function () {
          this._applySessionState({
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.LEAVING : null,
            reason: "online-exit-to-mode",
          });
          try { if (typeof Modal !== "undefined" && Modal && Modal.close) Modal.close("state-change"); } catch (e) {}
          try { this._clearPostMatchSession(); } catch (e) {}

          const gid = this.gameId || this._presenceRoomId;
          const uid = this.myUid;
          const wasSpectator = !!this.isSpectator;

          try {
            if (gid && uid && wasSpectator) await this._removeSpectatorRegistration(gid, uid);
          } catch (e) {}
          try { this._unbindGameLiveSubscription && this._unbindGameLiveSubscription(); } catch (e) {}
          try { this._teardownRoomComms && this._teardownRoomComms(); } catch (e) {}
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
            presenceRoomId: null,
          });
          try {
            if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: false });
          } catch (e) {}
          try { await this._setLobbyStatus("available"); } catch (e) {}

          try {
            const inPages = (location.pathname || "").includes("/pages/");
            const target = inPages ? "mode.html" : "pages/mode.html";
            if (typeof location.replace === "function") location.replace(target);
            else location.href = target;
          } catch (e) {}
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
              try {
                await this._removeSpectatorRegistration(gid, uid);
              } catch (e) {}
              if (!this._isAsyncContextCurrent(asyncContext)) return;
            } else {
              try {
                await this.endOnline();
              } catch (e) {}
              if (!this._isAsyncContextCurrent(asyncContext)) return;
              try {
                await this.exitToMode();
              } catch (e) {}
              return;
            }
    
            try {
              this._teardownRoomComms();
            } catch (e) {}
            try {
              this.gameRef && this.gameRef.off();
            } catch (e) {}
    
            try {
              this._clearPersistedActiveGame();
            } catch (e) {}
            this._applySessionState({
              active: false,
              spectator: false,
              gameId: null,
              gameRef: null,
              side: null,
            });
            try {
              this._setOnlineButtonsState(false);
            } catch (e) {}
    
            this._applySessionState({
              presenceStatus: "available",
              presenceRole: "lobby",
              presenceRoomId: null,
            });
            try { await this._runUnifiedAppPulse(true); } catch (e) {}
    
            try {
              const back = (location.pathname || "").includes("/pages/")
                ? "./loby.html"
                : "pages/loby.html";
              location.href = back;
            } catch (e) {}
          } catch (e) {}
        },

    _teardownOnlineSubscriptions: function () {
          try { this._teardownRoomComms(); } catch (e) {}
          try { this._stopOpponentAbsenceWatcher(); } catch (e) {}
          try { this.gameRef && this.gameRef.off(); } catch (e) {}
          try { this._unbindInvitePreferenceListener(); } catch (e) {}
          try { this._lobbyPlayersRef && this._lobbyPlayersCb && this._lobbyPlayersRef.off("value", this._lobbyPlayersCb); } catch (e) {}
          try { this._lobbyRoomsRef && this._lobbyRoomsCb && this._lobbyRoomsRef.off("value", this._lobbyRoomsCb); } catch (e) {}
          this._lobbyPlayersRef = null;
          this._lobbyPlayersCb = null;
          this._lobbyRoomsRef = null;
          this._lobbyRoomsCb = null;
          try { this._stopOutgoingInviteWatches(); } catch (e) {}
          try { this._teardownGamePresence(); } catch (e) {}
        },

    _resetOnlineRuntimeState: function () {
          try { this._clearCaptureDraft && this._clearCaptureDraft(); } catch (e) {}
          this._applySessionState({
            phase: window.DhametMatchCoordinator ? DhametMatchCoordinator.phases.LEAVING : null,
            reason: "online-reset",
          });
          this._lastTrainLoggedMoveIndex = 0;
          this._localEndedOnline = false;
          this._selfConnected = true;
          this._oppOnline = true;
          this._applySessionState({
            active: false,
            spectator: false,
            gameId: null,
            gameRef: null,
            side: null,
          });
          this._pendingSteps = [];
          this._cachedSouflaPlain = null;
          this._isApplyingRemote = false;
          try { this._clearPersistedActiveGame(); } catch (e) {}
          try { this._clearPresenceUi(); } catch (e) {}
          try { this._markLocalCommitSettled(); } catch (e) {}
          this._setOnlineButtonsState(false);
        },

    _setPresenceMode: function (status, role, roomId, ctx) {
          this._applySessionState({
            presenceStatus: status || (S.isPvCGamePage && S.isPvCGamePage() ? "vsComputer" : "available"),
            presenceRole: role || null,
            presenceRoomId: roomId || null,
          });
          try { this._runUnifiedAppPulse && this._runUnifiedAppPulse(true); } catch (e) {}
        },


    _unbindGameLiveSubscription: function () {
          try {
            if (this._gameLiveSub && typeof this._gameLiveSub.close === "function") this._gameLiveSub.close();
          } catch (e) {}
          this._gameLiveSub = null;
        },

    _bindGameListeners: function () {
          const gid = String(this.gameId || "").trim();
          if (!gid) return;
          this._unbindGameLiveSubscription();
          try {
            if (this.gameRef && typeof this.gameRef.off === "function") this.gameRef.off();
          } catch (e) {}
          try {
            this._setupGamePresence();
          } catch (e) {}
          try {
            this._startOpponentAbsenceWatcher();
          } catch (e) {}
          const liveContext = this._captureAsyncContext(gid);
          const onLiveGame = (data, envelope) => {
            if (!this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) return;
            if (!data) {
              try { this._verifyMissingOfficialGame(); } catch (e) {}
              return;
            }
            try {
              this._ingestOfficialGame(data, {
                source: "live",
                gameId: gid,
                version: envelope && envelope.version,
                rejectDuplicate: true,
              });
            } catch (e) {
              try { Logger.warn("official_live_apply_failed", { gameId: gid, err: String(e && (e.message || e)) }); } catch (_) {}
            }
          };
          try {
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.subscribeGameLive !== "function") throw new Error("live-client-missing");
            this._gameLiveSub = window.DhametGameRoomClient.subscribeGameLive({
              gameId: gid,
              onData: onLiveGame,
              onClose: () => {
                try {
                  if (this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) this._forceResync && this._forceResync("live-closed");
                } catch (e) {}
              },
              onReconnect: () => {
                try {
                  if (this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) this._forceResync && this._forceResync("live-reconnected");
                } catch (e) {}
              },
              onError: () => {
                try { if (this._isAsyncContextCurrent(liveContext, { ignorePostMatch: true })) this._forceResync && this._forceResync("live-error"); } catch (e) {}
              },
            });
          } catch (e) {
            Logger.warn("game_live_subscribe_failed", { gameId: gid, err: String(e && (e.message || e)) });
            try { this._forceResync && this._forceResync("live-subscribe-failed"); } catch (_) {}
          }
    
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

    _applyRemoteState: function (data, options) {
          try {
            this._isApplyingRemote = true;
            const applyOptions = options && typeof options === "object" ? options : {};
            const skipFx = !!applyOptions.skipFx;
    
            try {
              const remoteMI = Number(
                (data && (data.moveIndex ?? (data.lastMove && data.lastMove.moveIndex))) ?? 0,
              );
              if (this._awaitingLocalCommit && Number.isFinite(this._expectedMoveIndex)) {
                if (remoteMI < this._expectedMoveIndex) {
                  return;
                }
                this._markLocalCommitSettled();
              }
            } catch (e) {}
            const snap = data && data.state ? data.state.snapshot : null;
            if (!snap) return;
    
            try {
              this._maybeRecordOpponentMoveForTraining(data);
            } catch (e) {}
    
            try { if (typeof resetTransientGameState === "function") resetTransientGameState(); } catch (e) {}
            restoreSnapshot(snap, { redraw: false, visual: false });
    
            try {
              const lm = data && data.lastMove ? data.lastMove : null;
                const curSide =
                  snap && typeof snap.player === "number"
                    ? snap.player
                    : typeof data.turn === "number"
                      ? data.turn
                      : null;
                const lastSide =
                  curSide != null ? -curSide : lm && typeof lm.by === "number" ? lm.by : null;
    
                if (lm && lm.kind === "undo" && typeof Visual !== "undefined" && Visual) {
                  const fr = lm.undoneFrom != null ? lm.undoneFrom : null;
                  const p = Array.isArray(lm.undonePath) ? lm.undonePath : null;
                  if (fr != null && p && p.length && typeof Visual.setUndoMovePath === "function") {
                    Visual.setUndoMovePath(fr, p);
                  } else if (fr != null && p && p.length && typeof Visual.setUndoMove === "function") {
                    Visual.setUndoMove(fr, p[p.length - 1]);
                  } else {
                    try {
                      Visual.setUndoMove && Visual.setUndoMove(null, null);
                    } catch (e) {}
                  }
                  try {
                    if (typeof Visual.markTurnBoundary === "function") Visual.markTurnBoundary();
                  } catch (e) {}
                } else {
                  try {
                    if (lastSide != null) Game.lastMoveSide = lastSide;
                  } catch (e) {}
                  try {
                    let fr = null;
                    let p = null;
    
                    if (lm && lm.from != null && Array.isArray(lm.path) && lm.path.length) {
                      fr = lm.from;
                      p = lm.path;
                    } else {
                      fr =
                        snap.lastMoveFrom != null
                          ? snap.lastMoveFrom
                          : snap.lastMovedFrom != null
                            ? snap.lastMovedFrom
                            : null;
                      p =
                        Array.isArray(snap.lastMovePath) && snap.lastMovePath.length
                          ? snap.lastMovePath
                          : snap.lastMovedTo != null
                            ? [snap.lastMovedTo]
                            : null;
                    }
    
                    if (fr != null && p && p.length && typeof Visual !== "undefined" && Visual) {
                      if (typeof Visual.setLastMovePath === "function")
                        Visual.setLastMovePath(fr, p, lastSide);
                      else if (typeof Visual.setLastMove === "function")
                        Visual.setLastMove(fr, p[p.length - 1], lastSide);
                      try {
                        if (typeof Visual.markTurnBoundary === "function") Visual.markTurnBoundary();
                      } catch (e) {}
                    } else {
                      try {
                        Visual && Visual.setLastMove && Visual.setLastMove(null, null);
                      } catch (e) {}
                    }
                  } catch (e) {}
                }
            } catch (e) {}
    
            try {
              if (
                typeof UI !== "undefined" &&
                UI &&
                typeof UI.updateCounts === "function" &&
                Game &&
                Array.isArray(Game.board)
              ) {
                let top = 0,
                  bot = 0,
                  tKings = 0,
                  bKings = 0;
                for (let r = 0; r < Game.board.length; r++) {
                  const row = Game.board[r];
                  if (!Array.isArray(row)) continue;
                  for (let c = 0; c < row.length; c++) {
                    const v = row[c];
                    if (!v) continue;
                    if (v > 0) {
                      top++;
                      if (Math.abs(v) === 2) tKings++;
                    } else if (v < 0) {
                      bot++;
                      if (Math.abs(v) === 2) bKings++;
                    }
                  }
                }
                UI.updateCounts({ top, bot, tKings, bKings });
              }
            } catch (e) {}
    
            try {
              const queue = deferredPromotionQueue(data && data.state);
              Game.deferredPromotions = queue;
              Game.deferredPromotion = queue.length ? Object.assign({}, queue[0]) : null;
            } catch (e) {}
    
            try {
              if (!skipFx && data.state && Array.isArray(data.state.capturedOrder)) {
                try {
                  if (
                    typeof Visual !== "undefined" &&
                    Visual &&
                    typeof Visual.setCapturedOrder === "function"
                  )
                    Visual.setCapturedOrder(data.state.capturedOrder);
                } catch (e) {}
              }
            } catch (e) {}
            try {
              this._resumeOfficialTurn();
            } catch (error) {
              try { Logger.warn("official_turn_resume_failed", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
            }
    
            try {
              const lm = data.lastMove;
              const mi = lm && typeof lm.moveIndex === "number" ? lm.moveIndex : 0;
              if (mi && mi > (this._lastSeenMoveModal || 0)) {
                this._lastSeenMoveModal = mi;
                if (lm.kind === "soufla" && lm.decision) {
                  try {
                    if (
                      typeof TrainRecorder !== "undefined" &&
                      TrainRecorder &&
                      typeof TrainRecorder.rollbackLastMoveBoundary === "function"
                    ) {
                      if (mi && mi > 0 && !this._lastTrainRollbackEventMI_sf)
                        this._lastTrainRollbackEventMI_sf = 0;
                      if (!mi || mi <= (this._lastTrainRollbackEventMI_sf || 0)) {
                      } else {
                        this._lastTrainRollbackEventMI_sf = mi;
                        const undoneMI = (mi | 0) - 1;
                        try {
                          TrainRecorder.rollbackLastMoveBoundary({
                            type: "ext_move",
                            moveIndex: undoneMI,
                          });
                        } catch (e) {}
                      }
                    }
                  } catch (e) {}
                  this._showSouflaModalFromLastMove(lm);
                } else if (lm.kind === "undo") {
                  try {
                    if (
                      typeof TrainRecorder !== "undefined" &&
                      TrainRecorder &&
                      typeof TrainRecorder.rollbackLastMoveBoundary === "function"
                    ) {
                      if (mi && mi > 0 && !this._lastTrainRollbackEventMI_undo)
                        this._lastTrainRollbackEventMI_undo = 0;
                      if (!mi || mi <= (this._lastTrainRollbackEventMI_undo || 0)) {
                      } else {
                        this._lastTrainRollbackEventMI_undo = mi;
                        const undoneMI = (mi | 0) - 1;
                        let ok = false;
                        try {
                          ok = TrainRecorder.rollbackLastMoveBoundary({
                            type: "ext_move",
                            moveIndex: undoneMI,
                          });
                        } catch (e) {}
                        if (!ok) {
                          try {
                            TrainRecorder.rollbackLastMoveBoundary();
                          } catch (e) {}
                        }
                      }
                    }
                  } catch (e) {}
                  showOnlineNotice(window.I18N.translateArgs("undo.applied"));
                }
              }
    
              try {
                const lm2 = data.lastMove;
                const mi2 = lm2 && typeof lm2.moveIndex === "number" ? lm2.moveIndex : 0;
    
                if (lm2 && lm2.kind === "soufla" && lm2.souflaMeta && lm2.souflaMeta.fx) {
                  const fx = lm2.souflaMeta.fx;
                  this._lastSouflaFXMoveIndex = mi2 || this._lastSouflaFXMoveIndex;
    
                  try {
                    if (typeof Visual !== "undefined" && Visual && Visual.clearSouflaFX) {
                      Visual.clearSouflaFX();
                    }
                  } catch (e) {}
    
                  try {
                    if (fx && Array.isArray(fx.redPaths) && fx.redPaths.length) {
                      Visual.setSouflaIgnoredPaths && Visual.setSouflaIgnoredPaths(fx.redPaths);
                    } else if (fx && fx.red && fx.red.from != null) {
                      Visual.setSouflaIgnoredPaths &&
                        Visual.setSouflaIgnoredPaths([
                          { from: fx.red.from, path: [fx.red.to], jumps: [] },
                        ]);
                    }
                  } catch (e) {}
    
                  try {
                    if (fx && fx.undoArrow && fx.undoArrow.from != null) {
                      if (Array.isArray(fx.undoArrow.path) && fx.undoArrow.path.length) {
                        Visual.setSouflaUndoArrow &&
                          Visual.setSouflaUndoArrow(fx.undoArrow.from, fx.undoArrow.path);
                      } else if (fx.undoArrow.to != null) {
                        Visual.setSouflaUndoArrow &&
                          Visual.setSouflaUndoArrow(fx.undoArrow.from, fx.undoArrow.to);
                      }
                    }
                  } catch (e) {}
    
                  try {
                    if (fx && fx.removeIdx != null) {
                      Visual.setSouflaRemove && Visual.setSouflaRemove(fx.removeIdx);
                    }
                  } catch (e) {}
    
                  try {
                    if (fx && Array.isArray(fx.forcePath) && fx.forcePath.length) {
                      Visual.setSouflaForcePath && Visual.setSouflaForcePath(fx.forcePath);
                    }
                  } catch (e) {}
                } else if (
                  this._lastSouflaFXMoveIndex != null &&
                  mi2 &&
                  mi2 > this._lastSouflaFXMoveIndex
                ) {
                  try {
                    if (typeof Visual !== "undefined" && Visual && Visual.clearSouflaFX) {
                      Visual.clearSouflaFX();
                    }
                  } catch (e) {}
                  this._lastSouflaFXMoveIndex = null;
                }
              } catch (e) {}
            } catch (e) {}
          } catch (e) {
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

    _publishSpectatorCount: async function (gameId, count) {
          // Spectator count is now calculated and published by /dhamet/api/lobby/spectator.
          // The client deliberately no longer writes games/<id>/spectatorCount or roomList/<id>.
          return false;
        },

    _countSpectatorsFromValue: function (value) {
          if (window.DhametSpectators && typeof window.DhametSpectators.countSpectators === "function") {
            return window.DhametSpectators.countSpectators(value);
          }
          if (!value || typeof value !== "object") return 0;
          return Object.keys(value).filter((k) => value[k]).length;
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
              return { ok: false, reason: result && /full/.test(String(result.error || "")) ? "full" : "error", error: result };
            }
            const own = result.spectator || { uid, nickname: nick, joinedAt: fallbackJoinedAt };
            this._spectatorJoinedAt = Number(own.joinedAt || fallbackJoinedAt) || fallbackJoinedAt;
            this._spectatorRef = null;
            const count = Number(result.count || result.spectatorCount || 0) || 0;
            this._lastSpectatorRegistration = { ok: true, gameId: gid, uid, at, count };
            return { ok: true, gameId: gid, uid, ref: null, count };
          } catch (e) {
            const code = String((e && (e.code || e.message)) || "");
            handleDbError(e, window.I18N.translateArgs("online.errors.spectatorJoinFailed"), { ctx: "spectator.join" });
            return { ok: false, reason: /full/.test(code) ? "full" : "error", error: e };
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
          try { this._runUnifiedAppPulse && this._runUnifiedAppPulse(true); } catch (e) {}
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
                  }).catch(() => {
                    try {
                      if (this._voice) this._voice.writeDenied = true;
                    } catch (_) {}
                  });
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
              if ((!this._chatLiveSub || this._chatLiveGameId !== this.gameId) && typeof this._initRoomComms === "function") {
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
    
            const wName =
              (this._lastGameData &&
                this._lastGameData.players &&
                this._lastGameData.players.white &&
                this._lastGameData.players.white.nickname) ||
              "";
            const bName =
              (this._lastGameData &&
                this._lastGameData.players &&
                this._lastGameData.players.black &&
                this._lastGameData.players.black.nickname) ||
              "";
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
    
                const otherReadTs =
                  this._chat && typeof this._chat._otherLastReadTs === "number"
                    ? this._chat._otherLastReadTs
                    : 0;
    
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
    
                if ((!this._chatLiveSub || this._chatLiveGameId !== this.gameId) && typeof this._initRoomComms === "function") {
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
              if (!this._chatLiveSub || this._chatLiveGameId !== this.gameId) {
                try { if (this._chatLiveSub && this._chatLiveSub.close) this._chatLiveSub.close(); } catch (e) {}
                this._chatLiveSub = null;
                this._chatLiveGameId = this.gameId;
                if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.subscribeChatLive !== "function") {
                  throw new Error("chat_live_transport_unavailable");
                }
                this._chatLiveSub = window.DhametGameRoomClient.subscribeChatLive({
                  gameId: this.gameId,
                  onData: applyChatSnapshot,
                  onError: () => {},
                  onClose: () => {},
                });
              }
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
                // Keep only a passive RTC watch so this player can auto-listen if
                // the opponent starts talking first.
                if (!this.isSpectator && typeof this._voiceWatchRemoteStart === "function") this._voiceWatchRemoteStart();
              } catch (e) {}
            }

            try { this.refreshPvpControls(); } catch (e) {}
          } catch (e) {}
        },

    _teardownRoomComms: function () {
          try {
            if (this._chatLiveSub && this._chatLiveSub.close) this._chatLiveSub.close();
          } catch (e) {}
          this._chatLiveSub = null;
          this._chatLiveGameId = null;
          this._chatMsgHandler = null;
          this._chatRef = null;
          this._chatMessagesRef = null;
          this._chatMessagesQuery = null;
          this._chatReadsRef = null;
          this._chatMyReadRef = null;
          this._chatReadsHandler = null;

          try { this._voiceLeave(); } catch (e) {}
          try { if (this._voicePassiveSub && this._voicePassiveSub.close) this._voicePassiveSub.close(); } catch (e) {}
          this._voicePassiveSub = null;
          this._voicePassiveGameId = null;

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

    _voiceShowFailureNotice: function () {
          try {
            showOnlineNotice(
              window.I18N.translateArgs(
                "pvp.voice.failedBody",
                "تعذر تشغيل الدردشة الصوتية. تحقق من إذن الميكروفون ثم أعد المحاولة.",
              ),
              {
                title: window.I18N.translateArgs("pvp.voice.failedTitle", "فشل الدردشة الصوتية"),
                allowSpectator: true,
              },
            );
          } catch (e) {}
        },

    _voiceWatchRemoteStart: function () {
          try {
            if (!this.isActive || !this.gameId || this.isSpectator) return false;
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.subscribeRtcLive !== "function") return false;
            if (this._voice && this._voice.enabled) return true;
            if (this._voicePassiveSub && this._voicePassiveGameId === this.gameId) return true;
            try { if (this._voicePassiveSub && this._voicePassiveSub.close) this._voicePassiveSub.close(); } catch (e) {}
            this._voicePassiveSub = null;
            this._voicePassiveGameId = this.gameId;
            const maybeAutoListen = (value) => {
              try {
                if (!this.isActive || !this.gameId || this.isSpectator) return;
                if (this._voice && this._voice.enabled) return;
                const root = value && typeof value === "object" ? value : {};
                const participants = root.participants && typeof root.participants === "object" ? root.participants : {};
                const hasRemotePlayer = Object.keys(participants).some((uid) => {
                  try {
                    const rec = participants[uid];
                    return String(uid) !== String(this.myUid || "") && rec && String(rec.role || "player") === "player";
                  } catch (e) { return false; }
                });
                if (!hasRemotePlayer) return;
                this._voiceJoin({ noMicPrompt: true, allowSpectatorMic: false, passiveListen: true }).catch(() => {});
              } catch (e) {}
            };
            this._voicePassiveSub = window.DhametGameRoomClient.subscribeRtcLive({
              gameId: this.gameId,
              onData: maybeAutoListen,
              onError: () => {},
              onClose: () => {},
            });
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
          try { if (this._voicePassiveSub && this._voicePassiveSub.close) this._voicePassiveSub.close(); } catch (e) {}
          this._voicePassiveSub = null;
          this._voicePassiveGameId = null;
    
          let authReady = false;
          try {
            authReady = await ensureAuthReady();
          } catch (e) {}
          if (!authReady || !requireAuthUid(this.myUid)) {
            this._voiceShowFailureNotice();
            return false;
          }
    
          let acquiredLocalStream = false;
          if (!opts.noMicPrompt) {
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
              this._voiceShowFailureNotice();
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
          try { if (this.myUid) this._voiceKnownParticipants.add(this.myUid); } catch (e) {}

          this._voiceParticipantsReady = false;
          try {
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitRtcParticipant !== "function") {
              throw new Error("rtc_transport_unavailable");
            }
            const res = await window.DhametGameRoomClient.commitRtcParticipant({
              gameId: this.gameId,
              nickname: this.myNick || "",
              micMuted: !!this._voice.micMuted,
              clientSignalId: [this.myUid || "u", this.gameId || "g", "participant", Date.now()].join(":"),
            });
            if (res && res.ok !== false) {
              this._voiceParticipantsReady = true;
              this._voiceLastParticipantMicMuted = !!this._voice.micMuted;
            }
            else throw new Error((res && res.error) || "rtc_participant_failed");
          } catch (e) {
            try { if (this._voice) this._voice.writeDenied = true; } catch (_) {}
            if (acquiredLocalStream) this._voiceReleaseLocalStream();
            this._voiceShowFailureNotice();
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
                const ids = Object.keys(queue).sort((a, b) => {
                  const av = queue[a] && typeof queue[a].ts === "number" ? queue[a].ts : 0;
                  const bv = queue[b] && typeof queue[b].ts === "number" ? queue[b].ts : 0;
                  return av - bv || String(a).localeCompare(String(b));
                });
                for (const signalId of ids) {
                  try {
                    const seenKey = String(fromUid) + ":" + String(signalId);
                    if (this._voiceSeenSignals && this._voiceSeenSignals.has(seenKey)) continue;
                    const msg = queue[signalId];
                    if (!msg) continue;
                    this._voiceSeenSignals.add(seenKey);
                    await this._voiceHandleSignal(fromUid, msg);
                    if (window.DhametGameRoomClient && typeof window.DhametGameRoomClient.commitRtcAck === "function") {
                      window.DhametGameRoomClient.commitRtcAck({ gameId: this.gameId, fromUid: fromUid, signalId: signalId }).catch(() => {});
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {}
          };
          this._voiceApplyRtcSnapshot = applyRtcSnapshot;

          try {
            if (!this._rtcLiveSub || this._rtcLiveGameId !== this.gameId) {
              try { if (this._rtcLiveSub && this._rtcLiveSub.close) this._rtcLiveSub.close(); } catch (e) {}
              this._rtcLiveSub = null;
              this._rtcLiveGameId = this.gameId;
              if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.subscribeRtcLive !== "function") {
                throw new Error("rtc_live_transport_unavailable");
              }
              this._rtcLiveSub = window.DhametGameRoomClient.subscribeRtcLive({
                gameId: this.gameId,
                onData: (value) => { applyRtcSnapshot(value); },
                onError: () => {},
                onClose: () => {},
              });
            }
          } catch (e) {
            try { if (this._voice) this._voice.writeDenied = true; } catch (_) {}
            if (acquiredLocalStream) this._voiceReleaseLocalStream();
            this._voiceShowFailureNotice();
            return false;
          }

          this._voice.enabled = true;
          try {
            this.refreshPvpControls();
          } catch (e) {}
          return true;
        },

    _voiceLeave: function () {
          try {
            if (!this._voice) return;
            this._voice.enabled = false;
    
            try { if (this._rtcLiveSub && this._rtcLiveSub.close) this._rtcLiveSub.close(); } catch (e) {}
            this._rtcLiveSub = null;
            this._rtcLiveGameId = null;
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
            const url = String((window.ZAMAT_TURN_URL || window.ZAMAT_TURN_ENDPOINT || "") || "").trim();
            if (!url) return fallback;
            const res = await fetch(url, {
              method: "GET",
              headers: { Accept: "application/json" },
              credentials: "same-origin",
              cache: "no-store",
            });
            if (!res || !res.ok) return fallback;
            const data = await res.json().catch(() => null);
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

    _voiceClearReconnect: function (otherUid) {
          try {
            if (!this._voice || !this._voice.reconnectTimers) return;
            const timer = this._voice.reconnectTimers.get(otherUid);
            if (timer) clearTimeout(timer);
          } catch (e) {}
          try {
            if (this._voice && this._voice.reconnectTimers) this._voice.reconnectTimers.delete(otherUid);
          } catch (e) {}
        },

    _voiceScheduleReconnect: function (otherUid, reason) {
          try {
            if (!otherUid || !this._voice || !this._voice.enabled || this.isSpectator) return;
            this._voice.reconnectTimers = this._voice.reconnectTimers || new Map();
            if (this._voice.reconnectTimers.has(otherUid)) return;
            const delay = reason === "failed" ? 350 : 1500;
            const asyncContext = this._captureAsyncContext(this.gameId);
            const timer = setTimeout(async () => {
              try {
                this._voiceClearReconnect(otherUid);
                if (!this._isAsyncContextCurrent(asyncContext)) return;
                await this._voiceRestartPeer(otherUid, reason);
              } catch (e) {}
            }, delay);
            this._voice.reconnectTimers.set(otherUid, timer);
          } catch (e) {}
        },

    _voiceRestartPeer: async function (otherUid, reason) {
          try {
            if (!otherUid || !this._voice || !this._voice.enabled) return;
            const iOffer = String(this.myUid || "") < String(otherUid || "");
            const current = this._voice.peers && this._voice.peers.get(otherUid);
            if (current && (current.connectionState === "connected" || current.connectionState === "completed")) {
              return;
            }
            if (!iOffer) {
              if (current && typeof current.restartIce === "function") {
                try {
                  current.restartIce();
                } catch (e) {}
              }
              return;
            }
    
            let pc = current;
            if (!pc || pc.signalingState === "closed") {
              pc = this._voiceEnsurePeer(otherUid, { forceNew: true });
            }
            if (pc && pc.signalingState !== "stable") {
              try {
                this._voiceDropPeer(otherUid, { preserveCallId: false });
              } catch (e) {}
              pc = this._voiceEnsurePeer(otherUid, { forceNew: true });
            }
            if (!pc) return;
    
            const callId = this._voiceNewCallId(otherUid);
            try {
              this._voice.callIds.set(otherUid, callId);
            } catch (e) {}
    
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            this._voiceSendSignal(otherUid, { type: "offer", sdp: offer.sdp, callId: callId, restart: !!reason });
          } catch (e) {}
        },

    _voiceQueueIceSignal: function (toUid, payload) {
          try {
            if (!this.gameId || !toUid || !this.myUid) return;
            if (!requireAuthUid(this.myUid)) return;
            if (!this._voiceParticipantsReady) return;
            try {
              if (this._voiceKnownParticipants && !this._voiceKnownParticipants.has(String(toUid))) return;
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
                if (!this._isAsyncContextCurrent(cur.asyncContext)) return;
                const signals = (cur.signals || []).splice(0, 16).filter(Boolean);
                if (!signals.length) return;
                if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitRtcSignal !== "function") return;
                window.DhametGameRoomClient.commitRtcSignal({
                  kind: "signals-batch",
                  gameId: cur.asyncContext.gameId,
                  toUid: key,
                  signals: signals,
                  clientSignalId: [this.myUid || "u", key, "icebatch", Date.now(), Math.random().toString(36).slice(2, 8)].join(":"),
                }).catch(() => {
                  try { if (this._voice) this._voice.writeDenied = true; } catch (e) {}
                });
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
          } catch (e) {}
        },

    _voiceSendSignal: function (toUid, payload) {
          try {
            if (!this.gameId) return;
            if (!toUid || !this.myUid) return;
            if (this._voice && this._voice.writeDenied) return;
            if (payload && payload.type === "ice") {
              this._voiceQueueIceSignal(toUid, payload);
              return;
            }
    
            if (!requireAuthUid(this.myUid)) return;
            if (!this._voiceParticipantsReady) return;
            try {
              if (this._voiceKnownParticipants && !this._voiceKnownParticipants.has(String(toUid)))
                return;
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
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitRtcSignal !== "function") return;
            window.DhametGameRoomClient.commitRtcSignal({
              gameId: this.gameId,
              toUid: String(toUid),
              signal: msg,
              clientSignalId: [this.myUid || "u", String(toUid || "to"), Date.now(), Math.random().toString(36).slice(2, 8)].join(":"),
            }).catch(() => {
              try {
                if (this._voice) this._voice.writeDenied = true;
              } catch (e) {}
            });
          } catch (e) {}
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
              this._voiceDropPeer(otherUid, { preserveCallId: true });
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
            if (ev.candidate) this._voiceSendSignal(otherUid, { type: "ice", candidate: ev.candidate });
          };
    
          pc.ontrack = (ev) => {
            try {
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
              const state = pc.connectionState;
              if (state === "connected") {
                this._voiceClearReconnect(otherUid);
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
          try {
            if (!this._voice || !this._voice.enabled || this.isSpectator) return;
            const pc = this._voiceEnsurePeer(otherUid);
    
            const iOffer = String(this.myUid || "") < String(otherUid || "");
            if (!iOffer) return;
    
            if (pc.signalingState !== "stable") return;
    
            const callId = this._voiceNewCallId(otherUid);
            try {
              this._voice.callIds.set(otherUid, callId);
            } catch (e) {}
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this._voiceSendSignal(otherUid, { type: "offer", sdp: offer.sdp, callId: callId });
          } catch (e) {}
        },

    _voiceDropPeer: function (uid, opts) {
          opts = opts || {};
          try {
            if (!this._voice) return;
            try {
              this._voiceClearReconnect(uid);
            } catch (e) {}
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
              return;
            }
    
            if (msg.type === "ice" && msg.candidate) {
              try {
                await pc.addIceCandidate(msg.candidate);
              } catch (e) {}
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
            this._oppOnline = online;
            this._oppLastSeenAt = lastSeen || this._oppLastSeenAt || 0;
            if (pres && pres.nickname) this._oppName = String(pres.nickname);
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
            try {
              this._checkMoveCommitHealth();
            } catch (e) {}
          } catch (e) {}
        },

    _renderSharedLog: function (logArr) {
          try {
            const arr = Array.isArray(logArr) ? logArr : [];
            const last = arr.length ? arr[arr.length - 1] : null;
            const key = `${arr.length}:${last && last.ts ? last.ts : ""}`;
            if (key === this._lastRenderedLogKey) return;
            this._lastRenderedLogKey = key;
    
            if (window.LogMgr && typeof window.LogMgr.setEvents === "function") {
              const slice = arr.slice(-80);
    
              const inferTextLogEvent = (o) => {
                try {
                  if (!o || typeof o !== "object") return null;
                  const pick = (a, b) => (a !== undefined && a !== null ? a : b);
                  const k = String(o.kind || o.type || "");
    
                  const side = pick(o.side, pick(o.by, o.s));
                  const from = pick(o.from, o.f);
                  const to = pick(o.to, o.t);
                  const captures = pick(o.captures, o.c);
    
                  if (
                    k === "turn" ||
                    (from != null && to != null && side != null && (k === "" || k === "move"))
                  ) {
                    return { kind: "turn", side: side, from: from, to: to, captures: captures | 0 };
                  }
                  if (k === "undo" && (from != null || to != null)) {
                    return { kind: "undo", from: from, to: to };
                  }
                  if (k === "promote" && o.idx != null) {
                    return { kind: "promote", side: side, idx: o.idx };
                  }
                  if (k === "soufla_remove" && o.idx != null) {
                    return { kind: "soufla_remove", idx: o.idx };
                  }
                  if (k === "soufla_force" && from != null) {
                    return { kind: "soufla_force", from: from, path: o.path };
                  }
                  if (k === "actor_i18n" || o.actor) {
                    return { kind: "actor_i18n", actor: o.actor, key: o.key, vars: o.vars };
                  }
                  if (k === "i18n" || o.key) {
                    return { kind: "i18n", key: o.key, vars: o.vars };
                  }
                } catch (e) {}
                return null;
              };
    
              const evs = slice.map((it) => {
                if (!it || typeof it !== "object") {
                  return { kind: "raw", text: String(it ?? ""), ts: nowTs() };
                }
    
                if (it.kind) {
                  if (it.ts == null) it.ts = nowTs();
                  return it;
                }
    
                if (it.key) {
                  if (it.actor)
                    return {
                      kind: "actor_i18n",
                      actor: it.actor,
                      key: it.key,
                      vars: it.vars,
                      ts: it.ts,
                    };
                  return { kind: "i18n", key: it.key, vars: it.vars, ts: it.ts };
                }
    
                if (typeof it.text === "string") {
                  const dec = decodeSharedLogText(it.text);
                  if (dec) {
                    dec.ts = it.ts;
                    return dec;
                  }
    
                  const decodedLogEvent = inferTextLogEvent(it);
                  if (decodedLogEvent) {
                    decodedLogEvent.ts = it.ts;
                    return decodedLogEvent;
                  }
    
                  return { kind: "raw", text: it.text, ts: it.ts };
                }
    
                const decodedLogEvent = inferTextLogEvent(it);
                if (decodedLogEvent) {
                  decodedLogEvent.ts = it.ts;
                  return decodedLogEvent;
                }
    
                return { kind: "raw", text: "", ts: it.ts };
              });
    
              window.LogMgr.setEvents(evs);
              return;
            }
    
            const logEl = document.getElementById("log");
            if (!logEl) return;
    
            const slice = arr.slice(-80).reverse();
    
            logEl.innerHTML = "";
            slice.forEach((it) => {
              const row = document.createElement("div");
              row.className = "log-item";
    
              const timeEl = document.createElement("span");
              timeEl.className = "time";
              const ts = it && typeof it.ts === "number" ? it.ts : null;
              timeEl.textContent =
                ts != null ? new Date(ts).toLocaleTimeString("en-GB", { hour12: false }) : "";
    
              const msgEl = document.createElement("span");
              msgEl.className = "msg";
              const rawText = it && typeof it.text === "string" ? it.text : "";
              const dec = decodeSharedLogText(rawText);
              if (dec && dec.kind === "i18n") {
                msgEl.textContent = window.I18N.translateArgs(
                  dec.key,
                  dec.vars && typeof dec.vars === "object" ? dec.vars : {},
                );
              } else if (dec && dec.kind === "actor_i18n") {
                const msg = window.I18N.translateArgs(dec.key, dec.vars && typeof dec.vars === "object" ? dec.vars : {});
                msgEl.textContent = (dec.actor ? String(dec.actor) : window.I18N.translateArgs("players.player")) + ": " + msg;
              } else {
                msgEl.textContent = rawText ? String(rawText) : "";
              }
    
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

    _maybeRecordOpponentMoveForTraining: function (data) {
          try {
            if (typeof TrainRecorder === "undefined" || !TrainRecorder) return;
            if (typeof TrainRecorder.recordExternalDecision !== "function") return;
            if (typeof TrainRecorder.captureStateForTraining !== "function") return;
    
            if (typeof Game === "undefined" || !Game) return;
            if (typeof cloneBoard !== "function") return;
            if (typeof applyMoveSim !== "function") return;
            if (typeof isSquareCapturableBy !== "function") return;
            if (typeof valueAt !== "function" || typeof pieceKind !== "function") return;
            if (typeof rcStr !== "function") return;
            if (typeof N_CELLS !== "number" || typeof ACTION_ENDCHAIN !== "number") return;
            if (typeof MAN !== "number" || typeof KING !== "number") return;
    
            const lm = data && data.lastMove ? data.lastMove : null;
            if (!lm || lm.kind !== "move") return;
    
            try {
              if (data && data.soufla && data.soufla.pending) return;
            } catch (e) {}
    
            const mi = Number(lm.moveIndex ?? data.moveIndex ?? 0) || 0;
            if (!mi) return;
    
            const by = typeof lm.by === "number" ? lm.by | 0 : 0;
            if (!by || (this.mySide != null && by === (this.mySide | 0))) return;
            if (mi <= (this._lastTrainLoggedMoveIndex || 0)) return;
    
            const ply = (lm.ply != null ? Number(lm.ply) : Number(data.ply)) || 0;
            const prePly = ply - 1;
            if (prePly < 0) return;
    
            const states = data.states || null;
            const preState = states && states[String(prePly)] ? states[String(prePly)] : null;
            const preSnap = preState && preState.snapshot ? preState.snapshot : null;
            if (!preSnap || !preSnap.board) return;
    
            const from0 = Number(lm.from);
            if (!Number.isFinite(from0)) return;
    
            let path = [];
            if (Array.isArray(lm.path) && lm.path.length) path = lm.path.slice();
            else if (Number.isFinite(lm.to)) path = [Number(lm.to)];
            if (!path.length) return;
    
            const simBoard = cloneBoard(preSnap.board);
    
            try {
              if (TrainRecorder && typeof TrainRecorder.beginMoveBoundary === "function")
                TrainRecorder.beginMoveBoundary({ type: "ext_move", moveIndex: mi, by });
            } catch (e) {}
    
            const savedBoard = Game.board;
            const savedPlayer = Game.player;
            const savedInChain = Game.inChain;
            const savedChainPos = Game.chainPos;
    
            let anyCap = false;
    
            try {
              for (let i = 0; i < path.length; i++) {
                const stepFrom = i === 0 ? from0 : Number(path[i - 1]);
                const stepTo = Number(path[i]);
                if (!Number.isFinite(stepFrom) || !Number.isFinite(stepTo)) continue;
    
                const preChainPosRaw = Number(preSnap.chainPos);
                const preChainPos =
                  Number.isFinite(preChainPosRaw) && preChainPosRaw >= 0 ? preChainPosRaw | 0 : null;
    
                Game.board = simBoard;
                Game.player = by;
                Game.inChain = i > 0 ? true : !!preSnap.inChain;
                Game.chainPos = i > 0 ? stepFrom | 0 : preChainPos;
    
                const st = TrainRecorder.captureStateForTraining();
                if (!st) break;
    
                const action = (stepFrom | 0) * N_CELLS + (stepTo | 0);
    
                const beforeV = valueAt(stepFrom | 0);
                const beforeKind = pieceKind(beforeV);
                const res = applyMoveSim(stepFrom | 0, stepTo | 0);
                const cap = res && res.isCap ? 1 : 0;
                if (cap) anyCap = true;
    
                const afterV = valueAt(stepTo | 0);
                const afterKind = pieceKind(afterV);
                const crown = beforeKind === MAN && afterKind === KING ? 1 : 0;
    
                let trap = 0;
                try {
                  trap = isSquareCapturableBy(-by, stepTo | 0) ? 1 : 0;
                } catch (e) {}
    
                try {
                  TrainRecorder.recordExternalDecision({
                    state: st,
                    action,
                    actor: by,
                    cap,
                    crown,
                    trap,
                    fromStr: rcStr(stepFrom | 0),
                    toStr: rcStr(stepTo | 0),
                  });
                } catch (e) {}
              }
    
              if (anyCap) {
                const lastTo = Number(path[path.length - 1]);
                if (Number.isFinite(lastTo)) {
                  Game.board = simBoard;
                  Game.player = by;
                  Game.inChain = true;
                  Game.chainPos = lastTo | 0;
    
                  const endState = TrainRecorder.captureStateForTraining();
                  if (endState) {
                    let trapEnd = 0;
                    try {
                      trapEnd = isSquareCapturableBy(-by, lastTo | 0) ? 1 : 0;
                    } catch (e) {}
                    try {
                      TrainRecorder.recordExternalDecision({
                        state: endState,
                        action: ACTION_ENDCHAIN,
                        actor: by,
                        cap: 0,
                        crown: 0,
                        trap: trapEnd,
                        fromStr: rcStr(lastTo | 0),
                        toStr: "END",
                      });
                    } catch (e) {}
                  }
                }
              }
            } finally {
              Game.board = savedBoard;
              Game.player = savedPlayer;
              Game.inChain = savedInChain;
              Game.chainPos = savedChainPos;
            }
    
            this._lastTrainLoggedMoveIndex = mi;
          } catch (e) {}
        },

    hasUnsentLocalMoveSteps: function () {
          return !!(Array.isArray(this._pendingSteps) && this._pendingSteps.length);
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

    _reconcilePendingMoveOutbox: function (game) {
          try {
            const outbox = this._readPendingMoveOutbox && this._readPendingMoveOutbox();
            if (!outbox || !game) return;
            const clientMoveId = String(outbox.clientMoveId || "");
            const lastMove = game.lastMove || null;
            const appliedById = !!(clientMoveId && lastMove && String(lastMove.clientMoveId || "") === clientMoveId);
            const remoteIndex = Number(game.moveIndex || 0) || 0;
            const expectedIndex = Number(outbox.expectedMoveIndex || ((Number(outbox.baseMoveIndex || 0) || 0) + 1)) || 0;
            if (appliedById || (expectedIndex && remoteIndex >= expectedIndex)) {
              this._clearPendingMoveOutbox();
              try { this._markLocalCommitSettled(); } catch (e) {}
              return;
            }
            const base = Number(outbox.baseMoveIndex || 0) || 0;
            if (remoteIndex !== base) {
              this._clearPendingMoveOutbox();
              this._pendingSteps = [];
              this._cachedSouflaPlain = null;
              try { this._markLocalCommitSettled(); } catch (e) {}
              try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
              return;
            }
            if (outbox.replayedAfterResync) return;
            if (!window.DhametGameRoomClient || typeof window.DhametGameRoomClient.commitMove !== "function") return;
            outbox.replayedAfterResync = true;
            outbox.replayedAt = nowTs();
            this._savePendingMoveOutbox(outbox);
            const asyncContext = this._captureAsyncContext(this.gameId);
            window.DhametGameRoomClient.commitMove(outbox.payload)
              .then((res) => {
                if (!this._isAsyncContextCurrent(asyncContext)) return;
                const g = res && res.game ? res.game : null;
                if (res && res.committed !== false) {
                  try { if (g) this._lastGameData = g; } catch (e) {}
                  this._clearPendingMoveOutbox();
                  try { this._markLocalCommitSettled(); } catch (e) {}
                }
              })
              .catch(() => {});
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

          const MAX_MOVE_SEND_RETRIES = 12;
          if (this._moveRetryGaveUp) return;
          const attempt = (this._moveRetryAttempt || 0) + 1;
          this._moveRetryAttempt = attempt;
          if (attempt > MAX_MOVE_SEND_RETRIES) {
            this._moveRetryGaveUp = true;
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

    logSouflaPressedToCloudflare: function () {
          // Do not mutate game.log from the browser. Official soufla
          // detection/resolution events are produced by shared authority in GameRoom.
          return false;
        },

    sendMoveToCloudflare: function (_from, _to, nextTurn, _attempt) {
          if (!allowOnlineWrite()) return;
          if (!this.isActive || !this.gameRef || !this.gameId) return;
          if (!requireAuthUid(this.myUid)) {
            try { this.syncNow({ reason: "auth-recovery", repairPresence: false, notifyFailure: false }); } catch (e) {}
            try { showOnlineNotice(window.I18N.translateArgs("status.moveSendFail")); } catch (e) {}
            return;
          }

          const attempt = Number.isFinite(_attempt) ? _attempt : 0;
          const self = this;
          const expectedGameId = String(this.gameId || "");
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

          const retryOrFail = function (err, serverGame) {
            if (!taskIsCurrent()) return;
            self._pendingSteps = steps.concat(self._pendingSteps || []);
            try {
              const remoteMi = Number((serverGame && serverGame.moveIndex) || 0);
              if (serverGame) {
                self._ingestOfficialGame(serverGame, {
                  source: "move-commit-rejected",
                  gameId: expectedGameId,
                  version: serverGame.__transportVersion,
                  rejectDuplicate: false,
                });
              }
              if (self._awaitingLocalCommit && Number.isFinite(self._expectedMoveIndex) && remoteMi >= self._expectedMoveIndex) {
                try { self._markLocalCommitSettled(); } catch (e) {}
                try { self._forceResync("move-already-applied"); } catch (e) {}
                return;
              }
            } catch (e) {}

            try {
              const RESYNC_AFTER = 2;
              if (!self._moveRetryDidResync && attempt >= RESYNC_AFTER) {
                self._moveRetryDidResync = true;
                self._forceResync("move-retry");
              }
            } catch (e) {}

            const MAX_MOVE_SEND_RETRIES = 12;
            try { if (err) handleDbError(err, null, { ctx: "move.gameRoom" }); } catch (e) {}
            if (attempt >= MAX_MOVE_SEND_RETRIES || (err && (isPermissionDenied(err) || isNonRetriableGameCommitError(err)))) {
              self._moveRetryGaveUp = true;
              const nonRetriable = !!(err && (isPermissionDenied(err) || isNonRetriableGameCommitError(err)));
              if (nonRetriable) {
                self._pendingSteps = [];
                try { self._clearPendingMoveOutbox && self._clearPendingMoveOutbox(); } catch (e) {}
                try { self._markLocalCommitSettled(); } catch (e) {}
              } else {
                try {
                  const outbox = self._readPendingMoveOutbox && self._readPendingMoveOutbox();
                  if (outbox) {
                    outbox.retryGaveUpAt = nowTs();
                    outbox.attempts = attempt;
                    self._savePendingMoveOutbox(outbox);
                  }
                } catch (e) {}
              }
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
            retryOrFail(new Error("gameroom-transport-missing"), null);
            return;
          }

          window.DhametGameRoomClient.commitMove(payload)
            .then(function (res) {
              if (!taskIsCurrent()) return;
              const g = res && res.game ? res.game : null;
              if (!res || res.committed === false) {
                retryOrFail(null, g);
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
              try { self._touchRoomListActivity(expectedGameId, true); } catch (e) {}
            })
            .catch(function (err) {
              retryOrFail(err, err && err.data && err.data.game ? err.data.game : null);
            });
        },

    sendSouflaDecisionToCloudflare: function (decision, pending, nextTurn) {
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
              try { this._touchRoomListActivity(expectedGameId, true); } catch (e) {}
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
          if (!this.isActive || !this.gameId) return;
          if (this.isSpectator) return;

          try {
            const hasLocalSteps = this.hasUnsentLocalMoveSteps && this.hasUnsentLocalMoveSteps();
            if (Game && Game.inChain && hasLocalSteps) {
              if (typeof window.performLocalUndo === "function") {
                window.performLocalUndo({ onlineLocalOnly: true, allowForcedOpening: true });
              }
              return;
            }
          } catch (e) {}

          if (!allowOnlineWrite()) return;

          try {
            if (Game && Game.inChain) {
              showOnlineNotice(window.I18N.translateArgs("ui.noUndo"), { title: window.I18N.translateArgs("modals.undo.title") });
              return;
            }
          } catch (e) {}

          try {
            if (Game && Game.forcedEnabled && Game.forcedPly < 10) {
              showOnlineNotice(window.I18N.translateArgs("modals.undo.notAllowedBody"), { title: window.I18N.translateArgs("modals.undo.notAllowedTitle") });
              return;
            }
          } catch (e) {}

          if ((this.ply || 0) <= 0) {
            showOnlineNotice(window.I18N.translateArgs("ui.noUndo"), { title: window.I18N.translateArgs("modals.undo.title") });
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
              try { this._touchRoomListActivity(this.gameId, true); } catch (e) {}
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
              body: `<div>${formatTpl(window.I18N.translateArgs("undo.request.body"), { name })}</div>`,
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
              try { this._touchRoomListActivity(this.gameId, true); } catch (e) {}
            })
            .catch((e) => {
              if (!this._isAsyncContextCurrent(asyncContext)) return;
              handleDbError(e, window.I18N.translateArgs("undo.failed"), { ctx: "undo.respond" });
              try { this._forceResync(); } catch (_) {}
            });
        },

    _performUndoTransaction: function () {
          // PvP undo is handled by an official GameRoomClient control action.
          // Client-side board rollback is intentionally disabled.
          return;
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
    
          const ok = await this.initPresence();
          if (!ok) {
            try {
              if (playersEl)
                playersEl.innerHTML = `<div class="z-empty">${window.I18N.translateArgs("status.onlineInitFail")}</div>`;
            } catch (e) {}
            return;
          }
    
          try {
            const uid = this.myUid || (auth && auth.currentUser && auth.currentUser.uid) || "";
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
    
          await this._syncLobbyAvailabilityFromActiveGame();
    
          try {
            this._bindInviteListener();
          } catch (e) {}
          try {
            this._rememberUnifiedPulseReason && this._rememberUnifiedPulseReason("lobby-init");
            this._ensureUnifiedAppPulse && this._ensureUnifiedAppPulse("lobby-init", true);
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
    
              const now = nowTs();
    
              if (all) {
                for (const [uid, p] of Object.entries(all)) {
                  if (!p) continue;
                  const isSelf = uid === this.myUid;
                  const ts = Number(p.updatedAt || 0);
                  if (!isPresenceFresh(ts, PRESENCE_LIST_TTL_MS)) {
                    if (!isSelf) continue;
                  }
    
                  const nick = (p.nickname || "").trim() || defaultNick(uid);
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
                  if (r.isSelf) {
                    return `
                      <div class="z-row" data-uid="${r.uid}">
                        <div class="z-row-main">
                          <div class="z-row-title"><img class="z-avatar" src="${r.icon}" alt="" />${escapeHtml(r.nick)}</div>
                          <div class="z-row-sub">${escapeHtml(r.stLabel)}</div>
                        </div>
                        <div class="z-row-actions">
                          <span class="z-self">${window.I18N.translateArgs("players.you")}</span>
                        </div>
                      </div>
                    `;
                  }
    
                  const dis = r.canInvite ? "" : 'disabled aria-disabled="true"';
                  const title = r.canInvite ? "" : `title=\"${window.I18N.translateArgs(r.status === "inPvP" ? "lobby.inviteDisabled" : "lobby.invitesDisabled")}\"`;
                  const inviteLabel = window.I18N.translateArgs("actions.invite");
                  return `
                    <div class="z-row" data-uid="${r.uid}">
                      <div class="z-row-main">
                        <div class="z-row-title"><img class="z-avatar" src="${r.icon}" alt="" />${escapeHtml(r.nick)}</div>
                        <div class="z-row-sub">${escapeHtml(r.stLabel)}</div>
                      </div>
                      <div class="z-row-actions">
                        <button class="btn small ok" data-action="invite" ${dis} ${title}>
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
            try { await this._runUnifiedAppPulse(true); } catch (e) {}
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
                  const w = g.players && g.players.white ? g.players.white.nickname || "" : "";
                  const b = g.players && g.players.black ? g.players.black.nickname || "" : "";
                  const spectatorCount = Math.max(0, Math.min(3, Number(g.spectatorCount || 0) || 0));
                  const spectatorCountUpdatedAt = Number(g.spectatorCountUpdatedAt || 0) || 0;
                  const spectatorCountFresh = isPresenceFresh(spectatorCountUpdatedAt, SPECTATOR_COUNT_STALE_MS);
                  const visibility = normalizeRoomVisibility(g.visibility);
                  rooms.push({ gid, name, w, b, wuid, buid, visibility, createdAt: g.createdAt || g.acceptedAt || 0, spectatorCount, spectatorCountUpdatedAt, spectatorCountFresh });
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
                  return `
                    <div class="z-row z-room-row" data-gid="${r.gid}">
                      <div class="z-row-main">
                        <div class="z-row-title z-room-title"><span>${window.I18N.translateArgs("lobby.roomLabel")} : </span><span>${escapeHtml(r.name)}</span></div>
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
            try { await this._runUnifiedAppPulse(true); } catch (e) {};
    
          } catch (e) {}
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

    _isCurrentAuthPlayerInGame: function (g) {
          try {
            const uid = requireAuthUid(this.myUid);
            if (!uid || !g || !g.players) return false;
            const wuid = String((g.players.white && g.players.white.uid) || "").trim();
            const buid = String((g.players.black && g.players.black.uid) || "").trim();
            return uid === wuid || uid === buid;
          } catch (e) {
            return false;
          }
        },

    _showUnavailableGameAndLeave: async function () {
          try { showOnlineNotice(window.I18N.translateArgs("online.errors.noGame"), { allowSpectator: true }); } catch (e) {}
          return await this._abortOnlineEntry("official-game-unavailable");
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
          const self = this;
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
          try {
            const recent = this._getRecentAcceptedGame && this._getRecentAcceptedGame(gid);
            if (recent && String(recent.status || "") === "active") return recent;
          } catch (e) {}
          return null;
        },

    _isNaturalOnlineEndReason: function (reason) {
          const r = String(reason || "").trim();
          return r === "natural_win" || r === "draw" || r === "no_legal_moves" || r === "opponent_absent" || r === "late_exit";
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
          const ok = await this.initPresence();
          if (!this._isEntryRequestCurrent(entryRequest)) return false;
          if (!ok) {
            showOnlineNotice(window.I18N.translateArgs("status.onlineInitFail"));
            return;
          }
    
          let g = await this._refreshStaleRoomBeforeEntry(gameId);
          if (!this._isEntryRequestCurrent(entryRequest)) return false;
          if (!g) {
            if (this._lastOfficialReadError) {
              try { showOnlineNotice(window.I18N.translateArgs("status.reconnecting") || "تعذر الاتصال مؤقتًا. حاول مرة أخرى.", { allowSpectator: true }); } catch (e) {}
              return false;
            }
            await this._showUnavailableGameAndLeave();
            return false;
          }
    
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
              await this._startSpectator(gameId, entryRequest);
              return;
            }
          }
    
          if (!g.acceptedAt || statusText !== "active") {
            showOnlineNotice(window.I18N.translateArgs("online.waitingAcceptance"));
            return;
          }
    
          if (accessSide === -1 || uid === wuid) {
            await this._startInviterGame(gameId, entryRequest);
          } else {
            await this._joinGame(gameId, entryRequest);
          }
        },

    _startSpectator: async function (gameId, entryRequest) {
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          const ok = await this.initPresence();
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) return false;
          if (!ok) return false;
    
          const registration = await this._registerSpectatorInRoom(gameId);
          if (entryRequest && !this._isEntryRequestCurrent(entryRequest)) {
            try { if (registration && registration.ok) await this._removeSpectatorRegistration(gameId, this.myUid); } catch (e) {}
            return false;
          }
          if (!registration || !registration.ok) {
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
            lastRematchSeq: null,
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
            await this._runUnifiedAppPulse(true);
          } catch (e) {
            handleDbError(e, "", { ctx: "presence.spectatorStatus" });
          }
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
    
          try {
            if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
          } catch (e) {
            Logger.warn("spectator_presentation_reset_failed", { gameId, err: String(e && (e.message || e)) });
          }
          const synced = await this.syncNow({ reason: "spectator-entry", repairPresence: false, notifyFailure: false });
          if ((entryRequest && !this._isEntryRequestCurrent(entryRequest)) || !this._isAsyncContextCurrent(asyncContext)) return false;
          if (!synced) return await this._abortOnlineEntry("spectator-sync-failed");
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
    _abortOnlineEntry: async function (reason) {
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

          try {
            if (typeof location !== "undefined" && isGamePage()) {
              const back = (location.pathname || "").includes("/pages/") ? "./loby.html" : "pages/loby.html";
              if (typeof location.replace === "function") location.replace(back);
              else location.href = back;
            }
          } catch (e) {}
          return false;
        },

    _officialCursor: function (data, meta) {
          const source = meta && typeof meta === "object" ? meta : {};
          return {
            gameId: String(source.gameId || this.gameId || ""),
            rematchSeq: Number((data && data.rematchSeq) || 0) || 0,
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
          if (!this.isActive) return;
          const asyncContext = this._captureAsyncContext(this.gameId);
          try { tryFinalizeTrainingOnExit("disconnect", 900); } catch (e) {}
          const title = window.I18N.translateArgs("online.pvpEndTitle");
          const body = window.I18N.translateArgs("online.ended.remoteOrCleaned");
          let completed = false;
          const go = async () => {
            if (completed || !this._isAsyncContextCurrent(asyncContext, { ignorePostMatch: true })) return;
            completed = true;
            try { this._clearPersistedActiveGame(); } catch (e) {}
            try { await this.exitToMode(); } catch (e) {
              try {
                const inPages = (location.pathname || "").includes("/pages/");
                location.href = inPages ? "mode.html" : "pages/mode.html";
              } catch (_) {}
            }
          };
          if (typeof Modal !== "undefined" && Modal && typeof Modal.alert === "function") {
            try { setTimeout(go, 1800); } catch (e) {}
            Modal.alert({
              title,
              body: `<div>${body}</div>`,
              okLabel: window.I18N.translateArgs("buttons.home"),
              okClassName: "ok",
              allowSpectator: true,
              priority: 90,
              blocking: true,
              onClick: go,
              onClose: (reason) => {
                if (reason === "dismiss") go();
              },
            });
          } else {
            try { showOnlineNotice(body); } catch (e) {}
            go();
          }
        },

    _ingestOfficialGame: function (rawData, meta) {
          if (!rawData || typeof rawData !== "object") return false;
          const source = meta && typeof meta === "object" ? meta : {};
          const remoteMi = Number(rawData.moveIndex || 0) || 0;
          const localBaseMoveIndex = Number(this.moveIndex || 0) || 0;
          const rs = Number(rawData.rematchSeq || 0) || 0;
          const previousRematchSeq = this._lastRematchSeq;

          if (previousRematchSeq != null && rs < Number(previousRematchSeq || 0)) {
            try { Logger.info("official_state_rejected", { gameId: this.gameId, reason: "older-rematch", rematchSeq: rs, currentRematchSeq: previousRematchSeq }); } catch (_) {}
            return false;
          }
          const isTerminalState = !!(rawData.status && rawData.status !== "active");
          const isNewRematch = previousRematchSeq != null && rs > Number(previousRematchSeq || 0);
          if (
            this._awaitingLocalCommit &&
            Number.isFinite(this._expectedMoveIndex) &&
            remoteMi < this._expectedMoveIndex &&
            !isTerminalState &&
            !isNewRematch
          ) {
            try { Logger.info("official_state_held_for_local_commit", { gameId: this.gameId, remoteMi, expected: this._expectedMoveIndex, source: source.source || "" }); } catch (_) {}
            return false;
          }

          const data = this._prepareOfficialState(rawData);
          const stateSnap = data && data.state && data.state.snapshot;
          if (data.status === "active" && stateSnap && stateSnap.inChain) {
            try { Logger.warn("official_partial_turn_rejected", { gameId: this.gameId, moveIndex: remoteMi, reason: "official-snapshots-must-be-turn-boundaries" }); } catch (_) {}
            return false;
          }

          const cursor = this._officialCursor(data, source);
          let gate = { accepted: true };
          try {
            if (window.DhametMatchCoordinator && typeof DhametMatchCoordinator.acceptRemote === "function") {
              gate = DhametMatchCoordinator.acceptRemote(cursor, {
                expectedGameId: this.gameId,
                allowGameChange: false,
                rejectDuplicate: source.rejectDuplicate !== false,
              });
            }
          } catch (e) {
            try { Logger.warn("official_state_gate_failed", { gameId: this.gameId, error: String(e && (e.message || e)) }); } catch (_) {}
          }
          if (!gate.accepted) {
            try { Logger.info("official_state_rejected", { gameId: this.gameId, reason: gate.reason, cursor, source: source.source || "" }); } catch (_) {}
            return false;
          }

          if (
            this._awaitingLocalCommit &&
            Number.isFinite(this._expectedMoveIndex) &&
            (remoteMi >= this._expectedMoveIndex || isTerminalState || isNewRematch)
          ) {
            try { this._markLocalCommitSettled(); } catch (e) {}
          }

          let rematchAdvanced = false;
          if (previousRematchSeq == null) this._lastRematchSeq = rs;
          else if (rs > Number(previousRematchSeq || 0)) {
            rematchAdvanced = true;
            this._lastRematchSeq = rs;
            try { this._onRematchStarted(); } catch (e) {}
            try {
              if (window.DhametMatchCoordinator) {
                DhametMatchCoordinator.acceptRemote(cursor, {
                  expectedGameId: this.gameId,
                  allowGameChange: false,
                  rejectDuplicate: false,
                });
              }
            } catch (e) {}
          }

          try { this._lastGameData = data; } catch (e) {}
          try { this._handleOfficialRematchRequest(data); } catch (e) {}

          if (data.status && data.status !== "active") {
            try { this._enterPostMatch({ reason: data.endedReason || data.status, endedBy: data.endedBy || null }); } catch (e) {}
            return true;
          }

          try {
            const w = data.players && data.players.white ? data.players.white.nickname || "" : "";
            const b = data.players && data.players.black ? data.players.black.nickname || "" : "";
            Game.names.bot = w || "";
            Game.names.top = b || "";
            if (window.ZGamePlayers && typeof window.ZGamePlayers.refresh === "function") window.ZGamePlayers.refresh();
            this._topDisplayName = this._resolveSlotDisplayName("top", Game.names.top || window.I18N.translateArgs("players.player"));
            this._botDisplayName = this._resolveSlotDisplayName("bot", Game.names.bot || window.I18N.translateArgs("players.player"));
            this._ensurePresenceUi();
            this._updatePresenceUi();
          } catch (e) {}

          this.moveIndex = remoteMi;
          this.ply = Number(data.ply || 0) || 0;
          try { this._renderSharedLog(data.log || []); } catch (e) {}
          try { this._handlePresence(data); } catch (e) {}
          try {
            Game.availableSouflaForHuman = data.soufla && data.soufla.availableFor === this.mySide
              ? plainToSoufla(data.soufla.pending)
              : null;
          } catch (e) {}
          try { this._handleUndoRequest(data); } catch (e) {}

          const preserveLocalCapture = !!(
            stateSnap &&
            Game && Game.inChain &&
            Array.isArray(this._pendingSteps) && this._pendingSteps.length &&
            remoteMi === localBaseMoveIndex &&
            rs === Number(this._lastRematchSeq || 0)
          );
          if (preserveLocalCapture) {
            try { this._scheduleCaptureDraftSave(); } catch (e) {}
          } else if (stateSnap) {
            this._applyRemoteState(data, { skipFx: !!source.skipFx });
            try { this._restoreCaptureDraftIfValid && this._restoreCaptureDraftIfValid(data); } catch (e) {}
          } else if (typeof data.turn === "number") {
            try {
              this._resumeOfficialTurn(data.turn);
            } catch (error) {
              try { Logger.warn("official_turn_only_resume_failed", { gameId: this.gameId, error: String(error && (error.message || error)) }); } catch (_) {}
            }
          }

          if (rematchAdvanced) {
            try { this._setOnlineButtonsState(true); } catch (e) {}
          }
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
              rematchSeq: Number(this._lastRematchSeq || (this._lastGameData && this._lastGameData.rematchSeq) || 0) || 0,
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
            rematchSeq: officialData.rematchSeq,
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
    try { Online._autoEnterFromUrl(); } catch (_) {}
    try { Online.initInvitesPassive(); } catch (_) {}
    if (isGamePage()) return;

    if (document.getElementById("roomsList") && document.getElementById("playersList")) {
      Online.initLobbyPage({ roomsListId: "roomsList", playersListId: "playersList" }).catch(function () {
        var msg = window.I18N.translateArgs("status.onlineInitFail", "تعذر تشغيل اللعب عبر الإنترنت الآن.");
        var playersEl = document.getElementById("playersList");
        var roomsEl = document.getElementById("roomsList");
        if (playersEl) playersEl.innerHTML = '<div class="z-empty">' + msg + '</div>';
        if (roomsEl) roomsEl.innerHTML = '<div class="z-empty">' + msg + '</div>';
      });
      return;
    }
  });
})();
