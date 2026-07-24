import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const controller = fs.readFileSync("dhamet/site/js/online/backup-route-controller.js", "utf8");
const mode = fs.readFileSync("dhamet/site/pages/mode.html", "utf8");
const lobbyRuntime = fs.readFileSync("dhamet/site/js/online/lobby-runtime.js", "utf8");
test("online entry uses the central Worker redirect", () => {
  assert.match(mode, /href="\/dhamet\/api\/online-entry"/);
  assert.doesNotMatch(controller, /fetch\(|backend-route.*GET|ensureOfficialOrRedirect|fetchStatus/);
  assert.doesNotMatch(lobbyRuntime, /ensureOfficialOrRedirect/);
});
test("only explicit server directives can redirect an already-open official lobby", () => {
  assert.match(controller, /BACKUP_BACKEND_ACTIVE/);
  assert.match(controller, /dhamet2\.ouglsoft\.com/);
});
