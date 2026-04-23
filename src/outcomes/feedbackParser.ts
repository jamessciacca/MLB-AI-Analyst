import {
  type OutcomeFeedbackType,
  type OutcomePredictionRecord,
  type ParsedOutcomeFeedback,
} from "./types.ts";

const MARKET_PATTERNS: Array<{
  market: ParsedOutcomeFeedback["marketType"];
  patterns: RegExp[];
}> = [
  { market: "home_run", patterns: [/\b(home run|homer|homered|hr)\b/i] },
  { market: "hit", patterns: [/\b(hit|hits|single|got there|over 0\.5 hits?)\b/i] },
  { market: "rbi", patterns: [/\b(rbi|run batted in)\b/i] },
  { market: "total_bases", patterns: [/\b(total bases|bases|tb|over 1\.5)\b/i] },
  { market: "team_moneyline", patterns: [/\b(moneyline|ml|won|lost)\b/i] },
];

const POSITIVE_PATTERNS = [
  /\bgood (prediction|call|read)\b/i,
  /\bgreat (prediction|call|read)\b/i,
  /\byou were right\b/i,
  /\bthat was right\b/i,
  /\bcash(ed)?\b/i,
  /\bgot there\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bbad (prediction|call|read)\b/i,
  /\bwrong\b/i,
  /\bmiss(ed)?\b/i,
  /\blost\b/i,
  /\bdid not\b/i,
  /\bdidn['’]?t\b/i,
  /\btoo aggressive\b/i,
  /\btoo risky\b/i,
  /\b0 for\b/i,
];

const RECENT_REFERENCE_PATTERNS = [
  /\b(that one|that pick|that prop|the pick|the prop|he|him|it)\b/i,
];

function includesAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

function getMarketType(message: string): ParsedOutcomeFeedback["marketType"] {
  for (const rule of MARKET_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(message))) {
      return rule.market;
    }
  }

  return "unknown";
}

function getActualValue(message: string, market: ParsedOutcomeFeedback["marketType"]) {
  const negatedOutcome =
    /\b(did not|didn['’]?t|no)\s+(homer|homered|home run|hr|get a hit|hit)\b/i.test(
      message,
    ) || /\b(no hit|hitless|0\s*(?:for|-for-))\b/i.test(message);

  const wentMatch = message.match(/\b(?:went\s+)?(\d+)\s*(?:for|-for-)\s*\d+\b/i);

  if (wentMatch?.[1]) {
    return Number(wentMatch[1]);
  }

  const gotCountMatch = message.match(/\b(?:got|had|recorded|finished with)\s+(\d+)\s+(hits?|hrs?|home runs?|rbi|runs?|bases?)\b/i);

  if (gotCountMatch?.[1]) {
    return Number(gotCountMatch[1]);
  }

  if (
    market === "home_run" &&
    !negatedOutcome &&
    !/\btoo (aggressive|risky)\b/i.test(message) &&
    /\b(homered|home run|homer|hr)\b/i.test(message)
  ) {
    return 1;
  }

  if (
    market === "hit" &&
    !negatedOutcome &&
    /\b(got a hit|had a hit|recorded a hit|got there)\b/i.test(message)
  ) {
    return 1;
  }

  return null;
}

function getActualOutcome(
  message: string,
  market: ParsedOutcomeFeedback["marketType"],
  actualValue: number | null,
) {
  if (/\b(did not|didn['’]?t|no)\s+(homer|homered|home run|hr)\b/i.test(message)) {
    return false;
  }

  if (/\b(no hit|hitless|0\s*(?:for|-for-)|did not get a hit|didn['’]?t get a hit)\b/i.test(message)) {
    return false;
  }

  if (/\b(lost|missed|wrong)\b/i.test(message) && actualValue === null) {
    return false;
  }

  if (/\btoo (aggressive|risky)\b/i.test(message)) {
    return null;
  }

  if (actualValue !== null) {
    if (/\bover\s+1\.5\b/i.test(message)) {
      return actualValue > 1.5;
    }

    return actualValue > 0;
  }

  if (market === "home_run" && /\b(homered|home run|homer|hr)\b/i.test(message)) {
    return true;
  }

  if (market === "hit" && /\b(got a hit|had a hit|recorded a hit|got there)\b/i.test(message)) {
    return true;
  }

  if (/\b(cashed|you were right|great call|good call)\b/i.test(message)) {
    return true;
  }

  return null;
}

function getFeedbackType(
  message: string,
  actualOutcome: boolean | null,
): OutcomeFeedbackType {
  if (/\btoo aggressive|too risky\b/i.test(message)) {
    return "too_risky";
  }

  if (/\bgood reasoning|good read\b/i.test(message)) {
    return "good_reasoning";
  }

  if (/\bbad reasoning|bad read\b/i.test(message)) {
    return "bad_reasoning";
  }

  if (/\bpartial|push\b/i.test(message)) {
    return "partial";
  }

  if (/\b(good prediction|great call|you were right|correct)\b/i.test(message)) {
    return "correct";
  }

  if (/\b(wrong|missed|lost|bad prediction)\b/i.test(message)) {
    return "incorrect";
  }

  if (actualOutcome !== null) {
    return "outcome_only";
  }

  return "outcome_only";
}

function extractPlayerName(message: string, predictions: OutcomePredictionRecord[]) {
  const lower = message.toLowerCase();
  const fullMatch = predictions.find(
    (prediction) =>
      prediction.playerName && lower.includes(prediction.playerName.toLowerCase()),
  );

  if (fullMatch?.playerName) {
    return fullMatch.playerName;
  }

  const lastNameMatch = predictions.find((prediction) => {
    const lastName = prediction.playerName?.split(/\s+/).at(-1)?.toLowerCase();
    return Boolean(lastName && lastName.length > 2 && lower.includes(lastName));
  });

  if (lastNameMatch?.playerName) {
    return lastNameMatch.playerName;
  }

  const capitalized = message.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:got|had|homered|went|did|cashed|missed|lost)\b/);

  return capitalized?.[1] ?? null;
}

export function parseOutcomeFeedbackMessage(
  message: string,
  context: { recentPredictions?: OutcomePredictionRecord[] } = {},
): ParsedOutcomeFeedback {
  const normalized = message.trim();
  const marketType = getMarketType(normalized);
  const actualValue = getActualValue(normalized, marketType);
  const actualOutcome = getActualOutcome(normalized, marketType, actualValue);
  const feedbackType = getFeedbackType(normalized, actualOutcome);
  const positive = includesAny(normalized, POSITIVE_PATTERNS);
  const negative = includesAny(normalized, NEGATIVE_PATTERNS);
  const referencesRecentPick = includesAny(normalized, RECENT_REFERENCE_PATTERNS);
  const reasoningOnly =
    actualOutcome === null &&
    (feedbackType === "too_risky" ||
      feedbackType === "good_reasoning" ||
      feedbackType === "bad_reasoning");
  const playerName = extractPlayerName(normalized, context.recentPredictions ?? []);
  const isQuestionOrRequest =
    /\?$/.test(normalized) ||
    /^(who|what|which|why|how|show|give|find|tell|explain)\b/i.test(normalized);
  const looksLikeFeedback =
    !isQuestionOrRequest &&
    (actualOutcome !== null || positive || negative || reasoningOnly || referencesRecentPick);

  let confidence = 0.35;

  if (actualOutcome !== null) {
    confidence += 0.25;
  }
  if (playerName) {
    confidence += 0.2;
  }
  if (marketType !== "unknown") {
    confidence += 0.15;
  }
  if (positive || negative) {
    confidence += 0.1;
  }
  if (referencesRecentPick) {
    confidence += 0.05;
  }

  return {
    kind: looksLikeFeedback ? "prediction_feedback" : "not_feedback",
    playerName,
    marketType,
    actualOutcome,
    actualValue,
    feedbackType,
    sentiment: negative ? "negative" : positive ? "positive" : "neutral",
    confidence: Math.min(confidence, 0.98),
    rawMessage: normalized,
    referencesRecentPick,
    reasoningOnly,
    notes: reasoningOnly ? ["Reasoning/style feedback; outcome not resolved."] : [],
  };
}
