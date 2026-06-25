const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
