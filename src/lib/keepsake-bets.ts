import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type KeepsakeBetEntry,
  type KeepsakeBetSummary,
} from "@/lib/keepsake-types";

const KEEPSAKES_DIRECTORY = path.join(process.cwd(), "data", "keepsakes");
const BET_TRACKER_PATH = path.join(KEEPSAKES_DIRECTORY, "bet-tracker.json");

function isErrorWithCode(error: unknown, code: string) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}

async function ensureKeepsakesDirectory() {
  await mkdir(KEEPSAKES_DIRECTORY, { recursive: true });
}

function isValidEntry(candidate: unknown): candidate is KeepsakeBetEntry {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const entry = candidate as Partial<KeepsakeBetEntry>;

  return (
    typeof entry.id === "string" &&
    typeof entry.stakeAmount === "number" &&
    Number.isFinite(entry.stakeAmount) &&
    typeof entry.wonAmount === "number" &&
    Number.isFinite(entry.wonAmount) &&
    (typeof entry.note === "string" || entry.note === null) &&
    typeof entry.betDate === "string" &&
    typeof entry.createdAt === "string"
  );
}

async function readBetTracker(): Promise<KeepsakeBetEntry[]> {
  try {
    const raw = await readFile(BET_TRACKER_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isValidEntry);
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function writeBetTracker(entries: KeepsakeBetEntry[]) {
  await ensureKeepsakesDirectory();
  await writeFile(BET_TRACKER_PATH, JSON.stringify(entries, null, 2), "utf8");
}

function sortEntries(entries: KeepsakeBetEntry[]) {
  return entries
    .slice()
    .sort((left, right) => {
      const dateCompare = right.betDate.localeCompare(left.betDate);

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
}

export function summarizeKeepsakeBets(entries: KeepsakeBetEntry[]): KeepsakeBetSummary {
  const totalStaked = entries.reduce((sum, entry) => sum + entry.stakeAmount, 0);
  const totalWon = entries.reduce((sum, entry) => sum + entry.wonAmount, 0);

  return {
    totalStaked,
    totalWon,
    netAmount: totalWon - totalStaked,
    entryCount: entries.length,
  };
}

export async function listKeepsakeBets(): Promise<{
  entries: KeepsakeBetEntry[];
  summary: KeepsakeBetSummary;
}> {
  const entries = sortEntries(await readBetTracker());

  return {
    entries,
    summary: summarizeKeepsakeBets(entries),
  };
}

export async function saveKeepsakeBet(input: {
  stakeAmount: number;
  wonAmount: number;
  note?: string | null;
  betDate: string;
}): Promise<{
  entry: KeepsakeBetEntry;
  summary: KeepsakeBetSummary;
}> {
  const existingEntries = await readBetTracker();
  const entry: KeepsakeBetEntry = {
    id: randomUUID(),
    stakeAmount: input.stakeAmount,
    wonAmount: input.wonAmount,
    note: input.note?.trim() ? input.note.trim() : null,
    betDate: input.betDate,
    createdAt: new Date().toISOString(),
  };
  const nextEntries = sortEntries([entry, ...existingEntries]);

  await writeBetTracker(nextEntries);

  return {
    entry,
    summary: summarizeKeepsakeBets(nextEntries),
  };
}

export async function deleteKeepsakeBet(id: string): Promise<{
  deleted: boolean;
  summary: KeepsakeBetSummary;
}> {
  const entries = await readBetTracker();
  const nextEntries = entries.filter((entry) => entry.id !== id);
  const deleted = nextEntries.length !== entries.length;

  if (deleted) {
    await writeBetTracker(sortEntries(nextEntries));
  }

  return {
    deleted,
    summary: summarizeKeepsakeBets(nextEntries),
  };
}
