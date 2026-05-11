const ETF_SYMBOL_BLACKLIST = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "TQQQ",
  "SQQQ",
  "UVXY",
  "VXX",
  "SOXL",
  "SOXS",
  "LABU",
  "LABD",
  "XLF",
  "XLK",
  "XLE",
  "XBI",
  "SMH",
  "ARKK",
  "KWEB",
  "HYG",
  "LQD",
  "TLT",
  "GLD",
  "SLV",
  "USO",
]);

const REJECT_TERMS = [
  "ETF",
  "ETN",
  "FUND",
  "TRUST",
  "INDEX",
  "LEVERAGED",
  "INVERSE",
  "NOTE",
  "NOTES",
  "TREASURY",
  "BOND",
  "SPDR",
  "ISHARES",
  "PROSHARES",
  "DIREXION",
  "INVESCO ETF",
  "VANGUARD ETF",
];

type InstrumentCandidate = {
  ticker?: string | null;
  instrumentType?: string | null;
  company?: string | null;
  name?: string | null;
  type?: string | null;
};

export type InstrumentClassificationReason =
  | "common_stock"
  | "unknown_allowed"
  | "etf_or_fund"
  | "warrant_filtered"
  | "unit_filtered"
  | "right_filtered";

export type InstrumentClassificationResult = {
  allowed: boolean;
  reason: InstrumentClassificationReason;
  confidence: "high" | "medium" | "low" | "unknown";
  rawType?: string;
  rawName?: string;
};

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

export function classifyInstrumentCandidate(candidate: InstrumentCandidate): InstrumentClassificationResult {
  const ticker = (candidate.ticker ?? "").trim().toUpperCase();
  const rawType = `${candidate.instrumentType ?? ""} ${candidate.type ?? ""}`.trim();
  const rawName = `${candidate.company ?? ""} ${candidate.name ?? ""}`.trim();
  if (!ticker) {
    return {
      allowed: false,
      reason: "etf_or_fund",
      confidence: "low",
      rawType,
      rawName,
    };
  }
  if (ETF_SYMBOL_BLACKLIST.has(ticker)) {
    return {
      allowed: false,
      reason: "etf_or_fund",
      confidence: "high",
      rawType,
      rawName,
    };
  }

  const typeText = rawType.toUpperCase();
  const nameText = rawName.toUpperCase();
  const haystack = `${typeText} ${nameText}`.trim();
  const allowWarrants = readBooleanEnv("PULSEGRID_ALLOW_WARRANTS", false);

  if (haystack.includes("WARRANT") || ticker.includes(".WS") || ticker.includes("-WS") || ticker.includes("/WS") || ticker.includes("-WT")) {
    if (allowWarrants) {
      return {
        allowed: true,
        reason: "common_stock",
        confidence: "medium",
        rawType,
        rawName,
      };
    }
    return {
      allowed: false,
      reason: "warrant_filtered",
      confidence: "high",
      rawType,
      rawName,
    };
  }
  if (haystack.includes(" UNIT") || haystack.includes("UNITS")) {
    return {
      allowed: false,
      reason: "unit_filtered",
      confidence: "high",
      rawType,
      rawName,
    };
  }
  if (haystack.includes(" RIGHT") || haystack.includes("RIGHTS")) {
    return {
      allowed: false,
      reason: "right_filtered",
      confidence: "high",
      rawType,
      rawName,
    };
  }

  if (haystack.length > 0 && REJECT_TERMS.some((term) => haystack.includes(term))) {
    return {
      allowed: false,
      reason: "etf_or_fund",
      confidence: "high",
      rawType,
      rawName,
    };
  }

  if (typeText.length > 0) {
    const allowsCommon =
      typeText.includes("COMMON STOCK") ||
      typeText.includes("COMMON") ||
      typeText.includes("EQUITY") ||
      typeText.includes("ORDINARY SHARE");
    if (!allowsCommon) {
      return {
        allowed: false,
        reason: "etf_or_fund",
        confidence: "medium",
        rawType,
        rawName,
      };
    }
    return {
      allowed: true,
      reason: "common_stock",
      confidence: "high",
      rawType,
      rawName,
    };
  }

  return {
    allowed: true,
    reason: "unknown_allowed",
    confidence: "unknown",
    rawType,
    rawName,
  };
}

export function isCommonStockCandidate(candidate: InstrumentCandidate) {
  return classifyInstrumentCandidate(candidate).allowed;
}
