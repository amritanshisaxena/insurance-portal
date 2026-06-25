# Insurance Document Portal

Automated login and document retrieval from insurance carrier portals. Supports **Lemonade** (home insurance) and **AAA Insurance** (auto insurance) with MFA handling via real-time WebSocket communication.

## Architecture

```
Frontend (React/Vite :5173)  ──WS──>  Backend (Express :3001)  ──>  Redis (:6379)
                                              │
                                        Patchright (browser automation)
                                              │
                                    ┌─────────┴─────────┐
                                 Lemonade          AAA Insurance
```

- **Backend**: Node.js + Express + WebSocket (`ws`) + Patchright (stealth Playwright fork)
- **Frontend**: React 18 + Vite + react-pdf
- **Session Store**: Redis 7 (memory-only, no disk persistence)
- **Auth**: JWT (session-scoped, 2h expiry)

## Quick Start

### Prerequisites
- Node.js 20+
- Redis 7 running locally (or Docker)
- Chrome browser installed

### Development

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Start Redis (Docker)
docker run -d -p 6379:6379 redis:7-alpine redis-server --save "" --appendonly no

# Install Patchright Chrome
npx patchright install chrome

# Start both servers
npm run dev
```

Frontend: `http://localhost:5173` | Backend: `http://localhost:3001`

### Docker (Production)

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET to a strong random value

# Build and run
docker compose up --build
```

App runs at `http://localhost:3001` (frontend served by Express in production).

## Carrier Flows

### Lemonade (Passwordless)
1. Enter email → bot navigates to lemonade.com/login
2. Lemonade sends OTP to email → user enters code in portal UI
3. Bot submits OTP → dashboard loads → API response intercepted for policy discovery
4. For each policy: navigates to policy page → downloads PDF via "download a copy" link

### AAA Insurance (Email + Password + Okta MFA)
1. Enter email + password → bot logs in via auth.mwg.aaa.com
2. Clicks "Manage Policy" → Okta email MFA triggered
3. User enters Okta verification code → bot submits
4. Navigates to /policies → discovers all policy numbers via regex
5. For each policy: navigates to /documents/{policyNumber} → finds and downloads matching documents

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/token` | None | Issue session-scoped JWT |
| POST | `/api/carrier/start` | JWT | Start automation flow |
| GET | `/api/carrier/documents/:sessionId` | JWT | Retrieve fetched PDFs |
| GET | `/api/health` | None | Health check |

## WebSocket Protocol

Connect: `ws://host/ws?token=JWT`

**Server → Client**: `status`, `mfa_required`, `documents_ready`, `error`
**Client → Server**: `mfa_submit` (with verification code)

MFA handoff uses a Promise-based pending map — the carrier automation awaits until the user submits a code via WebSocket.

## Anti-Bot Strategy

1. **Patchright**: Patches CDP-level detection signals (`navigator.webdriver`, `Runtime.enable` leaks)
2. **Behavioral mimicry**: Random typing delays (50-130ms/char), scroll-before-click, inter-step pauses
3. **Stealth init scripts**: WebGL vendor spoofing, `navigator.plugins` consistency, `chrome.runtime` object
4. **Context config**: Real Chrome UA, 1366x768 viewport, US locale/timezone
5. **Headed mode**: `headless: false` even in Docker (via xvfb) — avoids headless detection

## Security & Privacy

### What we do
- Credentials held in memory only during active automation, never written to disk or logs
- Redis runs memory-only (`--save "" --appendonly no`) — all data evaporates on restart
- Session-scoped JWT with document access binding — no cross-session leakage
- Rate limiting: max 5 flow starts per JWT per 15 minutes
- PII redacted from structured logs (pino redact paths)
- `Cache-Control: no-store` on document API responses
- Documents served with session ownership verification

### Known risks & tradeoffs
- **In-memory exposure**: While active, credentials and documents exist in Node.js process memory. Short session TTLs (1h) and aggressive key expiry mitigate this.
- **Browser memory**: Documents are in the browser's JS heap after rendering. The UI warns users to close the tab when done.
- **No document encryption at rest**: Documents in Redis are plaintext base64. Redis is on a private Docker network with no external access. In shared infrastructure, encrypt before storage.
- **Carrier detection**: Carriers could detect and block automation. Stealth measures reduce but don't eliminate this risk.
- **TLS in dev**: Local development uses plaintext HTTP/WS. Production behind a reverse proxy (Render, Railway) auto-terminates TLS.

## Project Structure

```
├── backend/
│   ├── server.js              # Express + WS bootstrap
│   ├── config.js              # Environment config
│   ├── browser/pool.js        # Browser context pool
│   ├── carriers/
│   │   ├── BaseCarrier.js     # Template method pattern
│   │   ├── LemonadeCarrier.js # Lemonade flow
│   │   ├── AAACarrier.js      # AAA flow
│   │   └── registry.js        # Carrier registry
│   ├── middleware/             # JWT auth, error handler
│   ├── routes/                # API routes
│   ├── services/              # Redis, session mgr, doc store
│   ├── utils/                 # Logger, timing, crypto
│   └── ws/handler.js          # WebSocket + MFA handoff
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # State machine (useReducer)
│   │   ├── components/        # CarrierSelect, MFAPrompt, DocumentViewer, etc.
│   │   ├── hooks/             # useWebSocket, useSession
│   │   └── services/api.js    # Fetch wrapper with JWT
│   └── vite.config.js         # Dev proxy config
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## Tradeoffs & Design Decisions

- **Patchright over Playwright**: Drop-in replacement with better stealth. Falls back gracefully if unavailable.
- **`headless: false`**: Required for both carriers — headless detection is common. Docker uses xvfb to run headed Chrome without a display.
- **WebSocket for MFA**: Enables real-time bidirectional communication without polling. The Promise-based handoff keeps carrier code linear despite async user input.
- **Single-page PDF rendering**: Renders one page at a time with controls instead of all pages — better performance for large documents (50+ pages).
- **No session reuse**: Each flow does a fresh login. Session cookies could be cached in Redis to skip re-login, but adds complexity and staleness risk for a demo.
- **Redis memory-only**: Documents never touch disk. Acceptable for demo scope; production would add encryption and backup strategies.
