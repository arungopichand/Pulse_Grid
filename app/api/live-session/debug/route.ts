import { NextResponse } from "next/server";
import { getLiveSessionSnapshot, getRunnerAlertDebugState } from "@/lib/live-session-runtime";
import { getMarketStreamHealth, getDynamicUniverse, startMarketStream } from "@/lib/market-stream";
import { getMarketClock } from "@/lib/market-session";
import { getMassiveApiKey } from "@/lib/providers/massive";

export const dynamic = "force-dynamic";

export async function GET() {
  await startMarketStream();
  const snapshot = await getLiveSessionSnapshot();
  const health = getMarketStreamHealth();
  const universe = getDynamicUniverse();
  const marketClock = getMarketClock();
  const alertDebug = getRunnerAlertDebugState();

  const alertCountsByTicker = Object.entries(
    snapshot.alerts.reduce((acc, alert) => {
      acc[alert.ticker] = Math.max(acc[alert.ticker] ?? 0, alert.alertCountToday ?? 1);
      return acc;
    }, {} as Record<string, number>),
  )
    .map(([ticker, count]) => ({ ticker, count }))
    .sort((a, b) => b.count - a.count);
  const alertsCountToday = alertCountsByTicker.reduce((sum, row) => sum + row.count, 0);
  const latestAlertAt =
    snapshot.alerts.length > 0
      ? [...snapshot.alerts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]?.timestamp ?? null
      : null;
  const scannerMode =
    marketClock.sessionStatus === "premarket"
      ? "premarket_scanning"
      : marketClock.sessionStatus === "regular"
        ? "regular_scanning"
        : marketClock.sessionStatus === "after-hours"
          ? "afterhours_scanning"
          : "closed_waiting";

  const missingDataFields = snapshot.alerts.reduce(
    (acc, alert) => {
      if (alert.floatShares === null) acc.floatUnavailable += 1;
      if (alert.costToBorrowPercent === null || alert.costToBorrowPercent === undefined) acc.ctbUnavailable += 1;
      if (alert.shortInterestPercent === null || alert.shortInterestPercent === undefined) acc.siUnavailable += 1;
      if (!alert.haltStatus || alert.haltStatus === "none") acc.haltUnavailable += 1;
      return acc;
    },
    { floatUnavailable: 0, ctbUnavailable: 0, siUnavailable: 0, haltUnavailable: 0 },
  );

  return NextResponse.json(
    {
      session: {
        status: marketClock.sessionStatus,
        label: marketClock.label,
        date: marketClock.sessionDate,
      },
      scannerMode,
      massive: {
        apiKeyConfigured: Boolean(getMassiveApiKey()),
      },
      websocket: {
        connected: health.connected,
        authenticated: health.authenticated,
        subscribed: health.subscribed,
        subscribedSymbolCount: health.subscribedSymbolCount,
        wsMessagesReceived: health.wsMessagesReceived,
        wsUpdatesApplied: health.wsUpdatesApplied,
        lastMessageAt: health.lastMessageAt,
        lastWebSocketConnectAt: health.lastWebSocketConnectAt,
        lastWsUpdateAt: health.lastWsUpdateAt,
        statusOnlyStream: health.statusOnlyStream,
        aggregateUnauthorized: health.aggregateUnauthorized,
        subscribedTradeCount: health.subscribedTradeCount,
        subscribedAggregateCount: health.subscribedAggregateCount,
        appStartedAt: health.appStartedAt,
        lastDiscoveryAt: health.lastDiscoveryAt,
        lastDiscoveryStatus: health.lastDiscoveryStatus,
        lastUniverseCount: health.lastUniverseCount,
        lastTradeAt: health.lastTradeAt,
        lastAggregateAt: health.lastAggregateAt,
        startup: health.startup,
        reconnectCount: health.reconnectCount,
        degraded: health.degraded,
        degradedReason: health.degradedReason,
      },
      dynamicUniverse: {
        source: universe.source,
        discoveredCount: universe.discoveredCount,
        selectedCount: universe.selectedCount,
        topSymbols: universe.topSymbols,
        reasonsBySymbol: universe.reasonsBySymbol,
        stocksOnly: true,
        etfRejectedCount: universe.etfRejectedCount ?? 0,
        rejectedEtfSymbols: universe.rejectedEtfSymbols ?? [],
        activeUniverseTickers: snapshot.activeUniverseTickers ?? [],
      },
      quoteSummary: snapshot.marketData?.summary ?? null,
      scannerDiagnostics: snapshot.scannerDiagnostics ?? null,
      activeSignalsCount: snapshot.signals.length,
      alertTapeCount: snapshot.alerts.length,
      alertsCount: snapshot.alerts.length,
      lastAlertAt: latestAlertAt,
      alertsCountToday,
      latestAlerts: snapshot.alerts.slice(0, 50),
      emittedAlerts: snapshot.alerts.map((alert) => ({
        ticker: alert.ticker,
        alertType: alert.alertType,
        score: alert.score,
        formattedLine: alert.formattedLine ?? null,
        timestamp: alert.timestamp,
      })),
      alertCountsByTicker,
      pipelineCounts: {
        discoveredBeforeFilters: snapshot.scannerDiagnostics?.discoveredBeforeFilters ?? null,
        discovered: snapshot.scannerDiagnostics?.discoveredCount ?? null,
        selected: snapshot.scannerDiagnostics?.selectedCount ?? null,
        activeUniverse: snapshot.scannerDiagnostics?.activeUniverseCount ?? null,
        watchlistEvaluated: snapshot.watchlist.length,
        emittedAlerts: snapshot.alerts.length,
      },
      missingDataFields,
      highTracking: alertDebug.highTracking,
      suppressedDuplicateAlerts: alertDebug.suppressedDuplicates,
      transitionLog: alertDebug.transitionLog,
      topRejected: snapshot.diagnostics?.topRejected ?? [],
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
