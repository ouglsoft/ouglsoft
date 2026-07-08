(() => {
  try {
    self.window = self;
  } catch {}
  try {
    self.document = null;
  } catch {}

  try {
    const p0 = String(self.location && self.location.pathname ? self.location.pathname : "/");
    const p = p0.replace(/[?#].*$/, "");
    let dir = p.substring(0, p.lastIndexOf("/") + 1);
    dir = dir.replace(/\/js\/$/, "/");
    self.__APP_BASE_PATH_OVERRIDE = dir || "/";
  } catch {}


  importScripts("../shared/dhamet-utils.js", "../shared/dhamet-rules.js", "ai/ai-config.js", "ai/ai-evaluation.js", "ai/ai-search.js", "ai/ai-player.js", "ai/ai-runtime.js", "ai/ai-engine.js", "ai/ai-worker-game-context.js");

  let cancelToken = 0;

  function applyState(st) {
    if (!st) return;

    if (st.board) Game.board = st.board;
    if (typeof st.player === "number") Game.player = st.player;
    Game.inChain = !!st.inChain;
    Game.chainPos = st.chainPos == null ? null : st.chainPos;

    if (typeof st.forcedEnabled === "boolean") Game.forcedEnabled = st.forcedEnabled;
    if (typeof st.forcedPly === "number") Game.forcedPly = st.forcedPly | 0;
    if (st.forcedSeq != null) Game.forcedSeq = st.forcedSeq;

    if (typeof st.gameOver === "boolean") Game.gameOver = st.gameOver;
    if (typeof st.awaitingPenalty === "boolean") Game.awaitingPenalty = st.awaitingPenalty;

    if (st.settings) Game.settings = st.settings;

    try {
      if (typeof Turn !== "undefined" && Turn) {
        const tc = st.turnCtx || null;
        if (tc && typeof tc === "object") {
          Turn.ctx = {
            startedFrom: tc.startedFrom == null ? null : tc.startedFrom | 0,
            capturesDone: typeof tc.capturesDone === "number" ? tc.capturesDone | 0 : 0,
            Lmax: typeof tc.Lmax === "number" ? tc.Lmax | 0 : 0,
            candidates: Array.isArray(tc.candidates) ? tc.candidates : null,
          };
        } else {
          Turn.ctx = null;
        }
      }
    } catch {}
    try {
      Game._simDepth = 0;
    } catch {}
  }

  async function handleDecideAction() {
    if (self.AI && typeof self.AI._decideActionInternal === "function") {
      return await self.AI._decideActionInternal();
    }
    return typeof ACTION_ENDCHAIN === "number" ? ACTION_ENDCHAIN : 0;
  }

  function handlePVCPlan() {
    if (self.AI && typeof self.AI._pvcComputePlanInternal === "function") {
      return self.AI._pvcComputePlanInternal();
    }
    return null;
  }

  function handleBestChainPath(toIdx, aiSide) {
    if (self.AI && typeof self.AI._bestChainPathInternal === "function") {
      return self.AI._bestChainPathInternal(toIdx, aiSide);
    }
    return [];
  }

  function handleHasCaptureFrom(idx) {
    try {
      const from = idx | 0;
      const v = typeof valueAt === "function" ? valueAt(from) : null;
      const caps =
        typeof generateCapturesFrom === "function" ? generateCapturesFrom(from, v) : null;
      return !!(caps && caps.length);
    } catch {
      return false;
    }
  }

  async function handlePickSouflaDecision(pending) {
    if (self.AI && typeof self.AI._pickSouflaDecisionInternal === "function") {
      return await self.AI._pickSouflaDecisionInternal(pending);
    }
    return pending && pending.options ? pending.options[0] || null : null;
  }

  self.onmessage = async (ev) => {
    const msg = ev && ev.data ? ev.data : {};
    if (msg.cmd === "cancel") {
      cancelToken++;
      return;
    }

    const id = typeof msg.id === "number" ? msg.id : 0;
    const myToken = cancelToken;

    try {
      applyState(msg.state);
    } catch (_) {}

    try {
      if (msg.cmd === "decideAction") {
        const action = await handleDecideAction();
        const cancelled = myToken !== cancelToken;
        self.postMessage({ id, action, cancelled });
        return;
      }

      if (msg.cmd === "computePVCPlan") {
        const plan = handlePVCPlan();
        const cancelled = myToken !== cancelToken;
        self.postMessage({ id, plan, cancelled });
        return;
      }

      if (msg.cmd === "bestChainPath") {
        const toIdx = msg.toIdx | 0;
        const aiSide = msg.aiSide | 0;
        const bestPath = handleBestChainPath(toIdx, aiSide);
        const cancelled = myToken !== cancelToken;
        self.postMessage({ id, bestPath, cancelled });
        return;
      }

      if (msg.cmd === "hasCaptureFrom") {
        const idx0 = msg.idx | 0;
        const hasCapture = handleHasCaptureFrom(idx0);
        const cancelled = myToken !== cancelToken;
        self.postMessage({ id, hasCapture, cancelled });
        return;
      }

      if (msg.cmd === "pickSouflaDecision") {
        const decision = await handlePickSouflaDecision(msg.pending);
        const cancelled = myToken !== cancelToken;
        self.postMessage({ id, decision, cancelled });
        return;
      }
    } catch (_) {
      try {
        self.postMessage({ id, error: true, cancelled: myToken !== cancelToken });
      } catch {}
    }
  };
})();
