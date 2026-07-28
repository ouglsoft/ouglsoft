import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const read = (file) => fs.readFileSync(file, 'utf8');
const i18n = read('dhamet/site/js/i18n.js');
const online = read('dhamet/site/js/online/online-runtime.js');
const lobby = read('dhamet/site/js/online/lobby-runtime.js');
const game = read('dhamet/site/js/modes/game-runtime.js');
const ui = read('dhamet/site/js/ui/ui-runtime.js');
const souflaView = read('dhamet/site/js/ui/soufla-view.js');
const theme = read('dhamet/site/css/theme.css');
const gamePage = read('dhamet/site/pages/game.html');

function parseTranslations(source) {
  const markerAt = source.indexOf('const translations');
  const start = source.indexOf('{', markerAt);
  let depth = 0, quote = '', escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error('translations object not closed');
}
const tr = parseTranslations(i18n);

test('requested Arabic Soufla and move-failure messages are exact', () => {
  assert.equal(tr.ar.soufla.pick.toastNotOffender, 'هذه القطعة ليست مسوفلة/مخالفة، اختر القطعة التي تجاهلت الأسر.');
  assert.equal(tr.ar.status.moveSendFail, 'فشل إرسال النقلة، يرجى الضغط على زر التحديث ثم إعادة النقلة.');
});

test('spectators receive only neutral final match decisions and player-only errors remain suppressed', () => {
  for (const key of ['force', 'remove']) assert.ok(tr.ar.soufla.spectator[key]);
  for (const key of ['spectatorAccepted', 'spectatorRejected']) assert.ok(tr.ar.undo[key]);
  assert.doesNotMatch(online, /showOnlineNotice[\s\S]{0,240}undo\.spectatorRequested/);
  assert.match(online, /state === "rejected"[\s\S]*undo\.spectatorRejected/);
  assert.match(online, /lm\.kind === "undo"[\s\S]*this\.isSpectator[\s\S]*undo\.spectatorAccepted/);
  assert.match(online, /isSpectator:\s*!!this\.isSpectator/);
  assert.match(lobby, /!cfg\.allowSpectator[\s\S]*contains\("z-spectator"\)[\s\S]*return/);
  assert.doesNotMatch(online, /status\.moveSendFail"\),\s*\{\s*allowSpectator:\s*true/);
});

test('spectator departure is silent and does not end the match', () => {
  assert.match(online, /if \(wasSpectator\) this\._spectatorLeaving = true/);
  assert.match(online, /const silentSpectatorLeave = !!this\._spectatorLeaving/);
  assert.match(online, /if \(silentSpectatorLeave\)[\s\S]*location\.href = back;[\s\S]*return/);
  const silentBlock = online.match(/if \(silentSpectatorLeave\)[\s\S]*?return;/)?.[0] || '';
  assert.doesNotMatch(silentBlock, /showOnlineNotice|endGame|endedAt|status\s*=\s*["']ended/);
});

test('lobby watch button contains the current spectator count', () => {
  assert.match(online, /lobby\.spectate/);
  assert.match(online, /spectatorLabel[^\n]*spectatorCount/s);
  assert.match(online, /\(\$\{Number\(r\.spectatorCount \|\| 0\)\}\)/);
});

test('self is rendered as You with conjugated self messages, while spectators keep real names', () => {
  assert.match(online, /!this\.isSpectator[\s\S]*String\(uid\)[\s\S]*players\.you/);
  assert.match(game, /gameWinnerSelf/);
  assert.equal(tr.ar.online.endPresentation.selfEndedBy, 'أنهيت المباراة.');
  assert.equal(tr.ar.online.endPresentation.selfWinner, 'لقد فزت بالمباراة.');
  assert.equal(tr.ar.online.endPresentation.selfLoser, 'لقد خسرت المباراة.');
  assert.equal(tr.ar.log.gameWinnerSelf, 'لقد فزت بالمباراة.');
  assert.equal(tr.ar.log.gameLoserSelf, 'لقد خسرت المباراة.');
});

test('Soufla selection follows the offending piece to its new square', () => {
  assert.match(souflaView, /Rules\.resolveOffenderCurrentCell\(pending, offenderIdx\)/);
  assert.match(souflaView, /pending\.lastPieceIdx/);
  assert.doesNotMatch(souflaView, /if \(offenderSet\.has\(clickedIdx\)\) return/);
  const require = createRequire(import.meta.url);
  require('../dhamet/shared/dhamet-utils.js');
  require('../dhamet/shared/dhamet-rules.js');
  const R = globalThis.DhametRules;
  assert.equal(R.resolveOffenderCurrentCell({ startedFrom: 10, lastPieceIdx: 28 }, 10), 28);
  assert.equal(R.resolveOffenderCurrentCell({ lastMoveFrom: 12, lastPieceIdx: 30 }, 12), 30);
  assert.equal(R.resolveOffenderCurrentCell({ startedFrom: 10, lastPieceIdx: 28 }, 16), 16);
});

test('black pieces use a clear dark-orange edge and voice icons expose all states', () => {
  assert.match(theme, /--piece-black-edge:\s*rgb\(154 52 18\)/);
  assert.match(gamePage, /mic-on\.svg/);
  for (const file of ['mic-on.svg', 'mic-off.svg', 'volume-on.svg', 'volume-off.svg']) {
    const svg = read(`dhamet/site/assets/icons/${file}`);
    assert.match(svg, /<svg/);
    assert.match(svg, /path|line|polyline/);
  }
  assert.match(read('dhamet/site/assets/icons/mic-off.svg'), /#b42318/);
  assert.match(read('dhamet/site/assets/icons/volume-off.svg'), /#b42318/);
});

test('online and computer modes share the same board effects renderer', () => {
  assert.match(ui, /const Visual = \(\(\) => \{/);
  assert.match(ui, /applySouflaFXBatch/);
  assert.match(ui, /_clearTurnFx\(false\)/);
  assert.match(ui, /themeColor\("--mark-move"\)/);
  assert.match(ui, /themeColor\("--mark-undo"\)/);
  assert.match(game, /Visual\.setLastMovePath|Visual\.setLastMove/);
  assert.match(online, /Visual\.setLastMovePath|Visual\.setLastMove/);
});

test('the original application does not depend on a persisted Firebase session', () => {
  assert.doesNotMatch(gamePage, /firebase(?:-app|-auth|-database)?-compat|firebase\.initializeApp/i);
  assert.doesNotMatch(read('dhamet/site/pages/loby.html'), /firebase(?:-app|-auth|-database)?-compat|firebase\.initializeApp/i);
});


test('Soufla and undo result wording is simplified without duplicate player confirmations', () => {
  assert.equal(tr.ar.soufla.summary.remove, 'اختار اللاعب عقوبة السوفلة ضدك، وأزال قطعتك الموجودة في الموضع المحدد بعلامة X الحمراء.');
  assert.equal(tr.ar.soufla.summary.force, 'اختار اللاعب عقوبة السوفلة ضدك، وأجبرك على تنفيذ المسار المحدد على الرقعة باللون الأخضر.');
  assert.equal(tr.ar.soufla.spectator.remove, 'اختار اللاعب {actor} عقوبة السوفلة ضد اللاعب {victim}، وأزال قطعته الموجودة في الموضع المحدد بعلامة X الحمراء.');
  assert.equal(tr.ar.soufla.spectator.force, 'اختار اللاعب {actor} عقوبة السوفلة ضد اللاعب {victim}، وأجبره على تنفيذ المسار المحدد على الرقعة باللون الأخضر.');
  assert.match(souflaView, /mySide === by\) return false/);
  assert.doesNotMatch(online, /showOnlineNotice\(window\.I18N\.translateArgs\("undo\.applied"/);
  assert.equal(tr.ar.undo.applied, 'تم التراجع عن النقلة الأخيرة.');
  assert.doesNotMatch(tr.ar.undo.applied, /movePart|\$\{/);
});

test('mobile landscape follows either physical landscape direction without reload', () => {
  const mobile = read('dhamet/site/js/mobile.js');
  assert.match(mobile, /screen\.orientation\.lock\(target\)/);
  assert.doesNotMatch(mobile, /landscape-primary|target \+ '-primary'/);
  assert.match(mobile, /orientationchange/);
  assert.match(mobile, /exitMobileFullscreen/);
  assert.doesNotMatch(mobile, /location\.reload|location\.replace/);
});

test('capture timer uses white text, turns red while active, and reuses the end-capture action', () => {
  assert.match(theme, /Unified capture timer colors/);
  assert.match(theme, /timer-row #killClock[\s\S]*rgb\(var\(--rgb-white\)\)/);
  assert.match(theme, /body\.z-game-page:not\(\.z-mobile-on\) \.timer-row[\s\S]*var\(--gradient-game-control\)/);
  assert.match(theme, /timer-row #btnEndKill[\s\S]*var\(--gradient-game-control-danger\)/);
});


test('invite creation uses a committed-write timeout and never resends after an ambiguous reply', () => {
  const client = read('dhamet/site/js/online/game-room-client.js');
  assert.match(client, /createLobbyInvite[\s\S]*timeoutMs:\s*10000/);
  assert.match(online, /deliveryUnknown[\s\S]*_scheduleUnifiedAppPulseNoLaterThan/);
  assert.match(online, /status === 0 && \(errorName === "aborterror" \|\| errorName === "typeerror"\)/);
  assert.doesNotMatch(online, /const deliveryUnknown = status === 0 \|\|/);
  assert.doesNotMatch(online, /deliveryUnknown[\s\S]{0,500}createLobbyInvite\(/);
});

test('guest identity belongs to the browser session, survives tab close, and is not cached persistently', () => {
  const worker = read('dhamet/worker/src/index.js');
  const auth = read('dhamet/site/js/auth-runtime.js');
  const app = read('dhamet/site/js/app-runtime.js');
  const game = read('dhamet/site/js/modes/game-runtime.js');
  assert.doesNotMatch(worker, /GUEST_SESSION_TTL_SECONDS/);
  assert.match(worker, /sessionCookie\(existingToken, request, null\)[\s\S]*reusedGuest: true/);
  assert.equal((worker.match(/sessionCookie\(guest\.token, request, null\)/g) || []).length, 2);
  assert.match(auth, /cachedUser && !cachedUser\.isAnonymous[\s\S]*localStorage\.setItem\('dhamet\.cf\.user\.v1'/);
  assert.match(auth, /localUser && localUser\.uid && !localUser\.isAnonymous/);
  assert.doesNotMatch(app, /localStorage\.getItem\("zamat\.session\.user\.persist\.v1"\)/);
  assert.doesNotMatch(game, /localStorage\.getItem\("zamat\.session\.user\.persist\.v1"\)/);
});

test('undo requester receives the accepted or rejected final decision', () => {
  assert.ok(tr.ar.undo.requesterAccepted.includes('السهم الأصفر المعكوس'));
  assert.ok(tr.ar.undo.requesterRejected);
  assert.match(online, /undo\.requesterAccepted/);
  assert.match(online, /undo\.requesterRejected/);
});

test('desktop timer invokes the same endKillPressed handler and becomes red while live', () => {
  assert.match(ui, /killTimerTile\.addEventListener\("click"[\s\S]*endKillPressed\(\)/);
  assert.match(theme, /not\(\.z-mobile-on\) \.timer-row\.is-live[\s\S]*gradient-game-control-danger/);
});

test('nickname prompt starts with the default name, has one action, and close accepts the default', () => {
  const modal = read('dhamet/site/js/modal.js');
  assert.match(lobby, /function askNickname\(\)[\s\S]*value: resolveFallbackNick\(\)/);
  assert.match(lobby, /getCloseValue: \(\) => resolveFallbackNick\(\)/);
  assert.match(lobby, /hideCancel: true/);
  assert.match(modal, /cfg\.hideCancel === true \? \[\] :/);
});

test('the selected game icon is used by all existing Dhamet icon surfaces and remains below 50 KB', () => {
  assert.ok(fs.statSync('dhamet/site/assets/icons/icon.webp').size <= 50 * 1024);
  assert.ok(fs.statSync('site/assets/images/products/dhamet/icon.svg').size <= 50 * 1024);
  assert.match(read('dhamet/site/index.html'), /assets\/icons\/icon\.webp/);
  assert.match(read('site/ar/products/dhamet/index.html'), /products\/dhamet\/icon\.svg/);
});


test('computer-game administrative endings never run endgame adjudication', () => {
  const gameRuntime = read('dhamet/site/js/modes/game-runtime.js');
  assert.doesNotMatch(gameRuntime, /inferInterruptedOutcome/);
  assert.doesNotMatch(gameRuntime, /assessInterruptedPosition/);
  assert.match(gameRuntime, /Non-natural computer-game endings are deliberately never adjudicated/);
  assert.match(gameRuntime, /no browser search and no Cloudflare result request/);
  assert.match(gameRuntime, /reason: "non_counted_ending"[\s\S]*return response/);
});
