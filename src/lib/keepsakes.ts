import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { type KeepsakeImageSummary } from "@/lib/keepsake-types";

type KeepsakeManifestEntry = KeepsakeImageSummary & {
  storedFileName: string;
};

const KEEPSAKES_DIRECTORY = path.join(process.cwd(), "data", "keepsakes");
const KEEPSAKES_MANIFEST_PATH = path.join(KEEPSAKES_DIRECTORY, "index.json");

export const LOCAL_KEEPSAKE_STORAGE_PATH = "data/keepsakes";

function isErrorWithCode(error: unknown, code: string) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}

function toSummary(entry: KeepsakeManifestEntry): KeepsakeImageSummary {
  return {
    id: entry.id,
    originalName: entry.originalName,
    contentType: entry.contentType,
    size: entry.size,
    uploadedAt: entry.uploadedAt,
  };
}

async function ensureKeepsakesDirectory() {
  await mkdir(KEEPSAKES_DIRECTORY, { recursive: true });
}

async function readManifest(): Promise<KeepsakeManifestEntry[]> {
  try {
    const raw = await readFile(KEEPSAKES_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is KeepsakeManifestEntry => {
      const candidate = entry as Partial<KeepsakeManifestEntry>;

      return (
        typeof candidate.id === "string" &&
        typeof candidate.originalName === "string" &&
        typeof candidate.contentType === "string" &&
        typeof candidate.size === "number" &&
        typeof candidate.uploadedAt === "string" &&
        typeof candidate.storedFileName === "string"
      );
    });
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function writeManifest(entries: KeepsakeManifestEntry[]) {
  await ensureKeepsakesDirectory();
  await writeFile(KEEPSAKES_MANIFEST_PATH, JSON.stringify(entries, null, 2), "utf8");
}

function safeImageExtension(file: File) {
  const extension = path.extname(file.name).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".avif"].includes(extension)) {
    return extension;
  }

  if (file.type === "image/png") {
    return ".png";
  }
  if (file.type === "image/webp") {
    return ".webp";
  }
  if (file.type === "image/gif") {
    return ".gif";
  }
  if (file.type === "image/avif") {
    return ".avif";
  }

  return ".jpg";
}

export async function listKeepsakeImages(): Promise<KeepsakeImageSummary[]> {
  const entries = await readManifest();

  return entries
    .slice()
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
    .map(toSummary);
}

export async function saveKeepsakeImage(file: File): Promise<KeepsakeImageSummary> {
  const entries = await readManifest();
  const uploadedAt = new Date().toISOString();
  const id = randomUUID();
  const storedFileName = `${id}${safeImageExtension(file)}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const entry: KeepsakeManifestEntry = {
    id,
    originalName: file.name,
    contentType: file.type || "image/jpeg",
    size: file.size,
    uploadedAt,
    storedFileName,
  };

  await ensureKeepsakesDirectory();
  await writeFile(path.join(KEEPSAKES_DIRECTORY, storedFileName), bytes);
  await writeManifest([entry, ...entries]);

  return toSummary(entry);
}

export async function readKeepsakeImage(id: string): Promise<{
  entry: KeepsakeImageSummary;
  bytes: Buffer;
} | null> {
  const entries = await readManifest();
  const entry = entries.find((candidate) => candidate.id === id);

  if (!entry) {
    return null;
  }

  try {
    const bytes = await readFile(path.join(KEEPSAKES_DIRECTORY, entry.storedFileName));

    return {
      entry: toSummary(entry),
      bytes,
    };
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

export async function deleteKeepsakeImage(id: string) {
  const entries = await readManifest();
  const entry = entries.find((candidate) => candidate.id === id);

  if (!entry) {
    return false;
  }

  try {
    await unlink(path.join(KEEPSAKES_DIRECTORY, entry.storedFileName));
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }

  await writeManifest(entries.filter((candidate) => candidate.id !== id));
  return true;
}
