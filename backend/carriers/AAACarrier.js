const BaseCarrier = require('./BaseCarrier');
const logger = require('../utils/logger');

class AAACarrier extends BaseCarrier {
  constructor(page, sessionId, notify) {
    super(page, sessionId, notify);
    this.mfaType = 'email';
    this.mfaMessage = 'Enter the verification code sent to your email';
  }

  async login(credentials) {
    const { email, password } = credentials;

    // Step 1: Navigate to AAA login
    await this.page.goto('https://mwg.aaa.com/my-account', { waitUntil: 'domcontentloaded' });
    await this.delay(2000 + Math.random() * 1000);

    // If session cookies are valid, AAA may redirect past login
    const currentUrl = this.page.url();
    if (currentUrl.includes('mypolicy') || currentUrl.includes('csaa-insurance') || currentUrl.includes('mwg.aaa.com/my-account')) {
      const hasLoginForm = await this.page.$('input#username');
      if (!hasLoginForm) {
        logger.info({ sessionId: this.sessionId }, 'AAA: Already authenticated via restored session');
        return false;
      }
    }

    // Step 2: Email input (Auth0 Universal Login at auth.mwg.aaa.com)
    const emailInput = await this.page.waitForSelector('input#username', { timeout: 15000 });
    await emailInput.click();
    await this.delay(300);
    await emailInput.fill('');
    await emailInput.type(email, { delay: 50 + Math.random() * 80 });

    await this.delay(500 + Math.random() * 500);

    // Click the VISIBLE Continue button (Auth0 has a hidden submit button with aria-hidden)
    await this.page.click('button:has-text("Continue"):not([aria-hidden="true"])');

    // Step 3: Password — may be on the same page or a separate page
    await this.page.waitForSelector('input#password, input[type="password"]', { timeout: 15000 });
    await this.delay(500 + Math.random() * 500);

    const passwordInput = await this.page.$('input#password') || await this.page.$('input[type="password"]');
    await passwordInput.click();
    await passwordInput.type(password, { delay: 50 + Math.random() * 80 });

    await this.delay(300 + Math.random() * 300);

    // Click the visible Sign In / Continue button
    const signInBtn = await this.page.$('button:has-text("Sign In"):not([aria-hidden="true"])');
    if (signInBtn) {
      await signInBtn.click();
    } else {
      await this.page.click('button:has-text("Continue"):not([aria-hidden="true"])');
    }

    logger.info({ sessionId: this.sessionId }, 'AAA: Credentials submitted, waiting for dashboard or Okta MFA');

    // Wait for either the AAA dashboard or Okta MFA page
    await this.page.waitForURL(
      (url) => {
        const href = url.toString();
        return href.includes('mwg.aaa.com/my-account') ||
               href.includes('csaainsurance.okta.com') ||
               href.includes('mypolicy');
      },
      { timeout: 20000 }
    );

    await this.delay(1000);
  }

  async execute(credentials, waitForMFACode) {
    this.notify({ type: 'status', step: 'logging_in', message: 'Logging into AAA...' });
    const needsMFA = await this.login(credentials);

    if (needsMFA === false) {
      // Session restored — skip login, nav, and MFA, go straight to documents
      this.notify({ type: 'status', step: 'session_restored', message: 'Session restored — skipping login' });
    } else {
      this.notify({ type: 'status', step: 'logging_in', message: 'Navigating to insurance portal...' });

      // Navigate via header mega dropdown: Insurance → Manage Insurance → Manage Policy
      const insuranceNav = await this.page.waitForSelector(
        'header a:has-text("Insurance"), nav a:has-text("Insurance")',
        { timeout: 10000 }
      );
      await insuranceNav.hover();
      await this.delay(500);

      const manageInsLocator = this.page.locator('text=Manage Insurance').first();
      await manageInsLocator.hover({ timeout: 5000 });
      await this.delay(500);

      const [newPage] = await Promise.all([
        this.page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
        this.page.locator('text=Manage Policy').first().click({ noWaitAfter: true, timeout: 5000 }),
      ]);

      if (newPage) {
        await newPage.waitForLoadState('domcontentloaded');
        this.page = newPage;
        logger.info({ sessionId: this.sessionId }, 'AAA: Manage Policy opened in new tab');
      } else {
        await this.delay(2000);
      }

      await this.delay(500);
      let afterNavUrl = this.page.url();
      logger.info({ sessionId: this.sessionId, url: afterNavUrl }, 'AAA: After Manage Policy navigation');

      if (afterNavUrl.includes('/u/login') || afterNavUrl.includes('auth.')) {
        logger.info({ sessionId: this.sessionId }, 'AAA: Auth0 login required');
        try {
          await this.handleSecondLogin(credentials);
          afterNavUrl = this.page.url();
        } catch (e) {
          // Auth0 closes the popup after login — find the right page
          logger.info({ sessionId: this.sessionId, error: e.message }, 'AAA: Auth0 popup closed, scanning pages');
          await this.delay(3000);
          const pages = this.page.context().pages();
          const urls = pages.map(p => p.url());
          logger.info({ sessionId: this.sessionId, urls }, 'AAA: All open pages after Auth0');

          const oktaPage = pages.find(p => p.url().includes('okta.com'));
          const policyPage = pages.find(p => p.url().includes('mypolicy') || p.url().includes('csaa-insurance'));
          if (oktaPage) {
            this.page = oktaPage;
          } else if (policyPage) {
            this.page = policyPage;
          } else {
            // Check if dashboard page changed
            this.page = pages[0];
          }
          afterNavUrl = this.page.url();
          logger.info({ sessionId: this.sessionId, url: afterNavUrl }, 'AAA: Recovered page');
        }
      }

      if (afterNavUrl.includes('okta.com')) {
        await this.handleOktaMFA(waitForMFACode);
      } else if (afterNavUrl.includes('mypolicy') || afterNavUrl.includes('csaa-insurance')) {
        logger.info({ sessionId: this.sessionId }, 'AAA: Already past MFA, on MyPolicy');
      } else {
        // Wait on whatever page we have for a redirect
        await this.page.waitForURL(
          (url) => {
            const href = url.toString();
            return href.includes('okta.com') || href.includes('mypolicy') || href.includes('csaa-insurance');
          },
          { timeout: 20000 }
        );
        if (this.page.url().includes('okta.com')) {
          await this.handleOktaMFA(waitForMFACode);
        }
      }
    }

    // Now we should be on the MyPolicy dashboard
    this.notify({ type: 'status', step: 'fetching_documents', message: 'Fetching policy documents...' });
    const documents = await this.fetchDocuments();

    this.notify({ type: 'status', step: 'completed', message: 'Documents ready' });
    return documents;
  }

  async handleSecondLogin(credentials) {
    const { email, password } = credentials;

    // Same Auth0 flow as initial login but for the CSAA MyPolicy app
    const emailInput = await this.page.waitForSelector('input#username', { timeout: 10000 }).catch(() => null);
    if (emailInput) {
      await emailInput.click();
      await emailInput.fill('');
      await emailInput.type(email, { delay: 50 + Math.random() * 80 });
      await this.delay(500);
      await this.page.click('button:has-text("Continue"):not([aria-hidden="true"])');

      // Wait for password page
      const passwordInput = await this.page.waitForSelector('input#password, input[type="password"]', { timeout: 10000 });
      await this.delay(500);
      await passwordInput.click();
      await passwordInput.type(password, { delay: 50 + Math.random() * 80 });
      await this.delay(300);

      const signInBtn = await this.page.$('button:has-text("Sign In"):not([aria-hidden="true"])');
      if (signInBtn) {
        await signInBtn.click();
      } else {
        await this.page.click('button:has-text("Continue"):not([aria-hidden="true"])');
      }
    }

    // Wait for redirect to Okta MFA or MyPolicy
    await this.page.waitForURL(
      (url) => {
        const href = url.toString();
        return href.includes('okta.com') || href.includes('mypolicy') || href.includes('csaa-insurance') || href.includes('csae-insurance');
      },
      { timeout: 20000 }
    );
    await this.delay(2000);
    logger.info({ sessionId: this.sessionId, url: this.page.url() }, 'AAA: Second login completed');
  }

  async handleOktaMFA(waitForMFACode) {
    logger.info({ sessionId: this.sessionId }, 'AAA: On Okta MFA page');

    // Click "Send me the code" button
    const sendCodeBtn = await this.page.waitForSelector(
      'input[value="Send me the code"], a:has-text("Send me the code"), button:has-text("Send me the code")',
      { timeout: 10000 }
    );
    await sendCodeBtn.click();

    logger.info({ sessionId: this.sessionId }, 'AAA: "Send me the code" clicked');

    // Wait for the code input field to appear
    await this.page.waitForSelector(
      'input[name="credentials.passcode"], input[name="passcode"], input[type="tel"], input[name="answer"]',
      { timeout: 15000 }
    );

    // Now signal frontend for MFA code
    this.notify({ type: 'mfa_required', mfaType: 'email', message: 'Enter the verification code sent to your email' });
    this.notify({ type: 'status', step: 'awaiting_mfa', message: 'Waiting for email verification code...' });

    const code = await waitForMFACode(this.sessionId);

    this.notify({ type: 'status', step: 'submitting_mfa', message: 'Submitting verification code...' });

    // Enter the code
    await this.page.type(
      'input[name="credentials.passcode"], input[name="passcode"], input[type="tel"], input[name="answer"]',
      code,
      { delay: 80 + Math.random() * 50 }
    );

    await this.delay(500);

    // Set up API interceptor BEFORE verify click — dashboard calls policies API on load
    this._policiesPromise = this.page.waitForResponse(
      res => res.url().includes('/api-customers/v1/customers/policies') && res.status() === 200,
      { timeout: 30000 }
    ).catch(() => null);

    // Click verify/submit button
    await this.page.click('input[type="submit"], button[type="submit"], input[value="Verify"], button:has-text("Verify")');

    logger.info({ sessionId: this.sessionId }, 'AAA: MFA verify clicked, waiting for policies API');
  }

  async fetchDocuments() {
    const documents = [];

    this.notify({ type: 'status', step: 'fetching_documents', message: 'Fetching policy data...' });

    // Get policies from intercepted API response (set up in handleOktaMFA)
    let policies = [];
    if (this._policiesPromise) {
      const resp = await this._policiesPromise;
      // Mark MFA verified — Okta redirect complete, MyPolicy loaded
      this.notify({ type: 'status', step: 'mfa_verified', message: 'MFA verified, fetching documents...' });
      if (resp) {
        try {
          const data = await resp.json();
          policies = (data.policies || []).map(p => {
            const year = (p.effectiveDate || '').split('/').pop();
            return { number: p.policyNumber, urlId: `${p.policyNumber}${year}`, type: p.policyType };
          });
        } catch {}
      }
    }

    // Fallback: navigate to /policies and scrape from page text
    if (policies.length === 0) {
      logger.info({ sessionId: this.sessionId }, 'AAA: API intercept missed, falling back to page scrape');
      await this.page.goto('https://www.mypolicy.csaa-insurance.aaa.com/policies', { waitUntil: 'domcontentloaded' });
      for (let i = 0; i < 12; i++) {
        const found = await this.page.evaluate(() => {
          const matches = [...document.body.textContent.matchAll(/[A-Z]{2,6}\d{5,}/g)];
          return [...new Set(matches.map(m => m[0]))];
        });
        if (found.length > 0) {
          policies = found.map(n => ({ number: n, urlId: n, type: 'Unknown' }));
          break;
        }
        await this.delay(600);
      }
    }

    logger.info({ sessionId: this.sessionId, policies }, 'AAA: Found policies');

    if (policies.length === 0) {
      throw new Error('Could not find any policies on AAA account');
    }

    for (const policy of policies) {
      this.notify({ type: 'status', step: 'fetching_documents', message: `Opening document library for ${policy.number}...` });

      // Intercept catalog API request headers + response
      let catalogHeaders = null;
      const reqHandler = (req) => {
        if (req.url().includes('/api-documents/v1/documents/retrieve') && !req.url().includes('/retrieve/')) {
          catalogHeaders = req.headers();
        }
      };
      this.page.on('request', reqHandler);

      const catalogPromise = this.page.waitForResponse(
        res => {
          const u = res.url();
          return u.includes('/api-documents/v1/documents/retrieve') && !u.includes('/retrieve/') && res.status() === 200;
        },
        { timeout: 15000 }
      ).catch(() => null);

      await this.page.goto(
        `https://www.mypolicy.csaa-insurance.aaa.com/documents/${policy.urlId}`,
        { waitUntil: 'domcontentloaded' }
      );

      const catalogResp = await catalogPromise;
      this.page.removeListener('request', reqHandler);

      if (catalogResp && catalogHeaders) {
        const catalog = await catalogResp.json();
        const currentDocs = catalog.currentDocuments || [];

        const policyDocs = currentDocs.filter(d => {
          const name = (d.documentDescription || '').toLowerCase();
          return name.includes('policy') && !name.includes('privacy') && !name.includes('enrollment');
        });
        const toFetch = policyDocs.length > 0 ? policyDocs : [currentDocs[0]];

        logger.info({ sessionId: this.sessionId, found: toFetch.map(d => d.documentDescription) }, 'AAA: Policy docs found in catalog');

        const authHeaders = {
          'authorization': catalogHeaders['authorization'],
          'x-api-key': catalogHeaders['x-api-key'],
          'customer-key': catalogHeaders['customer-key'],
        };

        for (const doc of toFetch) {
          const docName = doc.documentDescription;
          this.notify({ type: 'status', step: 'fetching_documents', message: `Downloading ${docName}...` });

          const pdfUrl = `https://www.mypolicy.csaa-insurance.aaa.com/api-documents/v1/documents/retrieve/${doc.documentIdentifier}`;
          const resp = await this.page.context().request.get(pdfUrl, { headers: authHeaders });
          if (resp.ok()) {
            let buffer = Buffer.from(await resp.body());
            // API returns base64-encoded PDF — decode it
            const head = buffer.slice(0, 5).toString('utf8');
            if (head === 'JVBER') {
              buffer = Buffer.from(buffer.toString('utf8'), 'base64');
            }
            documents.push({ name: `${docName}.pdf`, buffer, mimeType: 'application/pdf' });
            logger.info({ sessionId: this.sessionId, name: docName, size: buffer.length }, 'AAA: Document downloaded via API');
          }
        }
      } else {
        // Fallback: wait for blob links
        logger.info({ sessionId: this.sessionId }, 'AAA: Catalog intercept missed, falling back to blob links');
        await this.page.waitForFunction(() => {
          return Array.from(document.querySelectorAll('a[href^="blob:"]'))
            .some(a => /\bpolicy\b/i.test(a.textContent) && !/privacy/i.test(a.textContent));
        }, { timeout: 20000 }).catch(() => null);

        const blobLinks = await this.page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href^="blob:"]'))
            .map(a => ({ text: a.textContent.trim(), href: a.href }));
        });

        const selected = blobLinks.filter(l => {
          const t = l.text.toLowerCase();
          return t.includes('policy') && !t.includes('privacy');
        });
        if (selected.length === 0 && blobLinks.length > 0) selected.push(blobLinks[0]);

        for (const doc of selected) {
          const b64 = await this.page.evaluate(async (blobUrl) => {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.readAsDataURL(blob);
            });
          }, doc.href);

          const buffer = Buffer.from(b64, 'base64');
          documents.push({ name: `${doc.text}.pdf`, buffer, mimeType: 'application/pdf' });
          logger.info({ sessionId: this.sessionId, name: doc.text, size: buffer.length }, 'AAA: Document downloaded (blob fallback)');
        }
      }
    }

    if (documents.length === 0) {
      throw new Error('No documents could be downloaded from AAA portal');
    }

    return documents;
  }

}

module.exports = AAACarrier;
