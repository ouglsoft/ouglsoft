#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dryRun = process.argv.includes('--dry-run');
const branch = process.env.GITHUB_REF_NAME || process.env.CLOUDFLARE_PAGES_BRANCH || 'main';

function fail(message) { console.error(`deploy-pages: ${message}`); process.exit(1); }

function readConfiguredPagesProjectName() {
  const fromEnv = process.env.CLOUDFLARE_PAGES_PROJECT_NAME || process.env.CF_PAGES_PROJECT_NAME || '';
  if (fromEnv.trim()) return fromEnv.trim();

  const packageJsonPath = path.join(root, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return '';

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return String(packageJson?.cloudflare?.pagesProjectName || '').trim();
  } catch (error) {
    fail(`Cannot read cloudflare.pagesProjectName from package.json: ${error.message}`);
  }
}

const project = readConfiguredPagesProjectName();
function run(cmd, args, cwd = root) {
  if (dryRun) { console.log([cmd, ...args].join(' ')); return; }
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}

const prep = spawnSync('node', ['deploy/prepare-pages.mjs'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (prep.status !== 0) process.exit(prep.status || 1);
if (!project) fail('Set cloudflare.pagesProjectName in package.json to the main OuglSoft Pages project name.');
if (!fs.existsSync(path.join(root, '.deploy', 'site', 'dhamet', 'index.html'))) fail('Prepared Dhamet index is missing.');
const apkDir = path.join(root, '.deploy', 'site', 'assets', 'downloads', 'apps');
for (const name of fs.existsSync(apkDir) ? fs.readdirSync(apkDir) : []) {
  if (!name.endsWith('.apk')) continue;
  if (fs.statSync(path.join(apkDir, name)).size > 25 * 1024 * 1024) {
    fail(name + ' exceeds the Pages 25 MiB asset limit. Upload it to the OUGLSOFT_APK_DOWNLOADS R2 bucket (key assets/downloads/apps/' + name + ') and keep it out of site/assets/downloads/apps/.');
  }
}
run('npx', ['--yes', 'wrangler', 'pages', 'deploy', '.deploy/site', '--project-name', project, '--branch', branch]);
