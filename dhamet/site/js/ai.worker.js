/* Dedicated worker for the local Dhamet computer player. */
(() => {
  'use strict';

  const BUILD = '?v=computer-pvs-1.3.1';
  importScripts(
    '../shared/dhamet-utils.js' + BUILD,
    '../shared/dhamet-rules.js' + BUILD,
    '../shared/dhamet-state.js' + BUILD,
    'ai/ai-config.js' + BUILD,
    'ai/ai-engine.js' + BUILD,
  );

  self.onmessage = (event) => {
    const message = event && event.data ? event.data : {};
    const id = Number(message.id || 0);
    try {
      if (message.cmd === 'analyzeTurn') {
        const analysis = self.DhametAIEngine.analyzePosition(message.state || {});
        self.postMessage({ id, analysis });
        return;
      }
      if (message.cmd === 'pickSouflaDecision') {
        const decision = self.DhametAIEngine.analyzePenalty(message.state || {}, message.pending || null);
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
