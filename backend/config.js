require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  browserPoolSize: parseInt(process.env.BROWSER_POOL_SIZE || '2'),
  proxy: process.env.PROXY_SERVER ? {
    server: process.env.PROXY_SERVER,
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD,
  } : null,
  session: {
    ttl: 3600,
    documentTtl: 3600,
    storageStateTtl: 86400,
    mfaTimeout: 120000,
  },
  rateLimit: {
    maxStarts: 5,
    windowSeconds: 900,
  },
};
