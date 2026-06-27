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

**Measured latencies** (post-MFA to documents on screen):
- Lemonade: ~8-12s (1 policy, 52-page PDF)
- AAA: ~10-15s (depends on number of policies, ~5-8s per policy)

The majority of post-MFA time is network I/O (page navigations, PDF downloads) rather than artificial delays.

**What we tried to reduce latency:**

| Attempt | Result | Why |
|---------|--------|-----|
| API response interception during MFA redirect | **Worked** | Set up `page.waitForResponse()` for the policies API *before* clicking MFA verify / typing OTP. Captures the response as the page loads post-MFA instead of making a separate request. Saves ~2-3s on both carriers. |
| Removed `waitForURL` after MFA verify click (AAA) | **Worked** | Previously waited for URL to change after Okta verify, adding ~3-5s. Removed it — the policies API interceptor already detects when the page has loaded. |
| Fixed catalog URL matching — `endsWith` → `includes` (AAA) | **Worked** | AAA's document catalog API URL sometimes has query params. `endsWith('/retrieve')` missed these, causing a fallback to slower DOM-based document scraping. `includes()` catches all variants. |
| Direct `form_url` download (Lemonade) | **Worked** | Lemonade's policies API response includes a `form_url` field with a direct link to the PDF. Downloading from this URL directly skips navigating to each policy page entirely. Saves ~3-5s per policy. |
| Replaced full-page scroll loops with `scrollIntoViewIfNeeded()` | **Worked** | Original approach scrolled the entire page 4-8 times with 800ms-1s delays to discover download links. Replaced with targeted scroll to the specific element. Saved ~4-8s per carrier. |
| `waitForSelector`/`waitForResponse` instead of fixed `delay()` calls | **Worked** | Bot proceeds as soon as content renders instead of waiting an arbitrary timeout. Replaced ~15s of cumulative `delay()` calls across both carrier flows. |
| Fixed timing measurement (`mfaMarked` once-only flag) | **Worked** | `mfa_verified` timer mark was being overwritten by subsequent status updates, making post-MFA time appear artificially short (~2s instead of real ~8s). Added a once-only flag. |
| Single-page PDF rendering in viewer | **Worked** | Renders one page at a time with navigation controls instead of all 50+ pages. First paint is instant instead of waiting for the entire document to render. |
| Parallel document download | **Didn't implement** | Could download multiple policy PDFs simultaneously but carriers may rate-limit parallel requests. Sequential is more reliable. |
| Pre-fetching documents during MFA wait | **Not possible** | Can't fetch documents before MFA completes — the carrier doesn't authenticate until MFA is verified. |

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
- **Lemonade**: Light anti-bot. No Cloudflare, no reCAPTCHA. Accepts automation with just Patchright + headed mode. The real challenge was the passwordless OTP flow (no password field, 6 separate digit inputs, SPA navigation after OTP). Anti-bot was not the blocker here — UX automation was.
- **AAA (CSAA/Okta)**: Moderate anti-bot via Okta. `navigator.webdriver` patch is critical — Okta actively checks it and blocks if detected. Headed mode required (headless fails silently — Okta serves a blank page). The real challenge was navigation: direct URL access to the policy page triggers a different auth chain than in-app navigation (see Challenges section). The mega dropdown approach was discovered after trying 5 other methods.

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

## Challenges & What We Tried

### Lemonade

| Challenge | What we tried | Outcome |
|-----------|--------------|---------|
| **Passwordless login** | Lemonade has no password — just email + OTP. Had to discover and implement the email-only flow, which is unusual among insurance carriers. | Worked. The flow enters email → clicks LOG IN → selects "Send passcode by email" → user enters 6-digit OTP. |
| **OTP input is 6 separate single-digit fields** | Tried `page.type()` into a single input — didn't work because each digit has its own `<input>`. | Fixed: detect if there are 6+ inputs, click the first one, then type each digit sequentially with `keyboard.type()`. Auto-submits after last digit. |
| **"Send passcode by email" link not clickable** | First tried `page.click('a:has-text("Send passcode by email")')` — failed because the text is inside a `<span>` wrapped in an anchor with non-standard structure. | Fixed: try `a`, `span`, and `button` selectors, then fall back to `page.evaluate()` that walks all DOM elements matching the text with flexible whitespace. |
| **Cookie consent banner blocking interactions** | Lemonade shows an "Accept All" cookie banner that overlays the page. Bot clicks failed because the banner intercepted events. | Fixed: dismiss the cookie banner via `page.evaluate()` before interacting with login elements. Run this on every page load. |
| **Policy discovery — DOM scraping vs API** | Initially navigated to each policy page and looked for "download a copy" links by scrolling the page. Slow (~5s per policy) and fragile if Lemonade changes their UI. | Replaced with API response interception: `page.waitForResponse()` captures the `/policies` API call that Lemonade's SPA makes on dashboard load. Gets all policy data (IDs, types, `form_url`) in one shot. |
| **Document download — page navigation vs direct URL** | First approach: navigate to `me.lemonade.com/policy/{id}`, scroll to find "download a copy" link, click it. ~5s per policy. | Replaced: the policies API includes `form_url` with a direct link to the PDF. Download via `context.request.get(form_url)` — no page navigation needed. Falls back to page navigation if `form_url` is missing. |
| **SPA navigation after OTP** | After OTP submission, Lemonade does a client-side redirect. `waitForURL` sometimes timed out because the URL change happens before the page is ready. | Fixed: `waitForURL('**/me.lemonade.com**')` with fallback to `waitForFunction(() => !window.location.href.includes('/login'))`. |

### AAA Insurance

| Challenge | What we tried | Outcome |
|-----------|--------------|---------|
| **Getting to the policy page after login** | After Auth0 login, needed to reach `mwg.aaa.com/mypolicy`. Tried navigating directly to the URL. | **Failed** — direct navigation to `mwg.aaa.com/mypolicy` redirects to `auth.northeast.aaa.com/u/login` instead of Okta MFA. This is a server-side redirect, not a client-side one. |
| **Geo cookies to prevent northeast redirect** | Set cookies: `mwg_main_dc_region=california`, `locdata` with California GPS coordinates, `geo_region=california-ca\|CA`. | **Failed** — the redirect is server-side based on the SSO session, not cookies. The cookies are for the CDN/content layer, not the auth layer. |
| **Opening policy URL in a new tab** | Tried `context.newPage()` + `goto('mwg.aaa.com/mypolicy')` thinking a new tab might carry the auth session differently. | **Failed** — same northeast redirect. The URL itself triggers a different auth chain than the in-app navigation. |
| **Extracting the Manage Policy link href** | Extracted the `href` from the "Manage Policy" link in the mega dropdown, hoping it contained SSO parameters. | **Failed** — the href is just `https://mwg.aaa.com/mypolicy` with no SSO params. But clicking it from the dashboard works because the browser follows the full redirect chain with proper Referer headers and session cookies in context. |
| **Direct Okta verification URL** | Tried navigating directly to `csaainsurance.okta.com/signin/verify/okta/email`. | **Failed** — Okta requires the full SSO flow context; direct URL doesn't have the necessary state tokens. |
| **Mega dropdown hover navigation** | Hover "Insurance" nav → hover "Manage Insurance" → click "Manage Policy". This opens a new tab that follows the correct SSO redirect chain to Okta MFA. | **Worked** — the key insight is that the navigation must happen organically from the AAA dashboard. The click triggers the correct SSO redirect chain because the browser sends the proper Referer and session context. |
| **Auth0 popup closes after login** | `handleSecondLogin()` for the Auth0 popup threw `TargetClosedError` because Auth0 closes the popup window after successful authentication. | Fixed: wrapped in try/catch, on `TargetClosedError` scan all open browser pages for Okta or MyPolicy URLs. |
| **Northeast Auth0 has single-page login** | The northeast Auth0 shows email + password on the same page, not the multi-step flow (email → Continue → password) that the main AAA auth uses. | Moot — once we switched to mega dropdown navigation, we no longer hit the northeast Auth0 at all. |
| **Document catalog API URL matching** | `res.url().endsWith('/api-documents/v1/documents/retrieve')` missed responses that had query parameters appended. | Fixed: changed to `res.url().includes('/api-documents/v1/documents/retrieve')` with exclusion for `/retrieve/{id}` (individual doc endpoint). |

### Deployment

| Challenge | What we tried | Outcome |
|-----------|--------------|---------|
| **Railway free tier** | Deployed to Railway ($5 free credit). Two builds failed: missing `xauth` package, then `xvfb-run` hanging. | Fixed both, but then hit "Agent usage limit reached" — free tier can't increase the limit, requires Hobby plan ($5/month). Switched to Render. |
| **`xvfb-run` hangs in containers** | Used `xvfb-run node backend/server.js` as the Docker CMD. | **Failed** — `xvfb-run` blocks in Railway's container environment. Replaced with `docker-entrypoint.sh` that starts `Xvfb :99` as a background process and then `exec node`. |
| **CRLF line endings in shell script** | Git on Windows converted `docker-entrypoint.sh` to CRLF. Linux containers can't execute `#!/bin/sh\r`. | Fixed: added `.gitattributes` forcing LF for `.sh` files, plus `sed -i 's/\r$//'` in Dockerfile as a safety net. |
| **Patchright browser path mismatch** | `npx patchright install chrome` installs Chrome, but `chromium.launch()` at runtime looks for Chromium at a different path. | Fixed: install both `chromium` and `chrome` in the Dockerfile. |
| **Render pricing ($35/month for web + Redis)** | Render Blueprint created a separate Redis service ($10/month) plus Standard web service ($25/month). | Fixed: bundled `redis-server` inside the Docker container. Redis runs as a background process in `docker-entrypoint.sh`. Total cost: $25/month (prorated by the second). |

## Tradeoffs & Design Decisions

- **Patchright over Playwright**: Drop-in replacement with better stealth. Falls back gracefully if unavailable.
- **`headless: false`**: Required for both carriers — headless detection is common. Docker uses xvfb to run headed Chrome without a display.
- **WebSocket for MFA**: Enables real-time bidirectional communication without polling. The Promise-based handoff keeps carrier code linear despite async user input.
- **Single-page PDF rendering**: Renders one page at a time with controls instead of all pages — better performance for large documents (50+ pages).
- **Session reuse via storageState**: Encrypted cookies/localStorage cached in Redis after successful login. Skips re-login on subsequent runs for the same user. Falls back to full login if session is stale.
- **Redis memory-only**: Documents never touch disk. Acceptable for demo scope; production would add encryption and backup strategies.
- **Smart waits over fixed delays**: `waitForSelector` and `waitForResponse` instead of arbitrary `delay()` calls. Bot proceeds as soon as content is ready, keeping latency tight without sacrificing reliability.
