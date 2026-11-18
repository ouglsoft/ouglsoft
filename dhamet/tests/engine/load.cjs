'use strict';
// Loads the shared engine exactly as the browser and the Worker do (classic scripts that
// register themselves on globalThis), from dhamet/shared.
const path = require('path');
const base = path.join(__dirname, '..', '..', 'shared');
for (const f of ['dhamet-utils', 'dhamet-rules', 'dhamet-state', 'dhamet-turn-resolution', 'dhamet-move', 'dhamet-soufla', 'dhamet-control', 'dhamet-events', 'dhamet-result', 'dhamet-match-end', 'dhamet-authority']) require(path.join(base, f + '.js'));
module.exports = { Rules: globalThis.DhametRules, State: globalThis.DhametState, Authority: globalThis.DhametAuthority, Soufla: globalThis.DhametSoufla, Move: globalThis.DhametMove, Result: globalThis.DhametResult, MatchEnd: globalThis.DhametMatchEnd, TurnResolution: globalThis.DhametTurnResolution };
