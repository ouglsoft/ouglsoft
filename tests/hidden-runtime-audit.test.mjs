import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const ui = read('dhamet/site/js/ui/ui-runtime.js');
const souflaView = read('dhamet/site/js/ui/soufla-view.js');
const dashboard = read('dhamet/site/js/dashboard-runtime.js');
const realtimeObject = read('dhamet/worker/src/durable/realtime-object.js');

test('rare UI notices do not call settings with an out-of-scope prefill value', () => {
  const matches = ui.match(/UI\.showSettingsModal\(prefill\)/g) || [];
  assert.equal(matches.length, 1, 'only the intentional Back button inside showAdvancedSettingsHelp may reuse prefill');
  assert.doesNotMatch(ui, /modals\.forcedOpening[\s\S]{0,500}showSettingsModal\(prefill\)/);
  assert.doesNotMatch(ui, /!Game\.history\.length[\s\S]{0,350}showSettingsModal\(prefill\)/);
});

test('PvC end presentation owns its template formatter instead of depending on lobby code', () => {
  assert.match(ui, /function formatUiTemplate\(template, vars\)/);
  assert.doesNotMatch(ui, /\bformatTpl\s*\(/);
  assert.match(ui, /formatUiTemplate\(t\("modals\.gameOver\.reason\.noPieces"\)/);
  assert.match(ui, /formatUiTemplate\(t\("modals\.gameOver\.reason\.noLegalMoves"\)/);
  assert.match(ui, /showGameOverModal\(winner\)/);
  assert.match(ui, /label:\s*t\("modals\.newGame\.title"\) \|\| t\("buttons\.newGame"\)/);
  assert.match(ui, /label:\s*t\("buttons\.home"\) \|\| t\("mode\.title"\)/);
  assert.match(ui, /onClose:\s*\(reason\) =>[\s\S]{0,160}goMode\(\)/);
});

test('Soufla view receives the shared rules dependency explicitly', () => {
  assert.match(souflaView, /Rules:\s*deps\.Rules\s*\|\|\s*root\.DhametRules/);
  assert.match(souflaView, /const Rules = d\.Rules/);
  assert.match(souflaView, /Rules\.resolveOffenderCurrentCell\(pending, offenderIdx\)/);
});

test('dashboard cleanup does not call a nonexistent profile-listener detach function', () => {
  assert.doesNotMatch(dashboard, /_detachProfileListener/);
});

test('Durable Object explicitly imports the JSON headers returned by its helper', () => {
  assert.match(realtimeObject, /import \{ json, bad, requestBody, now, jsonHeaders \} from '\.\.\/lib\/http\.js';/);
  assert.match(realtimeObject, /_headers\(\) \{ return jsonHeaders; \}/);
});
