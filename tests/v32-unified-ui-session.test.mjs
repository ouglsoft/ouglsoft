import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(p, "utf8");

test("shared shell owns language-aware back placement", () => {
  const mobile = read("dhamet/site/js/mobile.js");
  const style = read("dhamet/site/css/style.css");
  assert.match(mobile, /bar\.appendChild\(backBtn\);\s*bar\.appendChild\(langBtn\);/);
  assert.match(style, /\.directional-exit-icon\s*\{\s*transform: none;/);
  assert.match(style, /html\[dir="ltr"\] \.directional-exit-icon\s*\{\s*transform: scaleX\(-1\)/);
});

test("game log has one shared native-scroll implementation", () => {
  const view = read("dhamet/site/js/ui/game-log-view.js");
  const game = read("dhamet/site/js/modes/game-runtime.js");
  const online = read("dhamet/site/js/online/online-runtime.js");
  assert.match(view, /function syncElement\(/);
  assert.match(game, /DhametGameLogView\.syncElement\(log, events/);
  assert.match(online, /DhametGameLogView\.syncElement\(/);
  assert.doesNotMatch(game + online, /manualScrollActive|LOG_SCROLL_IDLE_MS|pendingRender|beginManualScroll/);
});

test("AI level sizing is isolated to the game AI selector", () => {
  const dropdown = read("dhamet/site/js/ui/dropdown-view.js");
  const style = read("dhamet/site/css/style.css");
  assert.match(dropdown, /function syncAiLevelWidth\(/);
  assert.match(dropdown, /wrapper\.classList\.contains\("is-ai-level"\)/);
  assert.match(style, /\.z-select-dropdown\.is-ai-level[\s\S]*--z-ai-level-width/);
  assert.match(style, /\.z-select-dropdown\.is-ai-level \.z-select-trigger[\s\S]*gap: 4px/);
});

test("original active-match actions use the authoritative lobby reconciliation", () => {
  const lobby = read("dhamet/site/js/online/lobby-runtime.js");
  const online = read("dhamet/site/js/online/online-runtime.js");
  assert.match(lobby, /_resolveActivePlayerMatch:[\s\S]*_dispatchUnifiedAppPulseNow\(true, "active-match-resolve"\)/);
  assert.match(lobby, /_syncLobbyAvailabilityFromActiveGame:[\s\S]*_resolveActivePlayerMatch\(\)/);
  assert.match(online, /_createGame:[\s\S]*const activeMatch = await this\._resolveActivePlayerMatch\(\)/);
  assert.match(online, /_returnToActiveMatch:[\s\S]*const resolved = await this\._resolveActivePlayerMatch\(\)/);
  assert.doesNotMatch(online, /const activeRoomId = String\(this\.gameId \|\| this\._presenceRoomId/);
});
