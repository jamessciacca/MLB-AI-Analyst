import { NextResponse } from "next/server";
import { z } from "zod";

import {
  LOCAL_KEEPSAKE_STORAGE_PATH,
  listKeepsakeImages,
  saveKeepsakeImage,
} from "@/lib/keepsakes";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const imageSchema = z
  .instanceof(File)
  .refine((file) => file.size <= MAX_IMAGE_BYTES, "Image must be 10MB or smaller.")
  .refine((file) => file.type.startsWith("image/"), "Upload must be an image.");

export async function GET() {
  try {
    return NextResponse.json({
      items: await listKeepsakeImages(),
      localOnly: true,
      storagePath: LOCAL_KEEPSAKE_STORAGE_PATH,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load keepsakes.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const image = form.get("image");

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json(
        { error: "Choose an image to upload." },
        { status: 400 },
      );
    }

    const item = await saveKeepsakeImage(imageSchema.parse(image));

    return NextResponse.json({
      item,
      localOnly: true,
      storagePath: LOCAL_KEEPSAKE_STORAGE_PATH,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save keepsake.",
      },
      { status: 400 },
    );
  }
}
