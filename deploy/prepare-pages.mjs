#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const siteDir = path.join(root, 'site');
const dhametSiteDir = path.join(root, 'dhamet', 'site');
const dhametSharedDir = path.join(root, 'dhamet', 'shared');
const outDir = path.join(root, '.deploy', 'site');

const excludedDhametRootFiles = new Set(['_headers', '_redirects', 'robots.txt', 'sitemap.xml']);

function fail(message) {
  console.error(`prepare-pages: ${message}`);
  process.exit(1);
}
function ensureDir(dir, label) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`${label} not found: ${dir}`);
}
function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
function copyDir(from, to, filter = null) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (filter && !filter(entry.name, src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, dst, null);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}
function requireFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} missing: ${file}`);
}

ensureDir(siteDir, 'site directory');
ensureDir(dhametSiteDir, 'dhamet/site directory');
ensureDir(dhametSharedDir, 'dhamet/shared directory');
requireFile(path.join(siteDir, '_headers'), 'main site _headers');
requireFile(path.join(dhametSiteDir, 'index.html'), 'Dhamet index');
requireFile(path.join(dhametSharedDir, 'dhamet-rules.js'), 'Dhamet shared rules');

resetDir(outDir);
copyDir(siteDir, outDir);

const dhametOut = path.join(outDir, 'dhamet');
resetDir(dhametOut);
copyDir(dhametSiteDir, dhametOut, (name, _src, entry) => {
  if (!entry.isFile()) return true;
  return !excludedDhametRootFiles.has(name);
});
copyDir(dhametSharedDir, path.join(dhametOut, 'shared'));

console.log('Prepared Pages output: .deploy/site');
console.log('Dhamet public path: .deploy/site/dhamet');
