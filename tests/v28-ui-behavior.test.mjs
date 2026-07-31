import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
const read = (p) => fs.readFileSync(p, "utf8");
const mobileCss = read("dhamet/site/css/mobile.css");
const style = read("dhamet/site/css/style.css");
const mobile = read("dhamet/site/js/mobile.js");
const game = read("dhamet/site/js/modes/game-runtime.js");
const online = read("dhamet/site/js/online/online-runtime.js");
const i18n = read("dhamet/site/js/i18n.js");

test("game return uses the same shared shell and language direction as every other page", () => {
  assert.match(style, /\.directional-exit-icon\s*\{\s*transform: none;/);
  assert.match(style, /html\[dir="ltr"\] \.directional-exit-icon\s*\{\s*transform: scaleX\(-1\)/);
  assert.match(mobile, /bar\.appendChild\(langBtn\);\s*bar\.appendChild\(backBtn\);/);
  assert.doesNotMatch(mobile, /syncGameDirectionalExitIcons|scheduleGameDirectionalExitIcons|syncGameShellPins|DhametSyncGameExitIcons/);
  assert.doesNotMatch(mobileCss, /\.z-mobile-game-shell-inner\s*\{[^}]*direction:\s*ltr|body\.z-mobile-on\[data-mobile-page="game"\] \.directional-exit-icon|\.z-mobile-shell-btn\.is-back\s+img\s*\{[^}]*transform:\s*rotate/);
  assert.doesNotMatch(style, /z-points-outward|body\.z-game-page \.directional-exit-icon|body\.z-mobile-on\[data-mobile-page="game"\][^{]*directional-exit-icon/);
  assert.match(mobile, /function markGameLayoutMutation\(/);
  assert.match(mobile, /function rememberGameHome\(/);
  assert.match(mobile, /function ensureGameSideLane\(/);
  assert.match(mobile, /function syncGameLevelInShell\(/);
  assert.match(mobile, /presence\.classList\.toggle\('z-presence-online', onlineNow\)/);
  assert.match(mobile, /presence\.classList\.toggle\('z-presence-offline', offlineNow\)/);
});

test("original icon is the approved icon and cannot reuse the immutable favicon URL", () => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync("dhamet/site/assets/icons/icon.webp")).digest("hex");
  assert.equal(hash, "9bd8e771cb6618284c8d5afc0048f6338d1fc17788229ace8bcbd495414c8927");
  for (const page of ["index.html","pages/mode.html","pages/dashboard.html","pages/reset-password.html","pages/loby.html","pages/game.html"]) {
    assert.doesNotMatch(read(`dhamet/site/${page}`), /icon\.webp["']/);
    assert.match(read(`dhamet/site/${page}`), /icon\.webp\?v=__DHAMET_BUILD__/);
  }
  assert.match(read("site/_headers"), /\/dhamet\/assets\/icons\/icon\.webp\n\s+Cache-Control: no-cache/);
});

test("activity log defers DOM rebuilds during manual scrolling and follows only near the bottom", () => {
  assert.match(game, /LOG_BOTTOM_THRESHOLD = 48/);
  assert.match(game, /LOG_SCROLL_IDLE_MS = 140/);
  assert.match(game, /let manualScrollActive = false/);
  assert.match(game, /let pendingRender = false/);
  assert.match(game, /for \(let i = 0; i < events\.length; i \+= 1\)/);
  assert.match(game, /followLatest = distanceFromBottom\(log\) <= LOG_BOTTOM_THRESHOLD/);
  assert.match(game, /log\.addEventListener\("scroll", updateFromActualScroll/);
  assert.match(game, /log\.addEventListener\("touchstart", beginManualScroll/);
  assert.doesNotMatch(game, /log\.addEventListener\("touchmove"/);
  assert.match(game, /if \(manualScrollActive\) \{\s*pendingRender = true;\s*return;/);
  assert.match(game, /shouldFollowLatest\s*\? Math\.max\(0, log\.scrollHeight - log\.clientHeight\)/);
  assert.doesNotMatch(game, /events\.length - 1; i >= 0/);
});

test("local manual end consumes its presentation while remote endings remain presented", () => {
  assert.match(online, /_suppressNextLocalEndPresentation = true/);
  assert.match(online, /if \(suppressLocalNotice\) return true;[\s\S]*showOnlineGameOverModal/);
});

test("modal alignment and requested translations are exact", () => {
  assert.match(style, /\.modal-body \{[\s\S]*text-align: center;[\s\S]*direction: inherit;/);
  assert.match(i18n, /"title": "اللوبي"/);
  assert.match(i18n, /لديك حق السوفلة\. اختر القطعة التي تجاهلت الأسر\./);
  assert.match(i18n, /تهانينا لـ\{player\}، لقد فاز بالمباراة!/);
  assert.match(i18n, /تهانينا، لقد فزت بالمباراة!/);
  assert.match(i18n, /Better luck next time—you lost the match\./);
  assert.match(i18n, /Une partie équilibrée, terminée par un match nul\./);
});
