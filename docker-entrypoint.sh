#!/bin/sh
# Start Xvfb in the background for headed Chrome
Xvfb :99 -screen 0 1366x768x24 -nolisten tcp -ac &

# Wait for Xvfb to be ready
sleep 1

export DISPLAY=:99

# exec replaces shell so Node gets SIGTERM directly from Railway
exec node backend/server.js
