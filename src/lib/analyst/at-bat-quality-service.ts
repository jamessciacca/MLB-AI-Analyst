import { clamp } from "../utils.ts";

const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);

export interface PlateAppearanceQualityInput {
  eventType: string | null;
  description: string | null;
  pitchCount: number;
  swings: number;
  whiffs: number;
  chaseOpportunities: number;
  chases: number;
  reachedDeepCount: boolean;
  launchSpeed: number | null;
  launchAngle: number | null;
  estimatedHitValue: number | null;
  battedBallType: "line_drive" | "ground_ball" | "fly_ball" | "popup" | "unknown";
  isWalk: boolean;
  isStrikeout: boolean;
  isHit: boolean;
  ballInPlay: boolean;
}

export interface PlateAppearanceQualityResult {
  score: number;
  qualityScore: number;
  expectedHitValue: number | null;
  unluckyOut: boolean;
  badOut: boolean;
  notes: string[];
}

function classifyExpectedHitValue(input: PlateAppearanceQualityInput) {
  if (typeof input.estimatedHitValue === "number") {
    return clamp(input.estimatedHitValue, 0, 0.98);
  }

  if (!input.ballInPlay) {
    return input.isHit ? 0.65 : 0;
  }

  const exitVelocity = input.launchSpeed ?? 0;
  const launchAngle = input.launchAngle ?? 0;

  if (exitVelocity >= 102 && launchAngle >= 10 && launchAngle <= 28) {
    return 0.78;
  }
  if (exitVelocity >= 98 && launchAngle >= 8 && launchAngle <= 32) {
    return 0.64;
  }
  if (input.battedBallType === "line_drive" && exitVelocity >= 92) {
    return 0.58;
  }
  if (input.battedBallType === "ground_ball" && exitVelocity >= 95) {
    return 0.34;
  }
  if (input.battedBallType === "fly_ball" && exitVelocity >= 95 && launchAngle <= 40) {
    return 0.26;
  }
  if (input.battedBallType === "popup") {
    return 0.02;
  }
  if (exitVelocity >= 90) {
    return 0.18;
  }

  return 0.08;
}

export function normalizeAtBatQualityScore(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return 0.5;
  }

  return clamp(0.5 + score * 0.18, 0.05, 0.95);
}

export function scorePlateAppearance(
  input: PlateAppearanceQualityInput,
): PlateAppearanceQualityResult {
  const notes: string[] = [];
  const estimatedHitValue = classifyExpectedHitValue(input);
  const exitVelocity = input.launchSpeed ?? 0;
  const chaseRate =
    input.chaseOpportunities > 0 ? input.chases / input.chaseOpportunities : 0;
  let score = 0;

  const eliteContact =
    input.ballInPlay &&
    ((exitVelocity >= 98 && input.battedBallType === "line_drive") ||
      (exitVelocity >= 100 && estimatedHitValue >= 0.55) ||
      (exitVelocity >= 102 && input.launchAngle !== null && input.launchAngle >= 10 && input.launchAngle <= 30));
  const goodContact =
    input.ballInPlay &&
    (estimatedHitValue >= 0.32 ||
      exitVelocity >= 95 ||
      (input.battedBallType === "line_drive" && exitVelocity >= 90));
  const weakContact =
    input.ballInPlay &&
    ((input.battedBallType === "popup" && exitVelocity < 90) ||
      (input.battedBallType === "ground_ball" && exitVelocity < 84) ||
      estimatedHitValue <= 0.08);
  const nonCompetitiveStrikeout =
    input.isStrikeout &&
    (input.pitchCount <= 3 || input.whiffs >= 2 || chaseRate >= 0.5);

  if (eliteContact) {
    score = 2;
    notes.push("elite contact");
  } else if (input.isWalk || goodContact || (input.reachedDeepCount && !input.isStrikeout)) {
    score = 1;
    if (input.isWalk) {
      notes.push("disciplined plate appearance");
    }
    if (goodContact) {
      notes.push("good contact quality");
    }
  } else if (weakContact || (input.isStrikeout && chaseRate > 0.3)) {
    score = -1;
  }

  if (nonCompetitiveStrikeout) {
    score = -2;
    notes.push("non-competitive strikeout");
  } else if (input.isStrikeout && score === 0) {
    score = -1;
    notes.push("swing-and-miss finish");
  }

  if (
    score === 0 &&
    input.ballInPlay &&
    input.battedBallType === "line_drive" &&
    exitVelocity >= 88
  ) {
    score = 1;
    notes.push("productive line-drive contact");
  }

  const unluckyOut =
    !input.isHit &&
    input.ballInPlay &&
    (estimatedHitValue >= 0.42 ||
      (input.battedBallType === "line_drive" && exitVelocity >= 94) ||
      (exitVelocity >= 98 && input.battedBallType === "fly_ball"));
  const badOut =
    !input.isHit &&
    (nonCompetitiveStrikeout ||
      weakContact ||
      (input.isStrikeout && chaseRate >= 0.45));

  if (unluckyOut) {
    notes.push("unlucky result");
  }
  if (badOut) {
    notes.push("poor process");
  }
  if (input.isHit && HIT_EVENTS.has(input.eventType ?? "")) {
    notes.push("recorded a hit");
  }

  return {
    score,
    qualityScore: normalizeAtBatQualityScore(score),
    expectedHitValue: estimatedHitValue,
    unluckyOut,
    badOut,
    notes,
  };
}
