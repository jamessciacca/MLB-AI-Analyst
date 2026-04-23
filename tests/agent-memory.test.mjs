import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRepository } from "../src/db/agentRepository.ts";
import {
  extractMemoryItems,
  shouldStoreMemory,
} from "../src/agent/memoryExtractor.ts";
import { MemoryManager } from "../src/agent/memoryManager.ts";
import { parseFeedbackMessage } from "../src/agent/feedbackParser.ts";
import { matchPredictionForFeedback } from "../src/agent/predictionContext.ts";
import { handleTerminalCommand } from "../src/agent/terminalCommands.ts";
import { buildPromptContext } from "../src/agent/promptBuilder.ts";

function tempRepository() {
  const dir = mkdtempSync(path.join(tmpdir(), "mlb-agent-test-"));
  return new AgentRepository(path.join(dir, "memory.sqlite"));
}

const samplePrediction = {
  predictionId: "pred-1",
  playerName: "Player A",
  marketType: "hit",
  predictedProbability: 0.72,
  predictionSummary: "Player A hit prediction at 72.0%, recommendation good play.",
  createdAt: "2026-04-22T12:00:00.000Z",
};

test("memory extraction stores stable preferences and skips filler", () => {
  assert.equal(shouldStoreMemory("hello"), false);
  assert.equal(shouldStoreMemory("remember I care more about safe hit props than HR upside"), true);

  const items = extractMemoryItems(
    "remember I care more about safe hit props than HR upside",
  );

  assert.ok(items.some((item) => item.category === "preference"));
  assert.ok(items.some((item) => item.category === "betting_style"));
});

test("feedback parser infers natural language prediction feedback", () => {
  const parsed = parseFeedbackMessage("good prediction, Player A did get a hit", [
    samplePrediction,
  ]);

  assert.equal(parsed.isFeedback, true);
  assert.equal(parsed.feedbackType, "positive");
  assert.equal(parsed.actualOutcome, "hit");
  assert.equal(parsed.wasPredictionCorrect, true);
  assert.equal(parsed.referencedPlayerName, "Player A");
});

test("memory retrieval ranks category and keyword matches", () => {
  const repository = tempRepository();
  const manager = new MemoryManager(repository);

  try {
    manager.saveMemoryItems([
      {
        category: "betting_style",
        content: "User prefers safer hit props over risky home run upside",
        tags: ["safe", "hit"],
        importanceScore: 0.9,
      },
      {
        category: "workflow_note",
        content: "User likes checking sessions after each run",
        tags: ["sessions"],
        importanceScore: 0.4,
      },
    ]);

    const memories = manager.retrieveRelevantMemories("safe hit pick", 2);
    assert.equal(memories[0].category, "betting_style");
  } finally {
    repository.close();
  }
});

test("natural language feedback links to the named prediction", () => {
  const otherPrediction = {
    ...samplePrediction,
    predictionId: "pred-2",
    playerName: "Player B",
  };
  const parsed = parseFeedbackMessage("that was wrong for Player A, no hit", [
    otherPrediction,
    samplePrediction,
  ]);
  const matched = matchPredictionForFeedback(parsed, [otherPrediction, samplePrediction]);

  assert.equal(matched?.predictionId, "pred-1");
});

test("terminal commands inspect state without calling the model", () => {
  const repository = tempRepository();
  const session = repository.createSession("Test");

  try {
    repository.upsertPrediction(samplePrediction);
    const lastPrediction = handleTerminalCommand(
      "/show-last-prediction",
      repository,
      session.id,
    );
    const help = handleTerminalCommand("/help", repository, session.id);

    assert.equal(lastPrediction.handled, true);
    assert.match(lastPrediction.output ?? "", /Player A/);
    assert.match(help.output ?? "", /\/feedback/);
  } finally {
    repository.close();
  }
});

test("prompt assembly includes memories, preferences, predictions, and feedback", () => {
  const session = {
    id: "session-1",
    title: "Test session",
    createdAt: "2026-04-22T12:00:00.000Z",
    updatedAt: "2026-04-22T12:00:00.000Z",
  };
  const prompt = buildPromptContext(
    {
      session,
      recentMessages: [],
      memories: [
        {
          id: 1,
          category: "betting_style",
          content: "User prefers safe hit props",
          tags: ["safe"],
          importanceScore: 0.9,
          source: "test",
          createdAt: session.createdAt,
          lastUsedAt: null,
        },
      ],
      preferences: [
        {
          id: 1,
          key: "risk_tolerance",
          value: "Prefer safe picks",
          confidence: 0.8,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      ],
      predictions: [samplePrediction],
      relatedFeedback: [
        {
          id: 1,
          predictionId: "pred-1",
          feedbackType: "positive",
          userMessage: "good prediction, he got a hit",
          actualOutcome: "hit",
          wasPredictionCorrect: true,
          createdAt: session.createdAt,
        },
      ],
    },
    "Who do you like for hits?",
  );

  assert.match(prompt, /User prefers safe hit props/);
  assert.match(prompt, /Player A hit prediction/);
  assert.match(prompt, /good prediction/);
});
