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
- Add `BLOB_READ_WRITE_TOKEN` on Vercel to make persisted observed highs survive redeploys and instance changes during the same market day.
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
- In production, Vercel Blob is the durable persistence path. If `BLOB_READ_WRITE_TOKEN` is missing or Blob write/read fails, live quotes and signals continue but session persistence is marked degraded.

## Vercel Blob Setup

1. Create or attach a Vercel Blob store to the project.
2. Add `BLOB_READ_WRITE_TOKEN` in the Vercel project environment variables.
3. Redeploy the project.

With Blob configured, the current market day's observed highs and recent live evaluations become redeploy-safe.
