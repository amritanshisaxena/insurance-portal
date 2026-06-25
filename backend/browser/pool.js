const logger = require('../utils/logger');
const config = require('../config');
const { applyStealthPatches } = require('./stealth');

let browser = null;
let launching = false;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launching) {
    await new Promise((r) => setTimeout(r, 500));
    return getBrowser();
  }

  launching = true;
  try {
    const { chromium } = require('patchright');
    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-component-update',
        '--window-size=1366,768',
        '--lang=en-US,en',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    browser.on('disconnected', () => {
      logger.warn('Browser disconnected, will relaunch on next request');
      browser = null;
    });

    logger.info('Patchright browser launched');
    return browser;
  } catch (err) {
    logger.error({ err }, 'Failed to launch browser');
    throw err;
  } finally {
    launching = false;
  }
}

async function acquireContext(storageState = null) {
  const b = await getBrowser();

  const contextOptions = {
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    bypassCSP: true,
    acceptDownloads: true,
    ...(storageState ? { storageState } : {}),
    ...(config.proxy ? { proxy: config.proxy } : {}),
  };

  const context = await b.newContext(contextOptions);
  const page = await context.newPage();
  await applyStealthPatches(page);

  return { context, page, id: Date.now() };
}

async function releaseContext(handle) {
  try {
    if (handle.context) await handle.context.close();
  } catch (err) {
    logger.error({ err }, 'Error closing browser context');
  }
}

async function shutdown() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

module.exports = { acquireContext, releaseContext, shutdown };
