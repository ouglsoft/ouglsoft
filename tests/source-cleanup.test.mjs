import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const i18nPath = path.join(root, "dhamet/site/js/i18n.js");

function translations() {
  const source = fs.readFileSync(i18nPath, "utf8");
  const start = source.indexOf("const translations = ");
  const end = source.indexOf("\n  window.translations = translations;", start);
  assert.ok(start >= 0 && end > start);
  const expression = source.slice(start + "const translations = ".length, end).trim().replace(/;$/, "");
  return vm.runInNewContext(`(${expression})`);
}

function flatten(value, prefix = "", output = {}) {
  for (const [key, item] of Object.entries(value || {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) flatten(item, full, output);
    else output[full] = String(item);
  }
  return output;
}

function placeholders(value) {
  return [...String(value).matchAll(/\$\{([^}]+)\}|\{([^}]+)\}/g)].map((match) => match[1] || match[2]).sort();
}

function filesUnder(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesUnder(target));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

test("translations have exact language parity and no unused leaves", () => {
  const data = translations();
  const maps = Object.fromEntries(["ar", "en", "fr"].map((lang) => [lang, flatten(data[lang])]));
  assert.equal(Object.keys(maps.ar).length, 404);
  for (const lang of ["en", "fr"]) {
    assert.deepEqual(Object.keys(maps[lang]).sort(), Object.keys(maps.ar).sort());
    for (const key of Object.keys(maps.ar)) assert.deepEqual(placeholders(maps[lang][key]), placeholders(maps.ar[key]), `${lang}:${key}`);
  }
  const appFiles = filesUnder(path.join(root, "dhamet/site")).filter((file) => /\.(?:js|html)$/.test(file) && file !== i18nPath);
  const source = appFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const dynamicPrefixes = ["advHelp.levelDetails.", "langs.", "log.results.pvcRejected.", "settings.levels.", "soufla.spectator.", "soufla.summary."];
  const unused = Object.keys(maps.ar).filter((key) => !source.includes(key) && !dynamicPrefixes.some((prefix) => key.startsWith(prefix)));
  assert.deepEqual(unused, []);
});

test("proven dead artifacts and declarations remain absent", () => {
  const files = filesUnder(root);
  assert.deepEqual(files.filter((file) => file.endsWith(".ast")), []);
  const source = files.filter((file) => /\.(?:js|mjs|cjs)$/.test(file) && !file.includes(`${path.sep}tests${path.sep}`)).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const symbol of ["roomStateLabel", "ACTION_SOUFLA_REMOVE", "ACTION_SOUFLA_FORCE"]) assert.ok(!source.includes(symbol), symbol);
});
