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
