(() => {
  try { self.window = self; } catch {}
  try { self.document = null; } catch {}

  try {
    const p0 = String(self.location && self.location.pathname ? self.location.pathname : "/");
    const p = p0.replace(/[?#].*$/, "");
    let dir = p.substring(0, p.lastIndexOf("/") + 1);
    dir = dir.replace(/\/js\/$/, "/");
    self.__APP_BASE_PATH_OVERRIDE = dir || "/";
  } catch {}

  importScripts("../shared/dhamet-utils.js", "../shared/dhamet-rules.js", "ai/ai-config.js", "ai/ai-runtime.js", "ai/ai-engine.js", "ai/ai-worker-game-context.js");

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
    if (typeof st.moveCount === "number") Game.moveCount = st.moveCount | 0;
    if (Object.prototype.hasOwnProperty.call(st, "ai2PlanBank")) Game.ai2PlanBank = Array.isArray(st.ai2PlanBank) ? st.ai2PlanBank : [];
    if (Object.prototype.hasOwnProperty.call(st, "ai2SouflaTrapMemory")) Game.ai2SouflaTrapMemory = st.ai2SouflaTrapMemory || null;
    try {
      if (typeof Turn !== "undefined" && Turn) {
        const tc = st.turnCtx || null;
        Turn.ctx = tc && typeof tc === "object" ? {
          startedFrom: tc.startedFrom == null ? null : tc.startedFrom | 0,
          capturesDone: typeof tc.capturesDone === "number" ? tc.capturesDone | 0 : 0,
          Lmax: typeof tc.Lmax === "number" ? tc.Lmax | 0 : 0,
          candidates: Array.isArray(tc.candidates) ? tc.candidates : null,
        } : null;
      }
    } catch {}
    try { Game._simDepth = 0; } catch {}
  }

  async function handleAnalyzeTurn() {
    if (self.AI && typeof self.AI._analyzeTurnInternal === "function") {
      return await self.AI._analyzeTurnInternal();
    }
    return null;
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

    try { applyState(msg.state); } catch (_) {}

    try {
      if (msg.cmd === "analyzeTurn") {
        const analysis = await handleAnalyzeTurn();
        self.postMessage({ id, analysis, cancelled: myToken !== cancelToken });
        return;
      }

      if (msg.cmd === "pickSouflaDecision") {
        const decision = await handlePickSouflaDecision(msg.pending);
        self.postMessage({ id, decision, cancelled: myToken !== cancelToken });
        return;
      }
    } catch (_) {
      try { self.postMessage({ id, error: true, cancelled: myToken !== cancelToken }); } catch {}
    }
  };
})();
