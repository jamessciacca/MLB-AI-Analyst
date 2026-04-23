import { type AgentRepository } from "../db/agentRepository.ts";
import { extractMemoryItems, extractPreferenceUpdates } from "./memoryExtractor.ts";
import { type MemoryItem, type MemoryItemInput } from "./types.ts";

const CATEGORY_WEIGHT: Record<string, number> = {
  preference: 1.35,
  betting_style: 1.3,
  instruction: 1.25,
  prediction_feedback: 1.2,
  explanation_preference: 1.1,
  project_fact: 1,
  workflow_note: 1,
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "are",
  "was",
  "were",
  "but",
  "have",
  "more",
  "less",
  "from",
  "today",
]);

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function daysSince(value: string) {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return 30;
  }

  return Math.max(0, (Date.now() - timestamp) / 86_400_000);
}

function scoreMemory(queryTokens: Set<string>, memory: MemoryItem) {
  const memoryTokens = tokenize(`${memory.content} ${memory.tags.join(" ")}`);
  let overlap = 0;

  for (const token of queryTokens) {
    if (memoryTokens.has(token)) {
      overlap += 1;
    }
  }

  const overlapScore = queryTokens.size === 0 ? 0 : overlap / queryTokens.size;
  const recencyScore = 1 / (1 + daysSince(memory.lastUsedAt ?? memory.createdAt) / 14);
  const categoryScore = CATEGORY_WEIGHT[memory.category] ?? 1;

  return (
    overlapScore * 2.5 +
    memory.importanceScore * categoryScore +
    recencyScore * 0.55
  );
}

export class MemoryManager {
  private repository: AgentRepository;

  constructor(repository: AgentRepository) {
    this.repository = repository;
  }

  retrieveRelevantMemories(message: string, limit: number): MemoryItem[] {
    const queryTokens = tokenize(message);
    const ranked = this.repository
      .getCandidateMemories()
      .map((memory) => ({
        memory,
        score: scoreMemory(queryTokens, memory),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry) => entry.memory);

    this.repository.markMemoriesUsed(ranked.map((memory) => memory.id));

    return ranked;
  }

  saveMemoryItems(items: MemoryItemInput[]): MemoryItem[] {
    const saved = items.map((item) => this.repository.saveMemory(item));

    for (const preference of extractPreferenceUpdates(items)) {
      this.repository.upsertPreference(
        preference.key,
        preference.value,
        preference.confidence,
      );
    }

    return saved;
  }

  extractAndSave(message: string): MemoryItem[] {
    return this.saveMemoryItems(extractMemoryItems(message));
  }
}
