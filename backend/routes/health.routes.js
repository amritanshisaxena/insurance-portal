const { Router } = require('express');
const redis = require('../services/redis');

const router = Router();

router.get('/', async (_req, res) => {
  const redisOk = await redis.ping();
  const status = redisOk ? 'ok' : 'degraded';
  res.status(redisOk ? 200 : 503).json({
    status,
    redis: redisOk ? 'connected' : 'disconnected',
    uptime: process.uptime(),
  });
});

module.exports = router;
