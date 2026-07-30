import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

function parseTranslations(source) {
  const markerAt = source.indexOf("const translations");
  assert.notEqual(markerAt, -1, "translations object marker missing");
  const start = source.indexOf("{", markerAt);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  throw new Error("translations object is not closed");
}

function flatten(value, prefix = "", output = {}) {
  for (const [key, child] of Object.entries(value || {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, full, output);
    else output[full] = child;
  }
  return output;
}

function render(template, vars) {
  return String(template).replace(/\$\{([^}]+)\}/g, (_, key) => String(vars[key] ?? ""));
}

const i18nSource = read("dhamet/site/js/i18n.js");
const translations = parseTranslations(i18nSource);
const lobbyHtml = read("dhamet/site/pages/loby.html");
const gameHtml = read("dhamet/site/pages/game.html");

test("lobby uses match terminology in all supported languages", () => {
  assert.equal(translations.ar.lobby.title, "اللوبي");
  assert.equal(translations.ar.lobby.roomsTitle, "قائمة المباريات الجارية");
  assert.equal(translations.en.lobby.title, "Lobby");
  assert.equal(translations.en.lobby.roomsTitle, "List of ongoing matches");
  assert.equal(translations.fr.lobby.title, "Lobby");
  assert.equal(translations.fr.lobby.roomsTitle, "Liste des parties en cours");
  assert.match(lobbyHtml, /data-i18n="lobby.title">اللوبي</);
  assert.match(lobbyHtml, /قائمة المباريات الجارية/);
});

test("named-match invitation is grammatical in Arabic, English, and French", () => {
  const cases = [
    ["ar", "أحمد", "مباراة الأصدقاء", "يدعوك <strong>أحمد</strong> إلى مباراة باسم <strong>مباراة الأصدقاء</strong>."],
    ["en", "Alex", "Friends", "<strong>Alex</strong> invited you to a match named <strong>Friends</strong>."],
    ["fr", "Alex", "Amis", "<strong>Alex</strong> vous invite à une partie nommée <strong>Amis</strong>."],
  ];
  for (const [lang, fromName, matchName, expected] of cases) {
    const online = translations[lang].online;
    const roomPart = render(online.newInviteRoomPart, { roomName: matchName });
    const body = render(online.newInviteBody, { fromName, roomPart });
    assert.equal(body, expected);
  }
});

test("old room terminology is absent from user-visible translations", () => {
  const oldTerms = /(?:غرف|غرفة|\brooms?\b|\bsalles?\b)/i;
  for (const [lang, values] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(flatten(values))) {
      if (typeof value !== "string") continue;
      const visible = value.replace(/\$\{[^}]+\}/g, "").replace(/<[^>]+>/g, "");
      assert.doesNotMatch(visible, oldTerms, `${lang}.${key} still exposes room terminology`);
    }
  }
  assert.doesNotMatch(lobbyHtml + gameHtml, /(?:غرف|غرفة)/);
  assert.equal(translations.ar.pvp.leave, "مغادرة المباراة");
  assert.equal(translations.en.pvp.leave, "Leave match");
  assert.equal(translations.fr.pvp.leave, "Quitter la partie");
});
