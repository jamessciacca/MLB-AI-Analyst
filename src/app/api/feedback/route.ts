import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getFeedbackCalibrationSummary } from "@/lib/feedback";

export const runtime = "nodejs";

const requestSchema = z.object({
  analysisId: z.string().min(1),
  playerId: z.coerce.number().int().positive(),
  gamePk: z.coerce.number().int().positive(),
  market: z.enum(["hit", "home_run"]),
  probability: z.coerce.number().min(0).max(1),
  recommendation: z.enum(["good play", "neutral", "avoid"]),
  rating: z.enum(["correct", "too_high", "too_low"]),
  notes: z.string().max(400).optional().default(""),
});

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const imageSchema = z
  .instanceof(File)
  .refine((file) => file.size <= MAX_IMAGE_BYTES, "Image must be 6MB or smaller.")
  .refine((file) => file.type.startsWith("image/"), "Upload must be an image.");

function safeImageExtension(file: File) {
  const extension = path.extname(file.name).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".webp", ".heic"].includes(extension)) {
    return extension;
  }

  if (file.type === "image/png") {
    return ".png";
  }
  if (file.type === "image/webp") {
    return ".webp";
  }

  return ".jpg";
}

async function parseFeedbackRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return {
      body: requestSchema.parse(await request.json()),
      proofImage: null,
    };
  }

  const form = await request.formData();
  const body = requestSchema.parse({
    analysisId: form.get("analysisId"),
    playerId: form.get("playerId"),
    gamePk: form.get("gamePk"),
    market: form.get("market"),
    probability: form.get("probability"),
    recommendation: form.get("recommendation"),
    rating: form.get("rating"),
    notes: form.get("notes") ?? "",
  });
  const file = form.get("proofImage");

  return {
    body,
    proofImage: file instanceof File && file.size > 0 ? imageSchema.parse(file) : null,
  };
}

export async function POST(request: Request) {
  try {
    const { body, proofImage } = await parseFeedbackRequest(request);
    const dataDirectory = path.join(process.cwd(), "data");
    const imageDirectory = path.join(dataDirectory, "feedback-images");
    const target = path.join(dataDirectory, "feedback.ndjson");
    let proofImageRecord: null | {
      fileName: string;
      relativePath: string;
      contentType: string;
      size: number;
    } = null;

    await mkdir(dataDirectory, { recursive: true });

    if (proofImage) {
      await mkdir(imageDirectory, { recursive: true });

      const fileName = `${body.analysisId}-${Date.now()}${safeImageExtension(proofImage)}`;
      const relativePath = path.join("data", "feedback-images", fileName);
      const bytes = Buffer.from(await proofImage.arrayBuffer());

      await writeFile(path.join(imageDirectory, fileName), bytes);

      proofImageRecord = {
        fileName: proofImage.name,
        relativePath,
        contentType: proofImage.type,
        size: proofImage.size,
      };
    }

    await appendFile(
      target,
      `${JSON.stringify({
        ...body,
        proofImage: proofImageRecord,
        savedAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save feedback.",
      },
      { status: 400 },
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json(await getFeedbackCalibrationSummary());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load feedback summary.",
      },
      { status: 500 },
    );
  }
}
