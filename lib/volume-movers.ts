import type { QuoteFreshness } from "./market-data";
import type { VolumeSnapshot } from "./volume-data";

export type VolumeMoverLabel = "Early Expansion" | "Volume Surge" | "Momentum + Volume";

export type VolumeMover = {
  ticker: string;
  company: string;
  price: number;
  changePercent: number;
  currentVolume: number;
  averageVolume: number;
  relativeVolume: number;
  last5mVolume: number;
  previous5mVolume: number;
  volumeAcceleration: number;
  volumeTrend: string;
  freshness: QuoteFreshness;
  label: VolumeMoverLabel;
  score: number;
  lastUpdated: string;
};

const MIN_CHANGE_PERCENT = 2.5;
const MIN_RELATIVE_VOLUME = 2;
const REQUIRED_BAR_COUNT = 10;

function roundMetric(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sumVolumes(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function buildVolumeTrend(volumeAcceleration: number) {
  const rounded = roundMetric(volumeAcceleration);

  if (rounded >= 2) {
    return `5m volume ${rounded}x prior window`;
  }

  return `5m volume +${roundMetric((rounded - 1) * 100, 1)}% vs prior`;
}

function getVolumeMoverLabel(changePercent: number, relativeVolume: number, volumeAcceleration: number): VolumeMoverLabel {
  if (changePercent >= 4 && relativeVolume >= 3) {
    return "Momentum + Volume";
  }

  if (relativeVolume >= 3 || volumeAcceleration >= 1.5) {
    return "Volume Surge";
  }

  return "Early Expansion";
}

function computeScore(changePercent: number, relativeVolume: number, volumeAcceleration: number) {
  return roundMetric(changePercent * 14 + relativeVolume * 18 + Math.min(volumeAcceleration, 4) * 16, 1);
}

export function computeVolumeMovers(snapshots: VolumeSnapshot[]): VolumeMover[] {
  return snapshots
    .flatMap((snapshot) => {
      if (snapshot.freshness === "stale") {
        return [];
      }

      if (snapshot.recentBars.length < REQUIRED_BAR_COUNT) {
        return [];
      }

      if (snapshot.averageVolume <= 0) {
        return [];
      }

      const lastTenBars = snapshot.recentBars.slice(-REQUIRED_BAR_COUNT);
      const previous5mVolume = sumVolumes(lastTenBars.slice(0, 5).map((bar) => bar.volume));
      const last5mVolume = sumVolumes(lastTenBars.slice(5).map((bar) => bar.volume));

      if (previous5mVolume <= 0 || last5mVolume <= previous5mVolume) {
        return [];
      }

      const relativeVolume = snapshot.currentVolume / snapshot.averageVolume;
      const volumeAcceleration = last5mVolume / previous5mVolume;

      if (snapshot.changePercent < MIN_CHANGE_PERCENT || relativeVolume < MIN_RELATIVE_VOLUME) {
        return [];
      }

      const mover: VolumeMover = {
        ticker: snapshot.ticker,
        company: snapshot.company,
        price: snapshot.price,
        changePercent: roundMetric(snapshot.changePercent),
        currentVolume: Math.round(snapshot.currentVolume),
        averageVolume: Math.round(snapshot.averageVolume),
        relativeVolume: roundMetric(relativeVolume),
        last5mVolume,
        previous5mVolume,
        volumeAcceleration: roundMetric(volumeAcceleration),
        volumeTrend: buildVolumeTrend(volumeAcceleration),
        freshness: snapshot.freshness,
        label: getVolumeMoverLabel(snapshot.changePercent, relativeVolume, volumeAcceleration),
        score: computeScore(snapshot.changePercent, relativeVolume, volumeAcceleration),
        lastUpdated: snapshot.lastUpdated,
      };

      return [mover];
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.relativeVolume !== left.relativeVolume) {
        return right.relativeVolume - left.relativeVolume;
      }

      return right.changePercent - left.changePercent;
    });
}
