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

export function isCommonStockCandidate(candidate: InstrumentCandidate) {
  const ticker = (candidate.ticker ?? "").trim().toUpperCase();
  if (!ticker) return false;
  if (ETF_SYMBOL_BLACKLIST.has(ticker)) return false;

  const typeText = `${candidate.instrumentType ?? ""} ${candidate.type ?? ""}`.toUpperCase();
  const nameText = `${candidate.company ?? ""} ${candidate.name ?? ""}`.toUpperCase();
  const haystack = `${typeText} ${nameText}`.trim();

  if (haystack.length > 0 && REJECT_TERMS.some((term) => haystack.includes(term))) {
    return false;
  }

  if (typeText.length > 0) {
    const allowsCommon =
      typeText.includes("COMMON STOCK") ||
      typeText.includes("COMMON") ||
      typeText.includes("EQUITY") ||
      typeText.includes("ORDINARY SHARE");
    if (!allowsCommon) {
      return false;
    }
  }

  return true;
}

