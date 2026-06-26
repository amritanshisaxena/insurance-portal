#!/bin/sh
# Start Xvfb in the background for headed Chrome
Xvfb :99 -screen 0 1366x768x24 -nolisten tcp -ac &
sleep 1
export DISPLAY=:99

# Start Redis in-process (ephemeral, no persistence)
redis-server --daemonize yes --save "" --appendonly no --maxmemory 64mb --maxmemory-policy allkeys-lru

# Default REDIS_URL to localhost if not set
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

# exec replaces shell so Node gets SIGTERM directly
exec node backend/server.js
