export type MomentumPatternLabel =
  | "Spike"
  | "Reappearing"
  | "After Lull"
  | "NHOD"
  | "3 Green Bars"
  | "PR Spike"
  | "Top Gainer"
  | "News Pending"
  | "Halted Up"
  | "Halted Down"
  | "Possible Halt Up"
  | "Possible Halt Down"
  | "Resumption Watch";

export type MomentumAlertDescriptor = {
  primaryPatternLabel: MomentumPatternLabel;
  secondaryReasonLabel: string | null;
  alertSummary: string;
  occurrenceCount: number;
  sequenceLabel: string | null;
};

type BuildMomentumAlertDescriptorParams = {
  occurrenceCount: number;
  isReappearing: boolean;
  isAfterLull: boolean;
  isNhod: boolean;
  isThreeGreenBars: boolean;
  isPrBacked: boolean;
  isTopGainerContinuation: boolean;
  haltLabel:
    | "Halted Up"
    | "Halted Down"
    | "Possible Halt Up"
    | "Possible Halt Down"
    | "Resumption Watch"
    | "News Pending"
    | null;
  relativeVolume: number | null;
  floatLabel: string | null;
  volumeLabel: string | null;
  reclaimedHod: boolean;
  liquidityConfirmed: boolean;
};

function compactNumberLabel(value: string | null) {
  return value && value !== "n/a" ? value : null;
}

function buildSequenceLabel(occurrenceCount: number) {
  return occurrenceCount > 1 ? `#${occurrenceCount}` : null;
}

function joinSummary(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).slice(0, 3).join(" | ");
}

export function buildMomentumAlertDescriptor(params: BuildMomentumAlertDescriptorParams): MomentumAlertDescriptor {
  const sequenceLabel = buildSequenceLabel(params.occurrenceCount);

  if (params.haltLabel) {
    return {
      primaryPatternLabel: params.haltLabel,
      secondaryReasonLabel: params.isPrBacked ? "PR" : null,
      alertSummary: joinSummary([
        params.haltLabel,
        params.isPrBacked ? "Catalyst active" : null,
        compactNumberLabel(params.volumeLabel) ? `Vol ${params.volumeLabel}` : null,
      ]),
      occurrenceCount: params.occurrenceCount,
      sequenceLabel,
    };
  }

  if (params.isPrBacked) {
    return {
      primaryPatternLabel: "PR Spike",
      secondaryReasonLabel: params.isNhod ? "NHOD" : null,
      alertSummary: joinSummary([
        "PR-backed spike",
        params.floatLabel ? `Float ${params.floatLabel}` : null,
        params.relativeVolume !== null ? `RVOL ${params.relativeVolume.toFixed(1)}x` : null,
      ]),
      occurrenceCount: params.occurrenceCount,
      sequenceLabel,
    };
  }

  if (params.isAfterLull) {
    return {
      primaryPatternLabel: "After Lull",
      secondaryReasonLabel: params.isThreeGreenBars ? "3 Green Bars" : params.reclaimedHod ? "Reclaimed HOD" : null,
      alertSummary: joinSummary([
        "After-lull continuation",
        params.isThreeGreenBars ? "3 green bars" : params.reclaimedHod ? "Reclaimed HOD" : null,
        params.liquidityConfirmed ? "Liquidity confirmed" : compactNumberLabel(params.volumeLabel) ? `Vol ${params.volumeLabel}` : null,
      ]),
      occurrenceCount: params.occurrenceCount,
      sequenceLabel,
    };
  }

  if (params.isReappearing) {
    return {
      primaryPatternLabel: "Reappearing",
      secondaryReasonLabel: params.reclaimedHod ? "Reclaimed HOD" : params.isNhod ? "NHOD" : null,
      alertSummary: joinSummary([
        "Reappearing momentum",
        params.reclaimedHod ? "Reclaimed HOD" : params.isNhod ? "NHOD" : null,
        compactNumberLabel(params.volumeLabel) ? `Vol ${params.volumeLabel}` : params.relativeVolume !== null ? `RVOL ${params.relativeVolume.toFixed(1)}x` : null,
      ]),
      occurrenceCount: params.occurrenceCount,
      sequenceLabel,
    };
  }

  if (params.isNhod) {
    return {
      primaryPatternLabel: "NHOD",
      secondaryReasonLabel: params.isTopGainerContinuation ? "Top Gainer" : null,
      alertSummary: joinSummary([
        "NHOD break",
        params.isTopGainerContinuation ? "Top-gainer continuation" : null,
        compactNumberLabel(params.volumeLabel) ? `Vol ${params.volumeLabel}` : null,
      ]),
      occurrenceCount: params.occurrenceCount,
      sequenceLabel,
    };
  }

  if (params.isThreeGreenBars) {
    return {
      primaryPatternLabel: "3 Green Bars",
      secondaryReasonLabel: params.isTopGainerContinuation ? "Top Gainer" : null,
      alertSummary: joinSummary([
        "3 green bars",
        params.isTopGainerContinuation ? "Continuation" : null,
        params.liquidityConfirmed ? "Liquidity confirmed" : null,
      ]),
      occurrenceCount: params.occurrenceCount,
      sequenceLabel,
    };
  }

  if (params.isTopGainerContinuation) {
    return {
      primaryPatternLabel: "Top Gainer",
      secondaryReasonLabel: params.reclaimedHod ? "Reclaimed HOD" : null,
      alertSummary: joinSummary([
        "Top-gainer continuation",
        params.reclaimedHod ? "Reclaimed HOD" : null,
        compactNumberLabel(params.volumeLabel) ? `Vol ${params.volumeLabel}` : null,
      ]),
      occurrenceCount: params.occurrenceCount,
      sequenceLabel,
    };
  }

  return {
    primaryPatternLabel: "Spike",
    secondaryReasonLabel: params.relativeVolume !== null && params.relativeVolume >= 2 ? `RVOL ${params.relativeVolume.toFixed(1)}x` : null,
    alertSummary: joinSummary([
      "Strong move",
      params.relativeVolume !== null ? `RVOL ${params.relativeVolume.toFixed(1)}x` : null,
      params.liquidityConfirmed ? "In play" : compactNumberLabel(params.volumeLabel) ? `Vol ${params.volumeLabel}` : null,
    ]),
    occurrenceCount: params.occurrenceCount,
    sequenceLabel,
  };
}
