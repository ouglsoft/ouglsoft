import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dhametSite = path.join(root, "dhamet/site");
const assetRoots = [
  path.join(root, "dhamet/site/assets"),
  path.join(root, "site/assets"),
];
const imageExt = new Set([".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".ico", ".avif"]);
const textExt = new Set([".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".xml"]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isInside(file, dir) {
  const rel = path.relative(dir, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

test("all shipped images and icons are referenced and unique", () => {
  const textFiles = walk(root).filter((file) => {
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    if (rel.startsWith(".git/") || rel.startsWith("node_modules/") || rel.startsWith(".deploy/")) return false;
    if (assetRoots.some((assetRoot) => isInside(file, assetRoot))) return false;
    return textExt.has(path.extname(file).toLowerCase());
  });
  const corpus = textFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const appRuntime = fs.readFileSync(path.join(dhametSite, "js/app-runtime.js"), "utf8");
  const assets = assetRoots.flatMap((assetRoot) => walk(assetRoot)).filter((file) => imageExt.has(path.extname(file).toLowerCase()));

  const unused = [];
  for (const file of assets) {
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    const siteRel = path.relative(dhametSite, file).replaceAll(path.sep, "/");
    const base = path.basename(file);
    const avatar = siteRel.startsWith("assets/icons/users/");
    const used = corpus.includes(rel) || corpus.includes(siteRel) || corpus.includes(base) || (avatar && appRuntime.includes(siteRel));
    if (!used) unused.push(rel);
  }
  assert.deepEqual(unused, [], `Unused image assets remain:\n${unused.join("\n")}`);

  const byHash = new Map();
  for (const file of assets) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    const group = byHash.get(hash) || [];
    group.push(rel);
    byHash.set(hash, group);
  }
  const duplicates = [...byHash.values()].filter((group) => group.length > 1);
  assert.deepEqual(duplicates, [], `Duplicate image assets remain: ${JSON.stringify(duplicates)}`);
});
