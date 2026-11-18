// The deploy-time guard of the stored data (results, points, ranking, accounts).
//
// The results live in a Durable Object (class RealtimeObject, object name "global") and the
// accounts in D1. Both are found again by a new Worker only through names: the Worker name,
// the binding names, the class name, the D1 database id and the migration history. A deploy
// that changes one of them does not delete anything, but the new Worker then opens an empty
// object or database, and the data "disappears" until the deploy is rolled back.
//
// checkStorageContract() compares the Worker's files with storage-contract.json and returns
// the list of violations (empty when the deploy is safe). It is used by the deploy script,
// which refuses to deploy on any violation, and by the tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseWrangler(text) {
  const top = {};
  const tables = [];
  let current = top;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const table = line.match(/^\[\[?([A-Za-z0-9_.-]+)\]\]?\s*(?:#.*)?$/);
    if (table) {
      current = { _table: table[1] };
      tables.push(current);
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!pair) continue;
    let value = pair[2].trim();
    const quoted = value.match(/^"([^"]*)"/);
    if (quoted) value = quoted[1];
    else if (value.startsWith('[')) value = (value.match(/"([^"]*)"/g) || []).map((v) => v.slice(1, -1));
    current[pair[1]] = value;
  }
  return { top, tables };
}

function list(value) { return Array.isArray(value) ? value : value ? [value] : []; }

export function checkStorageContract(workerDir, contractOverride) {
  const problems = [];
  const contract = contractOverride || JSON.parse(fs.readFileSync(path.join(workerDir, 'storage-contract.json'), 'utf8'));
  const wrangler = parseWrangler(fs.readFileSync(path.join(workerDir, 'wrangler.toml'), 'utf8'));
  const named = (table) => wrangler.tables.filter((t) => t._table === table);

  if (wrangler.top.name !== contract.worker) problems.push(`wrangler.toml: Worker name is "${wrangler.top.name}", must stay "${contract.worker}" (a renamed Worker gets new, empty Durable Object storage)`);

  const bindings = named('durable_objects.bindings');
  if (bindings.length !== 1) problems.push(`wrangler.toml: exactly one Durable Object binding is expected, found ${bindings.length}`);
  const binding = bindings[0] || {};
  if (binding.name !== contract.durableObject.binding) problems.push(`wrangler.toml: Durable Object binding is "${binding.name}", must stay "${contract.durableObject.binding}"`);
  if (binding.class_name !== contract.durableObject.class) problems.push(`wrangler.toml: Durable Object class is "${binding.class_name}", must stay "${contract.durableObject.class}"`);
  if (binding.script_name) problems.push('wrangler.toml: the Durable Object binding must belong to this Worker (script_name is set)');

  const databases = named('d1_databases');
  if (databases.length !== 1) problems.push(`wrangler.toml: exactly one D1 database is expected, found ${databases.length}`);
  const database = databases[0] || {};
  for (const [key, expected] of [['binding', contract.d1.binding], ['database_name', contract.d1.databaseName], ['database_id', contract.d1.databaseId]]) {
    if (database[key] !== expected) problems.push(`wrangler.toml: D1 ${key} is "${database[key]}", must stay "${expected}" (another database is an empty one)`);
  }

  const migrations = named('migrations');
  const tags = migrations.map((m) => m.tag);
  contract.migrationTags.forEach((tag, at) => {
    if (tags[at] !== tag) problems.push(`wrangler.toml: migration #${at + 1} must stay "${tag}" (the history is append-only), found "${tags[at]}"`);
  });
  if (new Set(tags).size !== tags.length) problems.push('wrangler.toml: migration tags must be unique');
  for (const m of migrations) {
    for (const key of ['deleted_classes', 'renamed_classes', 'transferred_classes']) {
      if (key in m) problems.push(`wrangler.toml: migration "${m.tag}" uses ${key}, which moves or erases the stored data`);
    }
  }
  const created = migrations.flatMap((m) => list(m.new_sqlite_classes).concat(list(m.new_classes)));
  if (!created.includes(contract.durableObject.class)) problems.push(`wrangler.toml: no migration creates ${contract.durableObject.class}`);

  const entry = fs.readFileSync(path.join(workerDir, 'src', 'index.js'), 'utf8');
  if (!new RegExp(`export\\s*\\{\\s*${contract.durableObject.class}\\s*\\}`).test(entry)) problems.push(`src/index.js must export ${contract.durableObject.class}`);
  if (!/idFromName\(sanitizeRealtimeScope\(scope\)\)/.test(entry) || !/if \(!scope\) return 'global';/.test(entry) || !/if \(scope === 'global'\) return scope;/.test(entry)) {
    problems.push('src/index.js: the Durable Object names ("global", "game:<id>", "rate:<id>") are derived differently; results are stored in the object named "global"');
  }

  const files = fs.existsSync(path.join(workerDir, 'migrations')) ? fs.readdirSync(path.join(workerDir, 'migrations')).filter((n) => n.endsWith('.sql')).sort() : [];
  for (const known of contract.d1Migrations) if (!files.includes(known)) problems.push(`migrations/${known} is missing (migrations are never removed or renamed)`);
  for (const file of files) {
    if (contract.d1Migrations.includes(file)) continue;
    const sql = fs.readFileSync(path.join(workerDir, 'migrations', file), 'utf8').replace(/--.*$/gm, '');
    if (/\b(DROP\s+(TABLE|COLUMN|INDEX)|DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET)\b/i.test(sql)) {
      problems.push(`migrations/${file} changes or erases existing rows; review it, then list it in storage-contract.json (d1Migrations) to confirm it is meant`);
    }
  }
  return problems;
}

export { parseWrangler };

// `node dhamet/worker/storage-contract.mjs` prints the violations and exits 1 when there are any.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = checkStorageContract(path.dirname(fileURLToPath(import.meta.url)));
  if (found.length) {
    console.error('Stored-data contract violated (nothing was deployed):\n- ' + found.join('\n- '));
    process.exit(1);
  }
  console.log('Stored-data contract: ok');
}
