import { NextResponse } from "next/server";

import { buildModelPerformanceSummary } from "@/lib/analyst/model-performance-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await buildModelPerformanceSummary());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load model performance summary.",
      },
      { status: 400 },
    );
  }
}
