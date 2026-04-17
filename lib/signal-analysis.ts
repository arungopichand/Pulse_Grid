import type { Signal } from "./live-signal-engine";

export type SignalAnalysisStage = "Early" | "In play" | "Extended";
export type SignalAnalysisConfidence = "High conviction" | "Strong" | "Developing";
export type SignalAnalysisTone = "Breaking out" | "Holding" | "Building" | "Fading" | "Reappearing";
export type RankMovement = "new" | "up" | "down" | "flat";
export type SessionPhase = "premarket" | "regular" | "after-hours" | "closed";

export type SignalAnalysis = {
  summary: string;
  bullCase: string;
  risk: string;
  stage: SignalAnalysisStage;
  confidence: SignalAnalysisConfidence;
  tone: SignalAnalysisTone;
  source: "rules" | "llm";
  generatedAt: string;
};

export type SignalAnalysisFeatures = {
  ticker: string;
  signalType: Signal["signalType"];
  sessionStatus: SessionPhase;
  degraded: boolean;
  quoteFreshness: Signal["quoteFreshness"] | "stale" | "missing";
  rank: number;
  rankMovement: RankMovement;
  price: number;
  changePercent: number;
  confidenceScore: number;
  scannerScore: number;
  relativeVolume: number | null;
  streakCount: number;
  reasonBadges: string[];
  riskFlags: string[];
  ageSeconds: number;
};

const STAGE_VALUES: SignalAnalysisStage[] = ["Early", "In play", "Extended"];
const CONFIDENCE_VALUES: SignalAnalysisConfidence[] = ["High conviction", "Strong", "Developing"];
const TONE_VALUES: SignalAnalysisTone[] = ["Breaking out", "Holding", "Building", "Fading", "Reappearing"];

const BANNED_PATTERN =
  /\b(news|catalyst|filing|fda|halt|ctb|borrow|short\s+interest|sec|earnings|merger|acquisition|buy|sell|entry|stop(?:-|\s)?loss|take(?:-|\s)?profit|price\s+target|target\s+price|upside\s+target|downside\s+target)\b/i;
const FORWARD_LOOKING_PATTERN =
  /\b(will|going to|expected to|should|likely to|headed to|toward)\b/i;
const OVERCONFIDENT_PATTERN =
  /\b(guaranteed|certain|no\s+risk|cannot\s+fail|sure\s+thing|definitely)\b/i;

function clampText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}.`;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function containsBannedContent(value: string) {
  return BANNED_PATTERN.test(value);
}

function hasOverconfidentLanguage(value: string) {
  return OVERCONFIDENT_PATTERN.test(value);
}

function hasForwardLookingLanguage(value: string) {
  return FORWARD_LOOKING_PATTERN.test(value);
}

function normalizeStage(value: unknown): SignalAnalysisStage | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (normalized === "early") return "Early";
  if (normalized === "in play" || normalized === "in-play" || normalized === "inplay") return "In play";
  if (normalized === "extended") return "Extended";
  return null;
}

function normalizeConfidence(value: unknown): SignalAnalysisConfidence | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (normalized === "high conviction" || normalized === "high-conviction") return "High conviction";
  if (normalized === "strong") return "Strong";
  if (normalized === "developing") return "Developing";
  return null;
}

function normalizeTone(value: unknown): SignalAnalysisTone | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (normalized === "breaking out" || normalized === "breakout") return "Breaking out";
  if (normalized === "holding") return "Holding";
  if (normalized === "building") return "Building";
  if (normalized === "fading") return "Fading";
  if (normalized === "reappearing") return "Reappearing";
  return null;
}

export function getAgeBucket(ageSeconds: number) {
  if (ageSeconds <= 120) return "0-2m";
  if (ageSeconds <= 480) return "2-8m";
  if (ageSeconds <= 1200) return "8-20m";
  return "20m+";
}

export function getRankBucket(rank: number) {
  if (rank <= 1) return "top1";
  if (rank <= 3) return "top3";
  if (rank <= 5) return "top5";
  return "other";
}

export function getConfidenceScoreBucket(confidenceScore: number, scannerScore: number) {
  if (confidenceScore >= 90 || scannerScore >= 80) return "high";
  if (confidenceScore >= 78 || scannerScore >= 65) return "strong";
  return "developing";
}

function getMomentumBucket(changePercent: number) {
  if (changePercent >= 6) return "mom-strong";
  if (changePercent >= 3) return "mom-medium";
  return "mom-soft";
}

function getVolumeBucket(relativeVolume: number | null) {
  if (relativeVolume === null) return "vol-missing";
  if (relativeVolume >= 2.5) return "vol-strong";
  if (relativeVolume >= 1.8) return "vol-ok";
  return "vol-soft";
}

export function createSignalAnalysisFingerprint(features: SignalAnalysisFeatures) {
  return [
    features.ticker,
    features.signalType,
    features.sessionStatus,
    features.degraded ? "degraded" : "healthy",
    features.quoteFreshness,
    getAgeBucket(features.ageSeconds),
    getRankBucket(features.rank),
    features.rankMovement,
    getConfidenceScoreBucket(features.confidenceScore, features.scannerScore),
    getMomentumBucket(features.changePercent),
    getVolumeBucket(features.relativeVolume),
    features.streakCount >= 2 ? "repeat" : "single",
  ].join("|");
}

function getConfidenceBucket(features: SignalAnalysisFeatures): SignalAnalysisConfidence {
  if (getConfidenceScoreBucket(features.confidenceScore, features.scannerScore) === "high") {
    return "High conviction";
  }

  if (getConfidenceScoreBucket(features.confidenceScore, features.scannerScore) === "strong") {
    return "Strong";
  }

  return "Developing";
}

function getStage(features: SignalAnalysisFeatures): SignalAnalysisStage {
  if (features.degraded || features.quoteFreshness === "cached") {
    return features.ageSeconds <= 900 ? "In play" : "Extended";
  }

  if ((features.rankMovement === "new" || features.rankMovement === "up") && features.ageSeconds <= 240) {
    return "Early";
  }

  if (features.ageSeconds <= 1200) {
    return "In play";
  }

  return "Extended";
}

function getTone(features: SignalAnalysisFeatures): SignalAnalysisTone {
  if (features.rankMovement === "new" && features.streakCount >= 2) {
    return "Reappearing";
  }

  if (features.rankMovement === "down" || features.quoteFreshness === "cached") {
    return features.changePercent >= 3 ? "Holding" : "Fading";
  }

  if (features.changePercent >= 6 && (features.relativeVolume ?? 0) >= 2.5) {
    return "Breaking out";
  }

  if ((features.relativeVolume ?? 0) >= 2 || features.streakCount >= 2) {
    return "Building";
  }

  return "Holding";
}

function buildSummary(features: SignalAnalysisFeatures, stage: SignalAnalysisStage, confidence: SignalAnalysisConfidence, tone: SignalAnalysisTone) {
  if (features.degraded) {
    return clampText(
      `The setup is still active for ${features.ticker}, but live coverage is limited this cycle. Current move is ${features.changePercent >= 0 ? "+" : ""}${features.changePercent.toFixed(2)}% with ${features.quoteFreshness} quote quality, so confidence is reduced.`,
      220,
    );
  }

  const volumeClause =
    features.relativeVolume !== null
      ? `RVOL is ${features.relativeVolume.toFixed(1)}x`
      : "volume confirmation is incomplete";
  const repeatClause = features.streakCount >= 2 ? ` with ${features.streakCount}x repeat strength` : "";

  return clampText(
    `${features.ticker} is ${tone.toLowerCase()} at rank #${features.rank} in ${stage.toLowerCase()} stage. Move is ${features.changePercent >= 0 ? "+" : ""}${features.changePercent.toFixed(2)}%, ${volumeClause}${repeatClause}, with ${confidence.toLowerCase()} structure.`,
    220,
  );
}

function buildBullCase(features: SignalAnalysisFeatures, tone: SignalAnalysisTone) {
  if (features.degraded) {
    return "Bull case is cleaner confirmation if fresh prints recover while this setup holds near the top ranks.";
  }

  if ((features.relativeVolume ?? 0) >= 2.5 && features.changePercent >= 5) {
    return `Bull case is continued participation while ${features.ticker} keeps strong price expansion with above-normal volume.`;
  }

  if (tone === "Reappearing" || features.streakCount >= 2) {
    return "Bull case is repeat-strength follow-through if this name continues to reassert near the top ranks.";
  }

  return "Bull case is stable hold of current rank while momentum and volume confluence remains intact.";
}

function buildRisk(features: SignalAnalysisFeatures) {
  if (features.degraded) {
    return "Risk is reduced confidence this cycle because live coverage is incomplete.";
  }

  if (features.quoteFreshness === "cached") {
    return "Risk is that cached quote freshness can lag fast tape changes and soften conviction.";
  }

  if (features.relativeVolume === null) {
    return "Risk is incomplete live volume confirmation, which can weaken this read.";
  }

  if (features.rankMovement === "down") {
    return "Risk is rank fade; if relative strength slips further, this setup can cool quickly.";
  }

  return "Risk is momentum fade if the current move stops expanding and rank starts to slip.";
}

export function buildSignalAnalysisFeatures(params: {
  signal: Signal;
  sessionStatus: SessionPhase;
  degraded: boolean;
  rank: number;
  rankMovement: RankMovement;
  nowMs?: number;
}) {
  const { signal, sessionStatus, degraded, rank, rankMovement, nowMs = Date.now() } = params;
  const ageSeconds = Math.max(0, Math.round((nowMs - new Date(signal.timestamp).getTime()) / 1000));

  return {
    ticker: signal.ticker,
    signalType: signal.signalType,
    sessionStatus,
    degraded,
    quoteFreshness: signal.quoteFreshness,
    rank,
    rankMovement,
    price: signal.price,
    changePercent: signal.changePercent,
    confidenceScore: signal.confidence,
    scannerScore: signal.score,
    relativeVolume: signal.relativeVolume,
    streakCount: signal.streakCount,
    reasonBadges: signal.reasonBadges.slice(0, 6),
    riskFlags: signal.riskFlags.slice(0, 4),
    ageSeconds,
  } satisfies SignalAnalysisFeatures;
}

export function generateDeterministicSignalAnalysis(features: SignalAnalysisFeatures): SignalAnalysis {
  const confidence = getConfidenceBucket(features);
  const stage = getStage(features);
  const tone = getTone(features);

  return {
    summary: buildSummary(features, stage, confidence, tone),
    bullCase: clampText(buildBullCase(features, tone), 150),
    risk: clampText(buildRisk(features), 150),
    stage,
    confidence,
    tone,
    source: "rules",
    generatedAt: new Date().toISOString(),
  };
}

function pickSafeText(value: unknown, fallback: string, maxLength: number, features?: SignalAnalysisFeatures) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return fallback;
  }

  if (containsBannedContent(normalized)) {
    return fallback;
  }

  if (hasForwardLookingLanguage(normalized)) {
    return fallback;
  }

  if (features?.degraded && hasOverconfidentLanguage(normalized)) {
    return fallback;
  }

  return clampText(normalized, maxLength);
}

export function sanitizeSignalAnalysis(
  candidate: Partial<SignalAnalysis>,
  fallback: SignalAnalysis,
  options?: { features?: SignalAnalysisFeatures },
): SignalAnalysis {
  const features = options?.features;
  const normalizedStage = normalizeStage(candidate.stage);
  const normalizedConfidence = normalizeConfidence(candidate.confidence);
  const normalizedTone = normalizeTone(candidate.tone);

  const stage = normalizedStage && STAGE_VALUES.includes(normalizedStage) ? normalizedStage : fallback.stage;
  let confidence =
    normalizedConfidence && CONFIDENCE_VALUES.includes(normalizedConfidence)
      ? normalizedConfidence
      : fallback.confidence;
  const tone = normalizedTone && TONE_VALUES.includes(normalizedTone) ? normalizedTone : fallback.tone;

  if (features?.degraded && confidence === "High conviction") {
    confidence = "Strong";
  }

  return {
    summary: pickSafeText(candidate.summary, fallback.summary, 220, features),
    bullCase: pickSafeText(candidate.bullCase, fallback.bullCase, 150, features),
    risk: pickSafeText(candidate.risk, fallback.risk, 150, features),
    stage,
    confidence,
    tone,
    source: candidate.source === "llm" ? "llm" : fallback.source,
    generatedAt: candidate.generatedAt || fallback.generatedAt,
  };
}
