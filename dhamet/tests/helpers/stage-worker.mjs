// The worker imports the shared engine as ../../shared/*, which exists only in the
// deployed layout (deploy/deploy-worker.mjs copies dhamet/shared next to src). Tests
// that load worker modules stage the same layout in a temporary directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// DHAMET_ROOT points the tests at another copy of the code (to watch a test fail on an older version).
const root = process.env.DHAMET_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function stageWorker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhamet-worker-'));
  fs.cpSync(path.join(root, 'worker', 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(root, 'shared'), path.join(dir, 'shared'), { recursive: true });
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp dir */ } });
  return {
    dir,
    importModule: (relative) => import(pathToFileURL(path.join(dir, 'src', relative)).href),
  };
}
