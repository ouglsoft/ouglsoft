// Static checks for the Dhamet code. Run from the repository root:
//   npx --yes eslint@9 --config dhamet/tests/eslint.config.mjs dhamet
// (dhamet/tests/run-all.mjs runs it with the other checks.)
//
//  - no-undef: a name that is not declared in its file, not provided by the platform and
//    not in the shared list (lint-globals.mjs) is an error. This is the check that would have
//    caught `formatTpl`, `DhametRules` and `_detachProfileListener` before they were published.
//  - no-restricted-globals (self): in the browser `self` is the window, so a missing
//    `const self = this` silently reads the wrong object (as in the move sender). Only the
//    Web Worker script may use it.
//  - no-empty: no empty blocks. Empty `catch {}` blocks are allowed for now because there are
//    about 1,300 of them and sorting them is a separate piece of work; every other empty block is an error.
import { appGlobals, browserGlobals, nodeGlobals, pageTestGlobals, webWorkerGlobals, workerGlobals } from './lint-globals.mjs';

const rules = {
  'no-undef': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-restricted-globals': ['error', { name: 'self', message: 'In the browser `self` is the window. Use `globalThis`, or bind the object explicitly (`const self = this`).' }],
};

export default [
  { ignores: ['**/node_modules/**', '**/.deploy/**'] },
  {
    files: ['dhamet/site/js/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...browserGlobals, ...appGlobals } },
    rules,
  },
  {
    files: ['dhamet/site/js/ai.worker.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...webWorkerGlobals, ...appGlobals } },
    rules: { ...rules, 'no-restricted-globals': 'off' },
  },
  {
    files: ['dhamet/shared/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...browserGlobals } },
    rules,
  },
  {
    files: ['dhamet/worker/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...workerGlobals } },
    rules,
  },
  {
    files: ['dhamet/tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...nodeGlobals } },
    rules,
  },
  {
    // The functions given to page.evaluate run inside the page, so they may use the page's names.
    files: ['dhamet/tests/browser/**/*.mjs', 'dhamet/tests/helpers/browser.mjs'],
    languageOptions: { globals: { ...browserGlobals, ...appGlobals, ...pageTestGlobals } },
  },
  {
    files: ['dhamet/tests/**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...nodeGlobals } },
    rules,
  },
];
