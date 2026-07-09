import { clamp } from "../utils.ts";

export function americanOddsToImpliedProbability(americanOdds: number | null | undefined) {
  if (americanOdds === null || americanOdds === undefined || !Number.isFinite(americanOdds) || americanOdds === 0) {
    return null;
  }

  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

export function probabilityToAmericanOdds(probability: number | null | undefined) {
  if (
    probability === null ||
    probability === undefined ||
    !Number.isFinite(probability) ||
    probability <= 0 ||
    probability >= 1
  ) {
    return null;
  }

  return probability >= 0.5
    ? -Math.round((probability / (1 - probability)) * 100)
    : Math.round(((1 - probability) / probability) * 100);
}

export function removeVig(homeImplied: number | null, awayImplied: number | null) {
  if (
    homeImplied === null ||
    awayImplied === null ||
    !Number.isFinite(homeImplied) ||
    !Number.isFinite(awayImplied)
  ) {
    return {
      noVigHomeProbability: null,
      noVigAwayProbability: null,
    };
  }

  const total = homeImplied + awayImplied;

  if (total <= 0) {
    return {
      noVigHomeProbability: null,
      noVigAwayProbability: null,
    };
  }

  return {
    noVigHomeProbability: homeImplied / total,
    noVigAwayProbability: awayImplied / total,
  };
}

function americanOddsProfitPerUnit(americanOdds: number) {
  return americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
}

export function expectedValueFromAmericanOdds(
  probability: number | null | undefined,
  americanOdds: number | null | undefined,
) {
  if (
    probability === null ||
    probability === undefined ||
    americanOdds === null ||
    americanOdds === undefined ||
    !Number.isFinite(probability) ||
    !Number.isFinite(americanOdds)
  ) {
    return null;
  }

  const winProbability = clamp(probability, 0, 1);
  const loseProbability = 1 - winProbability;
  const profitPerUnit = americanOddsProfitPerUnit(americanOdds);

  return winProbability * profitPerUnit - loseProbability;
}
