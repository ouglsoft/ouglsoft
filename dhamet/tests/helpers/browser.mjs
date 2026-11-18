// Launches Chrome through Playwright. Playwright is not a dependency of the repository:
// the test run installs it (npm install --no-save playwright) or points NODE_PATH at it,
// and DHAMET_CHROME may name a Chrome/Chromium executable.
import { createRequire } from 'node:module';
import { serveSite } from './site-server.mjs';

const require = createRequire(import.meta.url);

export async function openBrowser(options = {}) {
  const { chromium } = require('playwright');
  const executablePath = process.env.DHAMET_CHROME || undefined;
  const browser = await chromium.launch({ executablePath, channel: executablePath ? undefined : 'chrome', args: ['--no-sandbox'] });
  const site = await serveSite();
  const context = await browser.newContext({ viewport: options.viewport || { width: 420, height: 900 } });
  // No analytics or third-party requests during tests.
  await context.route(/googletagmanager|gstatic|firebase|google-analytics/, (route) => route.abort());
  const errors = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(String(error && error.message || error))));
  const close = async () => { await browser.close(); await site.close(); };
  return { browser, context, site, errors, close };
}

export async function openGame(env, search = '') {
  const page = await env.context.newPage();
  await page.goto(`${env.site.origin}/pages/game.html${search}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Game !== 'undefined' && Game.board && typeof UI !== 'undefined' && typeof checkEndConditions === 'function', null, { timeout: 15000 });
  return page;
}
