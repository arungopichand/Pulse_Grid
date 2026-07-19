"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BotFeedItem } from "@/lib/bot-feed/types";
import { fetchLiveSessionSnapshot, type LiveSessionSnapshot } from "@/lib/market-data";
import type { RunnerAlert } from "@/lib/runner-alerts";

type Channel = "main" | "momentum" | "halts" | "catalysts" | "gainers" | "watchlist";
type ChatKind = "momentum" | "halt" | "news" | "filing" | "summary" | "session";
type ChatBot = "pulse" | "wire" | "filings";

type ChatItem = {
  id: string;
  dedupeKey: string;
  timestamp: string;
  timeLabel: string;
  bot: ChatBot;
  kind: ChatKind;
  ticker: string | null;
  direction: "up" | "down" | null;
  priceBucket: string | null;
  movePercent: number | null;
  occurrenceCount: number | null;
  label: string;
  detail: string;
  metadata: string[];
  priceLabel: string | null;
  priority: "critical" | "high" | "medium" | "low";
};

type ChatGroup = {
  id: string;
  bot: ChatBot;
  timestamp: string;
  items: ChatItem[];
};

const CHANNELS: Array<{ id: Channel; label: string; icon: string; section: "scanner" | "tables" }> = [
  { id: "main", label: "main-chat", icon: "🌿", section: "scanner" },
  { id: "momentum", label: "momentum-spikes", icon: "⚡", section: "scanner" },
  { id: "halts", label: "halts", icon: "⏸", section: "scanner" },
  { id: "catalysts", label: "catalysts", icon: "📰", section: "scanner" },
  { id: "gainers", label: "gainers", icon: "📈", section: "tables" },
  { id: "watchlist", label: "watchlist", icon: "⭐", section: "tables" },
];

const BOT_DETAILS: Record<ChatBot, { name: string; avatarLabel: string; tone: string }> = {
  pulse: { name: "PulseBot", avatarLabel: "PG", tone: "pulse" },
  wire: { name: "MarketWire", avatarLabel: "MW", tone: "wire" },
  filings: { name: "FilingsBot", avatarLabel: "SEC", tone: "filings" },
};

function compactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
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

function marketTime(timestamp: string, withSeconds = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(timestamp));
}

function groupTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
  const currentDay = dateFormatter.format(new Date());
  const itemDay = dateFormatter.format(date);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return itemDay === currentDay ? `Today at ${clock}` : `${itemDay} at ${clock}`;
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
  if (price === null) return null;
  if (price < 0.5) return "< $.50c";
  if (price < 1) return "< $1";
  if (price < 2) return "< $2";
  if (price < 5) return "< $5";
  if (price < 10) return "< $10";
  if (price < 20) return "< $20";
  return formatPrice(price);
}

function normalizeLabel(value: string) {
  return value
    .replace("HALTED_UP", "Halted UP")
    .replace("HALTED_DOWN", "Halted DOWN")
    .replace("VOLUME_SPIKE", "Volume spike")
    .replace("GREEN_BARS", "3 green bars")
    .replace("PR_SPIKE", "PR spike")
    .replaceAll("_", " ");
}

function botItemToChat(item: BotFeedItem): ChatItem | null {
  if (item.type === "source_header") return null;

  if (item.type === "momentum_alert") {
    return {
      id: item.id,
      dedupeKey: item.dedupeKey,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      bot: "pulse",
      kind: "momentum",
      ticker: item.ticker,
      direction: item.direction,
      priceBucket: item.priceBucketLabel,
      movePercent: item.movePercent,
      occurrenceCount: item.occurrenceCount,
      label: item.label,
      detail: item.whyNow,
      metadata: item.metadataParts,
      priceLabel: null,
      priority: item.priority,
    };
  }

  if (item.type === "halt_alert") {
    return {
      id: item.id,
      dedupeKey: item.dedupeKey,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      bot: "pulse",
      kind: "halt",
      ticker: item.ticker,
      direction: item.haltDirection === "DOWN" ? "down" : "up",
      priceBucket: null,
      movePercent: null,
      occurrenceCount: null,
      label: item.haltDirection === "HALTED" ? "Resumption Watch" : `Halted ${item.haltDirection}`,
      detail: item.reasonLabel || "Volatility",
      metadata: item.metadataParts,
      priceLabel: item.priceLabel || null,
      priority: "critical",
    };
  }

  if (item.type === "symbol_news") {
    return {
      id: item.id,
      dedupeKey: item.dedupeKey,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      bot: "wire",
      kind: "news",
      ticker: item.ticker,
      direction: null,
      priceBucket: item.priceBucketLabel || null,
      movePercent: null,
      occurrenceCount: null,
      label: item.label,
      detail: item.headline,
      metadata: item.metadataParts,
      priceLabel: null,
      priority: item.priority,
    };
  }

  if (item.type === "sec_filing") {
    return {
      id: item.id,
      dedupeKey: item.dedupeKey,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      bot: "filings",
      kind: "filing",
      ticker: item.ticker,
      direction: null,
      priceBucket: null,
      movePercent: null,
      occurrenceCount: null,
      label: item.formLabel,
      detail: item.linkText,
      metadata: ["SEC filing"],
      priceLabel: null,
      priority: item.priority,
    };
  }

  if (item.type === "top_gainer_summary") {
    return {
      id: item.id,
      dedupeKey: item.dedupeKey,
      timestamp: item.timestamp,
      timeLabel: item.timeLabel,
      bot: "pulse",
      kind: "summary",
      ticker: null,
      direction: null,
      priceBucket: null,
      movePercent: null,
      occurrenceCount: null,
      label: "Top Gainers",
      detail: item.summaryText,
      metadata: item.symbols,
      priceLabel: null,
      priority: item.priority,
    };
  }

  return {
    id: item.id,
    dedupeKey: item.dedupeKey,
    timestamp: item.timestamp,
    timeLabel: item.timeLabel,
    bot: "pulse",
    kind: item.type === "summary_event" ? "summary" : "session",
    ticker: null,
    direction: null,
    priceBucket: null,
    movePercent: null,
    occurrenceCount: null,
    label: item.label,
    detail: item.detail,
    metadata: [],
    priceLabel: null,
    priority: item.priority,
  };
}

function alertToChat(alert: RunnerAlert): ChatItem {
  const isHalt = alert.alertType.startsWith("HALTED") || alert.alertType === "NEWS_PENDING_HALT";
  const isNews = alert.source === "news" || alert.alertType === "PR_SPIKE";
  const kind: ChatKind = isHalt ? "halt" : isNews ? "news" : "momentum";
  const metadata = [
    countryFlag(alert.countryCode),
    alert.floatShares ? `Float: ${compactNumber(alert.floatShares)}` : null,
    alert.relativeVolume ? `RVol: ${alert.relativeVolume.toFixed(1)}x` : null,
    alert.currentVolume ? `Vol: ${compactNumber(alert.currentVolume)}` : null,
    alert.shortInterestPercent ? `SI: ${alert.shortInterestPercent.toFixed(1)}%` : null,
    alert.marketCap ? `MC: ${compactNumber(alert.marketCap)}` : null,
    alert.highCostToBorrow ? "High CTB" : null,
  ].filter((part): part is string => Boolean(part));

  return {
    id: `runner-${alert.id}`,
    dedupeKey: `runner|${alert.ticker}|${alert.alertType}|${alert.alertCountToday ?? 1}`,
    timestamp: alert.timestamp,
    timeLabel: alert.alertTime || marketTime(alert.timestamp, isHalt),
    bot: isNews ? "wire" : "pulse",
    kind,
    ticker: alert.ticker,
    direction: (alert.changePercent ?? 0) >= 0 ? "up" : "down",
    priceBucket: priceBucket(alert.tickerPrice),
    movePercent: alert.changePercent,
    occurrenceCount: alert.alertCountToday ?? 1,
    label: normalizeLabel(alert.alertType),
    detail: alert.newsHeadline || alert.reason,
    metadata,
    priceLabel: isHalt ? formatPrice(alert.tickerPrice) : null,
    priority: isHalt ? "critical" : alert.score >= 85 ? "high" : alert.score >= 70 ? "medium" : "low",
  };
}

function dedupeChatItems(items: ChatItem[]) {
  const byKey = new Map<string, ChatItem>();
  for (const item of [...items].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())) {
    byKey.set(item.dedupeKey, item);
  }
  return [...byKey.values()]
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .slice(-100);
}

function buildChatGroups(items: ChatItem[]): ChatGroup[] {
  const groups: ChatGroup[] = [];
  for (const item of items) {
    const previous = groups[groups.length - 1];
    const gapMs = previous ? new Date(item.timestamp).getTime() - new Date(previous.timestamp).getTime() : Number.POSITIVE_INFINITY;
    const canJoin = previous && previous.bot === item.bot && gapMs < 12 * 60_000 && previous.items.length < 9 && item.kind !== "session";
    if (canJoin) {
      previous.items.push(item);
    } else {
      groups.push({ id: `chat-group-${item.id}`, bot: item.bot, timestamp: item.timestamp, items: [item] });
    }
  }
  return groups;
}

function matchesChannel(item: ChatItem, channel: Channel, watchlist: Set<string>) {
  if (channel === "main") return true;
  if (channel === "momentum") return item.kind === "momentum";
  if (channel === "halts") return item.kind === "halt";
  if (channel === "catalysts") return item.kind === "news" || item.kind === "filing";
  if (channel === "gainers") return item.kind === "summary" || (item.kind === "momentum" && (item.movePercent ?? 0) > 0);
  return Boolean(item.ticker && watchlist.has(item.ticker));
}

function MetadataParts({ parts }: { parts: string[] }) {
  if (!parts.length) return null;
  return (
    <>
      {parts.map((part, index) => (
        <span className="nuntio-meta" key={`${part}-${index}`}>
          <span aria-hidden="true">|</span> {part}
        </span>
      ))}
    </>
  );
}

function ChatRow({ item, onSelect }: { item: ChatItem; onSelect: (ticker: string) => void }) {
  if (item.kind === "momentum") {
    return (
      <button type="button" className="nuntio-alert-line" onClick={() => item.ticker && onSelect(item.ticker)}>
        <span className="nuntio-time-token">{item.timeLabel}</span>
        <span className={`nuntio-arrow nuntio-arrow-${item.direction}`}>{item.direction === "down" ? "↓" : "↑"}</span>
        <strong className="nuntio-ticker">{item.ticker}</strong>
        {item.priceBucket ? <span className="nuntio-price-bucket">{item.priceBucket}</span> : null}
        {item.movePercent !== null ? <span className={`nuntio-move nuntio-move-${item.direction}`}>{Math.abs(item.movePercent).toFixed(Math.abs(item.movePercent) >= 100 ? 0 : 0)}%</span> : null}
        {item.occurrenceCount ? <span className="nuntio-occurrence">· {item.occurrenceCount}</span> : null}
        <span className="nuntio-event-tag">{item.label}</span>
        <span className="nuntio-tilde">~</span>
        <MetadataParts parts={item.metadata} />
        {item.detail ? <span className="nuntio-why">{item.detail}</span> : null}
      </button>
    );
  }

  if (item.kind === "halt") {
    return (
      <button type="button" className="nuntio-alert-line nuntio-halt-line" onClick={() => item.ticker && onSelect(item.ticker)}>
        <span className="nuntio-time-token">{item.timeLabel}</span>
        <strong className="nuntio-ticker">{item.ticker}</strong>
        <span className={`nuntio-halt-tag nuntio-halt-${item.direction}`}>{item.label}</span>
        <span className="nuntio-meta-plain">| {item.detail}</span>
        {item.priceLabel ? <span className="nuntio-halt-price">→ {item.priceLabel}</span> : null}
        <MetadataParts parts={item.metadata} />
      </button>
    );
  }

  if (item.kind === "news" || item.kind === "filing") {
    return (
      <button type="button" className="nuntio-context-line" onClick={() => item.ticker && onSelect(item.ticker)}>
        <div className="nuntio-context-heading">
          <span className="nuntio-time-muted">{item.timeLabel}</span>
          <strong className="nuntio-ticker">{item.ticker}</strong>
          {item.priceBucket ? <span className="nuntio-price-bucket">{item.priceBucket}</span> : null}
          <span className={`nuntio-context-tag nuntio-context-${item.kind}`}>{item.label}</span>
          <span className="nuntio-link-label">Link ↗</span>
        </div>
        <div className="nuntio-context-copy">
          <span>{item.detail}</span>
          <MetadataParts parts={item.metadata} />
        </div>
      </button>
    );
  }

  if (item.kind === "summary") {
    return (
      <div className="nuntio-summary-card">
        <div className="nuntio-summary-title"><span>{item.timeLabel}</span>{item.label}</div>
        <p>{item.detail}</p>
        {item.metadata.length ? <div className="nuntio-summary-symbols">{item.metadata.map((symbol) => <span key={symbol}>{symbol}</span>)}</div> : null}
      </div>
    );
  }

  return (
    <div className="nuntio-session-card">
      <div><span className="nuntio-time-muted">{item.timeLabel}</span><strong>{item.label}</strong></div>
      <p>{item.detail}</p>
    </div>
  );
}

function ChatMessageGroup({ group, onSelect }: { group: ChatGroup; onSelect: (ticker: string) => void }) {
  const bot = BOT_DETAILS[group.bot];
  return (
    <article className="nuntio-message-group">
      <div className={`nuntio-bot-avatar nuntio-bot-${bot.tone}`} aria-hidden="true">
        {group.bot === "pulse" ? <span className="nuntio-dot-grid"><i /><i /><i /><i /><i /><i /><i /></span> : bot.avatarLabel}
      </div>
      <div className="nuntio-message-content">
        <header className="nuntio-message-author">
          <strong>{bot.name}</strong>
          <span className="nuntio-app-badge">APP</span>
          <time dateTime={group.timestamp}>{groupTimestamp(group.timestamp)}</time>
        </header>
        <div className="nuntio-message-lines">
          {group.items.map((item) => <ChatRow key={item.id} item={item} onSelect={onSelect} />)}
        </div>
      </div>
    </article>
  );
}

export function PulseTerminal() {
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<Channel>("main");
  const [query, setQuery] = useState("");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [liveConnected, setLiveConnected] = useState<boolean | null>(null);
  const [now, setNow] = useState(Date.now());

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
      try {
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
      } catch {
        if (active && !controller.signal.aborted) {
          setLoading(false);
          setLiveConnected(false);
        }
      }
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
  const chatItems = useMemo(() => {
    const normalizedBotItems = (snapshot?.botFeed ?? []).map(botItemToChat).filter((item): item is ChatItem => Boolean(item));
    const hasActionableBotRows = normalizedBotItems.some((item) => item.kind !== "session" && item.kind !== "summary");
    const fallbackAlerts = hasActionableBotRows ? [] : alerts.map(alertToChat);
    return dedupeChatItems([...normalizedBotItems, ...fallbackAlerts]);
  }, [alerts, snapshot]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return chatItems.filter((item) => {
      if (!matchesChannel(item, channel, watchlistSet)) return false;
      if (!needle) return true;
      return `${item.ticker ?? ""} ${item.label} ${item.detail} ${item.metadata.join(" ")}`.toUpperCase().includes(needle);
    });
  }, [channel, chatItems, query, watchlistSet]);

  const groups = useMemo(() => buildChatGroups(visibleItems), [visibleItems]);
  const counts = useMemo(() => Object.fromEntries(CHANNELS.map((entry) => [entry.id, chatItems.filter((item) => matchesChannel(item, entry.id, watchlistSet)).length])) as Record<Channel, number>, [chatItems, watchlistSet]);
  const currentChannel = CHANNELS.find((entry) => entry.id === channel) ?? CHANNELS[0];
  const selectedAlert = alerts.find((alert) => alert.ticker === selectedTicker) ?? null;
  const selectedWatch = snapshot?.watchlist.find((item) => item.ticker === selectedTicker) ?? null;
  const streamLabel = liveConnected === true ? "Live" : liveConnected === false ? "Reconnecting" : "Connecting";
  const activeUniverse = snapshot?.scannerDiagnostics?.activeUniverseCount ?? snapshot?.activeUniverseTickers?.length ?? 0;
  const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(now));

  function chooseChannel(next: Channel) {
    setChannel(next);
    setSidebarOpen(false);
  }

  function scrollToPresent() {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }

  return (
    <div className="nuntio-shell">
      {sidebarOpen ? <button type="button" className="nuntio-mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}

      <aside className={`nuntio-workspaces ${sidebarOpen ? "nuntio-workspaces-open" : ""}`} aria-label="Workspaces">
        <div className="nuntio-workspace nuntio-workspace-home">PG</div>
        <div className="nuntio-workspace-divider" />
        <div className="nuntio-workspace nuntio-workspace-active"><span className="nuntio-mini-grid"><i /><i /><i /><i /></span></div>
        <div className="nuntio-workspace">M</div>
        <div className="nuntio-workspace">N</div>
        <div className="nuntio-workspace nuntio-workspace-add">+</div>
      </aside>

      <aside className={`nuntio-channels ${sidebarOpen ? "nuntio-channels-open" : ""}`}>
        <div className="nuntio-server-header">
          <div><span className="nuntio-server-logo">P</span><strong>PulseGrid</strong></div>
          <span>⌄</span>
        </div>
        <button type="button" className="nuntio-browse"><span>☷</span> Browse Channels</button>

        <div className="nuntio-channel-scroll">
          <section className="nuntio-channel-section">
            <p>Pinned Channels</p>
            <button type="button" className="nuntio-channel-row" onClick={() => chooseChannel("catalysts")}><span>#</span><b>🚨 pr-spike</b></button>
          </section>

          <section className="nuntio-channel-section">
            <p>Start <span>⌄</span></p>
            <div className="nuntio-channel-row nuntio-channel-muted"><span>☑</span><b>start-here</b></div>
          </section>

          <section className="nuntio-channel-section">
            <p>Scanner <span>⌄</span></p>
            {CHANNELS.filter((entry) => entry.section === "scanner").map((entry) => (
              <button key={entry.id} type="button" className={`nuntio-channel-row ${channel === entry.id ? "nuntio-channel-active" : ""}`} onClick={() => chooseChannel(entry.id)}>
                <span>#</span><b>{entry.icon} {entry.label}</b><em>{counts[entry.id]}</em>
              </button>
            ))}
          </section>

          <section className="nuntio-channel-section">
            <p>Tables <span>⌄</span></p>
            {CHANNELS.filter((entry) => entry.section === "tables").map((entry) => (
              <button key={entry.id} type="button" className={`nuntio-channel-row ${channel === entry.id ? "nuntio-channel-active" : ""}`} onClick={() => chooseChannel(entry.id)}>
                <span>#</span><b>{entry.icon} {entry.label}</b><em>{counts[entry.id]}</em>
              </button>
            ))}
          </section>
        </div>

        <div className="nuntio-sidebar-status">
          <span className={`nuntio-status-dot ${liveConnected ? "nuntio-status-live" : ""}`} />
          <div><strong>{streamLabel}</strong><small>{snapshot?.sessionLabel ?? "Loading market"}</small></div>
          <span className="nuntio-sidebar-clock">{nyClock}</span>
        </div>
      </aside>

      <main className="nuntio-main">
        <header className="nuntio-topbar">
          <div className="nuntio-channel-title">
            <button type="button" className="nuntio-mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button>
            <span>#</span><strong>{currentChannel.icon} {currentChannel.label}</strong>
          </div>
          <div className="nuntio-toolbar">
            <button type="button" aria-label="Notifications">◒</button>
            <button type="button" aria-label="Pinned alerts">◆</button>
            <label className="nuntio-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search PulseGrid" aria-label="Search PulseGrid" /><span>⌕</span></label>
          </div>
        </header>

        <div className="nuntio-feed-status">
          <span className={`nuntio-status-dot ${liveConnected ? "nuntio-status-live" : ""}`} />
          <strong>{streamLabel}</strong>
          <span>{snapshot?.sessionLabel ?? "Loading"}</span>
          <span>·</span>
          <span>{activeUniverse} symbols</span>
          <span>·</span>
          <span>{alerts.length} active alerts</span>
          <span className="nuntio-feed-status-right">New York market time</span>
        </div>

        <section className="nuntio-feed" aria-live="polite">
          {loading ? (
            <div className="nuntio-loading"><span /><span /><span /><span /></div>
          ) : groups.length ? (
            groups.map((group) => <ChatMessageGroup key={group.id} group={group} onSelect={setSelectedTicker} />)
          ) : (
            <div className="nuntio-empty">
              <div className="nuntio-empty-icon">#</div>
              <h2>No alerts in #{currentChannel.label}</h2>
              <p>The scanner is connected. New qualifying market events will appear here automatically.</p>
            </div>
          )}
        </section>

        <button type="button" className="nuntio-jump" onClick={scrollToPresent}><span>You’re viewing live messages</span><b>Jump To Present</b></button>
      </main>

      {selectedTicker ? (
        <div className="nuntio-drawer-wrap" role="dialog" aria-modal="true" aria-label={`${selectedTicker} details`}>
          <button type="button" className="nuntio-drawer-scrim" aria-label="Close ticker details" onClick={() => setSelectedTicker(null)} />
          <aside className="nuntio-drawer">
            <div className="nuntio-drawer-header">
              <div><span>Ticker intelligence</span><h2>{selectedTicker}</h2></div>
              <button type="button" onClick={() => setSelectedTicker(null)}>×</button>
            </div>
            <div className="nuntio-drawer-body">
              <div className="nuntio-detail-grid">
                <div><span>Price</span><strong>{formatPrice(selectedAlert?.tickerPrice ?? selectedWatch?.price)}</strong></div>
                <div><span>Move</span><strong className={(selectedAlert?.changePercent ?? selectedWatch?.changePercent ?? 0) >= 0 ? "nuntio-positive" : "nuntio-negative"}>{formatMove(selectedAlert?.changePercent ?? selectedWatch?.changePercent)}</strong></div>
                <div><span>Volume</span><strong>{compactNumber(selectedAlert?.currentVolume)}</strong></div>
                <div><span>RVOL</span><strong>{selectedAlert?.relativeVolume ? `${selectedAlert.relativeVolume.toFixed(1)}x` : "—"}</strong></div>
                <div><span>Float</span><strong>{compactNumber(selectedAlert?.floatShares)}</strong></div>
                <div><span>Score</span><strong>{selectedAlert?.score ?? "—"}</strong></div>
              </div>
              <section className="nuntio-detail-section"><span>Latest trigger</span><strong>{selectedAlert ? normalizeLabel(selectedAlert.alertType) : selectedWatch?.activeSignalType ?? "Watchlist"}</strong><p>{selectedAlert?.reason ?? "Waiting for a fresh qualifying event."}</p></section>
              {selectedAlert?.newsHeadline ? <section className="nuntio-detail-section"><span>Catalyst</span><strong>{selectedAlert.newsHeadline}</strong>{selectedAlert.newsUrl ? <a href={selectedAlert.newsUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}</section> : null}
              <p className="nuntio-disclaimer">Scanner data is informational and may be delayed. Verify important information before acting.</p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
