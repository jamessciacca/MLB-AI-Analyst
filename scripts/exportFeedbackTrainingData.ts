import { exportFeedbackToPlayerGameTrainingCsv } from "../src/lib/feedback.ts";

async function main() {
  const result = await exportFeedbackToPlayerGameTrainingCsv();
  console.log(`Exported ${result.rows} resolved feedback rows.`);
  console.log(`CSV: ${result.path}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
