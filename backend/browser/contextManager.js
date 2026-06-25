const { encrypt, decrypt, hashUsername } = require('../utils/crypto');
const config = require('../config');
const logger = require('../utils/logger');

async function getStorageState(redis, carrier, email) {
  const key = `storageState:${carrier}:${hashUsername(email)}`;
  try {
    const encrypted = await redis.get(key);
    if (!encrypted) return null;
    const decrypted = decrypt(encrypted);
    const state = JSON.parse(decrypted);
    return state;
  } catch (err) {
    logger.warn({ err }, 'Failed to restore storageState, will do fresh login');
    return null;
  }
}

async function saveStorageState(redis, carrier, email, context) {
  const state = await context.storageState();
  const key = `storageState:${carrier}:${hashUsername(email)}`;
  const encrypted = encrypt(JSON.stringify(state));
  await redis.set(key, encrypted, 'EX', config.session.storageStateTtl);
}

module.exports = { getStorageState, saveStorageState };
