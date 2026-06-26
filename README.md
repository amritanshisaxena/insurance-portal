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

### Deploy to Render

A `render.yaml` Blueprint is included for one-click deployment:

1. Push repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect your GitHub repo — Render reads `render.yaml` automatically
4. `JWT_SECRET` is auto-generated. Adjust plan if more memory is needed.

**Note**: Headed Chrome requires ~1.5GB RAM. The Blueprint uses the Standard plan (2GB). The free tier (512MB) will OOM. Render's managed Redis handles the session store.

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

## Latency

Target: **under 10 seconds** from MFA submission to document on screen.

**Optimization approach:**
- Replaced all fixed `delay()` calls with `waitForSelector` / `waitForResponse` — the bot proceeds as soon as content renders, not after an arbitrary timeout
- Policy discovery via API response interception (`page.waitForResponse`) instead of DOM scraping — faster and more reliable
- Single-page PDF rendering in the viewer — renders one page at a time instead of all 50+ pages, so first paint is instant
- Scroll-to-target instead of full-page scroll loops — `scrollIntoViewIfNeeded()` to jump directly to download links

**Measured latencies** (post-MFA to documents on screen):
- Lemonade: ~8-12s (1 policy, 52-page PDF)
- AAA: ~10-15s (depends on number of policies, ~5-8s per policy)

The majority of post-MFA time is network I/O (page navigations, PDF downloads) rather than artificial delays.

## Session Reuse

After a successful flow, browser session state (cookies, localStorage) is saved to Redis, encrypted with AES-256-GCM. On the next run for the same carrier + email:

1. Saved state is restored into the browser context
2. If the carrier recognizes the session, login + MFA may be skipped entirely
3. If the restored session is stale (carrier redirects to login), the flow falls back to full login

Storage state keys are hashed (SHA-256) so email addresses aren't stored in Redis key names. State expires after 24 hours (`storageStateTtl`).

## Reliability

- **Flow timeout**: 5-minute hard limit on the entire automation flow to prevent zombie sessions
- **Retry on transient errors**: `BaseCarrier.retry()` wrapper for individual operations (selector lookups, navigations)
- **Browser crash recovery**: If the browser process disconnects, it's automatically relaunched on the next request
- **MFA timeout**: 2-minute window for user to submit MFA code; clean error if exceeded
- **Rate limiting**: Max 5 flow starts per JWT per 15 minutes to prevent abuse

## Anti-Bot & Fingerprinting

### What we use

| Layer | Technique | What it does | Impact |
|-------|-----------|-------------|--------|
| **CDP patches** | Patchright | Patches `Runtime.enable`, removes `navigator.webdriver`, fixes target leaks. Drop-in Playwright replacement. | High — defeats most CDP-level bot detection |
| **Init scripts** | `stealth.js` | Spoofs WebGL vendor/renderer to "Intel Iris", adds `chrome.runtime` object, normalizes `navigator.plugins` array, patches `Permissions.query` | Medium — passes basic fingerprint checks |
| **Behavioral** | `humanType`, `humanClick` | Random 50-130ms per-keystroke delays, scroll-into-view before click, 200-500ms pause before interactions | Medium — avoids timing-based bot detection |
| **Context** | Browser config | Real Chrome UA string, 1366x768 viewport, `en-US` locale, `America/New_York` timezone, `bypassCSP: true` | Medium — consistent non-suspicious fingerprint |
| **Headed mode** | `headless: false` | Runs visible Chrome even in Docker (via xvfb). Headless mode has detectable differences in rendering, fonts, and GPU behavior. | High — many carriers explicitly check for headless |

### What we tried but didn't implement
- **Canvas fingerprint spoofing**: Adds noise to canvas reads. Didn't need it — neither carrier checks canvas hashes.
- **Bezier mouse movements**: Simulate human cursor paths. Adds significant latency (~500ms per movement) for marginal benefit. Neither carrier tracks mouse trajectories.
- **Browser extension injection**: Load a real extension to mimic normal users. Increases complexity and boot time. Not needed for these carriers.
- **Residential proxy**: Env vars are wired up (`PROXY_SERVER`, `PROXY_USERNAME`, `PROXY_PASSWORD`) but not required. Both carriers accept datacenter IPs when cookies and fingerprints are clean.

### Carrier-specific observations
- **Lemonade**: Light anti-bot. Accepts automation with just Patchright + headed mode. No Cloudflare, no reCAPTCHA. The main challenge is passwordless OTP flow, not detection.
- **AAA (CSAA/Okta)**: Uses Okta for MFA which has moderate bot detection. `navigator.webdriver` patch is critical — Okta checks it. Headed mode required. The Okta email verification flow is straightforward once past detection.

## Security & Privacy

### What we do
- Credentials held in memory only during active automation, never written to disk or logs
- Session state encrypted with AES-256-GCM before Redis storage (key derived via PBKDF2 from JWT_SECRET)
- Redis runs memory-only (`--save "" --appendonly no`) — all data evaporates on restart
- Session-scoped JWT with document access binding — no cross-session leakage
- Rate limiting: max 5 flow starts per JWT per 15 minutes
- PII redacted from structured logs (pino redact: `password`, `email`, `authorization`)
- `Cache-Control: no-store` on document API responses
- Documents served with session ownership verification (`req.auth.sid === session.owner`)

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
│   ├── browser/
│   │   ├── pool.js            # Browser context pool
│   │   ├── stealth.js         # Anti-detection init scripts
│   │   └── contextManager.js  # Session state save/restore (AES encrypted)
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
├── render.yaml                # Render Blueprint for cloud deploy
└── .env.example
```

## Tradeoffs & Design Decisions

- **Patchright over Playwright**: Drop-in replacement with better stealth. Falls back gracefully if unavailable.
- **`headless: false`**: Required for both carriers — headless detection is common. Docker uses xvfb to run headed Chrome without a display.
- **WebSocket for MFA**: Enables real-time bidirectional communication without polling. The Promise-based handoff keeps carrier code linear despite async user input.
- **Single-page PDF rendering**: Renders one page at a time with controls instead of all pages — better performance for large documents (50+ pages).
- **Session reuse via storageState**: Encrypted cookies/localStorage cached in Redis after successful login. Skips re-login on subsequent runs for the same user. Falls back to full login if session is stale.
- **Redis memory-only**: Documents never touch disk. Acceptable for demo scope; production would add encryption and backup strategies.
- **Smart waits over fixed delays**: `waitForSelector` and `waitForResponse` instead of arbitrary `delay()` calls. Bot proceeds as soon as content is ready, keeping latency tight without sacrificing reliability.
