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

    // If session cookies are valid, Lemonade redirects straight to the dashboard
    if (this.page.url().includes('me.lemonade.com')) {
      logger.info({ sessionId: this.sessionId }, 'Lemonade: Already authenticated via restored session');
      return false;
    }

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
    // Set up API listener BEFORE typing OTP — redirect fires immediately after last digit
    this._policiesPromise = this.page.waitForResponse(
      res => res.url().includes('/api/v1/web_dashboard/accounts/home/policies') && res.status() === 200,
      { timeout: 30000 }
    ).catch(() => null);

    const digits = code.replace(/\s/g, '').split('');
    const inputs = await this.page.$$('input');

    if (inputs.length >= 6) {
      await inputs[0].click();
      await this.delay(100);

      for (const digit of digits) {
        await this.page.keyboard.type(digit, { delay: 50 + Math.random() * 30 });
        await this.delay(60 + Math.random() * 60);
      }
    } else {
      await this.page.keyboard.type(code, { delay: 50 + Math.random() * 30 });
    }

    logger.info({ sessionId: this.sessionId }, 'Lemonade: OTP submitted');

    await this.page.waitForURL('**/me.lemonade.com**', { timeout: 20000 }).catch(async () => {
      await this.page.waitForFunction(
        () => !window.location.href.includes('/login'),
        { timeout: 15000 }
      );
    });

    logger.info({ sessionId: this.sessionId }, 'Lemonade: Logged in, on dashboard');
  }

  async fetchDocuments() {
    const documents = [];

    await this.page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (/accept all/i.test(btn.textContent)) { btn.click(); return; }
      }
    });

    // Use the response intercepted during MFA redirect if available
    let policyData;
    const intercepted = this._policiesPromise ? await this._policiesPromise : null;
    this.notify({ type: 'status', step: 'mfa_verified', message: 'MFA verified, fetching documents...' });
    if (intercepted) {
      policyData = await intercepted.json();
    } else {
      // Fallback: reload to trigger the API call
      const [resp] = await Promise.all([
        this.page.waitForResponse(
          res => res.url().includes('/api/v1/web_dashboard/accounts/home/policies') && res.status() === 200,
          { timeout: 15000 }
        ),
        this.page.reload({ waitUntil: 'domcontentloaded' }),
      ]);
      policyData = await resp.json();
    }

    const items = policyData?.data?.items || {};
    const policies = Object.values(items).filter(p => p.is_policy);
    if (policies.length === 0) {
      throw new Error('No policies found in Lemonade account');
    }

    logger.info({ sessionId: this.sessionId, count: policies.length, types: policies.map(p => p.humanized_type) }, 'Lemonade: Found policies via API');

    for (const policy of policies) {
      this.notify({ type: 'status', step: 'fetching_documents', message: `Fetching ${policy.humanized_type} policy...` });

      const policyLabel = policy.humanized_type || policy.coverage_type || policy.id;
      const suggestedName = `Lemonade ${policyLabel} Policy - ${policy.id}.pdf`;

      const downloadUrl = policy.form_url;
      if (downloadUrl) {
        logger.info({ sessionId: this.sessionId, policyId: policy.id }, 'Lemonade: Downloading via form_url (skipping page nav)');
        const response = await this.page.context().request.get(downloadUrl);
        const buffer = Buffer.from(await response.body());
        documents.push({ name: suggestedName, buffer, mimeType: 'application/pdf' });
        logger.info({ sessionId: this.sessionId, name: suggestedName, size: buffer.length }, 'Lemonade: Document downloaded');
      } else {
        await this.page.goto(`https://me.lemonade.com/policy/${policy.id}`, { waitUntil: 'domcontentloaded' });
        const downloadLink = await this.page.waitForSelector('a:has-text("download a copy")', { timeout: 10000 }).catch(() => null);
        const href = downloadLink ? await downloadLink.getAttribute('href') : null;
        if (href) {
          const response = await this.page.context().request.get(href);
          const buffer = Buffer.from(await response.body());
          documents.push({ name: suggestedName, buffer, mimeType: 'application/pdf' });
          logger.info({ sessionId: this.sessionId, name: suggestedName, size: buffer.length }, 'Lemonade: Document downloaded (fallback)');
        }
      }
    }

    if (documents.length === 0) {
      throw new Error('No documents found in Lemonade account');
    }

    return documents;
  }
}

module.exports = LemonadeCarrier;
