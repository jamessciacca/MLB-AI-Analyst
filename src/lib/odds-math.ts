import {
  americanOddsToImpliedProbability as baseAmericanOddsToImpliedProbability,
  probabilityToAmericanOdds as baseProbabilityToAmericanOdds,
} from "./analyst/math.ts";

export type ManualOddsValueRating =
  | "strong positive value"
  | "positive value"
  | "fair/no clear edge"
  | "overpriced"
  | "bad value";

export interface NormalizedAmericanOddsInput {
  originalInput: string;
  normalizedOdds: number;
  impliedProbability: number;
  sportsbook: string | null;
}

export type NormalizeAmericanOddsResult =
  | {
      ok: true;
      value: NormalizedAmericanOddsInput;
    }
  | {
      ok: false;
      error: string;
      originalInput: string;
    };

export interface ManualOddsAnalysis {
  sportsbook: string | null;
  originalInput: string;
  normalizedOdds: number;
  impliedProbability: number;
  edge: number;
  valueRating: ManualOddsValueRating;
  isUserEntered: true;
}

const SPORTSBOOK_ALIASES: Record<string, string> = {
  dk: "DraftKings",
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  fd: "FanDuel",
  betmgm: "BetMGM",
  mgm: "BetMGM",
  caesars: "Caesars",
};

export function americanOddsToImpliedProbability(odds: number | null | undefined) {
  return baseAmericanOddsToImpliedProbability(odds);
}

export function probabilityToAmericanOdds(probability: number | null | undefined) {
  return baseProbabilityToAmericanOdds(probability);
}

export function calculateEdge(
  modelProbability: number | null | undefined,
  sportsbookOdds: number | null | undefined,
) {
  const impliedProbability = americanOddsToImpliedProbability(sportsbookOdds);

  if (
    modelProbability === null ||
    modelProbability === undefined ||
    !Number.isFinite(modelProbability) ||
    impliedProbability === null
  ) {
    return null;
  }

  return modelProbability - impliedProbability;
}

export function normalizeSportsbookName(input: string | null | undefined) {
  const trimmed = input?.trim();

  if (!trimmed) {
    return null;
  }

  const compact = trimmed.toLowerCase().replace(/[^a-z]/g, "");
  return SPORTSBOOK_ALIASES[compact] ?? trimmed;
}

export function manualOddsValueRating(edge: number): ManualOddsValueRating {
  if (edge >= 0.07) {
    return "strong positive value";
  }
  if (edge >= 0.03) {
    return "positive value";
  }
  if (edge <= -0.07) {
    return "bad value";
  }
  if (edge <= -0.03) {
    return "overpriced";
  }

  return "fair/no clear edge";
}

export function normalizeAmericanOddsInput(input: string | number): NormalizeAmericanOddsResult {
  const originalInput = String(input ?? "").trim();

  if (!originalInput) {
    return {
      ok: false,
      error: "Enter American odds like -135, +120, or DraftKings -145.",
      originalInput,
    };
  }

  const match = originalInput.match(/([+-]?\d+)(?!.*[+-]?\d+)/);

  if (!match) {
    return {
      ok: false,
      error: "Odds must include a number like -135 or +120.",
      originalInput,
    };
  }

  const parsed = Number(match[1]);

  if (!Number.isFinite(parsed) || parsed === 0) {
    return {
      ok: false,
      error: "American odds cannot be 0.",
      originalInput,
    };
  }

  const normalizedOdds = parsed > 0 ? Math.trunc(parsed) : Math.trunc(parsed);
  const impliedProbability = americanOddsToImpliedProbability(normalizedOdds);

  if (impliedProbability === null) {
    return {
      ok: false,
      error: "Unable to convert those odds into an implied probability.",
      originalInput,
    };
  }

  const sportsbookText = originalInput.replace(match[1], "").replace(/[-+]/g, " ").trim();

  return {
    ok: true,
    value: {
      originalInput,
      normalizedOdds,
      impliedProbability,
      sportsbook: normalizeSportsbookName(sportsbookText),
    },
  };
}

export function buildManualOddsAnalysis(input: {
  modelProbability: number;
  originalInput: string;
  normalizedOdds: number;
  sportsbook?: string | null;
}) {
  const impliedProbability = americanOddsToImpliedProbability(input.normalizedOdds);

  if (impliedProbability === null) {
    return null;
  }

  const edge = input.modelProbability - impliedProbability;

  return {
    sportsbook: normalizeSportsbookName(input.sportsbook) ?? null,
    originalInput: input.originalInput,
    normalizedOdds: input.normalizedOdds,
    impliedProbability,
    edge,
    valueRating: manualOddsValueRating(edge),
    isUserEntered: true,
  } satisfies ManualOddsAnalysis;
}
