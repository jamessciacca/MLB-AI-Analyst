import type { ExternalContext } from "../providers/provider-types.ts";
import { type GameSummary } from "../types.ts";

import {
  americanOddsToImpliedProbability,
  getPlayerOddsForGame,
  removeVig,
} from "../vegas-odds-service.ts";

import { type AnalystOddsContext, type AnalystPlayerPropOdds } from "./types.ts";

function fallbackFromExternal(
  externalContext: ExternalContext | null | undefined,
): AnalystOddsContext | null {
  if (!externalContext?.odds) {
    return null;
  }

  return {
    source: "espn-fallback",
    eventId: null,
    homeMoneyline: externalContext.odds.homeMoneyline ?? null,
    awayMoneyline: externalContext.odds.awayMoneyline ?? null,
    homeImpliedProbability:
      externalContext.odds.marketImpliedHomeWinProb ??
      americanOddsToImpliedProbability(externalContext.odds.homeMoneyline ?? null),
    awayImpliedProbability:
      externalContext.odds.marketImpliedAwayWinProb ??
      americanOddsToImpliedProbability(externalContext.odds.awayMoneyline ?? null),
    noVigHomeProbability: externalContext.odds.noVigHomeWinProb ?? null,
    noVigAwayProbability: externalContext.odds.noVigAwayWinProb ?? null,
    totalRuns: null,
    runLine: null,
    bestBook: "ESPN consensus",
    bookmaker: "ESPN consensus",
    lastUpdate: null,
  };
}

export async function getAnalystOddsContext(input: {
  game: GameSummary;
  externalContext: ExternalContext | null | undefined;
}): Promise<{
  moneyline: AnalystOddsContext | null;
  batterHits: AnalystPlayerPropOdds[];
  batterHomeRuns: AnalystPlayerPropOdds[];
  warnings: string[];
}> {
  try {
    const vegas = await getPlayerOddsForGame(input.game);

    if (
      vegas.moneyline ||
      vegas.batterHits.length > 0 ||
      vegas.batterHomeRuns.length > 0 ||
      vegas.warnings.length > 0
    ) {
      return {
        moneyline: vegas.moneyline
          ? {
              source: "the-odds-api",
              eventId: vegas.moneyline.eventId,
              homeMoneyline: vegas.moneyline.homeOdds,
              awayMoneyline: vegas.moneyline.awayOdds,
              homeImpliedProbability: vegas.moneyline.homeImpliedProbability,
              awayImpliedProbability: vegas.moneyline.awayImpliedProbability,
              noVigHomeProbability: vegas.moneyline.noVigHomeProbability,
              noVigAwayProbability: vegas.moneyline.noVigAwayProbability,
              totalRuns: null,
              runLine: null,
              bestBook: vegas.moneyline.bestBook,
              bookmaker: vegas.moneyline.bookmaker,
              lastUpdate: vegas.moneyline.lastUpdate,
            }
          : fallbackFromExternal(input.externalContext),
        batterHits: vegas.batterHits,
        batterHomeRuns: vegas.batterHomeRuns,
        warnings: vegas.warnings,
      };
    }
  } catch (error) {
    return {
      moneyline: fallbackFromExternal(input.externalContext),
      batterHits: [],
      batterHomeRuns: [],
      warnings: [
        error instanceof Error
          ? `The Odds API lookup failed: ${error.message}`
          : "The Odds API lookup failed.",
      ],
    };
  }

  return {
    moneyline: fallbackFromExternal(input.externalContext),
    batterHits: [],
    batterHomeRuns: [],
    warnings: [],
  };
}

export function getPropOddsForPlayer(input: {
  props: AnalystPlayerPropOdds[];
  playerName: string;
  market: "batter_hits" | "batter_home_runs";
}) {
  const exact = input.props.find(
    (prop) =>
      prop.market === input.market &&
      prop.playerName.localeCompare(input.playerName, undefined, {
        sensitivity: "base",
      }) === 0,
  );

  if (exact) {
    return exact;
  }

  return (
    input.props.find((prop) => prop.market === input.market && prop.playerName.includes(input.playerName)) ??
    input.props.find((prop) => prop.market === input.market && input.playerName.includes(prop.playerName)) ??
    null
  );
}

export { removeVig };
