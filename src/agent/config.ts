import path from "node:path";

export type AgentConfig = {
  memoryEnabled: boolean;
  semanticMemoryEnabled: boolean;
  maxRecentMessages: number;
  maxRetrievedMemories: number;
  memoryStoragePath: string;
  terminalModeEnabled: boolean;
  automaticMemoryExtractionEnabled: boolean;
  model: string;
};

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envInt(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getAgentConfig(): AgentConfig {
  return {
    memoryEnabled: envFlag("AGENT_MEMORY_ENABLED", true),
    semanticMemoryEnabled: envFlag("AGENT_SEMANTIC_MEMORY_ENABLED", false),
    maxRecentMessages: envInt("AGENT_MAX_RECENT_MESSAGES", 12),
    maxRetrievedMemories: envInt("AGENT_MAX_RETRIEVED_MEMORIES", 8),
    memoryStoragePath:
      process.env.AGENT_MEMORY_DB_PATH ??
      path.join(process.cwd(), "data", "agent-memory.sqlite"),
    terminalModeEnabled: envFlag("AGENT_TERMINAL_ENABLED", true),
    automaticMemoryExtractionEnabled: envFlag("AGENT_AUTO_MEMORY_ENABLED", true),
    model: process.env.AGENT_OPENAI_MODEL ?? "gpt-5.4-mini",
  };
}
