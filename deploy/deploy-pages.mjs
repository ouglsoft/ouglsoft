#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dryRun = process.argv.includes('--dry-run');
const project = process.env.CLOUDFLARE_PAGES_PROJECT_NAME || process.env.CF_PAGES_PROJECT_NAME || '';
const branch = process.env.GITHUB_REF_NAME || process.env.CLOUDFLARE_PAGES_BRANCH || 'main';

function fail(message) { console.error(`deploy-pages: ${message}`); process.exit(1); }
function run(cmd, args, cwd = root) {
  if (dryRun) { console.log([cmd, ...args].join(' ')); return; }
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}

const prep = spawnSync('node', ['deploy/prepare-pages.mjs'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (prep.status !== 0) process.exit(prep.status || 1);
if (!project) fail('Set CLOUDFLARE_PAGES_PROJECT_NAME to the main OuglSoft Pages project name.');
if (!fs.existsSync(path.join(root, '.deploy', 'site', 'dhamet', 'index.html'))) fail('Prepared Dhamet index is missing.');
run('npx', ['--yes', 'wrangler', 'pages', 'deploy', '.deploy/site', '--project-name', project, '--branch', branch]);
