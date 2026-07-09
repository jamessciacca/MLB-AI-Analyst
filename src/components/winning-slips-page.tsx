"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  type KeepsakeBetEntry,
  type KeepsakeBetSummary,
  type KeepsakeImageSummary,
} from "@/lib/keepsake-types";

type ColorTheme = "light" | "dark";

type KeepsakesResponse = {
  items: KeepsakeImageSummary[];
  storagePath?: string;
  error?: string;
};

type KeepsakeTrackerResponse = {
  entries: KeepsakeBetEntry[];
  summary: KeepsakeBetSummary;
  error?: string;
};

const THEME_STORAGE_KEY = "mlb-analyst-theme";
const THEME_CHANGE_EVENT = "mlb-analyst-theme-change";

function getStoredTheme(): ColorTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" || storedTheme === "light" ? storedTheme : "light";
}

function subscribeToThemeChanges(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function setStoredTheme(theme: ColorTheme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function formatUploadedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatBetDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export function WinningSlipsPage() {
  const colorTheme = useSyncExternalStore(
    subscribeToThemeChanges,
    getStoredTheme,
    () => "light",
  );
  const [items, setItems] = useState<KeepsakeImageSummary[]>([]);
  const [betEntries, setBetEntries] = useState<KeepsakeBetEntry[]>([]);
  const [betSummary, setBetSummary] = useState<KeepsakeBetSummary>({
    totalStaked: 0,
    totalWon: 0,
    netAmount: 0,
    entryCount: 0,
  });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [storagePath, setStoragePath] = useState("data/keepsakes");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingBet, setIsSavingBet] = useState(false);
  const [activeDeleteId, setActiveDeleteId] = useState<string | null>(null);
  const [activeDeleteBetId, setActiveDeleteBetId] = useState<string | null>(null);
  const [fullscreenItem, setFullscreenItem] = useState<KeepsakeImageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [trackerStatusMessage, setTrackerStatusMessage] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [wonAmount, setWonAmount] = useState("");
  const [betNote, setBetNote] = useState("");
  const [betDate, setBetDate] = useState(todayInputValue());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
  }, [colorTheme]);

  useEffect(() => {
    void loadPageData();
  }, []);

  async function loadPageData() {
    setIsLoading(true);

    try {
      const [keepsakesResponse, trackerResponse] = await Promise.all([
        fetch("/api/keepsakes", { cache: "no-store" }),
        fetch("/api/keepsakes/tracker", { cache: "no-store" }),
      ]);
      const keepsakesPayload = (await keepsakesResponse.json()) as KeepsakesResponse;
      const trackerPayload = (await trackerResponse.json()) as KeepsakeTrackerResponse;

      if (!keepsakesResponse.ok) {
        throw new Error(keepsakesPayload.error ?? "Unable to load keepsakes.");
      }

      if (!trackerResponse.ok) {
        throw new Error(trackerPayload.error ?? "Unable to load bet tracker.");
      }

      setItems(keepsakesPayload.items);
      setStoragePath(keepsakesPayload.storagePath ?? "data/keepsakes");
      setBetEntries(trackerPayload.entries);
      setBetSummary(trackerPayload.summary);
      setError(null);
      setTrackerError(null);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Unable to load keepsakes.";
      setError(message);
      setTrackerError(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) {
      setError("Choose at least one image first.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setStatusMessage(null);

    try {
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("image", file);

        const response = await fetch("/api/keepsakes", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? `Unable to upload ${file.name}.`);
        }
      }

      const uploadedCount = selectedFiles.length;
      setSelectedFiles([]);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      setStatusMessage(
        `${uploadedCount} keepsake image${uploadedCount === 1 ? "" : "s"} saved locally.`,
      );
      await loadPageData();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload keepsakes.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(id: string) {
    const target = items.find((item) => item.id === id);

    if (!target) {
      return;
    }

    const confirmed = window.confirm(`Delete "${target.originalName}" from this keepsake page?`);

    if (!confirmed) {
      return;
    }

    setActiveDeleteId(id);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/keepsakes/${id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete keepsake.");
      }

      setItems((currentItems) => currentItems.filter((item) => item.id !== id));
      if (fullscreenItem?.id === id) {
        setFullscreenItem(null);
      }
      setStatusMessage(`Deleted "${target.originalName}".`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete keepsake.");
    } finally {
      setActiveDeleteId(null);
    }
  }

  async function handleSaveBet() {
    const parsedStakeAmount = Number(stakeAmount);
    const parsedWonAmount = Number(wonAmount);

    if (!Number.isFinite(parsedStakeAmount) || parsedStakeAmount < 0) {
      setTrackerError("Enter a valid amount for money in.");
      return;
    }

    if (!Number.isFinite(parsedWonAmount) || parsedWonAmount < 0) {
      setTrackerError("Enter a valid amount for money back.");
      return;
    }

    if (!betDate) {
      setTrackerError("Choose the date for this bet.");
      return;
    }

    setIsSavingBet(true);
    setTrackerError(null);
    setTrackerStatusMessage(null);

    try {
      const response = await fetch("/api/keepsakes/tracker", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stakeAmount: parsedStakeAmount,
          wonAmount: parsedWonAmount,
          note: betNote,
          betDate,
        }),
      });
      const payload = (await response.json()) as
        | (KeepsakeTrackerResponse & { entry?: KeepsakeBetEntry })
        | { error?: string };

      if (!response.ok || !("summary" in payload) || !("entry" in payload) || !payload.entry) {
        throw new Error(payload.error ?? "Unable to save tracker entry.");
      }

      const savedEntry = payload.entry;

      setBetEntries((currentEntries) => [savedEntry, ...currentEntries]);
      setBetSummary(payload.summary);
      setStakeAmount("");
      setWonAmount("");
      setBetNote("");
      setBetDate(todayInputValue());
      setTrackerStatusMessage("Bet tracker updated locally.");
    } catch (saveError) {
      setTrackerError(
        saveError instanceof Error ? saveError.message : "Unable to save tracker entry.",
      );
    } finally {
      setIsSavingBet(false);
    }
  }

  async function handleDeleteBet(id: string) {
    const target = betEntries.find((entry) => entry.id === id);

    if (!target) {
      return;
    }

    const confirmed = window.confirm("Delete this tracker entry?");

    if (!confirmed) {
      return;
    }

    setActiveDeleteBetId(id);
    setTrackerError(null);
    setTrackerStatusMessage(null);

    try {
      const response = await fetch(`/api/keepsakes/tracker/${id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as
        | { summary?: KeepsakeBetSummary; error?: string }
        | { error?: string };

      if (!response.ok || !("summary" in payload) || !payload.summary) {
        throw new Error(payload.error ?? "Unable to delete tracker entry.");
      }

      setBetEntries((currentEntries) => currentEntries.filter((entry) => entry.id !== id));
      setBetSummary(payload.summary);
      setTrackerStatusMessage("Tracker entry deleted.");
    } catch (deleteError) {
      setTrackerError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete tracker entry.",
      );
    } finally {
      setActiveDeleteBetId(null);
    }
  }

  return (
    <main className="shell keepsakes-shell">
      <section className="hero keepsakes-hero">
        <div className="hero-grid keepsakes-hero-grid">
          <div className="hero-copy">
            <div className="hero-topline">
              <p className="eyebrow">Winning Slip Keepsakes</p>
              <div className="hero-action-row">
                <Link href="/" className="theme-toggle theme-toggle-link">
                  Back To Analyst
                </Link>
                <button
                  type="button"
                  className="theme-toggle"
                  aria-pressed={colorTheme === "dark"}
                  onClick={() => setStoredTheme(colorTheme === "dark" ? "light" : "dark")}
                >
                  {colorTheme === "dark" ? "Day Mode" : "Night Mode"}
                </button>
              </div>
            </div>
            <h1>Winning Slip Keepsakes</h1>
            <p>
              This page is your private vault for winning slip screenshots and photos.
              Upload images here to keep a simple, organized gallery that stays only on
              this app and out of your GitHub pushes.
            </p>

            <div className="hero-badges">
              <span className="hero-pill">Simple grid layout</span>
              <span className="hero-pill">Fullscreen viewing</span>
              <span className="hero-pill">Local-only storage</span>
            </div>
          </div>

          <div className="hero-showcase">
            <div className="hero-card hero-card-primary">
              <span className="hero-card-label">Stored On This Machine</span>
              <strong>{storagePath}</strong>
              <p>
                The keepsake folder is git-ignored, so uploaded images stay local to this
                app and are not included when you push code to GitHub.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="panel keepsake-upload-panel">
        <div className="section-heading-row keepsake-heading-row">
          <div>
            <h2>Upload Winning Slip Images</h2>
            <p className="muted">
              Add one or more images, then save them into your keepsake page.
            </p>
          </div>
        </div>

        <div className="keepsake-upload-row">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="keepsake-file-input"
            onChange={(event) => {
              setSelectedFiles(Array.from(event.target.files ?? []));
              setError(null);
              setStatusMessage(null);
            }}
          />
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              void handleUpload();
            }}
            disabled={isUploading || selectedFiles.length === 0}
          >
            {isUploading ? "Uploading..." : "Upload Images"}
          </button>
        </div>

        <div className="keepsake-upload-meta">
          <span>
            {selectedFiles.length > 0
              ? `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected`
              : "No images selected yet"}
          </span>
          <span>Accepted: PNG, JPG, WEBP, GIF, HEIC, AVIF up to 10MB each</span>
        </div>

        {statusMessage ? <p className="keepsake-status-note">{statusMessage}</p> : null}
        {error ? <p className="keepsake-error-note">{error}</p> : null}
      </section>

      <section className="panel keepsake-tracker-panel">
        <div className="section-heading-row keepsake-heading-row">
          <div>
            <h2>Bet Tracker</h2>
            <p className="muted">
              Keep a simple running view of money in, money back, and your overall net.
            </p>
          </div>
        </div>

        <div className="keepsake-tracker-summary">
          <article className="keepsake-tracker-stat">
            <span className="field-label">Money In</span>
            <strong>{formatCurrency(betSummary.totalStaked)}</strong>
            <span className="muted">{betSummary.entryCount} tracked bet{betSummary.entryCount === 1 ? "" : "s"}</span>
          </article>
          <article className="keepsake-tracker-stat">
            <span className="field-label">Money Back</span>
            <strong>{formatCurrency(betSummary.totalWon)}</strong>
            <span className="muted">What came back from the book</span>
          </article>
          <article
            className={`keepsake-tracker-stat ${
              betSummary.netAmount >= 0 ? "is-positive" : "is-negative"
            }`}
          >
            <span className="field-label">Net</span>
            <strong>{formatCurrency(betSummary.netAmount)}</strong>
            <span className="muted">Money back minus money in</span>
          </article>
        </div>

        <div className="keepsake-tracker-entry">
          <div className="keepsake-tracker-form">
            <label className="input-group keepsake-tracker-field">
              <span className="field-label">Money In</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="text-input"
                placeholder="25.00"
                value={stakeAmount}
                onChange={(event) => {
                  setStakeAmount(event.target.value);
                  setTrackerError(null);
                }}
              />
            </label>

            <label className="input-group keepsake-tracker-field">
              <span className="field-label">Money Back</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="text-input"
                placeholder="0.00"
                value={wonAmount}
                onChange={(event) => {
                  setWonAmount(event.target.value);
                  setTrackerError(null);
                }}
              />
            </label>

            <label className="input-group keepsake-tracker-field">
              <span className="field-label">Bet Date</span>
              <input
                type="date"
                className="text-input"
                value={betDate}
                onChange={(event) => {
                  setBetDate(event.target.value);
                  setTrackerError(null);
                }}
              />
            </label>

            <label className="input-group keepsake-tracker-field keepsake-tracker-field-note">
              <span className="field-label">Note</span>
              <input
                type="text"
                className="text-input"
                placeholder="Optional reminder"
                value={betNote}
                maxLength={120}
                onChange={(event) => {
                  setBetNote(event.target.value);
                  setTrackerError(null);
                }}
              />
            </label>
          </div>

          <div className="keepsake-tracker-actions">
            <p className="muted">
              Use money back as the amount returned to you. Enter `0` for losing bets.
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void handleSaveBet();
              }}
              disabled={isSavingBet}
            >
              {isSavingBet ? "Saving..." : "Add Tracker Entry"}
            </button>
          </div>
        </div>

        {trackerStatusMessage ? <p className="keepsake-status-note">{trackerStatusMessage}</p> : null}
        {trackerError ? <p className="keepsake-error-note">{trackerError}</p> : null}

        <div className="keepsake-tracker-log">
          <div className="section-heading-row keepsake-heading-row">
            <div>
              <h3>Recent Entries</h3>
              <p className="muted">A simple running ledger that stays local to this app.</p>
            </div>
          </div>

          {betEntries.length === 0 ? (
            <div className="keepsake-empty-state">
              <strong>No tracker entries yet.</strong>
              <span>Add your first bet above to start tracking money in and money back.</span>
            </div>
          ) : (
            <div className="keepsake-tracker-list">
              {betEntries.map((entry) => {
                const netAmount = entry.wonAmount - entry.stakeAmount;

                return (
                  <article key={entry.id} className="keepsake-tracker-card">
                    <div className="keepsake-tracker-card-top">
                      <div>
                        <strong>{formatBetDate(entry.betDate)}</strong>
                        <div className="keepsake-card-meta">
                          <span>In: {formatCurrency(entry.stakeAmount)}</span>
                          <span>Back: {formatCurrency(entry.wonAmount)}</span>
                          <span>Net: {formatCurrency(netAmount)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          void handleDeleteBet(entry.id);
                        }}
                        disabled={activeDeleteBetId === entry.id}
                      >
                        {activeDeleteBetId === entry.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                    {entry.note ? <p className="muted">{entry.note}</p> : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="keepsake-gallery-section">
        <div className="section-heading-row keepsake-heading-row">
          <div>
            <h2>Your Gallery</h2>
            <p className="muted">
              A clean grid of your saved winning slips, organized for easy browsing on any
              screen size.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="panel keepsake-empty-state">
            <strong>Loading your keepsakes...</strong>
          </div>
        ) : items.length === 0 ? (
          <div className="panel keepsake-empty-state">
            <strong>No winning slips saved yet.</strong>
            <span>Upload your first image above to start your keepsake gallery.</span>
          </div>
        ) : (
          <div className="keepsake-grid">
            {items.map((item) => (
              <article key={item.id} className="panel keepsake-card">
                <Image
                  src={`/api/keepsakes/${item.id}`}
                  alt={item.originalName}
                  className="keepsake-image"
                  width={1200}
                  height={1500}
                  loading="lazy"
                  sizes="(max-width: 720px) 100vw, (max-width: 1200px) 50vw, 25vw"
                  unoptimized
                />
                <div className="keepsake-card-body">
                  <strong title={item.originalName}>{item.originalName}</strong>
                  <div className="keepsake-card-meta">
                    <span>{formatUploadedAt(item.uploadedAt)}</span>
                    <span>{formatFileSize(item.size)}</span>
                  </div>
                  <div className="keepsake-card-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setFullscreenItem(item)}
                    >
                      View Fullscreen
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        void handleDelete(item.id);
                      }}
                      disabled={activeDeleteId === item.id}
                    >
                      {activeDeleteId === item.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {fullscreenItem ? (
        <div
          className="keepsake-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${fullscreenItem.originalName} fullscreen view`}
          onClick={() => setFullscreenItem(null)}
        >
          <div
            className="keepsake-lightbox-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="keepsake-lightbox-top">
              <div>
                <strong>{fullscreenItem.originalName}</strong>
                <div className="keepsake-card-meta">
                  <span>{formatUploadedAt(fullscreenItem.uploadedAt)}</span>
                  <span>{formatFileSize(fullscreenItem.size)}</span>
                </div>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setFullscreenItem(null)}
              >
                Close
              </button>
            </div>
            <Image
              src={`/api/keepsakes/${fullscreenItem.id}`}
              alt={fullscreenItem.originalName}
              className="keepsake-lightbox-image"
              width={1800}
              height={2200}
              sizes="100vw"
              unoptimized
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
