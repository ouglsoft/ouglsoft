import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("confirmed manual online end has one explicit mode-page exit on every viewport", () => {
  const online = read("dhamet/site/js/online/online-runtime.js");
  const start = online.indexOf("    endOnline: async function () {");
  const end = online.indexOf("\n    _clearPostMatchSession: function () {", start);
  assert.ok(start >= 0 && end > start, "endOnline block must exist");
  const block = online.slice(start, end);
  assert.match(block, /_suppressNextLocalEndPresentation = true/);
  assert.match(block, /this\._enterPostMatch\([\s\S]*await this\._exitOnlineSessionTo\("mode\.html"\)/);
  assert.doesNotMatch(block, /z-mobile-on|data-mobile-page|innerWidth|matchMedia/);
});
