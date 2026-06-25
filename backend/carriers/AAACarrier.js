const BaseCarrier = require('./BaseCarrier');
const logger = require('../utils/logger');
const fs = require('fs');

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
    await this.login(credentials);

    this.notify({ type: 'status', step: 'logging_in', message: 'Navigating to insurance portal...' });

    // Navigate via header mega dropdown: Insurance → Manage Insurance → Manage Policy
    // Step 1: Hover "Insurance" in header to open dropdown
    const insuranceNav = await this.page.waitForSelector(
      'header a:has-text("Insurance"), nav a:has-text("Insurance")',
      { timeout: 10000 }
    );
    await insuranceNav.hover();
    await this.delay(1500);

    // Step 2: Hover "Manage Insurance" in the left column
    // Use locator to find it within the visible dropdown
    const manageInsLocator = this.page.locator('text=Manage Insurance').first();
    await manageInsLocator.hover({ timeout: 5000 });
    await this.delay(1500);

    // Step 3: Click "Manage Policy" in the right column
    // Use noWaitAfter since it may open a new tab or trigger a slow redirect
    const [newPage] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
      this.page.locator('text=Manage Policy').first().click({ noWaitAfter: true, timeout: 5000 }),
    ]);

    if (newPage) {
      await newPage.waitForLoadState('domcontentloaded');
      this.page = newPage;
      logger.info({ sessionId: this.sessionId }, 'AAA: Manage Policy opened in new tab');
    } else {
      await this.delay(3000);
    }

    logger.info({ sessionId: this.sessionId, url: this.page.url() }, 'AAA: After Manage Policy click');

    // "Manage Policy & Billing" opens a second Auth0 login for the CSAA MyPolicy app
    // Handle popup (new tab) or same-tab navigation
    const popup = await this.page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
    if (popup) {
      await popup.waitForLoadState('domcontentloaded');
      this.page = popup;
    }

    await this.delay(2000);
    let afterNavUrl = this.page.url();
    logger.info({ sessionId: this.sessionId, url: afterNavUrl }, 'AAA: After Manage Policy click');

    // Second Auth0 login: "Manage Policy" triggers a new Auth0 flow for CSAA MyPolicy app
    if (afterNavUrl.includes('auth.mwg.aaa.com') || afterNavUrl.includes('/u/login')) {
      logger.info({ sessionId: this.sessionId }, 'AAA: Second Auth0 login for MyPolicy portal');
      await this.handleSecondLogin(credentials);
      afterNavUrl = this.page.url();
    }

    if (afterNavUrl.includes('okta.com')) {
      await this.handleOktaMFA(waitForMFACode);
    } else if (afterNavUrl.includes('mypolicy') || afterNavUrl.includes('csaa-insurance')) {
      logger.info({ sessionId: this.sessionId }, 'AAA: Already past MFA, on MyPolicy');
    } else {
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
    await this.delay(1000);
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

    // Click verify/submit button
    await this.page.click('input[type="submit"], button[type="submit"], input[value="Verify"], button:has-text("Verify")');

    // Wait for redirect to MyPolicy
    await this.page.waitForURL(
      (url) => url.toString().includes('mypolicy') || url.toString().includes('csaa-insurance'),
      { timeout: 20000 }
    );

    await this.delay(2000);
    logger.info({ sessionId: this.sessionId }, 'AAA: Okta MFA passed, on MyPolicy dashboard');
  }

  async fetchDocuments() {
    const documents = [];
    const currentUrl = this.page.url();

    // Navigate to policies page to discover all policy numbers
    this.notify({ type: 'status', step: 'fetching_documents', message: 'Navigating to policies...' });

    if (!currentUrl.includes('/policies')) {
      const viewPolicies = await this.page.$('a:has-text("View policies"), button:has-text("View policies")');
      if (viewPolicies) {
        await viewPolicies.click();
      } else {
        await this.page.goto('https://mypolicy.csaa-insurance.aaa.com/policies', { waitUntil: 'domcontentloaded' });
      }
    }
    await this.delay(5000);

    // Find ALL policy numbers on the page (retry until rendered)
    let policyNumbers = [];
    for (let i = 0; i < 6; i++) {
      policyNumbers = await this.page.evaluate(() => {
        const matches = [...document.body.textContent.matchAll(/[A-Z]{2,6}\d{5,}/g)];
        return [...new Set(matches.map(m => m[0]))];
      });
      if (policyNumbers.length > 0) break;
      await this.delay(2000);
    }

    logger.info({ sessionId: this.sessionId, policyNumbers }, 'AAA: Found policy numbers');

    if (policyNumbers.length === 0) {
      throw new Error('Could not find any policy numbers on AAA policies page');
    }

    // For each policy, navigate to its document library and download matching docs
    for (const policyNumber of policyNumbers) {
      this.notify({ type: 'status', step: 'fetching_documents', message: `Opening document library for ${policyNumber}...` });

      await this.page.goto(
        `https://mypolicy.csaa-insurance.aaa.com/documents/${policyNumber}`,
        { waitUntil: 'domcontentloaded' }
      );
      await this.delay(5000);
      logger.info({ sessionId: this.sessionId, policyNumber, url: this.page.url() }, 'AAA: On document library');

      for (let i = 0; i < 4; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 400));
        await this.delay(1000);
      }

      let docLinks = await this.page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
          .filter(a => {
            const t = a.textContent.toLowerCase();
            return t.includes('member') && t.includes('policy');
          })
          .map(a => a.textContent.trim());
      });

      if (docLinks.length === 0) {
        logger.warn({ sessionId: this.sessionId, policyNumber }, 'AAA: No "member"+"policy" docs, trying broader match');
        docLinks = await this.page.evaluate(() => {
          return Array.from(document.querySelectorAll('a'))
            .filter(a => {
              const t = a.textContent.toLowerCase().trim();
              return t.includes('policy') && t.length > 5 && t.length < 80
                && !t.includes('edit') && !t.includes('quote') && !t.includes('link your') && !t.includes('view');
            })
            .map(a => a.textContent.trim());
        });
      }

      logger.info({ sessionId: this.sessionId, policyNumber, docLinks }, 'AAA: Document links found');

      for (const docName of docLinks) {
        this.notify({ type: 'status', step: 'fetching_documents', message: `Downloading ${docName}...` });
        const pdfBuffer = await this.downloadDocument(docName);
        if (pdfBuffer) {
          documents.push({
            name: `${docName}.pdf`,
            buffer: pdfBuffer,
            mimeType: 'application/pdf',
          });
          logger.info({ sessionId: this.sessionId, name: docName, size: pdfBuffer.length }, 'AAA: Document downloaded');
        }
      }
    }

    if (documents.length === 0) {
      throw new Error('No documents could be downloaded from AAA portal');
    }

    return documents;
  }

  async downloadDocument(docName) {
    // Set up listeners before clicking — documents open as blob URLs in new tabs
    const [newTab] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null),
      this.page.locator(`a:has-text("${docName}")`).first().click({ noWaitAfter: true }),
    ]);

    // Case 1: Document opened in a new tab (blob URL)
    if (newTab) {
      await newTab.waitForLoadState('load', { timeout: 15000 });
      await this.delay(2000);
      const url = newTab.url();
      logger.info({ sessionId: this.sessionId, url }, 'AAA: Document opened in new tab');

      try {
        const bufferArray = await newTab.evaluate(async () => {
          const response = await fetch(window.location.href);
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          return Array.from(new Uint8Array(arrayBuffer));
        });
        await newTab.close();
        return Buffer.from(bufferArray);
      } catch (err) {
        logger.warn({ err }, 'AAA: Failed to fetch blob content, trying PDF capture');
        // Try getting the PDF via the page's content
        try {
          const pdfBytes = await newTab.pdf();
          await newTab.close();
          return pdfBytes;
        } catch {
          await newTab.close().catch(() => {});
        }
      }
    }

    // Case 2: PDF response intercepted on the same page
    // Wait briefly for any download event
    const download = await this.page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    if (download) {
      const filePath = await download.path();
      if (filePath) {
        return fs.readFileSync(filePath);
      }
    }

    return null;
  }
}

module.exports = AAACarrier;
