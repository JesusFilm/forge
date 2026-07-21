import { datadogLog } from "./datadog"
import { getStorage } from "./safeStorage"

/**
 * App-wide watch preference (audio-language only, for now), persisted across
 * videos and app restarts. Stored by unique language SLUG, never bcp47 — prefixes
 * collide ("ko" vs "ko-kmr") — so matching is exact-equality on the slug.
 */
export type WatchPreferences = {
  /** Preferred dub language slug, or null to use the resolution fallback. */
  audioLanguageSlug: string | null
}

/** Versioned key so a future schema change (subtitles, wifi-only) is a migration,
 *  not a breaking read. */
export const WATCH_PREFERENCES_STORAGE_KEY = "tv.watchPreferences.v1"

export const DEFAULT_WATCH_PREFERENCES: WatchPreferences = {
  audioLanguageSlug: null,
} as const

/**
 * Explicit local writes awaiting hydration. Absent key = "the user hasn't chosen",
 * which the value alone can't express — see mergeWatchPreferences.
 */
export type PendingWatchPreferences = Partial<WatchPreferences>

function normalizeNonEmptyString(value: unknown): string | null {
  // Anything non-string or empty degrades to "unset" so a corrupt/partial blob
  // falls through to the resolution fallback rather than poisoning slug matching.
  return typeof value === "string" && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Stored JSON → prefs, defaulting on anything unreadable (absent, corrupt, wrong
 * shape). Never throws; unknown fields from a newer writer are dropped. An older
 * bcp47-keyed blob reads back as defaults; the viewer re-picks once.
 */
export function parseStoredPreferences(raw: string | null): WatchPreferences {
  if (raw == null || raw === "") return { ...DEFAULT_WATCH_PREFERENCES }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_WATCH_PREFERENCES }
  }
  if (!isRecord(parsed)) return { ...DEFAULT_WATCH_PREFERENCES }
  return {
    audioLanguageSlug: normalizeNonEmptyString(parsed.audioLanguageSlug),
  }
}

/**
 * Resolve hydration against writes that raced ahead of it: local intent is newer,
 * so it wins — but only where the user actually chose, hence the pending keys
 * rather than a value comparison (null is both the default and a real "clear").
 */
export function mergeWatchPreferences(
  onDisk: WatchPreferences,
  pending: PendingWatchPreferences,
): WatchPreferences {
  return { ...onDisk, ...pending }
}

export function serializeWatchPreferences(prefs: WatchPreferences): string {
  return JSON.stringify(prefs)
}

/** Defaults on any read or parse failure. A swallowed read silently resets the
 *  viewer's dub language — the "my settings reset themselves" class — so log it. */
export async function loadWatchPreferences(): Promise<WatchPreferences> {
  try {
    const raw = await getStorage().getItem(WATCH_PREFERENCES_STORAGE_KEY)
    return parseStoredPreferences(raw)
  } catch {
    datadogLog.warn("watch_prefs.read_failed", {})
    return { ...DEFAULT_WATCH_PREFERENCES }
  }
}

/** The hydration race timed out: the read may still settle, but this session runs
 *  on defaults — same diagnosable-loss posture as a failed read. */
export function reportWatchPreferencesReadTimeout(): void {
  datadogLog.warn("watch_prefs.read_failed", { reason: "timeout" })
}

export async function saveWatchPreferences(
  prefs: WatchPreferences,
): Promise<void> {
  try {
    await getStorage().setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      serializeWatchPreferences(prefs),
    )
  } catch {
    // In-memory state already reflects the choice, but it won't survive a
    // relaunch — surface it so silent preference loss is diagnosable.
    datadogLog.warn("watch_prefs.write_failed", {})
  }
}
