const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let client = null;

function getClient() {
  if (!client) {
    client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
    });

    client.on('connect', () => logger.info('Redis connected'));
    client.on('error', (err) => logger.error({ err }, 'Redis error'));
  }
  return client;
}

async function ping() {
  try {
    const result = await getClient().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

async function shutdown() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getClient, ping, shutdown };
