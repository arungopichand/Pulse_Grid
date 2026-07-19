"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchLiveSessionSnapshot, type LiveSessionSnapshot } from "@/lib/market-data";
import type { BotFeedItem } from "@/lib/bot-feed/types";
import type { RunnerAlert } from "@/lib/runner-alerts";

type Channel = "all" | "movers" | "halts" | "catalysts" | "watchlist";
type FeedKind = "momentum" | "halt" | "news" | "filing" | "summary" | "session";

type TerminalItem = {
  id: string;
  timestamp: string;
  timeLabel: string;
  ticker: string | null;
  kind: FeedKind;
  title: string;
  detail: string;
  metadata: string[];
  movePercent: number | null;
  price: number | null;
  priority: "critical" | "high" | "medium" | "low";
};

const CHANNELS: Array<{ id: Channel; label: string; icon: string }> = [
  { id: "all", label: "Live tape", icon: "⌁" },
  { id: "movers", label: "Momentum", icon: "↗" },
  { id: "halts", label: "Halts", icon: "Ⅱ" },
  { id: "catalysts", label: "Catalysts", icon: "✦" },
  { id: "watchlist", label: "Watchlist", icon: "☆" },
];

function compactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatMove(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
}

function marketTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function countryFlag(code: string | null) {
  if (!code || code.length !== 2) return null;
  return code
    .toUpperCase()
    .split("")
    .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
    .join("");
}

function priceBucket(price: number | null) {
  if (price === null) return "";
  if (price < 0.5) return "< $0.50";
  if (price < 1) return "< $1";
  if (price < 2) return "< $2";
  if (price < 5) return "< $5";
  if (price < 10) return "< $10";
  if (price < 20) return "< $20";
  return formatPrice(price);
}

function alertKind(alert: RunnerAlert): FeedKind {
  if (alert.alertType.startsWith("HALTED") || alert.alertType === "NEWS_PENDING_HALT") return "halt";
  if (alert.source === "news" || alert.alertType === "PR_SPIKE") return "news";
  return "momentum";
}

function alertToItem(alert: RunnerAlert): TerminalItem {
  const kind = alertKind(alert);
  const metadata = [
    countryFlag(alert.countryCode),
    alert.floatShares ? `Float ${compactNumber(alert.floatShares)}` : null,
    alert.relativeVolume ? `RVol ${alert.relativeVolume.toFixed(1)}x` : null,
    alert.currentVolume ? `Vol ${compactNumber(alert.currentVolume)}` : null,
    alert.shortInterestPercent ? `SI ${alert.shortInterestPercent.toFixed(1)}%` : null,
    alert.marketCap ? `MC ${compactNumber(alert.marketCap)}` : null,
    alert.highCostToBorrow ? "High CTB" : null,
  ].filter((part): part is string => Boolean(part));

  const label = alert.alertType
    .replace("HALTED_UP", "Halted UP")
    .replace("HALTED_DOWN", "Halted DOWN")
    .replace("VOLUME_SPIKE", "Volume spike")
    .replace("GREEN_BARS", "3 green bars")
    .replace("PR_SPIKE", "PR spike")
    .replaceAll("_", " ");

  return {
    id: alert.id,
    timestamp: alert.timestamp,
    timeLabel: alert.alertTime || marketTime(alert.timestamp),
    ticker: alert.ticker,
    kind,
    title: label,
    detail: alert.newsHeadline || alert.reason,
    metadata,
    movePercent: alert.changePercent,
    price: alert.tickerPrice,
    priority: kind === "halt" ? "critical" : alert.score >= 85 ? "high" : alert.score >= 70 ? "medium" : "low",
  };
}

function botItemToTerminal(item: BotFeedItem): TerminalItem {
  if (item.type === "momentum_alert") {
    return {
      id: item.id,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      ticker: item.ticker,
      kind: "momentum",
      title: item.label,
      detail: item.whyNow,
      metadata: item.metadataParts,
      movePercent: item.movePercent,
      price: null,
      priority: item.priority,
    };
  }
  if (item.type === "halt_alert") {
    return {
      id: item.id,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      ticker: item.ticker,
      kind: "halt",
      title: item.haltDirection === "HALTED" ? "Resumption watch" : `Halted ${item.haltDirection}`,
      detail: item.reasonLabel || "Volatility halt",
      metadata: [item.priceLabel, ...item.metadataParts].filter((part): part is string => Boolean(part)),
      movePercent: null,
      price: null,
      priority: "critical",
    };
  }
  if (item.type === "symbol_news") {
    return {
      id: item.id,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      ticker: item.ticker,
      kind: "news",
      title: item.label,
      detail: item.headline,
      metadata: item.metadataParts,
      movePercent: null,
      price: null,
      priority: item.priority,
    };
  }
  if (item.type === "sec_filing") {
    return {
      id: item.id,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      ticker: item.ticker,
      kind: "filing",
      title: item.formLabel,
      detail: item.linkText,
      metadata: ["SEC filing"],
      movePercent: null,
      price: null,
      priority: item.priority,
    };
  }
  if (item.type === "top_gainer_summary") {
    return {
      id: item.id,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      ticker: null,
      kind: "summary",
      title: "Top gainers",
      detail: item.summaryText,
      metadata: item.symbols,
      movePercent: null,
      price: null,
      priority: item.priority,
    };
  }
  return {
    id: item.id,
    timestamp: item.timestamp,
    timeLabel: item.timeLabel,
    ticker: null,
    kind: "session",
    title: item.type === "source_header" ? item.source : item.label,
    detail: item.type === "source_header" ? item.subLabel || "Live scanner source" : item.detail,
    metadata: [],
    movePercent: null,
    price: null,
    priority: item.priority,
  };
}

function itemMatchesChannel(item: TerminalItem, channel: Channel, watchlist: Set<string>) {
  if (channel === "all") return true;
  if (channel === "movers") return item.kind === "momentum" || item.kind === "summary";
  if (channel === "halts") return item.kind === "halt";
  if (channel === "catalysts") return item.kind === "news" || item.kind === "filing";
  return Boolean(item.ticker && watchlist.has(item.ticker));
}

function ChannelIcon({ value }: { value: string }) {
  return <span className="inline-flex h-6 w-6 items-center justify-center text-base text-slate-500">{value}</span>;
}

function ActivityIcon({ kind }: { kind: FeedKind }) {
  const value = kind === "halt" ? "Ⅱ" : kind === "news" ? "✦" : kind === "filing" ? "§" : kind === "summary" ? "≋" : kind === "session" ? "◷" : "↗";
  return <span className={`activity-icon activity-icon-${kind}`}>{value}</span>;
}

function FeedRow({ item, onSelect }: { item: TerminalItem; onSelect: (ticker: string) => void }) {
  const rising = (item.movePercent ?? 0) >= 0;
  return (
    <button
      type="button"
      onClick={() => item.ticker && onSelect(item.ticker)}
      className={`terminal-row group ${item.priority === "critical" ? "terminal-row-critical" : ""}`}
      disabled={!item.ticker}
    >
      <ActivityIcon kind={item.kind} />
      <span className="terminal-time">{item.timeLabel}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {item.ticker ? <span className="ticker-symbol">{item.ticker}</span> : null}
          {item.price !== null ? <span className="price-bucket">{priceBucket(item.price)}</span> : null}
          {item.movePercent !== null ? (
            <span className={rising ? "move-up" : "move-down"}>{formatMove(item.movePercent)}</span>
          ) : null}
          <span className={`event-pill event-pill-${item.kind}`}>{item.title}</span>
          {item.metadata.map((part, index) => (
            <span key={`${part}-${index}`} className="metadata-part">
              {part}
            </span>
          ))}
        </div>
        {item.detail ? <p className="mt-1.5 line-clamp-2 text-left text-[13px] leading-5 text-slate-400">{item.detail}</p> : null}
      </div>
      {item.ticker ? <span className="row-chevron">›</span> : null}
    </button>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "green" | "amber" | "blue" }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between gap-3">
        <span className="metric-label">{label}</span>
        <span className={`metric-dot metric-dot-${tone || "blue"}`} />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export function PulseTerminal() {
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<Channel>("all");
  const [query, setQuery] = useState("");
  const [minMove, setMinMove] = useState(0);
  const [maxPrice, setMaxPrice] = useState(20);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [liveConnected, setLiveConnected] = useState<boolean | null>(null);

  const applySnapshot = useCallback((next: LiveSessionSnapshot) => {
    setSnapshot(next);
    setLoading(false);
    setLiveConnected(next.streamHealth?.connected ?? next.ok);
  }, []);

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    const controller = new AbortController();

    async function connect() {
      const initial = await fetchLiveSessionSnapshot({ signal: controller.signal });
      if (!active) return;
      applySnapshot(initial);

      eventSource = new EventSource("/api/live-session/events");
      eventSource.addEventListener("snapshot", (event) => {
        if (!active) return;
        try {
          applySnapshot(JSON.parse((event as MessageEvent<string>).data) as LiveSessionSnapshot);
        } catch {
          setLiveConnected(false);
        }
      });
      eventSource.onopen = () => setLiveConnected(true);
      eventSource.onerror = () => setLiveConnected(false);
    }

    void connect();
    return () => {
      active = false;
      controller.abort();
      eventSource?.close();
    };
  }, [applySnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const alerts = useMemo(() => snapshot?.alerts.filter((alert) => alert.alertType !== "TEST") ?? [], [snapshot]);
  const watchlistSet = useMemo(() => new Set(snapshot?.watchlist.map((item) => item.ticker) ?? []), [snapshot]);
  const items = useMemo(() => {
    const source = snapshot?.botFeed.length ? snapshot.botFeed.map(botItemToTerminal) : alerts.map(alertToItem);
    return source.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  }, [alerts, snapshot]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    return items.filter((item) => {
      if (!itemMatchesChannel(item, channel, watchlistSet)) return false;
      if (item.movePercent !== null && Math.abs(item.movePercent) < minMove) return false;
      if (item.price !== null && item.price > maxPrice) return false;
      if (normalizedQuery && !`${item.ticker ?? ""} ${item.title} ${item.detail} ${item.metadata.join(" ")}`.toUpperCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [channel, items, maxPrice, minMove, query, watchlistSet]);

  const topMovers = useMemo(
    () => [...alerts].filter((alert) => alert.changePercent !== null).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)).slice(0, 6),
    [alerts],
  );
  const topMover = topMovers[0] ?? null;
  const selectedAlert = alerts.find((alert) => alert.ticker === selectedTicker) ?? null;
  const selectedWatch = snapshot?.watchlist.find((item) => item.ticker === selectedTicker) ?? null;
  const channelCounts = useMemo(() => Object.fromEntries(CHANNELS.map((entry) => [entry.id, items.filter((item) => itemMatchesChannel(item, entry.id, watchlistSet)).length])), [items, watchlistSet]);
  const streamLabel = liveConnected === true ? "Live" : liveConnected === false ? "Reconnecting" : "Connecting";
  const activeUniverse = snapshot?.scannerDiagnostics?.activeUniverseCount ?? snapshot?.activeUniverseTickers?.length ?? 0;
  const haltCount = items.filter((item) => item.kind === "halt").length;
  const newsCount = items.filter((item) => item.kind === "news" || item.kind === "filing").length;
  const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(now));

  return (
    <div className="terminal-shell">
      {sidebarOpen ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`terminal-sidebar ${sidebarOpen ? "terminal-sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /></div>
          <div>
            <p className="font-semibold tracking-tight text-white">PulseGrid</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Market intelligence</p>
          </div>
        </div>

        <nav className="mt-8">
          <p className="sidebar-label">Scanner</p>
          <div className="mt-2 space-y-1">
            {CHANNELS.map((entry) => (
              <button
                type="button"
                key={entry.id}
                onClick={() => { setChannel(entry.id); setSidebarOpen(false); }}
                className={`channel-button ${channel === entry.id ? "channel-button-active" : ""}`}
              >
                <ChannelIcon value={entry.icon} />
                <span className="flex-1 text-left">{entry.label}</span>
                <span className="channel-count">{channelCounts[entry.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="mt-8">
          <p className="sidebar-label">Market status</p>
          <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
            <div className="flex items-center gap-2">
              <span className={`status-light ${liveConnected ? "status-light-live" : "status-light-warn"}`} />
              <span className="text-sm font-medium text-slate-200">{streamLabel}</span>
            </div>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <div className="flex justify-between"><span>Session</span><span className="capitalize text-slate-300">{snapshot?.sessionStatus ?? "—"}</span></div>
              <div className="flex justify-between"><span>New York</span><span className="font-mono text-slate-300">{nyClock}</span></div>
              <div className="flex justify-between"><span>Universe</span><span className="text-slate-300">{activeUniverse}</span></div>
            </div>
          </div>
        </div>

        <p className="mt-auto pt-8 text-[10px] leading-4 text-slate-600">Scanner signals are informational and are not financial advice.</p>
      </aside>

      <main className="terminal-main">
        <header className="terminal-header">
          <div className="flex items-center gap-3">
            <button type="button" className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">☰</button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Live Scanner</h1>
              <p className="text-xs text-slate-500">Real-time small-cap momentum wire</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="terminal-search">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker or catalyst" aria-label="Search ticker or catalyst" />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button> : null}
            </label>
            <div className={`live-chip ${liveConnected ? "live-chip-on" : ""}`}><span />{streamLabel}</div>
          </div>
        </header>

        <div className="terminal-content">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Top mover" value={topMover ? `${topMover.ticker} ${formatMove(topMover.changePercent)}` : "No signal"} detail={topMover ? `${formatPrice(topMover.tickerPrice)} · ${compactNumber(topMover.currentVolume)} vol` : "Waiting for qualifying setup"} tone="green" />
            <MetricCard label="Active alerts" value={String(alerts.length)} detail={`${visibleItems.length} shown in current view`} tone="blue" />
            <MetricCard label="Halts / catalysts" value={`${haltCount} / ${newsCount}`} detail="Current market session" tone="amber" />
            <MetricCard label="Scanner universe" value={String(activeUniverse)} detail={snapshot?.scannerDiagnostics?.universeSource ?? "Live discovery"} tone="blue" />
          </section>

          <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_310px]">
            <section className="terminal-panel min-w-0">
              <div className="terminal-panel-header">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="status-light status-light-live" />
                    <h2 className="font-semibold text-white">Market wire</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Newest alerts first · New York market time</p>
                </div>
                <span className="rounded-md border border-white/[0.08] px-2 py-1 font-mono text-[11px] text-slate-500">{visibleItems.length} events</span>
              </div>

              <div className="filter-strip">
                <label><span>Move</span><select value={minMove} onChange={(event) => setMinMove(Number(event.target.value))}><option value={0}>Any</option><option value={5}>5%+</option><option value={10}>10%+</option><option value={20}>20%+</option><option value={50}>50%+</option></select></label>
                <label><span>Price</span><select value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))}><option value={1}>Under $1</option><option value={2}>Under $2</option><option value={5}>Under $5</option><option value={10}>Under $10</option><option value={20}>Under $20</option><option value={100000}>All prices</option></select></label>
                <div className="ml-auto hidden text-xs text-slate-600 sm:block">Click a ticker for details</div>
              </div>

              <div className="terminal-feed">
                {loading ? (
                  <div className="space-y-2 p-4">{Array.from({ length: 7 }).map((_, index) => <div key={index} className="feed-skeleton" />)}</div>
                ) : visibleItems.length ? (
                  visibleItems.map((item) => <FeedRow key={item.id} item={item} onSelect={setSelectedTicker} />)
                ) : (
                  <div className="empty-feed"><span>⌁</span><h3>No matching live alerts</h3><p>Adjust the channel or filters. The scanner will add new qualifying events automatically.</p></div>
                )}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="terminal-panel">
                <div className="terminal-panel-header py-4"><div><h2 className="font-semibold text-white">Top movers</h2><p className="mt-1 text-xs text-slate-500">Ranked by session gain</p></div></div>
                <div className="divide-y divide-white/[0.05]">
                  {topMovers.length ? topMovers.map((alert, index) => (
                    <button type="button" key={alert.id} onClick={() => setSelectedTicker(alert.ticker)} className="mover-row">
                      <span className="mover-rank">{index + 1}</span>
                      <span className="min-w-0 flex-1"><strong>{alert.ticker}</strong><small>{formatPrice(alert.tickerPrice)} · {compactNumber(alert.currentVolume)} vol</small></span>
                      <span className={(alert.changePercent ?? 0) >= 0 ? "move-up" : "move-down"}>{formatMove(alert.changePercent)}</span>
                    </button>
                  )) : <p className="p-5 text-sm text-slate-500">No ranked movers yet.</p>}
                </div>
              </section>

              <section className="terminal-panel p-4">
                <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">System health</h2><span className={`status-light ${liveConnected ? "status-light-live" : "status-light-warn"}`} /></div>
                <div className="mt-4 space-y-3 text-xs">
                  <div className="health-row"><span>WebSocket</span><strong>{snapshot?.scannerDiagnostics?.websocketConnected ? "Connected" : streamLabel}</strong></div>
                  <div className="health-row"><span>Fresh quotes</span><strong>{snapshot?.scannerDiagnostics?.quoteFresh ?? 0}</strong></div>
                  <div className="health-row"><span>Signals emitted</span><strong>{snapshot?.scannerDiagnostics?.alertsEmittedCount ?? alerts.length}</strong></div>
                  <div className="health-row"><span>Persistence</span><strong>{snapshot?.persistence.durable ? "Durable" : snapshot?.persistence.mode ?? "—"}</strong></div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </main>

      {selectedTicker ? (
        <div className="ticker-drawer-wrap" role="dialog" aria-modal="true" aria-label={`${selectedTicker} details`}>
          <button className="ticker-drawer-scrim" onClick={() => setSelectedTicker(null)} aria-label="Close ticker details" />
          <aside className="ticker-drawer">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] p-5">
              <div><p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Ticker intelligence</p><h2 className="mt-1 text-3xl font-semibold tracking-tight text-white">{selectedTicker}</h2></div>
              <button type="button" className="drawer-close" onClick={() => setSelectedTicker(null)}>×</button>
            </div>
            <div className="space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-2">
                <div className="detail-stat"><span>Price</span><strong>{formatPrice(selectedAlert?.tickerPrice ?? selectedWatch?.price)}</strong></div>
                <div className="detail-stat"><span>Move</span><strong className={(selectedAlert?.changePercent ?? selectedWatch?.changePercent ?? 0) >= 0 ? "move-up" : "move-down"}>{formatMove(selectedAlert?.changePercent ?? selectedWatch?.changePercent)}</strong></div>
                <div className="detail-stat"><span>Volume</span><strong>{compactNumber(selectedAlert?.currentVolume)}</strong></div>
                <div className="detail-stat"><span>RVOL</span><strong>{selectedAlert?.relativeVolume ? `${selectedAlert.relativeVolume.toFixed(1)}x` : "—"}</strong></div>
                <div className="detail-stat"><span>Float</span><strong>{compactNumber(selectedAlert?.floatShares)}</strong></div>
                <div className="detail-stat"><span>Score</span><strong>{selectedAlert?.score ?? "—"}</strong></div>
              </div>
              <div className="drawer-section"><span>Latest trigger</span><strong>{selectedAlert?.alertType.replaceAll("_", " ") ?? selectedWatch?.activeSignalType ?? "Watchlist"}</strong><p>{selectedAlert?.reason ?? "Live quote context is available from the watchlist."}</p></div>
              {selectedAlert?.newsHeadline ? <div className="drawer-section"><span>Catalyst</span><strong>Latest news</strong><p>{selectedAlert.newsHeadline}</p>{selectedAlert.newsUrl ? <a href={selectedAlert.newsUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}</div> : null}
              <div className="drawer-section"><span>Market data</span><div className="mt-3 flex flex-wrap gap-2">{[countryFlag(selectedAlert?.countryCode ?? null), selectedAlert?.highCostToBorrow ? "High CTB" : null, selectedAlert?.shortInterestPercent ? `SI ${selectedAlert.shortInterestPercent.toFixed(1)}%` : null, selectedAlert?.marketCap ? `MC ${compactNumber(selectedAlert.marketCap)}` : null].filter(Boolean).map((tag) => <em key={tag}>{tag}</em>)}</div></div>
              <p className="text-[11px] leading-5 text-slate-600">Market data may be delayed or unavailable during provider interruptions. Verify important information before acting.</p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
