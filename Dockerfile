# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production
FROM node:20-bookworm
WORKDIR /app

# Install Chrome dependencies + xvfb for headed mode in container
RUN apt-get update && apt-get install -y --no-install-recommends \
    redis-server \
    xvfb \
    xauth \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    libxshmfence1 \
    libxkbcommon0 \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Install Patchright Chrome
RUN npx patchright install chrome

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy entrypoint script (strip Windows line endings if any)
COPY docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3001
ENV DISPLAY=:99

EXPOSE 3001

CMD ["./docker-entrypoint.sh"]
