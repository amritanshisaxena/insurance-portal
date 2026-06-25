const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['req.body.password', 'req.body.email', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino/file',
    options: { destination: 1 },
  } : undefined,
});

module.exports = logger;
