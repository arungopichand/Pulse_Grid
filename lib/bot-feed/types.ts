export type BotFeedEventType =
  | "source_header"
  | "momentum_alert"
  | "symbol_news"
  | "sec_filing"
  | "halt_alert"
  | "top_gainer_summary"
  | "session_marker"
  | "summary_event";

export type BotFeedPriority = "critical" | "high" | "medium" | "low";

export type BotFeedBase<TType extends BotFeedEventType> = {
  id: string;
  type: TType;
  source: string;
  timestamp: string;
  marketDayKey: string;
  priority: BotFeedPriority;
  ticker?: string;
  dedupeKey: string;
  rawRef?: {
    signalId?: string;
    eventId?: string;
    alertSignalId?: string;
  };
};

export type SourceHeaderItem = BotFeedBase<"source_header"> & {
  source: string;
  timeLabel: string;
  subLabel?: string;
};

export type MomentumAlertItem = BotFeedBase<"momentum_alert"> & {
  ticker: string;
  timeLabel: string;
  direction: "up" | "down";
  priceBucketLabel: string;
  movePercent: number;
  occurrenceCount: number;
  label: string;
  whyNow: string;
  metadataParts: string[];
  confidenceLabel: "High" | "Medium" | "Low";
  confidenceScore: number;
  severity?: string;
  lifecycleState?: "new" | "active" | "cooled_down" | "resolved";
  isFresh?: boolean;
  isFading?: boolean;
};

export type SymbolNewsItem = BotFeedBase<"symbol_news"> & {
  ticker: string;
  timeLabel: string;
  label: "News Spike" | "News Pending";
  priceBucketLabel?: string;
  headline: string;
  metadataParts: string[];
  confidenceLabel: "High" | "Medium" | "Low";
};

export type SecFilingItem = BotFeedBase<"sec_filing"> & {
  timeLabel: string;
  ticker: string;
  formLabel: string;
  linkText: string;
};

export type HaltAlertItem = BotFeedBase<"halt_alert"> & {
  timeLabel: string;
  ticker: string;
  haltDirection: "UP" | "DOWN" | "HALTED";
  reasonLabel?: string;
  priceLabel?: string;
  metadataParts: string[];
};

export type TopGainerSummaryItem = BotFeedBase<"top_gainer_summary"> & {
  timeLabel: string;
  summaryText: string;
  symbols: string[];
};

export type SessionMarkerItem = BotFeedBase<"session_marker"> & {
  timeLabel: string;
  label: string;
  detail: string;
};

export type SummaryEventItem = BotFeedBase<"summary_event"> & {
  timeLabel: string;
  label: string;
  detail: string;
};

export type BotFeedItem =
  | SourceHeaderItem
  | MomentumAlertItem
  | SymbolNewsItem
  | SecFilingItem
  | HaltAlertItem
  | TopGainerSummaryItem
  | SessionMarkerItem
  | SummaryEventItem;
