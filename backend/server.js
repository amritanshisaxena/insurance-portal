const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { setupWebSocket } = require('./ws/handler');

const authRoutes = require('./routes/auth.routes');
const carrierRoutes = require('./routes/carrier.routes');
const healthRoutes = require('./routes/health.routes');

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: config.nodeEnv === 'production'
    ? false
    : ['http://localhost:5173', 'http://localhost:3001'],
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/carrier', carrierRoutes);
app.use('/api/health', healthRoutes);

if (config.nodeEnv === 'production') {
  const staticPath = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(staticPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

app.use(errorHandler);

setupWebSocket(server);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Server started');
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  const redis = require('./services/redis');
  const pool = require('./browser/pool');
  await pool.shutdown();
  await redis.shutdown();
  server.close();
  process.exit(0);
});
