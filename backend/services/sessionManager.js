const config = require('../config');

class SessionManager {
  constructor(redis) {
    this.redis = redis;
  }

  async create(sessionId, carrier, ownerSid) {
    const session = {
      carrier,
      owner: ownerSid,
      status: 'starting',
      createdAt: Date.now(),
      documentCount: 0,
    };
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(session),
      'EX',
      config.session.ttl
    );
    return session;
  }

  async updateStatus(sessionId, status, extra = {}) {
    const raw = await this.redis.get(`session:${sessionId}`);
    if (!raw) throw Object.assign(new Error('Session expired'), { status: 404 });
    const session = { ...JSON.parse(raw), status, ...extra, updatedAt: Date.now() };
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(session),
      'EX',
      config.session.ttl
    );
    return session;
  }

  async get(sessionId) {
    const raw = await this.redis.get(`session:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async destroy(sessionId) {
    const keys = await this.redis.keys(`doc:${sessionId}:*`);
    if (keys.length) await this.redis.del(...keys);
    await this.redis.del(`session:${sessionId}`);
  }

  async checkRateLimit(ownerSid) {
    const key = `ratelimit:${ownerSid}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, config.rateLimit.windowSeconds);
    }
    return count <= config.rateLimit.maxStarts;
  }
}

module.exports = SessionManager;
