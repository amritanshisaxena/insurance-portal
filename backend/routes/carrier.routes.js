const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { getCarrier } = require('../carriers/registry');
const SessionManager = require('../services/sessionManager');
const DocumentStore = require('../services/documentStore');
const redis = require('../services/redis');
const logger = require('../utils/logger');
const FlowTimer = require('../utils/timing');
const config = require('../config');

const router = Router();

router.post('/start', authMiddleware, async (req, res) => {
  const { carrier, email, password } = req.body;

  if (!carrier || !email) {
    return res.status(400).json({ error: 'carrier and email are required' });
  }

  const client = redis.getClient();
  const sessionMgr = new SessionManager(client);

  const allowed = await sessionMgr.checkRateLimit(req.auth.sid);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }

  let carrierEntry;
  try {
    carrierEntry = getCarrier(carrier);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (carrierEntry.requiresPassword !== false && !password) {
    return res.status(400).json({ error: 'Password is required for this carrier' });
  }

  const sessionId = uuidv4();
  await sessionMgr.create(sessionId, carrier, req.auth.sid);

  res.status(202).json({ sessionId });

  // Async automation flow — runs after response is sent
  const timer = new FlowTimer(sessionId);
  const { runCarrierFlow } = require('../ws/handler');

  setImmediate(() => {
    runCarrierFlow(sessionId, carrierEntry, { email, password }, req.auth.sid, timer)
      .catch((err) => {
        logger.error({ err, sessionId }, 'Carrier flow failed');
      });
  });
});

router.get('/documents/:sessionId', authMiddleware, async (req, res) => {
  const { sessionId } = req.params;
  const client = redis.getClient();
  const sessionMgr = new SessionManager(client);
  const docStore = new DocumentStore(client);

  const session = await sessionMgr.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (session.owner !== req.auth.sid) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (session.status !== 'completed') {
    return res.status(202).json({ status: session.status });
  }

  const documents = await docStore.retrieve(sessionId);

  res.set('Cache-Control', 'no-store');
  res.json({ documents });
});

module.exports = router;
