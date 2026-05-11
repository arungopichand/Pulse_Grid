export type RunnerAlert = {
  id: string;
  ticker: string;
  timestamp: string;
  alertTime: string;
  source: "massive" | "news" | "halt" | "enrichment";
  direction: "up" | "down" | "flat";
  alertType:
    | "NHOD"
    | "NSH"
    | "VOLUME_SPIKE"
    | "GREEN_BARS"
    | "PR_SPIKE"
    | "HALTED_UP"
    | "HALTED_DOWN"
    | "NEWS_PENDING_HALT"
    | "THEME"
    | "SQUEEZE_WATCH"
    | "TEST";
  tickerPrice: number | null;
  priceBucket: string;
  changePercent: number | null;
  alertCountToday: number;
  countryCode: string | null;
  countryFlag: string | null;
  currentVolume: number | null;
  averageVolume: number | null;
  relativeVolume: number | null;
  floatShares: number | null;
  marketCap: number | null;
  institutionalOwnershipPercent: number | null;
  shortInterestPercent: number | null;
  costToBorrowPercent: number | null;
  highCostToBorrow: boolean;
  theme: string | null;
  newsHeadline: string | null;
  newsUrl: string | null;
  haltStatus: "none" | "halted_up" | "halted_down" | "news_pending" | null;
  haltReason: string | null;
  sessionHigh: number | null;
  dayHigh: number | null;
  previousSessionHigh: number | null;
  previousDayHigh: number | null;
  score: number;
  reason: string;
  formattedLine: string;
};

