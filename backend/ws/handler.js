const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const SessionManager = require('../services/sessionManager');
const DocumentStore = require('../services/documentStore');
const redis = require('../services/redis');
const logger = require('../utils/logger');
const config = require('../config');

const mfaPendingMap = new Map();
const wsConnections = new Map();

function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!token) {
      socket.destroy();
      return;
    }

    try {
      const auth = verifyToken(token);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.auth = auth;
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    const sid = ws.auth.sid;
    wsConnections.set(sid, ws);
    logger.info({ sid }, 'WebSocket connected');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'mfa_submit' && msg.sessionId && msg.code) {
          submitMFA(msg.sessionId, msg.code);
        }
      } catch (err) {
        logger.error({ err }, 'Invalid WebSocket message');
      }
    });

    ws.on('close', () => {
      wsConnections.delete(sid);
      logger.info({ sid }, 'WebSocket disconnected');
    });

    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return wss;
}

function notifyClient(ownerSid, sessionId, message) {
  const ws = wsConnections.get(ownerSid);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ ...message, sessionId }));
  }
}

function waitForMFA(sessionId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      mfaPendingMap.delete(sessionId);
      reject(new Error('MFA_TIMEOUT'));
    }, config.session.mfaTimeout);

    mfaPendingMap.set(sessionId, { resolve, reject, timeout });
  });
}

function submitMFA(sessionId, code) {
  const pending = mfaPendingMap.get(sessionId);
  if (!pending) {
    logger.warn({ sessionId }, 'No pending MFA for session');
    return;
  }
  clearTimeout(pending.timeout);
  mfaPendingMap.delete(sessionId);
  pending.resolve(code);
}

async function runCarrierFlow(sessionId, carrierEntry, credentials, ownerSid, timer) {
  const client = redis.getClient();
  const sessionMgr = new SessionManager(client);
  const docStore = new DocumentStore(client);
  const { getStorageState, saveStorageState } = require('../browser/contextManager');

  let mfaMarked = false;
  const notify = (msg) => {
    if (msg.step === 'mfa_verified' && !mfaMarked) {
      timer.mark('mfa_verified');
      mfaMarked = true;
    }
    notifyClient(ownerSid, sessionId, msg);
  };
  const carrierName = carrierEntry.displayName || 'unknown';

  let page = null;
  let context = null;
  let handle = null;

  try {
    const { acquireContext, releaseContext } = require('../browser/pool');

    // Only restore session if user opted in to "Remember session"
    let savedState = null;
    if (credentials.rememberSession) {
      savedState = await getStorageState(client, carrierName, credentials.email);
      if (savedState) logger.info({ sessionId }, 'Restored previous session state');
    }
    handle = await acquireContext(savedState || undefined);
    context = handle.context;
    page = handle.page;

    timer.mark('browser_acquired');

    const CarrierClass = carrierEntry.class;
    const carrier = new CarrierClass(page, sessionId, notify);

    // 5 minute max flow timeout (excluding MFA wait)
    const flowTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Flow timed out after 5 minutes')), 300000)
    );
    const documents = await Promise.race([
      carrier.execute(credentials, waitForMFA),
      flowTimeout,
    ]);

    timer.mark('documents_fetched');

    // Only save session state if user opted in
    if (credentials.rememberSession) {
      await saveStorageState(client, carrierName, credentials.email, context).catch(err => {
        logger.warn({ err }, 'Failed to save storageState (non-fatal)');
      });
      logger.info({ sessionId }, 'Session state saved (user opted in)');
    }

    const count = await docStore.store(sessionId, documents);
    await sessionMgr.updateStatus(sessionId, 'completed', { documentCount: count });

    notify({ type: 'documents_ready', documentCount: count, timing: timer.summary(), carrier: carrierName });

    timer.mark('done');
    logger.info(timer.summary(), 'Flow completed');

    if (context) await releaseContext(handle);
    handle = null;
  } catch (err) {
    logger.error({ err, sessionId }, 'Carrier flow error');

    let screenshot = null;
    if (page) {
      screenshot = await page.screenshot({ type: 'png' }).catch(() => null);
    }

    await sessionMgr.updateStatus(sessionId, 'error', { error: err.message }).catch(() => {});
    notify({
      type: 'error',
      code: err.message,
      message: err.message,
      screenshot: screenshot ? screenshot.toString('base64') : null,
    });

    if (handle) {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }
}

module.exports = { setupWebSocket, runCarrierFlow, waitForMFA };
