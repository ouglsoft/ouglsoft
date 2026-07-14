#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dryRun = process.argv.includes('--dry-run');
const workerSrc = path.join(root, 'dhamet', 'worker');
const sharedSrc = path.join(root, 'dhamet', 'shared');
const outDir = path.join(root, '.deploy', 'dhamet-worker');

function fail(message) { console.error(`deploy-worker: ${message}`); process.exit(1); }
function ensureDir(dir, label) { if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`${label} not found: ${dir}`); }
function copyDir(from, to) { fs.mkdirSync(to, { recursive: true }); fs.cpSync(from, to, { recursive: true, force: true, dereference: true }); }
function run(cmd, args, cwd = outDir) {
  if (dryRun) { console.log([cmd, ...args].join(' ')); return; }
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}
function parseDatabaseName(toml) {
  const envName = process.env.CLOUDFLARE_D1_DATABASE_NAME || process.env.CF_D1_DATABASE_NAME;
  if (envName) return envName;
  const m = toml.match(/^database_name\s*=\s*"([^"]+)"/m);
  return m ? m[1] : '';
}

ensureDir(workerSrc, 'dhamet/worker');
ensureDir(path.join(workerSrc, 'src'), 'dhamet/worker/src');
ensureDir(sharedSrc, 'dhamet/shared');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
copyDir(path.join(workerSrc, 'src'), path.join(outDir, 'src'));
copyDir(sharedSrc, path.join(outDir, 'shared'));
if (fs.existsSync(path.join(workerSrc, 'migrations'))) copyDir(path.join(workerSrc, 'migrations'), path.join(outDir, 'migrations'));
fs.copyFileSync(path.join(workerSrc, 'wrangler.toml'), path.join(outDir, 'wrangler.toml'));

const wranglerToml = fs.readFileSync(path.join(outDir, 'wrangler.toml'), 'utf8');
const dbName = parseDatabaseName(wranglerToml);
if (fs.existsSync(path.join(outDir, 'migrations')) && fs.readdirSync(path.join(outDir, 'migrations')).some((n) => n.endsWith('.sql'))) {
  if (!dbName) fail('D1 database name missing. Set CLOUDFLARE_D1_DATABASE_NAME or database_name in wrangler.toml.');
  run('npx', ['--yes', 'wrangler', 'd1', 'migrations', 'apply', dbName, '--remote', '--config', 'wrangler.toml']);
}
run('npx', ['--yes', 'wrangler', 'deploy', '--config', 'wrangler.toml']);
