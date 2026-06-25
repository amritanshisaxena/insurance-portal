const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

function generateToken() {
  return jwt.sign(
    { sid: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000) },
    config.jwtSecret,
    { expiresIn: '2h' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  try {
    req.auth = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { generateToken, verifyToken, authMiddleware };
