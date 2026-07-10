/* Dedicated worker for the local Dhamet computer player. */
(() => {
  'use strict';

  const BUILD = '?v=computer-pvs-1.6.0';
  importScripts(
    '../shared/dhamet-utils.js' + BUILD,
    '../shared/dhamet-rules.js' + BUILD,
    '../shared/dhamet-state.js' + BUILD,
    'ai/ai-config.js' + BUILD,
    'ai/ai-engine.js' + BUILD,
  );

  // One-turn, in-memory soufla plan. It is replaced by every new computer
  // turn and consumed by the next penalty decision. It is never persisted or
  // sent to the server.
  let rememberedSouflaPlan = null;

  self.onmessage = (event) => {
    const message = event && event.data ? event.data : {};
    const id = Number(message.id || 0);
    try {
      if (message.cmd === 'analyzeTurn') {
        rememberedSouflaPlan = null;
        const analysis = self.DhametAIEngine.analyzePosition(message.state || {});
        rememberedSouflaPlan = analysis && analysis.souflaPlan ? analysis.souflaPlan : null;
        self.postMessage({ id, analysis });
        return;
      }
      if (message.cmd === 'pickSouflaDecision') {
        const plan = rememberedSouflaPlan;
        rememberedSouflaPlan = null;
        const decision = self.DhametAIEngine.analyzePenalty(message.state || {}, message.pending || null, plan);
        self.postMessage({ id, decision });
        return;
      }
      self.postMessage({ id, error: 'computer/unknown-command' });
    } catch (error) {
      self.postMessage({
        id,
        error: error && error.message ? String(error.message) : 'computer/worker-error',
      });
    }
  };
})();
