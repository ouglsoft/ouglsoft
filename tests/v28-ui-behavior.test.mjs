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
  assert.match(mobile, /bar\.appendChild\(backBtn\);\s*bar\.appendChild\(langBtn\);/);
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

test("activity log uses the shared native-scroll reconciler", () => {
  const logView = read("dhamet/site/js/ui/game-log-view.js");
  assert.match(game, /LOG_BOTTOM_THRESHOLD = 48/);
  assert.match(game, /DhametGameLogView\.syncElement\(log, events/);
  assert.doesNotMatch(game, /manualScrollActive|LOG_SCROLL_IDLE_MS|touchstart.*beginManualScroll|ResizeObserver/);
  assert.match(logView, /function syncElement\(/);
  assert.match(logView, /distanceFromBottom\(element\) <= threshold/);
  assert.match(logView, /if \(row === cursor\) cursor = cursor\.nextSibling/);
  assert.match(logView, /followLatest \? maxTop : Math\.min\(previousTop, maxTop\)/);
  assert.match(style, /\.log-item \{\s*flex: 0 0 auto;/);
  assert.match(style, /\.log \{[\s\S]*scrollbar-gutter: stable;[\s\S]*backdrop-filter: none;/);
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
