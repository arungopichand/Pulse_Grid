export type WatchlistTicker = {
  ticker: string;
  company: string;
  sector: string;
  exchange: "NASDAQ" | "NYSE" | "AMEX";
  instrumentType: "Common Stock";
  country: "US";
  floatShares?: number | null;
  riskFlags?: string[];
};

export const watchlistUniverse: WatchlistTicker[] = [
  {
    ticker: "PLUG",
    company: "Plug Power",
    sector: "Clean Energy",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 820_000_000,
  },
  {
    ticker: "CLOV",
    company: "Clover Health",
    sector: "Healthcare",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 410_000_000,
  },
  {
    ticker: "EVGO",
    company: "EVgo",
    sector: "Charging",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 225_000_000,
  },
  {
    ticker: "RANI",
    company: "Rani Therapeutics",
    sector: "Biotech",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 42_000_000,
  },
  {
    ticker: "WKHS",
    company: "Workhorse",
    sector: "EV",
    exchange: "NYSE",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 185_000_000,
  },
  {
    ticker: "BNGO",
    company: "Bionano Genomics",
    sector: "Genomics",
    exchange: "NYSE",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 330_000_000,
  },
  {
    ticker: "MVIS",
    company: "MicroVision",
    sector: "Sensors",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 210_000_000,
  },
  {
    ticker: "RR",
    company: "Richtech Robotics",
    sector: "Robotics",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 72_000_000,
  },
  {
    ticker: "OPTT",
    company: "Ocean Power Technologies",
    sector: "Energy Tech",
    exchange: "AMEX",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 88_000_000,
  },
  {
    ticker: "SNDL",
    company: "SNDL",
    sector: "Cannabis",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 245_000_000,
  },
];

export const backupWatchlistUniverse: WatchlistTicker[] = [
  {
    ticker: "OPEN",
    company: "Opendoor",
    sector: "Real Estate Tech",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 620_000_000,
  },
  {
    ticker: "ABEV",
    company: "Ambev",
    sector: "Consumer Staples",
    exchange: "NYSE",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 4_900_000_000,
  },
  {
    ticker: "ATNM",
    company: "Actinium Pharmaceuticals",
    sector: "Biotech",
    exchange: "AMEX",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 63_000_000,
  },
  {
    ticker: "FGEN",
    company: "FibroGen",
    sector: "Biotech",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 93_000_000,
  },
  {
    ticker: "VUZI",
    company: "Vuzix",
    sector: "Wearables",
    exchange: "NASDAQ",
    instrumentType: "Common Stock",
    country: "US",
    floatShares: 74_000_000,
  },
];

export const allWatchlistCandidates: WatchlistTicker[] = [...watchlistUniverse, ...backupWatchlistUniverse];
