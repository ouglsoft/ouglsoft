#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const siteDir = path.join(root, 'site');
const dhametSiteDir = path.join(root, 'dhamet', 'site');
const dhametSharedDir = path.join(root, 'dhamet', 'shared');
const outDir = path.join(root, '.deploy', 'site');

const dhametPublishedEntries = new Set(['index.html', 'assets', 'css', 'js', 'pages']);


function readDhametBuild() {
  const packageJsonPath = path.join(root, 'package.json');
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const value = String(packageJson?.dhametBuild || '').trim();
    if (!value) fail('package.json dhametBuild is missing.');
    return value;
  } catch (error) {
    fail(`Cannot read dhametBuild: ${error.message}`);
  }
}
function injectBuildToken(dir, build) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) injectBuildToken(file, build);
    else if (entry.isFile() && /\.(?:html|js)$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('__DHAMET_BUILD__')) fs.writeFileSync(file, text.replaceAll('__DHAMET_BUILD__', build));
    }
  }
}

function fail(message) {
  console.error(`prepare-pages: ${message}`);
  process.exit(1);
}
function ensureDir(dir, label) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`${label} not found: ${dir}`);
}
function requireFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} missing: ${file}`);
}
function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true, dereference: true });
}
function copyDhametPublicFiles(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!dhametPublishedEntries.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

ensureDir(siteDir, 'site directory');
ensureDir(dhametSiteDir, 'dhamet/site directory');
ensureDir(dhametSharedDir, 'dhamet/shared directory');
requireFile(path.join(siteDir, '_headers'), 'main site _headers');
requireFile(path.join(siteDir, 'robots.txt'), 'main site robots.txt');
requireFile(path.join(siteDir, 'sitemap.xml'), 'main site sitemap.xml');
requireFile(path.join(dhametSiteDir, 'index.html'), 'Dhamet index');
requireFile(path.join(dhametSharedDir, 'dhamet-rules.js'), 'Dhamet shared rules');

resetDir(outDir);
copyDir(siteDir, outDir);

const dhametOut = path.join(outDir, 'dhamet');
resetDir(dhametOut);
copyDhametPublicFiles(dhametSiteDir, dhametOut);
copyDir(dhametSharedDir, path.join(dhametOut, 'shared'));
injectBuildToken(dhametOut, readDhametBuild());

console.log('Prepared Pages output: .deploy/site');
console.log('Dhamet public path: .deploy/site/dhamet');
