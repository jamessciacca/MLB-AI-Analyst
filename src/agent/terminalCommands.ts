import { type AgentRepository } from "../db/agentRepository.ts";

export type TerminalCommandResult = {
  handled: boolean;
  shouldExit?: boolean;
  output?: string;
  clearSession?: boolean;
  messageOverride?: string;
};

export function formatHelp() {
  return [
    "Commands:",
    "  /help                 Show this help",
    "  /exit                 Leave chat",
    "  /memory               Show recent durable memories",
    "  /feedback <note>      Log feedback against the latest matching prediction",
    "  /recent-predictions   Show recent saved predictions",
    "  /unresolved           Show unresolved predictions",
    "  /export-training      Export resolved prediction rows to CSV + JSONL",
    "  /sessions             List recent sessions",
    "  /clear-session        Clear messages in this session",
    "  /show-last-prediction Show latest saved prediction",
  ].join("\n");
}

export function handleTerminalCommand(
  input: string,
  repository: AgentRepository,
  sessionId: string,
): TerminalCommandResult {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  if (trimmed === "/help") {
    return { handled: true, output: formatHelp() };
  }

  if (trimmed === "/exit" || trimmed === "/quit") {
    return { handled: true, shouldExit: true, output: "Session saved. See you next slate." };
  }

  if (trimmed === "/memory") {
    const memories = repository.listMemories(12);

    return {
      handled: true,
      output:
        memories.length === 0
          ? "No durable memories saved yet."
          : memories
              .map(
                (memory) =>
                  `#${memory.id} [${memory.category}] ${memory.content} (${memory.tags.join(", ")})`,
              )
              .join("\n"),
    };
  }

  if (trimmed === "/sessions") {
    const sessions = repository.listSessions(12);

    return {
      handled: true,
      output:
        sessions.length === 0
          ? "No sessions found."
          : sessions
              .map((session) => `${session.id} | ${session.title} | ${session.updatedAt}`)
              .join("\n"),
    };
  }

  if (trimmed === "/clear-session") {
    repository.clearSession(sessionId);

    return {
      handled: true,
      clearSession: true,
      output: "Cleared messages for this session. Durable memories are unchanged.",
    };
  }

  if (trimmed === "/show-last-prediction") {
    const prediction = repository.getLatestPrediction();

    return {
      handled: true,
      output: prediction
        ? `${prediction.predictionId}: ${prediction.predictionSummary}`
        : "No prediction has been synced yet. Run a prediction in the app or ask a chat question first.",
    };
  }

  if (trimmed.startsWith("/feedback")) {
    const note = trimmed.replace(/^\/feedback\s*/i, "").trim();

    return {
      handled: false,
      messageOverride: note ? `Feedback: ${note}` : "Feedback on the latest prediction.",
    };
  }

  return { handled: true, output: `Unknown command: ${trimmed}. Type /help for options.` };
}
