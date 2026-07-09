import { type GameSummary, type VenueSnapshot } from "../types.ts";
import { average, clamp, normalizeSearch } from "../utils.ts";

import { type AnalystBallparkContext } from "./types.ts";

type BallparkEntry = {
  aliases: string[];
  hitFactor: number;
  homeRunFactor: number;
  leftyHomeRunFactor: number;
  rightyHomeRunFactor: number;
  altitudeFeet: number | null;
  notes: string[];
};

const BALLPARKS: BallparkEntry[] = [
  { aliases: ["chase field"], hitFactor: 1.01, homeRunFactor: 1.03, leftyHomeRunFactor: 1.02, rightyHomeRunFactor: 1.04, altitudeFeet: 1090, notes: ["dry desert air can help carry", "roof status matters"] },
  { aliases: ["truist park"], hitFactor: 1.01, homeRunFactor: 1.05, leftyHomeRunFactor: 1.05, rightyHomeRunFactor: 1.04, altitudeFeet: 1050, notes: ["above-average right-center carry", "deep lineup support often matters here"] },
  { aliases: ["oriole park at camden yards", "camden yards"], hitFactor: 0.99, homeRunFactor: 0.95, leftyHomeRunFactor: 0.9, rightyHomeRunFactor: 1.0, altitudeFeet: 10, notes: ["left-field wall suppresses some lefty pull power", "still playable for gap hitting"] },
  { aliases: ["fenway park"], hitFactor: 1.05, homeRunFactor: 1.02, leftyHomeRunFactor: 0.96, rightyHomeRunFactor: 1.08, altitudeFeet: 20, notes: ["green monster boosts doubles and hit probability", "right-handed fly-ball damage plays up"] },
  { aliases: ["wrigley field"], hitFactor: 1.0, homeRunFactor: 1.0, leftyHomeRunFactor: 1.0, rightyHomeRunFactor: 1.0, altitudeFeet: 600, notes: ["wind-sensitive park", "conditions can swing sharply game to game"] },
  { aliases: ["guaranteed rate field"], hitFactor: 1.0, homeRunFactor: 1.08, leftyHomeRunFactor: 1.06, rightyHomeRunFactor: 1.09, altitudeFeet: 595, notes: ["friendly to lifted pull power", "home-run environment often plays above neutral"] },
  { aliases: ["great american ball park"], hitFactor: 1.02, homeRunFactor: 1.12, leftyHomeRunFactor: 1.11, rightyHomeRunFactor: 1.12, altitudeFeet: 490, notes: ["one of the strongest HR environments", "mistake pitches get punished"] },
  { aliases: ["progressive field"], hitFactor: 1.0, homeRunFactor: 1.01, leftyHomeRunFactor: 1.0, rightyHomeRunFactor: 1.02, altitudeFeet: 650, notes: ["mostly neutral run environment", "weather can move totals"] },
  { aliases: ["coors field"], hitFactor: 1.12, homeRunFactor: 1.18, leftyHomeRunFactor: 1.16, rightyHomeRunFactor: 1.19, altitudeFeet: 5200, notes: ["elite altitude boost", "thin air raises hit and extra-base damage"] },
  { aliases: ["comerica park"], hitFactor: 0.99, homeRunFactor: 0.93, leftyHomeRunFactor: 0.94, rightyHomeRunFactor: 0.92, altitudeFeet: 585, notes: ["large alleys mute raw home-run carry", "speed and gap hitters can still benefit"] },
  { aliases: ["daikin park", "minute maid park"], hitFactor: 1.0, homeRunFactor: 1.04, leftyHomeRunFactor: 1.08, rightyHomeRunFactor: 1.0, altitudeFeet: 50, notes: ["short left-field porch history boosts pull lefties", "roof status can neutralize weather"] },
  { aliases: ["kauffman stadium"], hitFactor: 1.01, homeRunFactor: 0.9, leftyHomeRunFactor: 0.9, rightyHomeRunFactor: 0.89, altitudeFeet: 750, notes: ["spacious gaps help singles and doubles", "home-run ceiling is muted"] },
  { aliases: ["angel stadium"], hitFactor: 0.99, homeRunFactor: 0.98, leftyHomeRunFactor: 0.99, rightyHomeRunFactor: 0.98, altitudeFeet: 150, notes: ["fairly neutral overall", "marine air can suppress carry on some nights"] },
  { aliases: ["dodger stadium"], hitFactor: 1.0, homeRunFactor: 1.05, leftyHomeRunFactor: 1.03, rightyHomeRunFactor: 1.06, altitudeFeet: 340, notes: ["night air can slow offense early", "ball still jumps when lifted"] },
  { aliases: ["loanDepot park", "loandepot park"], hitFactor: 0.97, homeRunFactor: 0.91, leftyHomeRunFactor: 0.92, rightyHomeRunFactor: 0.9, altitudeFeet: 10, notes: ["roofed run environment leans pitcher-friendly", "extra-base carry is often suppressed"] },
  { aliases: ["american family field"], hitFactor: 1.0, homeRunFactor: 1.04, leftyHomeRunFactor: 1.03, rightyHomeRunFactor: 1.05, altitudeFeet: 640, notes: ["roof helps consistency", "good lifted-power environment"] },
  { aliases: ["target field"], hitFactor: 0.99, homeRunFactor: 0.96, leftyHomeRunFactor: 0.97, rightyHomeRunFactor: 0.95, altitudeFeet: 840, notes: ["cool weather often drags offense", "plays near neutral in warm conditions"] },
  { aliases: ["citi field"], hitFactor: 0.98, homeRunFactor: 0.94, leftyHomeRunFactor: 0.94, rightyHomeRunFactor: 0.94, altitudeFeet: 15, notes: ["suppresses some long-ball damage", "less forgiving for marginal fly balls"] },
  { aliases: ["yankee stadium"], hitFactor: 1.01, homeRunFactor: 1.11, leftyHomeRunFactor: 1.18, rightyHomeRunFactor: 1.05, altitudeFeet: 15, notes: ["right-field porch boosts lefty power", "HR environment plays above neutral"] },
  { aliases: ["sutter health park", "oakland coliseum", "ringcentral coliseum"], hitFactor: 0.98, homeRunFactor: 0.93, leftyHomeRunFactor: 0.94, rightyHomeRunFactor: 0.92, altitudeFeet: 30, notes: ["Athletics fallback profile leans spacious and suppressive", "watch for wind changes"] },
  { aliases: ["citizens bank park"], hitFactor: 1.01, homeRunFactor: 1.09, leftyHomeRunFactor: 1.09, rightyHomeRunFactor: 1.08, altitudeFeet: 40, notes: ["favorable pull-power park", "high-upside HR setting"] },
  { aliases: ["pnc park"], hitFactor: 0.98, homeRunFactor: 0.92, leftyHomeRunFactor: 0.89, rightyHomeRunFactor: 0.95, altitudeFeet: 725, notes: ["deep left-center limits some power", "right-handed opposite-field damage is harder to sustain"] },
  { aliases: ["petco park"], hitFactor: 0.97, homeRunFactor: 0.92, leftyHomeRunFactor: 0.93, rightyHomeRunFactor: 0.91, altitudeFeet: 20, notes: ["marine air often suppresses flight", "run environment trends below average"] },
  { aliases: ["oracle park"], hitFactor: 0.97, homeRunFactor: 0.88, leftyHomeRunFactor: 0.84, rightyHomeRunFactor: 0.91, altitudeFeet: 10, notes: ["deep power alleys and marine air cut HR carry", "triples can still appear in gaps"] },
  { aliases: ["t-mobile park"], hitFactor: 0.98, homeRunFactor: 0.93, leftyHomeRunFactor: 0.94, rightyHomeRunFactor: 0.92, altitudeFeet: 20, notes: ["dense air can mute hard contact payoff", "leans slightly pitcher-friendly"] },
  { aliases: ["busch stadium"], hitFactor: 0.98, homeRunFactor: 0.92, leftyHomeRunFactor: 0.93, rightyHomeRunFactor: 0.91, altitudeFeet: 465, notes: ["solid run suppression baseline", "needs quality contact for damage"] },
  { aliases: ["george m. steinbrenner field", "tropicana field"], hitFactor: 1.0, homeRunFactor: 0.99, leftyHomeRunFactor: 0.99, rightyHomeRunFactor: 0.99, altitudeFeet: 15, notes: ["Rays fallback profile is near neutral", "roof or temporary park context can matter"] },
  { aliases: ["globe life field"], hitFactor: 0.99, homeRunFactor: 0.96, leftyHomeRunFactor: 0.97, rightyHomeRunFactor: 0.95, altitudeFeet: 560, notes: ["roof lowers weather volatility", "plays closer to neutral than the old park"] },
  { aliases: ["rogers centre", "rogers center"], hitFactor: 1.01, homeRunFactor: 1.04, leftyHomeRunFactor: 1.03, rightyHomeRunFactor: 1.04, altitudeFeet: 250, notes: ["indoors or controlled conditions stabilize offense", "good extra-base environment"] },
  { aliases: ["nationals park"], hitFactor: 1.0, homeRunFactor: 1.01, leftyHomeRunFactor: 1.0, rightyHomeRunFactor: 1.02, altitudeFeet: 25, notes: ["close to neutral", "summer warmth can push it slightly hitter-friendly"] },
];

function derivedFactors(venue: VenueSnapshot | null, game: GameSummary): AnalystBallparkContext {
  const averageFenceDistance =
    average([
      venue?.dimensions.leftLine,
      venue?.dimensions.leftCenter,
      venue?.dimensions.center,
      venue?.dimensions.rightCenter,
      venue?.dimensions.rightLine,
    ]) ?? 378;
  const altitudeFeet = venue?.elevationFeet ?? null;
  const hitFactor = clamp(1 + ((378 - averageFenceDistance) / 180) + ((altitudeFeet ?? 500) - 500) / 22000, 0.92, 1.12);
  const homeRunFactor = clamp(1 + ((365 - averageFenceDistance) / 120) + ((altitudeFeet ?? 500) - 500) / 14000, 0.85, 1.2);

  return {
    venueName: venue?.name ?? game.venue.name,
    hitFactor,
    homeRunFactor,
    leftyHomeRunFactor: homeRunFactor,
    rightyHomeRunFactor: homeRunFactor,
    altitudeFeet,
    notes: ["Derived park context from venue dimensions and elevation."],
    source: "derived",
  };
}

export function getBallparkContext(
  venue: VenueSnapshot | null,
  game: GameSummary,
): AnalystBallparkContext {
  const venueName = normalizeSearch(venue?.name ?? game.venue.name);
  const matched = BALLPARKS.find((entry) =>
    entry.aliases.some((alias) => venueName.includes(normalizeSearch(alias))),
  );

  if (!matched) {
    return derivedFactors(venue, game);
  }

  return {
    venueName: venue?.name ?? game.venue.name,
    hitFactor: matched.hitFactor,
    homeRunFactor: matched.homeRunFactor,
    leftyHomeRunFactor: matched.leftyHomeRunFactor,
    rightyHomeRunFactor: matched.rightyHomeRunFactor,
    altitudeFeet: venue?.elevationFeet ?? matched.altitudeFeet,
    notes: matched.notes,
    source: "hardcoded",
  };
}
