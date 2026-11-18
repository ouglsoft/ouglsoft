// The deploy guard of the stored data: the real Worker files satisfy the contract, and
// every kind of change that would hide the stored results from a new deploy is caught.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.DHAMET_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workerDir = path.join(root, 'worker');
const { checkStorageContract } = await import(new URL('file://' + path.join(workerDir, 'storage-contract.mjs')).href);

assert.deepEqual(checkStorageContract(workerDir), [], 'the Worker files keep the stored data reachable');

// A scratch copy of the Worker's files that a case edits.
const scratch = (edit) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  for (const name of ['wrangler.toml', 'storage-contract.json']) fs.copyFileSync(path.join(workerDir, name), path.join(dir, name));
  fs.cpSync(path.join(workerDir, 'migrations'), path.join(dir, 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(workerDir, 'src', 'index.js'), path.join(dir, 'src', 'index.js'));
  edit(dir);
  return checkStorageContract(dir);
};
const rewrite = (file, from, to) => (dir) => {
  const target = path.join(dir, file);
  const before = fs.readFileSync(target, 'utf8');
  assert.ok(before.includes(from), `fixture text "${from}" exists in ${file}`);
  fs.writeFileSync(target, before.replace(from, to));
};
const cases = {
  'renamed Worker': rewrite('wrangler.toml', 'name = "dhamet-api"', 'name = "dhamet-api-2"'),
  'renamed Durable Object class': rewrite('wrangler.toml', 'class_name = "RealtimeObject"', 'class_name = "RealtimeObject2"'),
  'renamed binding': rewrite('wrangler.toml', 'name = "REALTIME"', 'name = "REALTIME_V2"'),
  'another D1 database': rewrite('wrangler.toml', 'database_id = "3f957678-fd6c-4164-8302-f5fa4b8acf16"', 'database_id = "00000000-0000-0000-0000-000000000000"'),
  'renamed migration tag': rewrite('wrangler.toml', 'tag = "v1"', 'tag = "v2"'),
  'migration that erases the class': (dir) => fs.appendFileSync(path.join(dir, 'wrangler.toml'), '\n[[migrations]]\ntag = "v2"\ndeleted_classes = ["RealtimeObject"]\n'),
  'migration that renames the class': (dir) => fs.appendFileSync(path.join(dir, 'wrangler.toml'), '\n[[migrations]]\ntag = "v2"\nrenamed_classes = [{ from = "RealtimeObject", to = "Other" }]\n'),
  'removed D1 migration file': (dir) => fs.rmSync(path.join(dir, 'migrations', '0001_initial.sql')),
  'unreviewed destructive D1 migration': (dir) => fs.writeFileSync(path.join(dir, 'migrations', '0007_x.sql'), 'DELETE FROM users;\n'),
  'Durable Object name no longer "global"': rewrite('src/index.js', "if (scope === 'global') return scope;", "if (scope === 'global') return 'global-v2';"),
};
const caught = {};
for (const [name, edit] of Object.entries(cases)) {
  const found = scratch(edit);
  assert.ok(found.length > 0, `"${name}" is caught`);
  caught[name] = found.length;
}
// Changes that do not touch the stored data stay allowed.
assert.deepEqual(scratch(rewrite('wrangler.toml', 'TURN_TTL_SECONDS = "3600"', 'TURN_TTL_SECONDS = "7200"')), [], 'a changed variable is allowed');
assert.deepEqual(scratch((dir) => fs.writeFileSync(path.join(dir, 'migrations', '0007_add.sql'), 'CREATE TABLE IF NOT EXISTS x (id TEXT);\n')), [], 'a new additive D1 migration is allowed');
assert.deepEqual(scratch((dir) => fs.appendFileSync(path.join(dir, 'wrangler.toml'), '\n[[migrations]]\ntag = "v2"\nnew_sqlite_classes = ["Another"]\n')), [], 'a new class in a new migration is allowed');
console.log(JSON.stringify({ caught: Object.keys(caught).length }));
