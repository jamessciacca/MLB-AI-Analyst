export const ODDS_CONFIG = {
  baseUrl: "https://api.the-odds-api.com/v4",
  sportKey: "baseball_mlb",
  defaultRegion: process.env.ODDS_DEFAULT_REGION?.trim() || "us",
  oddsFormat: process.env.ODDS_FORMAT?.trim() || "american",
  dateFormat: "iso",
  bookmakers:
    process.env.ODDS_BOOKMAKERS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [],
  preferredBookmakers:
    process.env.ODDS_PREFERRED_BOOKMAKERS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? ["draftkings"],
  markets: {
    moneyline: "h2h",
    batterHits: "batter_hits",
    batterHomeRuns: "batter_home_runs",
  },
} as const;
