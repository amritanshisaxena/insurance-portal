const config = require('../config');

class DocumentStore {
  constructor(redis) {
    this.redis = redis;
  }

  async store(sessionId, documents) {
    const pipeline = this.redis.pipeline();
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const payload = JSON.stringify({
        name: doc.name,
        mimeType: doc.mimeType,
        data: doc.buffer.toString('base64'),
      });
      pipeline.set(`doc:${sessionId}:${i}`, payload, 'EX', config.session.documentTtl);
    }
    await pipeline.exec();
    return documents.length;
  }

  async retrieve(sessionId) {
    const keys = await this.redis.keys(`doc:${sessionId}:*`);
    if (!keys.length) return [];
    keys.sort();
    const values = await this.redis.mget(keys);
    return values.filter(Boolean).map((raw) => JSON.parse(raw));
  }
}

module.exports = DocumentStore;
