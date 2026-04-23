import {
  type MemoryCategory,
  type MemoryItemInput,
} from "./types.ts";

const FILLER_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|cool|nice|great)[.! ]*$/i,
  /^what'?s up[?!. ]*$/i,
];

const CATEGORY_RULES: Array<{
  category: MemoryCategory;
  patterns: RegExp[];
  tags: string[];
  importance: number;
}> = [
  {
    category: "betting_style",
    patterns: [
      /\bsafer?\b/i,
      /\brisky\b/i,
      /\bhome run upside\b/i,
      /\bhr picks?\b/i,
      /\bhit props?\b/i,
      /\bchalk\b/i,
      /\bparlay\b/i,
    ],
    tags: ["betting-style"],
    importance: 0.82,
  },
  {
    category: "instruction",
    patterns: [/\bweight\b/i, /\bprioritize\b/i, /\bconsider\b/i, /\bfactor\b/i],
    tags: ["instruction"],
    importance: 0.78,
  },
  {
    category: "explanation_preference",
    patterns: [
      /\bexplain\b/i,
      /\bdirect\b/i,
      /\bconcise\b/i,
      /\bdetail\b/i,
      /\bshow me\b/i,
    ],
    tags: ["explanation"],
    importance: 0.7,
  },
  {
    category: "prediction_feedback",
    patterns: [
      /\bgood prediction\b/i,
      /\bbad prediction\b/i,
      /\bwrong\b/i,
      /\bright\b/i,
      /\bgot a hit\b/i,
      /\bno hit\b/i,
      /\btoo aggressive\b/i,
      /\bweather mattered\b/i,
      /\bbullpen\b/i,
    ],
    tags: ["feedback"],
    importance: 0.86,
  },
  {
    category: "workflow_note",
    patterns: [/\bworkflow\b/i, /\bwhen i ask\b/i, /\balways\b/i, /\bnever\b/i],
    tags: ["workflow"],
    importance: 0.74,
  },
];

function normalizeMessage(message: string) {
  return message.trim().replace(/\s+/g, " ");
}

function summarizeAsMemory(message: string, category: MemoryCategory) {
  const normalized = normalizeMessage(message);

  if (/^remember\b/i.test(normalized)) {
    return normalized.replace(/^remember\s+(that\s+)?/i, "User wants remembered: ");
  }

  if (/^i (want|prefer|care|like|need)\b/i.test(normalized)) {
    return `User preference: ${normalized}`;
  }

  if (category === "prediction_feedback") {
    return `Recent prediction feedback: ${normalized}`;
  }

  if (category === "instruction") {
    return `Project instruction: ${normalized}`;
  }

  return normalized;
}

function preferenceKey(content: string) {
  const lower = content.toLowerCase();

  if (lower.includes("safe") || lower.includes("risky")) {
    return "risk_tolerance";
  }

  if (lower.includes("home run") || lower.includes("hr")) {
    return "home_run_style";
  }

  if (lower.includes("hit prop") || lower.includes("hit pick")) {
    return "hit_prop_style";
  }

  if (lower.includes("explain") || lower.includes("direct") || lower.includes("concise")) {
    return "explanation_style";
  }

  return lower
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .slice(0, 4)
    .join("_");
}

export function shouldStoreMemory(message: string): boolean {
  const normalized = normalizeMessage(message);

  if (normalized.length < 12) {
    return false;
  }

  if (FILLER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return (
    /\bremember\b/i.test(normalized) ||
    /\bi (want|prefer|care|like|need)\b/i.test(normalized) ||
    CATEGORY_RULES.some((rule) =>
      rule.patterns.some((pattern) => pattern.test(normalized)),
    )
  );
}

export function extractMemoryItems(message: string): MemoryItemInput[] {
  if (!shouldStoreMemory(message)) {
    return [];
  }

  const normalized = normalizeMessage(message);
  const matchedRules = CATEGORY_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(normalized)),
  );

  const rules =
    matchedRules.length > 0
      ? matchedRules
      : [
          {
            category: "preference" as const,
            tags: ["preference"],
            importance: 0.68,
          },
        ];

  const unique = new Map<MemoryCategory, MemoryItemInput>();

  for (const rule of rules) {
    const content = summarizeAsMemory(normalized, rule.category);
    unique.set(rule.category, {
      category: rule.category,
      content,
      tags: [...rule.tags, preferenceKey(content)].filter(Boolean),
      importanceScore: rule.importance,
      source: "chat",
    });
  }

  if (/\bi (want|prefer|care|like|need)\b/i.test(normalized)) {
    unique.set("preference", {
      category: "preference",
      content: summarizeAsMemory(normalized, "preference"),
      tags: ["preference", preferenceKey(normalized)],
      importanceScore: 0.8,
      source: "chat",
    });
  }

  return [...unique.values()];
}

export function extractPreferenceUpdates(items: MemoryItemInput[]) {
  return items
    .filter(
      (item) =>
        item.category === "preference" ||
        item.category === "betting_style" ||
        item.category === "explanation_preference",
    )
    .map((item) => ({
      key: item.tags?.at(-1) ?? preferenceKey(item.content),
      value: item.content,
      confidence: Math.min(0.95, Math.max(0.55, item.importanceScore ?? 0.65)),
    }));
}
