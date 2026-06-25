const { Router } = require('express');
const { generateToken } = require('../middleware/auth');
const { listCarriers } = require('../carriers/registry');

const router = Router();

router.post('/token', (_req, res) => {
  const token = generateToken();
  res.json({ token });
});

router.get('/carriers', (_req, res) => {
  res.json({ carriers: listCarriers() });
});

module.exports = router;
