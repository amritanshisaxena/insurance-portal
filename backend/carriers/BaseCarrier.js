class BaseCarrier {
  constructor(page, sessionId, notify) {
    this.page = page;
    this.sessionId = sessionId;
    this.notify = notify;
  }

  async login(_credentials) { throw new Error('Not implemented'); }
  async submitMFA(_code) { throw new Error('Not implemented'); }
  async fetchDocuments() { throw new Error('Not implemented'); }

  async execute(credentials, waitForMFACode) {
    this.notify({ type: 'status', step: 'logging_in', message: 'Logging in...' });
    const needsMFA = await this.login(credentials);

    if (needsMFA !== false) {
      this.notify({ type: 'mfa_required', mfaType: this.mfaType || 'code', message: this.mfaMessage || 'Enter verification code' });
      this.notify({ type: 'status', step: 'awaiting_mfa', message: 'Waiting for verification code...' });

      const code = await waitForMFACode(this.sessionId);

      this.notify({ type: 'status', step: 'submitting_mfa', message: 'Submitting verification code...' });
      await this.submitMFA(code);
    } else {
      this.notify({ type: 'status', step: 'session_restored', message: 'Session restored — skipping login' });
    }

    this.notify({ type: 'status', step: 'fetching_documents', message: 'Fetching documents...' });
    const documents = await this.fetchDocuments();

    this.notify({ type: 'status', step: 'completed', message: 'Documents ready' });
    return documents;
  }

  async humanType(selector, text) {
    const el = await this.page.waitForSelector(selector, { timeout: 10000 });
    await el.click();
    await this.page.type(selector, text, { delay: 50 + Math.random() * 80 });
  }

  async humanClick(selector) {
    const el = await this.page.waitForSelector(selector, { timeout: 10000 });
    await el.scrollIntoViewIfNeeded();
    await this.delay(200 + Math.random() * 300);
    await el.click();
  }

  async delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async retry(fn, retries = 1) {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === retries) throw err;
        await this.delay(1000);
      }
    }
  }
}

module.exports = BaseCarrier;
