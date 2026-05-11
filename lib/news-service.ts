import { getMassiveApiKey } from "./providers/massive";

export type CatalystType =
  | "PR"
  | "SEC"
  | "FDA"
  | "earnings"
  | "offering"
  | "contract"
  | "merger"
  | "other";

export type NewsItem = {
  id: string;
  title: string;
  articleUrl: string | null;
  publisher: string | null;
  publishedUtc: string | null;
  tickers: string[];
  catalystType: CatalystType;
};

const cache = new Map<string, { fetchedAt: number; items: NewsItem[] }>();
const TTL_MS = 60_000;

function classifyCatalyst(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes("8-k") || normalized.includes("10-q") || normalized.includes("6-k") || normalized.includes("s-1") || normalized.includes("424b")) return "SEC" as const;
  if (normalized.includes("fda") || normalized.includes("trial")) return "FDA" as const;
  if (normalized.includes("earnings") || normalized.includes("guidance")) return "earnings" as const;
  if (normalized.includes("offering") || normalized.includes("dilution")) return "offering" as const;
  if (normalized.includes("contract")) return "contract" as const;
  if (normalized.includes("merger") || normalized.includes("acquisition")) return "merger" as const;
  if (normalized.includes("press release") || normalized.includes("pr")) return "PR" as const;
  return "other" as const;
}

export async function fetchMassiveNewsForTicker(ticker: string) {
  const symbol = ticker.trim().toUpperCase();
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt <= TTL_MS) {
    return cached.items;
  }

  const key = getMassiveApiKey();
  if (!key) return [];
  const url = new URL("https://api.massive.com/v2/reference/news");
  url.searchParams.set("ticker", symbol);
  url.searchParams.set("limit", "20");
  url.searchParams.set("apiKey", key);

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { results?: Array<Record<string, unknown>> };
    if (!response.ok || !Array.isArray(payload.results)) return [];
    const items: NewsItem[] = payload.results.map((row, idx) => {
      const title = typeof row.title === "string" ? row.title : "Untitled";
      const articleUrl = typeof row.article_url === "string" ? row.article_url : typeof row.articleUrl === "string" ? row.articleUrl : null;
      const publisher =
        typeof row.publisher === "string"
          ? row.publisher
          : row.publisher && typeof row.publisher === "object" && "name" in row.publisher && typeof (row.publisher as { name?: unknown }).name === "string"
            ? ((row.publisher as { name: string }).name)
            : null;
      const publishedUtc = typeof row.published_utc === "string" ? row.published_utc : null;
      const tickers =
        Array.isArray(row.tickers)
          ? row.tickers.filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase())
          : [symbol];
      return {
        id: `${symbol}-${publishedUtc ?? "na"}-${idx}`,
        title,
        articleUrl,
        publisher,
        publishedUtc,
        tickers,
        catalystType: classifyCatalyst(title),
      };
    });
    cache.set(symbol, { fetchedAt: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}

export async function fetchSecFilingsForTicker() {
  return [] as Array<{ formType: string; link: string; filedAt: string | null }>;
}
