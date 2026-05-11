export type FeedItemType =
  | "signal"
  | "signal_followup"
  | "filing"
  | "news"
  | "macro_news"
  | "halt"
  | "market_marker"
  | "economic_event"
  | "summary_line"
  | "summary_table";

export type FeedPriority = "critical" | "high" | "medium" | "low";
export type FeedSource = "scanner" | "news" | "filing" | "system" | "summary" | "macro";
export type FeedScannerRule = "Eligible" | "Above Price Limit";

type FeedItemBase<TType extends FeedItemType, TMetadata> = {
  id: string;
  dedupeKey: string;
  type: TType;
  timestamp: string;
  marketDayKey: string;
  source: FeedSource;
  priority: FeedPriority;
  ticker?: string;
  headline?: string;
  text?: string;
  body?: string;
  metadata: TMetadata;
};

export type FeedSignalMetadata = {
  signalType: string;
  company: string;
  price: number;
  changePercent: number;
  priceBucketLabel: string;
  scannerRuleLabel: FeedScannerRule;
  confidence: string;
  confidenceScore: number;
  finalScore: number;
  quoteFreshness: string;
  countryCode: string;
  exchange: string;
  floatLabel: string | null;
  relativeVolumeLabel: string;
  volumeLabel: string;
  stageTags: string[];
  primaryPatternLabel: string;
  secondaryReasonLabel: string | null;
  occurrenceCount: number;
  sequenceLabel: string | null;
  summary: string;
  reasonBadges: string[];
  themeTags: string[];
  specialTags: string[];
  riskFlags: string[];
};

export type FeedSignalItem = FeedItemBase<"signal", FeedSignalMetadata>;

export type FeedFollowupItem = FeedItemBase<"signal_followup", {
  eventType: string;
  context: string;
  linkedTicker?: string;
}>;

export type FeedNewsItem = FeedItemBase<"news" | "macro_news", {
  eventType: string;
  sentiment: "bullish" | "bearish" | "neutral" | null;
  linkedTicker?: string;
  sourceLabel: string;
}>;

export type FeedFilingItem = FeedItemBase<"filing", {
  filingType: string;
  linkedTicker?: string;
}>;

export type FeedHaltItem = FeedItemBase<"halt", {
  haltCode: string;
  linkedTicker?: string;
}>;

export type FeedMarketMarkerItem = FeedItemBase<"market_marker", {
  label: string;
  phase: "premarket" | "regular" | "after-hours" | "closed";
  detail: string;
}>;

export type FeedEconomicEventItem = FeedItemBase<"economic_event", {
  category: string;
  impact: "high" | "medium" | "low";
}>;

export type FeedSummaryLineItem = FeedItemBase<"summary_line", {
  label: string;
  symbols: string[];
}>;

export type FeedSummaryTableItem = FeedItemBase<"summary_table", {
  label: string;
  columns: string[];
  rows: Array<{ symbol: string; values: string[] }>;
}>;

export type FeedItem =
  | FeedSignalItem
  | FeedFollowupItem
  | FeedNewsItem
  | FeedFilingItem
  | FeedHaltItem
  | FeedMarketMarkerItem
  | FeedEconomicEventItem
  | FeedSummaryLineItem
  | FeedSummaryTableItem;

export type FeedStoreDiagnostics = {
  marketDayKey: string;
  itemCount: number;
  perTypeCounts: Partial<Record<FeedItemType, number>>;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  loadedFromPersistence: boolean;
  rolloverPurged: boolean;
};
