import { NextResponse } from "next/server";

import { deleteKeepsakeImage, readKeepsakeImage } from "@/lib/keepsakes";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const image = await readKeepsakeImage(id);

    if (!image) {
      return NextResponse.json({ error: "Keepsake not found." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(image.bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(image.bytes.byteLength),
        "Content-Type": image.entry.contentType,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load keepsake.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const deleted = await deleteKeepsakeImage(id);

    if (!deleted) {
      return NextResponse.json({ error: "Keepsake not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to delete keepsake.",
      },
      { status: 500 },
    );
  }
}
