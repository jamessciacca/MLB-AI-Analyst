import { fetchWithRetry, remember } from "@/lib/cache";
import { ODDS_CONFIG } from "@/lib/odds-config";
import { type GameSummary } from "@/lib/types";
import { asNumber, asString, normalizeSearch, todayIsoDate } from "@/lib/utils";
import {
  americanOddsToImpliedProbability,
  probabilityToAmericanOdds as probabilityToFairAmericanOdds,
  removeVig as removeVigPair,
} from "@/lib/analyst/math";

const ODDS_TTL_MS = 10 * 60 * 1000;

type OddsApiOutcome = {
  name?: string;
  price?: number;
  point?: number;
  description?: string;
};

type OddsApiMarket = {
  key?: string;
  outcomes?: OddsApiOutcome[];
  last_update?: string;
};

type OddsApiBookmaker = {
  key?: string;
  title?: string;
  last_update?: string;
  markets?: OddsApiMarket[];
};

type PriceCandidate = {
  price: number | null;
  bookmaker: string | null;
  bookmakerKey: string | null;
  lastUpdate: string | null;
};

export type OddsApiEvent = {
  id?: string;
  sport_key?: string;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: OddsApiBookmaker[];
};

export interface NormalizedMoneylineOdds {
  eventId: string;
  game: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number | null;
  awayOdds: number | null;
  homeImpliedProbability: number | null;
  awayImpliedProbability: number | null;
  noVigHomeProbability: number | null;
  noVigAwayProbability: number | null;
  bestBook: string | null;
  bookmaker: string | null;
  lastUpdate: string | null;
}

export interface NormalizedPlayerPropOdds {
  eventId: string;
  playerName: string;
  market: "batter_hits" | "batter_home_runs";
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  overImpliedProbability: number | null;
  underImpliedProbability: number | null;
  noVigOverProbability: number | null;
  noVigUnderProbability: number | null;
  bestBook: string | null;
  bookmaker: string | null;
  lastUpdate: string | null;
}

export interface PlayerOddsForGameResult {
  eventId: string | null;
  matched: boolean;
  moneyline: NormalizedMoneylineOdds | null;
  batterHits: NormalizedPlayerPropOdds[];
  batterHomeRuns: NormalizedPlayerPropOdds[];
  warnings: string[];
}

function getApiKey() {
  return process.env.ODDS_API_KEY?.trim() || "";
}

function oddsEnabled() {
  return getApiKey().length > 0;
}

function logUsageHeaders(response: Response) {
  const remaining = response.headers.get("x-requests-remaining");
  const used = response.headers.get("x-requests-used");
  const last = response.headers.get("x-requests-last");

  if (remaining || used || last) {
    console.info(
      `[The Odds API] remaining=${remaining ?? "?"} used=${used ?? "?"} last=${last ?? "?"}`,
    );
  }
}

function withCommonQuery(url: URL) {
  url.searchParams.set("apiKey", getApiKey());
  url.searchParams.set("regions", ODDS_CONFIG.defaultRegion);
  url.searchParams.set("oddsFormat", ODDS_CONFIG.oddsFormat);
  url.searchParams.set("dateFormat", ODDS_CONFIG.dateFormat);

  if (ODDS_CONFIG.bookmakers.length > 0) {
    url.searchParams.set("bookmakers", ODDS_CONFIG.bookmakers.join(","));
  }

  return url;
}

async function fetchOddsJson<T>(url: URL): Promise<T> {
  return remember(url.toString(), ODDS_TTL_MS, async () => {
    const response = await fetchWithRetry(url, { cache: "no-store" }, {
      retries: 1,
      timeoutMs: 10000,
    });

    logUsageHeaders(response);

    if (!response.ok) {
      throw new Error(
        `Odds request failed: ${response.status} ${url.origin}${url.pathname}?markets=${url.searchParams.get("markets") ?? "unknown"}`,
      );
    }

    return (await response.json()) as T;
  });
}

function impliedPayoutValue(americanOdds: number | null | undefined) {
  if (americanOdds === null || americanOdds === undefined || !Number.isFinite(americanOdds)) {
    return -Infinity;
  }

  return americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
}

function bookmakerLastUpdate(
  bookmaker: OddsApiBookmaker | null | undefined,
  market: OddsApiMarket | null | undefined,
) {
  return market?.last_update ?? bookmaker?.last_update ?? null;
}

function outcomePlayerName(outcome: OddsApiOutcome) {
  const description = asString(outcome.description);

  if (description) {
    return description;
  }

  const name = asString(outcome.name);
  const normalized = normalizeSearch(name ?? "");

  if (normalized === "over" || normalized === "under" || normalized === "yes" || normalized === "no") {
    return null;
  }

  return name;
}

function isOverLike(outcome: OddsApiOutcome) {
  const normalized = normalizeSearch(outcome.name ?? "");
  return normalized === "over" || normalized === "yes";
}

function isUnderLike(outcome: OddsApiOutcome) {
  const normalized = normalizeSearch(outcome.name ?? "");
  return normalized === "under" || normalized === "no";
}

function twoWayVig(leftOdds: number | null, rightOdds: number | null) {
  const left = americanOddsToImpliedProbability(leftOdds);
  const right = americanOddsToImpliedProbability(rightOdds);

  if (left === null || right === null) {
    return Number.POSITIVE_INFINITY;
  }

  return left + right;
}

function preferredBookRank(
  bookmakerKey: string | null | undefined,
  bookmakerName: string | null | undefined,
) {
  const normalizedKey = normalizeSearch(bookmakerKey ?? "");
  const normalizedName = normalizeSearch(bookmakerName ?? "");
  const index = ODDS_CONFIG.preferredBookmakers.findIndex((preferred) => {
    const normalizedPreferred = normalizeSearch(preferred);
    return normalizedPreferred === normalizedKey || normalizedPreferred === normalizedName;
  });

  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function bestMoneylineBook(event: OddsApiEvent) {
  const candidates = (event.bookmakers ?? []).flatMap((bookmaker) => {
    const market = bookmaker.markets?.find(
      (candidate) => candidate.key === ODDS_CONFIG.markets.moneyline,
    );
    const homeOdds =
      market?.outcomes?.find(
        (outcome) =>
          normalizeSearch(outcome.name ?? "") === normalizeSearch(event.home_team ?? ""),
      )?.price ?? null;
    const awayOdds =
      market?.outcomes?.find(
        (outcome) =>
          normalizeSearch(outcome.name ?? "") === normalizeSearch(event.away_team ?? ""),
      )?.price ?? null;

    if (typeof homeOdds !== "number" || typeof awayOdds !== "number") {
      return [];
    }

    return [
      {
        bookmaker,
        market,
        homeOdds,
        awayOdds,
        vig: twoWayVig(homeOdds, awayOdds),
      },
    ];
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftRank = preferredBookRank(left.bookmaker.key, left.bookmaker.title);
    const rightRank = preferredBookRank(right.bookmaker.key, right.bookmaker.title);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.vig - right.vig;
  });
  return candidates[0] ?? null;
}

function normalizeMoneylineEvent(
  event: OddsApiEvent,
  mlbGame?: GameSummary | null,
): NormalizedMoneylineOdds | null {
  const best = bestMoneylineBook(event);

  if (!best || !event.id || !event.home_team || !event.away_team) {
    return null;
  }

  const homeImpliedProbability = americanOddsToImpliedProbability(best.homeOdds);
  const awayImpliedProbability = americanOddsToImpliedProbability(best.awayOdds);
  const noVig = removeVig({
    leftProbability: homeImpliedProbability,
    rightProbability: awayImpliedProbability,
  });

  return {
    eventId: event.id,
    game:
      mlbGame
        ? `${mlbGame.awayTeam.abbreviation} @ ${mlbGame.homeTeam.abbreviation}`
        : `${event.away_team} @ ${event.home_team}`,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    homeOdds: best.homeOdds,
    awayOdds: best.awayOdds,
    homeImpliedProbability,
    awayImpliedProbability,
    noVigHomeProbability: noVig.noVigLeftProbability,
    noVigAwayProbability: noVig.noVigRightProbability,
    bestBook: best.bookmaker.title ?? null,
    bookmaker: best.bookmaker.title ?? null,
    lastUpdate: bookmakerLastUpdate(best.bookmaker, best.market),
  };
}

function chooseBestPrice(
  candidates: PriceCandidate[],
) {
  const filtered = candidates.filter(
    (candidate): candidate is PriceCandidate & { price: number } =>
      typeof candidate.price === "number" && Number.isFinite(candidate.price),
  );

  if (filtered.length === 0) {
    return null;
  }

  filtered.sort((left, right) => {
    const leftRank = preferredBookRank(left.bookmakerKey, left.bookmaker);
    const rightRank = preferredBookRank(right.bookmakerKey, right.bookmaker);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return impliedPayoutValue(right.price) - impliedPayoutValue(left.price);
  });
  return filtered[0] ?? null;
}

function choosePreferredBookOnlyPrice(candidates: PriceCandidate[]) {
  const preferred = candidates.filter((candidate) =>
    preferredBookRank(candidate.bookmakerKey, candidate.bookmaker) !== Number.POSITIVE_INFINITY,
  );

  return preferred.length > 0 ? chooseBestPrice(preferred) : null;
}

function normalizePropMarket(
  eventId: string,
  bookmakers: OddsApiBookmaker[],
  marketKey: "batter_hits" | "batter_home_runs",
) {
  const grouped = new Map<string, {
    playerName: string;
    line: number | null;
    over: PriceCandidate[];
    under: PriceCandidate[];
  }>();

  for (const bookmaker of bookmakers) {
    const market = bookmaker.markets?.find((candidate) => candidate.key === marketKey);

    if (!market?.outcomes?.length) {
      continue;
    }

    for (const outcome of market.outcomes) {
      const playerName = outcomePlayerName(outcome);

      if (!playerName) {
        continue;
      }

      const line = asNumber(outcome.point);
      const key = `${normalizeSearch(playerName)}::${line ?? "na"}`;
      const bucket = grouped.get(key) ?? {
        playerName,
        line,
        over: [],
        under: [],
      };
      const candidate = {
        price: asNumber(outcome.price),
        bookmaker: bookmaker.title ?? null,
        bookmakerKey: bookmaker.key ?? null,
        lastUpdate: bookmakerLastUpdate(bookmaker, market),
      };

      if (isOverLike(outcome)) {
        bucket.over.push(candidate);
      } else if (isUnderLike(outcome)) {
        bucket.under.push(candidate);
      } else if (bucket.over.length === 0) {
        bucket.over.push(candidate);
      }

      grouped.set(key, bucket);
    }
  }

  return [...grouped.values()]
    .map((entry): NormalizedPlayerPropOdds | null => {
      const preferredOver = choosePreferredBookOnlyPrice(entry.over);
      const preferredUnder = choosePreferredBookOnlyPrice(entry.under);
      const bestOver = preferredOver ?? chooseBestPrice(entry.over);
      const bestUnder = preferredUnder ?? chooseBestPrice(entry.under);
      const overImpliedProbability = americanOddsToImpliedProbability(bestOver?.price ?? null);
      const underImpliedProbability = americanOddsToImpliedProbability(bestUnder?.price ?? null);
      const noVig = removeVig({
        leftProbability: overImpliedProbability,
        rightProbability: underImpliedProbability,
      });

      if (!bestOver && !bestUnder) {
        return null;
      }

      return {
        eventId,
        playerName: entry.playerName,
        market: marketKey,
        line: entry.line,
        overOdds: bestOver?.price ?? null,
        underOdds: bestUnder?.price ?? null,
        overImpliedProbability,
        underImpliedProbability,
        noVigOverProbability: noVig.noVigLeftProbability,
        noVigUnderProbability: noVig.noVigRightProbability,
        bestBook: bestOver?.bookmaker ?? bestUnder?.bookmaker ?? null,
        bookmaker: bestOver?.bookmaker ?? bestUnder?.bookmaker ?? null,
        lastUpdate: bestOver?.lastUpdate ?? bestUnder?.lastUpdate ?? null,
      };
    })
    .filter((entry): entry is NormalizedPlayerPropOdds => Boolean(entry))
    .sort(
      (left, right) =>
        left.playerName.localeCompare(right.playerName) ||
        (left.line ?? Number.POSITIVE_INFINITY) - (right.line ?? Number.POSITIVE_INFINITY),
    );
}

export function matchOddsEventToMlbGame(
  mlbGame: GameSummary,
  oddsEvents: OddsApiEvent[],
) {
  return oddsEvents.find((event) => {
    const homeMatch =
      normalizeSearch(event.home_team ?? "") === normalizeSearch(mlbGame.homeTeam.name);
    const awayMatch =
      normalizeSearch(event.away_team ?? "") === normalizeSearch(mlbGame.awayTeam.name);
    const commenceTime = event.commence_time ? new Date(event.commence_time).getTime() : null;
    const gameTime = new Date(mlbGame.gameDate).getTime();
    const withinWindow =
      commenceTime === null ? true : Math.abs(commenceTime - gameTime) <= 18 * 60 * 60 * 1000;

    return homeMatch && awayMatch && withinWindow;
  }) ?? null;
}

export function removeVig(input: {
  leftProbability: number | null | undefined;
  rightProbability: number | null | undefined;
}) {
  const normalized = removeVigPair(
    input.leftProbability ?? null,
    input.rightProbability ?? null,
  );

  return {
    noVigLeftProbability: normalized.noVigHomeProbability,
    noVigRightProbability: normalized.noVigAwayProbability,
  };
}

export function calculateEdge(
  modelProbability: number | null | undefined,
  sportsbookOdds: number | null | undefined,
) {
  const implied = americanOddsToImpliedProbability(sportsbookOdds);

  if (
    modelProbability === null ||
    modelProbability === undefined ||
    !Number.isFinite(modelProbability) ||
    implied === null
  ) {
    return null;
  }

  return modelProbability - implied;
}

export async function getMlbMoneylineOdds(input?: {
  officialDate?: string | null;
  games?: GameSummary[];
}) {
  if (!oddsEnabled()) {
    return {
      available: false,
      events: [] as OddsApiEvent[],
      odds: [] as NormalizedMoneylineOdds[],
      warnings: ["ODDS_API_KEY is missing. Moneyline odds are unavailable."],
    };
  }

  const url = withCommonQuery(
    new URL(`${ODDS_CONFIG.baseUrl}/sports/${ODDS_CONFIG.sportKey}/odds`),
  );
  url.searchParams.set("markets", ODDS_CONFIG.markets.moneyline);
  const events = await fetchOddsJson<OddsApiEvent[]>(url);
  const games = input?.games ?? [];
  const targetDate = input?.officialDate ?? todayIsoDate();
  const odds = (games.length > 0
    ? games
        .map((game) => {
          const event = matchOddsEventToMlbGame(game, events);
          return event ? normalizeMoneylineEvent(event, game) : null;
        })
        .filter((entry): entry is NormalizedMoneylineOdds => Boolean(entry))
    : events
        .map((event) => normalizeMoneylineEvent(event))
        .filter((entry): entry is NormalizedMoneylineOdds => Boolean(entry)))
    .filter((entry) => {
      const commence = events.find((event) => event.id === entry.eventId)?.commence_time;
      return commence ? commence.slice(0, 10) >= targetDate : true;
    });

  return {
    available: true,
    events,
    odds,
    warnings: odds.length > 0 ? [] : ["No MLB moneyline odds were available for the requested date."],
  };
}

export async function getMlbEventOdds(
  eventId: string,
  markets: Array<"batter_hits" | "batter_home_runs">,
) {
  if (!oddsEnabled()) {
    return {
      available: false,
      eventId,
      batterHits: [] as NormalizedPlayerPropOdds[],
      batterHomeRuns: [] as NormalizedPlayerPropOdds[],
      warnings: ["ODDS_API_KEY is missing. Player props are unavailable."],
    };
  }

  const url = withCommonQuery(
    new URL(
      `${ODDS_CONFIG.baseUrl}/sports/${ODDS_CONFIG.sportKey}/events/${encodeURIComponent(eventId)}/odds`,
    ),
  );
  url.searchParams.set("markets", markets.join(","));
  const payload = await fetchOddsJson<OddsApiEvent>(url);
  const bookmakers = payload.bookmakers ?? [];
  const batterHits = markets.includes("batter_hits")
    ? normalizePropMarket(eventId, bookmakers, "batter_hits")
    : [];
  const batterHomeRuns = markets.includes("batter_home_runs")
    ? normalizePropMarket(eventId, bookmakers, "batter_home_runs")
    : [];

  return {
    available: true,
    eventId,
    batterHits,
    batterHomeRuns,
    warnings: [
      markets.includes("batter_hits") && batterHits.length === 0
        ? "No hit odds available yet"
        : null,
      markets.includes("batter_home_runs") && batterHomeRuns.length === 0
        ? "No home run odds available yet"
        : null,
    ].filter((value): value is string => Boolean(value)),
  };
}

export async function getBatterHitOdds(eventId: string) {
  return (await getMlbEventOdds(eventId, ["batter_hits"])).batterHits;
}

export async function getBatterHomeRunOdds(eventId: string) {
  return (await getMlbEventOdds(eventId, ["batter_home_runs"])).batterHomeRuns;
}

export function findPlayerPropOdds(
  props: NormalizedPlayerPropOdds[],
  playerName: string,
  market: "batter_hits" | "batter_home_runs",
) {
  const normalizedName = normalizeSearch(playerName);
  const exactMatches = props.filter(
    (prop) =>
      prop.market === market &&
      normalizeSearch(prop.playerName) === normalizedName,
  );

  const looseMatches = props.filter(
    (prop) =>
      prop.market === market &&
      (normalizeSearch(prop.playerName).includes(normalizedName) ||
        normalizedName.includes(normalizeSearch(prop.playerName))),
  );

  const candidates = exactMatches.length > 0 ? exactMatches : looseMatches;

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftStandard = left.line === 0.5 ? 0 : 1;
    const rightStandard = right.line === 0.5 ? 0 : 1;

    if (leftStandard !== rightStandard) {
      return leftStandard - rightStandard;
    }

    const leftTwoWay = left.overOdds !== null && left.underOdds !== null ? 0 : 1;
    const rightTwoWay = right.overOdds !== null && right.underOdds !== null ? 0 : 1;

    if (leftTwoWay !== rightTwoWay) {
      return leftTwoWay - rightTwoWay;
    }

    return (left.line ?? Number.POSITIVE_INFINITY) - (right.line ?? Number.POSITIVE_INFINITY);
  });

  return candidates[0] ?? null;
}

export async function getPlayerOddsForGame(game: GameSummary): Promise<PlayerOddsForGameResult> {
  const moneylineResponse = await getMlbMoneylineOdds({
    officialDate: game.officialDate,
    games: [game],
  });
  const matchedMoneyline = moneylineResponse.odds[0] ?? null;
  const matchedEvent = matchedMoneyline?.eventId
    ? moneylineResponse.events.find((event) => event.id === matchedMoneyline.eventId) ?? null
    : matchOddsEventToMlbGame(game, moneylineResponse.events);

  if (!matchedEvent?.id) {
    return {
      eventId: null,
      matched: false,
      moneyline: matchedMoneyline,
      batterHits: [],
      batterHomeRuns: [],
      warnings: [
        ...moneylineResponse.warnings,
        "Could not match an odds event to this MLB game.",
      ],
    };
  }

  const eventOdds = await getMlbEventOdds(matchedEvent.id, [
    "batter_hits",
    "batter_home_runs",
  ]);

  return {
    eventId: matchedEvent.id,
    matched: true,
    moneyline: matchedMoneyline,
    batterHits: eventOdds.batterHits,
    batterHomeRuns: eventOdds.batterHomeRuns,
    warnings: eventOdds.warnings,
  };
}

export { americanOddsToImpliedProbability, probabilityToFairAmericanOdds };
