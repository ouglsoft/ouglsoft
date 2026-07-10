/* Dedicated worker for the local Dhamet computer player. */
(() => {
  'use strict';

  importScripts(
    '../shared/dhamet-utils.js',
    '../shared/dhamet-rules.js',
    'ai/ai-config.js',
    'ai/ai-engine.js',
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
