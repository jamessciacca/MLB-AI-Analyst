import { type AnalysisResult, type GameSummary, type PlayerOddsSnapshot } from "@/lib/types";

const ODDS_API_BASE_URL = "https://api.odds-api.io/v3";
const ODDS_API_MLB_SPORT = "baseball";
const ODDS_API_MLB_LEAGUE = "usa-mlb";
const DRAFTKINGS = "DraftKings" as const;
const EVENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ODDS_CACHE_TTL_MS = 2 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type OddsApiEvent = {
  id: number;
  home: string;
  away: string;
  date: string;
  status: string;
  league?: {
    name?: string;
    slug?: string;
  };
  sport?: {
    name?: string;
    slug?: string;
  };
};

type OddsApiProp = {
  label?: string;
  hdp?: number | string | null;
  over?: string | number | null;
  under?: string | number | null;
};

type OddsApiMarket = {
  name?: string;
  updatedAt?: string | null;
  odds?: OddsApiProp[];
};

type OddsApiOddsResponse = {
  id?: number;
  bookmakers?: Record<string, OddsApiMarket[]>;
};

const eventCache = new Map<string, CacheEntry<OddsApiEvent | null>>();
const oddsCache = new Map<string, CacheEntry<PlayerOddsSnapshot>>();
const eventOddsCache = new Map<string, CacheEntry<OddsApiOddsResponse>>();

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(the|team|jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getNameTokens(value: string) {
  return normalizeName(value).split(" ").filter(Boolean);
}

function getPlayerNameAliases(playerName: string) {
  const tokens = getNameTokens(playerName);

  if (tokens.length === 0) {
    return [];
  }

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const middle = tokens.slice(1, -1);
  const full = tokens.join(" ");
  const firstLast = [first, last].filter(Boolean).join(" ");
  const initialLast = `${first.slice(0, 1)} ${last}`;
  const reversed = [last, first, ...middle].filter(Boolean).join(" ");

  return Array.from(new Set([full, firstLast, initialLast, reversed]));
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildDisabledSnapshot(): PlayerOddsSnapshot {
  return {
    status: "disabled",
    bookmaker: DRAFTKINGS,
    market: "hit",
    marketName: null,
    eventId: null,
    line: null,
    over: null,
    under: null,
    updatedAt: null,
    message: "DraftKings odds are not configured.",
  };
}

function buildNotFoundSnapshot(
  analysis: AnalysisResult,
  eventId: number | null,
  message = "No matching DraftKings player prop was found for this hitter.",
): PlayerOddsSnapshot {
  return {
    status: "not_found",
    bookmaker: DRAFTKINGS,
    market: analysis.market,
    marketName: null,
    eventId,
    line: null,
    over: null,
    under: null,
    updatedAt: null,
    message,
  };
}

function buildErrorSnapshot(analysis: AnalysisResult, message: string): PlayerOddsSnapshot {
  return {
    status: "error",
    bookmaker: DRAFTKINGS,
    market: analysis.market,
    marketName: null,
    eventId: null,
    line: null,
    over: null,
    under: null,
    updatedAt: null,
    message,
  };
}

function eventMatchesGame(event: OddsApiEvent, game: GameSummary) {
  const eventHome = normalizeName(event.home);
  const eventAway = normalizeName(event.away);
  const gameHomeNames = [
    game.homeTeam.name,
    game.homeTeam.abbreviation,
  ].map(normalizeName);
  const gameAwayNames = [
    game.awayTeam.name,
    game.awayTeam.abbreviation,
  ].map(normalizeName);

  const homeMatches = gameHomeNames.some(
    (name) => name && (eventHome.includes(name) || name.includes(eventHome)),
  );
  const awayMatches = gameAwayNames.some(
    (name) => name && (eventAway.includes(name) || name.includes(eventAway)),
  );

  return homeMatches && awayMatches;
}

function getEventTimeDistance(event: OddsApiEvent, game: GameSummary) {
  const eventTime = new Date(event.date).getTime();
  const gameTime = new Date(game.gameDate).getTime();

  if (!Number.isFinite(eventTime) || !Number.isFinite(gameTime)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(eventTime - gameTime);
}

function findMatchingOddsEvent(events: OddsApiEvent[], game: GameSummary) {
  return (
    events
      .filter((candidate) => eventMatchesGame(candidate, game))
      .sort((left, right) => getEventTimeDistance(left, game) - getEventTimeDistance(right, game))[0] ??
    null
  );
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
    next: {
      revalidate: 0,
    },
  });

  if (!response.ok) {
    throw new Error(`Odds API returned ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function findOddsEvent(game: GameSummary, apiKey: string) {
  const cacheKey = `${game.officialDate}:${game.awayTeam.id}:${game.homeTeam.id}`;
  const cached = getFromCache(eventCache, cacheKey);

  if (cached !== null || eventCache.has(cacheKey)) {
    return cached;
  }

  const buildEventsUrl = (from: string, to: string) => {
    const url = new URL(`${ODDS_API_BASE_URL}/events`);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("sport", ODDS_API_MLB_SPORT);
    url.searchParams.set("league", ODDS_API_MLB_LEAGUE);
    url.searchParams.set("status", "pending,live");
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    return url;
  };

  const events = await fetchJson<OddsApiEvent[]>(
    buildEventsUrl(`${game.officialDate}T00:00:00Z`, `${addDays(game.officialDate, 1)}T12:00:00Z`),
  );
  const event =
    findMatchingOddsEvent(events, game) ??
    findMatchingOddsEvent(
      await fetchJson<OddsApiEvent[]>(
        buildEventsUrl(
          `${addDays(game.officialDate, -1)}T12:00:00Z`,
          `${addDays(game.officialDate, 2)}T12:00:00Z`,
        ),
      ),
      game,
    );

  setCache(eventCache, cacheKey, event, event ? EVENT_CACHE_TTL_MS : ODDS_CACHE_TTL_MS);

  return event;
}

async function getEventOdds(eventId: number, apiKey: string) {
  const cacheKey = String(eventId);
  const cached = getFromCache(eventOddsCache, cacheKey);

  if (cached) {
    return cached;
  }

  const url = new URL(`${ODDS_API_BASE_URL}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("eventId", String(eventId));
  url.searchParams.set("bookmakers", DRAFTKINGS);

  const response = await fetchJson<OddsApiOddsResponse>(url);
  setCache(eventOddsCache, cacheKey, response, ODDS_CACHE_TTL_MS);
  return response;
}

function getDraftKingsMarkets(response: OddsApiOddsResponse) {
  const bookmakers = response.bookmakers ?? {};
  const exact = bookmakers[DRAFTKINGS];

  if (exact) {
    return exact;
  }

  const draftKingsEntry = Object.entries(bookmakers).find(
    ([bookmaker]) => normalizeName(bookmaker) === normalizeName(DRAFTKINGS),
  );

  return draftKingsEntry?.[1] ?? [];
}

function marketMatchesAnalysis(marketName: string, analysis: AnalysisResult) {
  const normalized = normalizeName(marketName);

  if (analysis.market === "home_run") {
    return (
      normalized.includes("home run") ||
      normalized.includes("homer") ||
      normalized.includes("player") ||
      normalized.includes("batter")
    );
  }

  return (
    normalized.includes("hit") ||
    normalized.includes("player") ||
    normalized.includes("batter")
  );
}

function propMatchesPlayer(prop: OddsApiProp, playerName: string) {
  const label = normalizeName(prop.label ?? "");
  const aliases = getPlayerNameAliases(playerName);

  return aliases.some((alias) => {
    if (!label || !alias) {
      return false;
    }

    return label.includes(alias) || alias.includes(label);
  });
}

function getPropStatLabel(prop: OddsApiProp) {
  const label = prop.label ?? "";
  const match = label.match(/\(([^)]+)\)/);

  return normalizeName(match?.[1] ?? label);
}

function propMatchesMarket(prop: OddsApiProp, analysis: AnalysisResult, marketName: string) {
  const statLabel = getPropStatLabel(prop);
  const normalizedMarketName = normalizeName(marketName);

  if (analysis.market === "home_run") {
    return (
      statLabel.includes("home run") ||
      statLabel.includes("homer") ||
      normalizedMarketName.includes("home run") ||
      normalizedMarketName.includes("homer")
    );
  }

  return (
    statLabel === "hits" ||
    statLabel === "hit" ||
    statLabel.includes("batter hits") ||
    statLabel.includes("pitching hits") ||
    statLabel.includes("player hits") ||
    normalizedMarketName.includes("hits") ||
    normalizedMarketName.includes("hit props")
  );
}

function getTargetLine() {
  return 0.5;
}

function propMatchesOnePlusLine(prop: OddsApiProp) {
  const line = toNumber(prop.hdp);

  return line !== null && Math.abs(line - getTargetLine()) < 0.001;
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toOddsString(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function extractDraftKingsPlayerProp(
  response: OddsApiOddsResponse,
  analysis: AnalysisResult,
): PlayerOddsSnapshot | null {
  const markets = getDraftKingsMarkets(response);

  for (const market of markets) {
    const marketName = market.name ?? "";

    if (!marketMatchesAnalysis(marketName, analysis)) {
      continue;
    }

    const prop =
      market.odds
        ?.filter(
          (candidate) =>
            propMatchesPlayer(candidate, analysis.hitter.player.fullName) &&
            propMatchesMarket(candidate, analysis, marketName) &&
            propMatchesOnePlusLine(candidate),
        )
        [0] ?? null;

    if (!prop) {
      continue;
    }

    return {
      status: "available",
      bookmaker: DRAFTKINGS,
      market: analysis.market,
      marketName,
      eventId: response.id ?? null,
      line: toNumber(prop.hdp),
      over: toOddsString(prop.over),
      under: toOddsString(prop.under),
      updatedAt: market.updatedAt ?? null,
      message: "DraftKings player prop found.",
    };
  }

  return null;
}

export async function getDraftKingsPlayerOdds(
  analysis: AnalysisResult,
): Promise<PlayerOddsSnapshot> {
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    return {
      ...buildDisabledSnapshot(),
      market: analysis.market,
    };
  }

  const oddsCacheKey = `${analysis.game.gamePk}:${analysis.hitter.player.id}:${analysis.market}`;
  const cached = getFromCache(oddsCache, oddsCacheKey);

  if (cached) {
    return cached;
  }

  try {
    const event = await findOddsEvent(analysis.game, apiKey);

    if (!event) {
      const notFound = buildNotFoundSnapshot(
        analysis,
        null,
        "No matching DraftKings event was found for this MLB game.",
      );
      setCache(oddsCache, oddsCacheKey, notFound, ODDS_CACHE_TTL_MS);
      return notFound;
    }

    const response = await getEventOdds(event.id, apiKey);
    const playerOdds =
      extractDraftKingsPlayerProp(response, analysis) ??
      buildNotFoundSnapshot(analysis, event.id);

    setCache(oddsCache, oddsCacheKey, playerOdds, ODDS_CACHE_TTL_MS);
    return playerOdds;
  } catch (error) {
    return buildErrorSnapshot(
      analysis,
      error instanceof Error ? error.message : "Unable to load DraftKings odds.",
    );
  }
}
