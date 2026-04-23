import {
  type AgentPrediction,
  type ParsedFeedback,
  type PredictionMarket,
} from "./types.ts";

const POSITIVE_PATTERNS = [
  /\bgood prediction\b/i,
  /\bgreat call\b/i,
  /\byou were right\b/i,
  /\bthat was right\b/i,
  /\bcorrect\b/i,
  /\bcash(ed)?\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bbad prediction\b/i,
  /\bwrong\b/i,
  /\bmiss(ed)?\b/i,
  /\btoo aggressive\b/i,
  /\btoo risky\b/i,
  /\bno hit\b/i,
  /\bdidn'?t hit\b/i,
  /\bdid not hit\b/i,
];

function includesAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

function marketFromText(message: string): PredictionMarket {
  if (/\b(home run|homer|hr)\b/i.test(message)) {
    return "home_run";
  }

  if (/\b(hit|single|hits?)\b/i.test(message)) {
    return "hit";
  }

  if (/\b(game|winner|won|lost)\b/i.test(message)) {
    return "game_win";
  }

  return "unknown";
}

function outcomeFromText(message: string) {
  if (/\b(no home run|no homer|no hr|didn'?t homer|did not homer)\b/i.test(message)) {
    return "no_home_run" as const;
  }

  if (/\b(home run|homer|hr)\b/i.test(message) && !/\btoo\b/i.test(message)) {
    return "home_run" as const;
  }

  if (/\b(no hit|hitless|didn'?t hit|did not hit|0 hits?|0-for)\b/i.test(message)) {
    return "no_hit" as const;
  }

  if (/\b(got|had|get|did get) a hit\b/i.test(message)) {
    return "hit" as const;
  }

  if (/\bwon\b/i.test(message)) {
    return "win" as const;
  }

  if (/\blost\b/i.test(message)) {
    return "loss" as const;
  }

  return "unknown" as const;
}

function inferCorrectness(message: string, outcome: ReturnType<typeof outcomeFromText>) {
  if (includesAny(message, NEGATIVE_PATTERNS)) {
    return false;
  }

  if (
    includesAny(message, POSITIVE_PATTERNS) ||
    outcome === "hit" ||
    outcome === "home_run" ||
    outcome === "win"
  ) {
    return true;
  }

  if (outcome === "no_hit" || outcome === "no_home_run" || outcome === "loss") {
    return false;
  }

  return null;
}

function extractReferencedPlayer(message: string, predictions: AgentPrediction[]) {
  const lower = message.toLowerCase();
  const exact = predictions.find(
    (prediction) => prediction.playerName && lower.includes(prediction.playerName.toLowerCase()),
  );

  if (exact?.playerName) {
    return exact.playerName;
  }

  const commandParts = message.trim().split(/\s+/).slice(2);
  const maybeName = commandParts
    .filter((part) => !/^(hit|no_hit|hr|home_run|good|bad|wrong|right)$/i.test(part))
    .join(" ")
    .trim();

  return maybeName.length > 2 ? maybeName : null;
}

export function parseFeedbackMessage(
  message: string,
  predictions: AgentPrediction[] = [],
): ParsedFeedback {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  const isCommand = lower.startsWith("/feedback");
  const outcome = outcomeFromText(normalized);
  const referencedMarket = marketFromText(normalized);
  const positive = includesAny(normalized, POSITIVE_PATTERNS);
  const negative = includesAny(normalized, NEGATIVE_PATTERNS);
  const preferenceLike =
    /\b(i want|i prefer|remember|weight|care more|fewer|less risky|more heavily)\b/i.test(
      normalized,
    );
  const feedbackLike =
    isCommand ||
    positive ||
    negative ||
    outcome !== "unknown" ||
    /\bprediction\b/i.test(normalized) ||
    /\breasoning\b/i.test(normalized);

  if (!feedbackLike) {
    return {
      isFeedback: false,
      feedbackType: preferenceLike ? "preference" : "neutral",
      actualOutcome: "unknown",
      wasPredictionCorrect: null,
      referencedPlayerName: null,
      referencedMarket,
      note: normalized,
      shouldCreateMemory: preferenceLike,
    };
  }

  const wasPredictionCorrect = inferCorrectness(normalized, outcome);
  const feedbackType = negative
    ? /too risky|too aggressive/i.test(normalized)
      ? "too_risky"
      : "negative"
    : positive
      ? "positive"
      : preferenceLike
        ? "preference"
        : "neutral";

  return {
    isFeedback: true,
    feedbackType,
    actualOutcome: outcome,
    wasPredictionCorrect,
    referencedPlayerName: extractReferencedPlayer(normalized, predictions),
    referencedMarket,
    note: normalized,
    shouldCreateMemory: true,
  };
}

export function formatFeedbackForMemory(parsed: ParsedFeedback, prediction: AgentPrediction | null) {
  const target = prediction
    ? `${prediction.playerName ?? "the prediction"} ${prediction.marketType}`
    : parsed.referencedPlayerName ?? "an unmatched prediction";
  const correctness =
    parsed.wasPredictionCorrect === null
      ? "outcome unknown"
      : parsed.wasPredictionCorrect
        ? "correct"
        : "incorrect";

  return `Prediction feedback: ${target} was marked ${correctness}. User note: ${parsed.note}`;
}
