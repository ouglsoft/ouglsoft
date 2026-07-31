import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (file) => fs.readFileSync(file, "utf8");

function extractFunction(source, name) {
  const fnAt = source.indexOf(`function ${name}(`);
  assert.ok(fnAt >= 0, `${name} missing`);
  const asyncAt = source.lastIndexOf("async ", fnAt);
  const at = asyncAt >= 0 && source.slice(asyncAt + 6, fnAt).trim() === "" ? asyncAt : fnAt;
  const brace = source.indexOf("{", fnAt);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`${name} not closed`);
}

const online = read("dhamet/site/js/online/online-runtime.js");
const lobby = read("dhamet/site/js/online/lobby-runtime.js");
const game = read("dhamet/site/js/modes/game-runtime.js");
const i18n = read("dhamet/site/js/i18n.js");

const retryRuntime = vm.runInNewContext(
  `${extractFunction(online, "waitForOnlineRetry")}\n${extractFunction(online, "initPresenceWithRetry")}\n${extractFunction(online, "resolveActiveMatchWithRetry")}\n({initPresenceWithRetry,resolveActiveMatchWithRetry})`,
  { setTimeout: (fn) => fn(), Promise },
);

test("online opening retries one transient initialization/read failure", async () => {
  let presenceCalls = 0;
  const presenceOwner = {
    async initPresence() {
      presenceCalls += 1;
      return presenceCalls === 2;
    },
  };
  assert.equal(await retryRuntime.initPresenceWithRetry(presenceOwner), true);
  assert.equal(presenceCalls, 2);

  let matchCalls = 0;
  const matchOwner = {
    async _resolveActivePlayerMatch() {
      matchCalls += 1;
      return matchCalls === 1 ? { state: "unknown", gameId: "" } : { state: "none", gameId: "" };
    },
  };
  assert.deepEqual(await retryRuntime.resolveActiveMatchWithRetry(matchOwner), { state: "none", gameId: "" });
  assert.equal(matchCalls, 2);
});

test("activity log is rendered newest-first and anchored at the top", () => {
  assert.match(game, /const newestFirst = events\.map\([\s\S]*?\.reverse\(\);/);
  assert.match(online, /logEl,\s*evs\.slice\(\)\.reverse\(\),/);
  assert.match(read("dhamet/site/js/ui/game-log-view.js"), /element\.scrollTop = 0/);
});

test("sender is notified when the official invite result is rejected", () => {
  assert.match(lobby, /st === "rejected"[\s\S]*?translateArgs\("online\.inviteRejected"\)/);
  assert.match(i18n, /"inviteRejected": "رفض اللاعب الآخر دعوتك\."/);
  assert.match(i18n, /"inviteRejected": "The other player declined your invitation\."/);
  assert.match(i18n, /"inviteRejected": "L’autre joueur a refusé votre invitation\."/);
});

test("online-open failure text includes connection guidance in all languages", () => {
  assert.match(i18n, /تعذر فتح اللعب عبر الإنترنت الآن\. تأكد من اتصالك بالإنترنت وحاول مرة أخرى\./);
  assert.match(i18n, /Online play could not be opened right now\. Check your internet connection and try again\./);
  assert.match(i18n, /Le jeu en ligne ne peut pas être ouvert pour le moment\. Vérifiez votre connexion Internet et réessayez\./);
});
