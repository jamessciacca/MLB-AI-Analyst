import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { ChatAgent } from "./chatAgent.ts";
import { getAgentConfig } from "./config.ts";
import { handleTerminalCommand } from "./terminalCommands.ts";
import { syncOutcomePredictions } from "../outcomes/predictionStore.ts";
import {
  exportResolvedPredictionsToCsv,
  exportResolvedPredictionsToJsonl,
} from "../outcomes/trainingExport.ts";

function formatPredictionList(
  predictions: Awaited<ReturnType<typeof syncOutcomePredictions>>,
) {
  if (predictions.length === 0) {
    return "No saved predictions found yet.";
  }

  return predictions
    .slice(0, 20)
    .map((prediction, index) => {
      const probability =
        prediction.predictedProbability === null
          ? "n/a"
          : `${(prediction.predictedProbability * 100).toFixed(1)}%`;

      return `${index + 1}. ${prediction.playerName ?? "Unknown"} ${prediction.marketType} - ${probability} (${prediction.status})`;
    })
    .join("\n");
}

async function main() {
  const config = getAgentConfig();

  if (!config.terminalModeEnabled) {
    console.log("Terminal chat is disabled by AGENT_TERMINAL_ENABLED.");
    return;
  }

  const agent = new ChatAgent(config);
  const repository = agent.getRepository();
  const requestedSessionId = process.argv.find((arg) => arg.startsWith("--session="))?.split("=")[1];
  let session = repository.getOrCreateSession(requestedSessionId, "Terminal MLB chat");
  const rl = readline.createInterface({ input, output });

  console.log(`MLB Analyst chat | session ${session.id}`);
  console.log("Type /help for commands or /exit to leave.");

  try {
    while (true) {
      const raw = await rl.question("\nYou > ");
      const trimmed = raw.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed === "/recent-predictions") {
        console.log(formatPredictionList(await syncOutcomePredictions(repository, 50)));
        continue;
      }

      if (trimmed === "/unresolved") {
        await syncOutcomePredictions(repository, 250);
        console.log(
          formatPredictionList(
            repository.listOutcomePredictions({ limit: 50, unresolvedOnly: true }),
          ),
        );
        continue;
      }

      if (trimmed === "/export-training") {
        const [csv, jsonl] = await Promise.all([
          exportResolvedPredictionsToCsv(repository),
          exportResolvedPredictionsToJsonl(repository),
        ]);
        console.log(
          `Exported ${csv.rows} resolved rows.\nCSV: ${csv.path}\nJSONL: ${jsonl.path}`,
        );
        continue;
      }

      const command = handleTerminalCommand(trimmed, repository, session.id);

      if (command.shouldExit) {
        console.log(command.output);
        break;
      }

      if (command.handled) {
        console.log(command.output ?? "");

        if (command.clearSession) {
          session = repository.getOrCreateSession(session.id, "Terminal MLB chat");
        }

        continue;
      }

      const result = await agent.respond(command.messageOverride ?? trimmed, session.id);
      session = repository.getOrCreateSession(result.sessionId, "Terminal MLB chat");
      console.log(`\nAssistant > ${result.response}`);

      if (result.memoriesSaved.length > 0) {
        console.log(`Saved ${result.memoriesSaved.length} memory item(s).`);
      }
    }
  } finally {
    rl.close();
    agent.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
