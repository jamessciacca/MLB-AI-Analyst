import { getGameByPk, getGamesByDate, getPlayerById, searchBatters } from "../mlb.ts";
import { type GameSummary, type PlayerSearchResult } from "../types.ts";
import { normalizeSearch, plusDays, todayIsoDate } from "../utils.ts";

export async function resolvePlayerForAnalystRequest(input: {
  playerId?: number | null;
  playerName?: string | null;
}): Promise<{ player: PlayerSearchResult | null; warnings: string[] }> {
  const warnings: string[] = [];

  if (input.playerId) {
    return {
      player: await getPlayerById(input.playerId),
      warnings,
    };
  }

  if (!input.playerName) {
    return {
      player: null,
      warnings: ["Player name or playerId is required."],
    };
  }

  const results = await searchBatters(input.playerName);
  const exact = results.find(
    (candidate) => normalizeSearch(candidate.fullName) === normalizeSearch(input.playerName ?? ""),
  );
  const player = exact ?? results[0] ?? null;

  if (player && !exact) {
    warnings.push(`Matched ${player.fullName} as the closest available hitter result.`);
  }

  if (!player) {
    warnings.push(`No active hitter match found for "${input.playerName}".`);
  }

  return { player, warnings };
}

export async function resolveGameForAnalystRequest(gamePk: number): Promise<GameSummary | null> {
  return getGameByPk(gamePk);
}

export async function resolveUpcomingGameForPlayer(input: {
  player: PlayerSearchResult;
  officialDate?: string | null;
}): Promise<{ game: GameSummary | null; warnings: string[] }> {
  const warnings: string[] = [];
  const teamId = input.player.currentTeamId;

  if (!teamId) {
    return {
      game: null,
      warnings: [`${input.player.fullName} does not have an active MLB team assignment in the local directory.`],
    };
  }

  const baseDate = input.officialDate ?? todayIsoDate();
  const candidateDates = [baseDate, plusDays(baseDate, 1), plusDays(baseDate, 2)];

  for (const date of candidateDates) {
    const games = await getGamesByDate(date);
    const game = games.find(
      (candidate) => candidate.homeTeam.id === teamId || candidate.awayTeam.id === teamId,
    );

    if (game) {
      if (date !== baseDate) {
        warnings.push(`No same-day game was found, so the next scheduled game on ${date} was used.`);
      }

      return { game, warnings };
    }
  }

  warnings.push(`No scheduled game was found for ${input.player.fullName} within the next three dates starting ${baseDate}.`);
  return { game: null, warnings };
}
