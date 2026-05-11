# PulseGrid Lite

PulseGrid Lite is a compact real-time inspired dashboard for momentum stock signals. It is focused on a polished live V1: watchlist quote polling, deterministic live signal cards, filter controls, a watchlist, detail drawer, and in-app trigger toasts without backend sprawl.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Live quote polling through a protected Next.js API route
- Deploy-ready for Vercel

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Build for production

```bash
npm run build
npm run start
```

## Run tests

```bash
npm run test
```

## Production-style live stream validation

Run the app in production mode:

```bash
npm run build
npm run start
```

Then validate these endpoints:

- `GET /api/market/health`
  - Check `status`, `mode`, `streamStarted`, `lastMessageAt`, `messagesPerMinute`, `reconnectCount`, and stale/degraded flags.
- `GET /api/market/quotes?tickers=...`
  - Confirm responses continue from shared in-memory stream state without per-hit upstream fetch behavior.
- `GET /api/live-session`
  - Confirm session snapshots still return normally.
- `GET /api/live-session/events`
  - Confirm SSE still emits `snapshot` events.

If you force a stream interruption, `reconnectCount` should increase and `status`/`isDegraded` should reflect reconnect and recovery.

## Deploy to Vercel

1. Push the repo to GitHub.
2. Import the project into Vercel.
3. Vercel will detect Next.js automatically.
4. Add any environment variables from `.env.example` in the Vercel project settings when needed.
5. Deploy.

## Live market data

- Watchlist metadata lives in [lib/watchlist.ts](/c:/Users/arung/Pulse_Grid/lib/watchlist.ts).
- The live rule engine lives in [lib/live-signal-engine.ts](/c:/Users/arung/Pulse_Grid/lib/live-signal-engine.ts).
- The provider layer lives in [lib/market-data.ts](/c:/Users/arung/Pulse_Grid/lib/market-data.ts).
- The internal quote route lives in [app/api/market/quotes/route.ts](/c:/Users/arung/Pulse_Grid/app/api/market/quotes/route.ts).
- The session-aware live snapshot route lives in [app/api/live-session/route.ts](/c:/Users/arung/Pulse_Grid/app/api/live-session/route.ts).
- The persistence layer lives in [lib/session-state-store.ts](/c:/Users/arung/Pulse_Grid/lib/session-state-store.ts).
- Add a Finnhub key as `FINNHUB_API_KEY`.
- Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` on Vercel for durable session state snapshots.
- Optional kill switch: `DISABLE_STATE_PERSISTENCE=true` to force memory-only mode.
- Watchlist tickers refresh only from real quotes.
- Active signals are computed deterministically from live `price`, `changePercent`, and rolling session observations since app start.
- Session-aware observed highs and recent evaluations reset automatically at the start of a new New York market day.
- Unsupported signal families such as News Catalyst and Relative Volume Surge are intentionally omitted until real source data is available.

## Structured News Factor

- Structured news ingestion lives in [lib/news-data.ts](/c:/Users/arung/Pulse_Grid/lib/news-data.ts).
- Current source is Finnhub news sentiment (+ optional latest company headline when available).
- Deterministic engine awards `newsScore` only when structured bullish/bearish news is present.
- `BULLISH` and `BEARISH` signal types fire only from structured directional news, otherwise `SPIKE` remains the main type.
- If structured news is unavailable for a cycle, the engine stays honest and keeps newsScore neutral.

## Live Event Layer

- Event normalization and deterministic notify rules live in [lib/live-events.ts](/c:/Users/arung/Pulse_Grid/lib/live-events.ts).
- Runtime integration lives in [lib/live-session-runtime.ts](/c:/Users/arung/Pulse_Grid/lib/live-session-runtime.ts).
- UI live tape lives in [components/live-event-feed.tsx](/c:/Users/arung/Pulse_Grid/components/live-event-feed.tsx).
- High-priority in-app alerts are fed through [components/toast-stack.tsx](/c:/Users/arung/Pulse_Grid/components/toast-stack.tsx).
- Event dedup + cooldown state is persisted with session state in [lib/session-state-store.ts](/c:/Users/arung/Pulse_Grid/lib/session-state-store.ts).

### Supported event types now

- `TOP_SETUP` (scanner-driven)
- `PRICE_SPIKE` (scanner-driven)
- `VOLUME_SPIKE` (scanner-driven)
- `REAPPEAR` (scanner-driven)
- `BULLISH_SIGNAL` (scanner + structured directional news)
- `BEARISH_SIGNAL` (scanner + structured directional news)
- `NEWS` (structured provider news context)

### Scaffolded but not yet provider-backed

- `SEC_FILING`
- `OFFERING`
- `REVERSE_SPLIT`
- `HALT`
- `FDA`
- `EARNINGS`

These are defined in the normalized model but are not emitted until a reliable structured provider path is added.

## AI layer

- AI orchestration service lives in [lib/ai/signal-analysis-layer.ts](/c:/Users/arung/Pulse_Grid/lib/ai/signal-analysis-layer.ts).
- AI-backed signal analysis route lives in [app/api/analysis/signal/route.ts](/c:/Users/arung/Pulse_Grid/app/api/analysis/signal/route.ts).
- If `OPENAI_API_KEY` is missing, analysis automatically falls back to deterministic rules output.
- Optional model override: `OPENAI_MODEL` (default `gpt-4o-mini`).
- AI is grounded on deterministic signal fields and cannot override ranking/scoring/freshness.

## In-app support agent

- Support agent backend runner lives in [lib/ai/support-agent.ts](/c:/Users/arung/Pulse_Grid/lib/ai/support-agent.ts).
- Streaming chat route lives in [app/api/agent/support/route.ts](/c:/Users/arung/Pulse_Grid/app/api/agent/support/route.ts).
- Chat UI panel lives in [components/support-agent-panel.tsx](/c:/Users/arung/Pulse_Grid/components/support-agent-panel.tsx).
- The support agent defaults to `gpt-5.5` and can be overridden with `OPENAI_SUPPORT_AGENT_MODEL`.
- API keys remain server-side only. The client calls the internal route and never receives `OPENAI_API_KEY`.
- Multi-turn context is preserved in client conversation state and posted each turn to the server route.

### Support agent setup

1. Set `OPENAI_API_KEY` in `.env.local`.
2. Optional: set `OPENAI_SUPPORT_AGENT_MODEL` (default `gpt-5.5`).
3. Run `npm run dev` and open the PulseGrid Copilot panel at the bottom-right of the app.

### Support agent tools

- `get_live_session_overview`: returns session health/status plus top active signals.
- `get_ticker_context`: returns per-ticker signal/watchlist/quote metadata context.

## V1 features

- Premium dark dashboard with responsive layout
- Filter bar for signal type, confidence, and watchlist mode
- Live signal feed driven by real quote evaluation
- Ticker detail drawer/modal
- Watchlist panel with live quote status
- Market session status: premarket, regular, after-hours, or closed
- In-app new signal toast notifications for newly triggered live rules

## Notes

- This app is not a trading platform or execution terminal.
- It is optimized for speed, polish, and readability as a proof-of-concept V1.
- If market data is unavailable or rate-limited, the UI shows a degraded state instead of fabricating signals.
- In local development, session persistence falls back to a server-side file under `.data/`.
- In production, Supabase Storage is the durable persistence path. If it is unavailable, live quotes and signals continue in memory-only mode.

## Session State Store Setup

1. Create a Supabase Storage bucket (recommended name: `pulsegrid-state`).
2. Keep the bucket private; server code writes and signs access with `SUPABASE_SERVICE_ROLE_KEY`.
3. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in project environment variables.
4. Optional custom paths:
   - `SUPABASE_STORAGE_BUCKET` (defaults to `pulsegrid-state`)
   - `SUPABASE_STORAGE_STATE_PREFIX` (defaults to `session-state`)
5. Optional dev fallback: set `ENABLE_LOCAL_STATE_FILE=true` locally.
6. Redeploy the project.

With Supabase Storage configured, the current market day's observed highs and recent live evaluations become redeploy-safe.

## Legacy Blob URL Migration

If you have historical Vercel Blob object URLs that contain persisted state JSON, migrate them once with:

```bash
LEGACY_BLOB_URLS="https://.../state-1.json,https://.../state-2.json" npm run migrate:blob-to-supabase
```

The script uploads each JSON payload into your configured Supabase Storage bucket/prefix.
