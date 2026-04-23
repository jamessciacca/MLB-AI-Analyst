import { NextResponse } from "next/server";
import { z } from "zod";

import { ChatAgent } from "@/agent/chatAgent";
import { updateCalibrationForResolution } from "@/outcomes/calibration";
import { syncOutcomePredictions } from "@/outcomes/predictionStore";
import { buildTrainingFeedbackRow } from "@/outcomes/trainingExport";
import { type OutcomeResolution } from "@/outcomes/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  predictionId: z.string().min(1),
  actualOutcome: z.boolean().nullable(),
  actualValue: z.number().nullable().optional(),
  wasPredictionCorrect: z.boolean().nullable().optional(),
  resolutionMethod: z
    .enum(["user_message", "stats_api", "manual_override"])
    .default("manual_override"),
});

export async function POST(request: Request) {
  const agent = new ChatAgent();

  try {
    const body = requestSchema.parse(await request.json());
    const repository = agent.getRepository();
    await syncOutcomePredictions(repository, 250);
    const prediction = repository.getOutcomePredictionById(body.predictionId);

    if (!prediction) {
      return NextResponse.json({ error: "Prediction not found." }, { status: 404 });
    }

    const resolution: OutcomeResolution = {
      predictionId: body.predictionId,
      actualOutcome: body.actualOutcome,
      actualValue: body.actualValue ?? null,
      wasPredictionCorrect: body.wasPredictionCorrect ?? body.actualOutcome,
      resolutionMethod: body.resolutionMethod,
      resolutionConfidence: 1,
      rawResolutionContextJson: JSON.stringify(body),
    };
    const resolutionId = repository.saveResolvedOutcome(resolution);
    const calibrationUpdated = updateCalibrationForResolution(
      repository,
      prediction,
      resolution,
    );
    repository.saveTrainingFeedbackRow(buildTrainingFeedbackRow(prediction, resolution));

    return NextResponse.json({
      prediction,
      resolution,
      resolutionId,
      calibrationUpdated,
      trainingRowCreated: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to resolve prediction.",
      },
      { status: 400 },
    );
  } finally {
    agent.close();
  }
}
