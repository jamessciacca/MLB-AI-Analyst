import {
  type OutcomePredictionRecord,
  type ParsedOutcomeFeedback,
  type PredictionMatch,
} from "./types.ts";

function normalize(value: string | null) {
  return value?.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

function namesCompatible(parsedName: string | null, predictionName: string | null) {
  if (!parsedName || !predictionName) {
    return false;
  }

  const parsed = normalize(parsedName);
  const prediction = normalize(predictionName);
  const parsedLast = parsed.split(" ").at(-1);
  const predictionLast = prediction.split(" ").at(-1);

  return (
    parsed === prediction ||
    prediction.includes(parsed) ||
    parsed.includes(prediction) ||
    Boolean(parsedLast && predictionLast && parsedLast === predictionLast)
  );
}

function isCompatibleMarket(
  parsed: ParsedOutcomeFeedback,
  prediction: OutcomePredictionRecord,
) {
  return parsed.marketType === "unknown" || parsed.marketType === prediction.marketType;
}

function hoursSince(value: string) {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return 240;
  }

  return Math.max(0, (Date.now() - timestamp) / 3_600_000);
}

export function findBestPredictionMatch(
  parsed: ParsedOutcomeFeedback,
  recentPredictions: OutcomePredictionRecord[],
): PredictionMatch {
  const scored = recentPredictions.map((prediction, index) => {
    const reasons: string[] = [];
    let score = 0;

    if (prediction.status !== "resolved") {
      score += 0.24;
      reasons.push("unresolved prediction");
    }

    if (namesCompatible(parsed.playerName, prediction.playerName)) {
      score += 0.38;
      reasons.push("player name match");
    }

    if (isCompatibleMarket(parsed, prediction)) {
      score += parsed.marketType === "unknown" ? 0.08 : 0.24;
      reasons.push(parsed.marketType === "unknown" ? "market unspecified" : "market match");
    }

    if (parsed.referencesRecentPick && index === 0) {
      score += 0.18;
      reasons.push("recent-pick reference");
    }

    const recencyScore = Math.max(0, 0.16 - hoursSince(prediction.createdAt) / 240);
    score += recencyScore;

    if (!parsed.playerName && !parsed.referencesRecentPick && parsed.marketType === "unknown") {
      score -= 0.25;
      reasons.push("feedback is vague");
    }

    if (prediction.status === "resolved") {
      score -= 0.2;
      reasons.push("already resolved");
    }

    return { prediction, score, reasons };
  });

  const ranked = scored.sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const confidence = best ? Math.max(0, Math.min(best.score, 0.98)) : 0;
  const safeEnough =
    confidence >= 0.55 ||
    Boolean(best && parsed.referencesRecentPick && confidence >= 0.45);

  return {
    prediction: safeEnough && best ? best.prediction : null,
    confidence,
    reasons: best?.reasons ?? ["no prediction candidates"],
    alternatives: ranked.slice(1, 4).map((entry) => entry.prediction),
  };
}
