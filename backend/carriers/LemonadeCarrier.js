const BaseCarrier = require('./BaseCarrier');
const logger = require('../utils/logger');

class LemonadeCarrier extends BaseCarrier {
  constructor(page, sessionId, notify) {
    super(page, sessionId, notify);
    this.mfaType = 'email';
    this.mfaMessage = 'Enter the 6-digit code sent to your email';
    this.loginUrl = 'https://www.lemonade.com/login';
  }

  async login(credentials) {
    const { email } = credentials;

    this.notify({ type: 'status', step: 'logging_in', message: 'Opening Lemonade login...' });
    await this.page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
    await this.delay(1000 + Math.random() * 500);

    // Dismiss cookie banner if present
    await this.page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (/accept all/i.test(btn.textContent)) { btn.click(); return; }
      }
    });

    this.notify({ type: 'status', step: 'logging_in', message: 'Entering email...' });
    const emailInput = await this.page.waitForSelector(
      'input[placeholder="EMAIL ADDRESS"], input[type="email"], input[name="email"]',
      { timeout: 10000 }
    );
    await emailInput.click();
    await this.page.type(
      'input[placeholder="EMAIL ADDRESS"], input[type="email"], input[name="email"]',
      email,
      { delay: 50 + Math.random() * 80 }
    );

    await this.delay(300 + Math.random() * 300);

    this.notify({ type: 'status', step: 'logging_in', message: 'Clicking LOG IN...' });
    const loginBtn = await this.page.waitForSelector(
      'button:has-text("LOG IN"), button[type="submit"]',
      { timeout: 5000 }
    );
    await loginBtn.click();

    this.notify({ type: 'status', step: 'logging_in', message: 'Waiting for OTP page...' });
    await this.page.waitForURL('**/login#otp', { timeout: 15000 }).catch(() => {});
    await this.delay(1000);

    // Click "Send passcode by email" — use noWaitAfter since it may trigger SPA navigation
    this.notify({ type: 'status', step: 'logging_in', message: 'Switching to email OTP...' });
    const emailOtpLink = await this.page.$('a:has-text("Send passcode by email"), span:has-text("Send passcode by email"), button:has-text("Send passcode by email")');
    if (emailOtpLink) {
      await emailOtpLink.click({ noWaitAfter: true });
      await this.delay(2000);
      logger.info({ sessionId: this.sessionId }, 'Lemonade: Switched to email OTP');
    } else {
      // Fallback: try evaluate with flexible whitespace matching
      await this.page.evaluate(() => {
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (/send passcode by email/i.test(text) && el.children.length === 0) {
            el.click();
            return;
          }
        }
      });
      await this.delay(2000);
    }
    this.notify({ type: 'status', step: 'logging_in', message: 'OTP sent to email' });
  }

  async submitMFA(code) {
    const digits = code.replace(/\s/g, '').split('');
    const inputs = await this.page.$$('input');

    if (inputs.length >= 6) {
      await inputs[0].click();
      await this.delay(200);

      for (const digit of digits) {
        await this.page.keyboard.type(digit, { delay: 80 + Math.random() * 50 });
        await this.delay(100 + Math.random() * 100);
      }
    } else {
      await this.page.keyboard.type(code, { delay: 80 + Math.random() * 50 });
    }

    logger.info({ sessionId: this.sessionId }, 'Lemonade: OTP submitted');

    await this.page.waitForURL('**/me.lemonade.com**', { timeout: 20000 }).catch(async () => {
      await this.page.waitForFunction(
        () => !window.location.href.includes('/login'),
        { timeout: 15000 }
      );
    });

    await this.delay(2000);
    logger.info({ sessionId: this.sessionId }, 'Lemonade: Logged in, on dashboard');
  }

  async fetchDocuments() {
    const documents = [];

    // Wait for dashboard to fully render (React async loading)
    await this.delay(5000);

    // Close cookie banner if present (use evaluate to avoid viewport issues)
    await this.page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (/accept all/i.test(btn.textContent)) { btn.click(); return; }
      }
    });
    await this.delay(500);

    // Intercept the policies API response the dashboard fetches on reload
    const [policiesResponse] = await Promise.all([
      this.page.waitForResponse(
        res => res.url().includes('/api/v1/web_dashboard/accounts/home/policies') && res.status() === 200,
        { timeout: 15000 }
      ),
      this.page.reload({ waitUntil: 'domcontentloaded' }),
    ]);
    const policyData = await policiesResponse.json();

    const items = policyData?.data?.items || {};
    const policies = Object.values(items).filter(p => p.is_policy);
    if (policies.length === 0) {
      throw new Error('No policies found in Lemonade account');
    }

    logger.info({ sessionId: this.sessionId, count: policies.length, types: policies.map(p => p.humanized_type) }, 'Lemonade: Found policies via API');

    for (const policy of policies) {
      this.notify({ type: 'status', step: 'fetching_documents', message: `Fetching ${policy.humanized_type} policy...` });

      await this.page.goto(`https://me.lemonade.com/policy/${policy.id}`, { waitUntil: 'domcontentloaded' });
      await this.delay(3000);
      logger.info({ sessionId: this.sessionId, policyId: policy.id, url: this.page.url() }, 'Lemonade: On policy page');

      await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (/accept all/i.test(btn.textContent)) { btn.click(); return; }
        }
      });
      await this.delay(500);

      for (let i = 0; i < 8; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 400));
        await this.delay(800);
      }

      const [download] = await Promise.all([
        this.page.waitForEvent('download', { timeout: 15000 }),
        this.page.evaluate(() => {
          const links = document.querySelectorAll('a');
          for (const link of links) {
            if (/download a copy/i.test(link.textContent)) { link.click(); return true; }
          }
          return false;
        }),
      ]);

      const policyLabel = policy.humanized_type || policy.coverage_type || policy.id;
      const suggestedName = `Lemonade ${policyLabel} Policy - ${policy.id}.pdf`;
      const filePath = await download.path();

      if (filePath) {
        const fs = require('fs');
        const buffer = fs.readFileSync(filePath);
        documents.push({
          name: suggestedName,
          buffer,
          mimeType: 'application/pdf',
        });
        logger.info({ sessionId: this.sessionId, name: suggestedName, size: buffer.length }, 'Lemonade: Document downloaded');
      }
    }

    if (documents.length === 0) {
      throw new Error('No documents found in Lemonade account');
    }

    return documents;
  }
}

module.exports = LemonadeCarrier;
