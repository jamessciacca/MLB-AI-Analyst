import OpenAI from "openai";

import { getAgentConfig, type AgentConfig } from "./config.ts";
import { MemoryManager } from "./memoryManager.ts";
import { syncLatestPredictionsToStore } from "./predictionContext.ts";
import { buildChatInput, buildOfflineResponse } from "./promptBuilder.ts";
import { type ChatAgentResponse, type MemoryItem } from "./types.ts";
import { AgentRepository } from "../db/agentRepository.ts";
import { processOutcomeFeedback } from "../outcomes/feedbackService.ts";

let openaiClient: OpenAI | null = null;

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openaiClient;
}

export class ChatAgent {
  private repository: AgentRepository;
  private memoryManager: MemoryManager;
  private config: AgentConfig;

  constructor(config: AgentConfig = getAgentConfig()) {
    this.config = config;
    this.repository = new AgentRepository(config.memoryStoragePath);
    this.memoryManager = new MemoryManager(this.repository);
  }

  close() {
    this.repository.close();
  }

  getRepository() {
    return this.repository;
  }

  async respond(message: string, sessionId?: string | null): Promise<ChatAgentResponse> {
    const session = this.repository.getOrCreateSession(sessionId, "MLB prediction chat");
    const predictions = await syncLatestPredictionsToStore(this.repository);
    const outcomeFeedback = await processOutcomeFeedback(this.repository, message, {
      feedbackSource: "user_chat",
      createMemory: this.config.memoryEnabled,
    });
    const matchedPrediction: ChatAgentResponse["matchedPrediction"] =
      outcomeFeedback.match.prediction
        ? {
            predictionId: outcomeFeedback.match.prediction.predictionId,
            playerName: outcomeFeedback.match.prediction.playerName,
            marketType:
              outcomeFeedback.match.prediction.marketType === "hit" ||
              outcomeFeedback.match.prediction.marketType === "home_run" ||
              outcomeFeedback.match.prediction.marketType === "game_win"
                ? outcomeFeedback.match.prediction.marketType
                : "unknown",
            predictedProbability: outcomeFeedback.match.prediction.predictedProbability,
            predictionSummary: outcomeFeedback.match.prediction.reasoningSummary,
            createdAt: outcomeFeedback.match.prediction.createdAt,
          }
        : null;

    this.repository.addMessage(session.id, "user", message);

    const memories =
      this.config.memoryEnabled
        ? this.memoryManager.retrieveRelevantMemories(
            `${message} ${matchedPrediction?.predictionSummary ?? ""}`,
            this.config.maxRetrievedMemories,
          )
        : [];
    const preferences = this.repository.listPreferences(12);
    const relatedFeedback = matchedPrediction
      ? this.repository.getFeedbackForPrediction(matchedPrediction.predictionId, 8)
      : this.repository.listPredictionFeedback(8);
    const recentMessages = this.repository.getRecentMessages(
      session.id,
      this.config.maxRecentMessages,
    );
    const promptContext = {
      session,
      recentMessages,
      memories,
      preferences,
      predictions,
      relatedFeedback,
    };
    const isOutcomeFeedback = outcomeFeedback.parsed.kind === "prediction_feedback";
    const response = isOutcomeFeedback
      ? outcomeFeedback.message
      : await this.generateResponse(promptContext, message);

    this.repository.addMessage(session.id, "assistant", response);

    const extractedMemories =
      !isOutcomeFeedback &&
      this.config.memoryEnabled &&
      this.config.automaticMemoryExtractionEnabled
        ? this.memoryManager.extractAndSave(message)
        : [];
    const memoriesSaved: MemoryItem[] = [
      ...extractedMemories,
      ...outcomeFeedback.memoriesSaved,
    ];

    return {
      sessionId: session.id,
      response,
      memoriesSaved,
      feedbackSaved: null,
      matchedPrediction,
      outcomeFeedback,
    };
  }

  private async generateResponse(
    context: Parameters<typeof buildChatInput>[0],
    message: string,
  ) {
    const openai = getOpenAiClient();

    if (!openai) {
      return buildOfflineResponse(context, message);
    }

    try {
      const response = await openai.responses.create({
        model: this.config.model,
        reasoning: { effort: "low" },
        input: buildChatInput(context, message),
      });

      return response.output_text.trim() || buildOfflineResponse(context, message);
    } catch (error) {
      console.error("Chat model failed; falling back to local response.", error);
      return buildOfflineResponse(context, message);
    }
  }
}

export async function runChatTurn(message: string, sessionId?: string | null) {
  const agent = new ChatAgent();

  try {
    return await agent.respond(message, sessionId);
  } finally {
    agent.close();
  }
}
