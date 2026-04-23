import { ChatAgent } from "../src/agent/chatAgent.ts";
import {
  exportResolvedPredictionsToCsv,
  exportResolvedPredictionsToJsonl,
} from "../src/outcomes/trainingExport.ts";

async function main() {
  const agent = new ChatAgent();

  try {
    const repository = agent.getRepository();
    const [csv, jsonl] = await Promise.all([
      exportResolvedPredictionsToCsv(repository),
      exportResolvedPredictionsToJsonl(repository),
    ]);

    console.log(`Exported ${csv.rows} resolved prediction rows.`);
    console.log(`CSV: ${csv.path}`);
    console.log(`JSONL: ${jsonl.path}`);
  } finally {
    agent.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
