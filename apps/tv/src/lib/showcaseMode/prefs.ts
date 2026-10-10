import { getStorage } from "../safeStorage"

/** Versioned storage key so a future schema change (dwell time, curated source,
 *  language rotation) is a migration, not a breaking read. */
export const SHOWCASE_PREFS_STORAGE_KEY = "tv.showcaseMode.v1"

export type ShowcasePrefs = {
  /** Launch the showcase reel on cold start. Launch-only — never re-armed by an exit. */
  autoStart: boolean
}

export const DEFAULT_SHOWCASE_PREFS: ShowcasePrefs = {
  autoStart: false,
} as const

/**
 * Explicit local writes awaiting hydration. Absent key = "the user hasn't chosen",
 * which a bare `false` can't express — see mergeShowcasePrefs.
 */
export type PendingShowcasePrefs = Partial<ShowcasePrefs>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Stored JSON → prefs, defaulting on anything unreadable (absent, corrupt,
 * wrong shape). Never throws; unknown fields from a newer writer are dropped.
 */
export function parseStoredPrefs(raw: string | null): ShowcasePrefs {
  if (raw == null) return { ...DEFAULT_SHOWCASE_PREFS }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ...DEFAULT_SHOWCASE_PREFS }
    if (typeof parsed.autoStart !== "boolean") {
      return { ...DEFAULT_SHOWCASE_PREFS }
    }
    return { autoStart: parsed.autoStart }
  } catch {
    return { ...DEFAULT_SHOWCASE_PREFS }
  }
}

/**
 * Resolve hydration against writes that raced ahead of it: local intent is newer,
 * so it wins — but only where the user actually chose, hence the pending keys
 * rather than a value comparison (`false` is both the default and a real choice).
 */
export function mergeShowcasePrefs(
  onDisk: ShowcasePrefs,
  pending: PendingShowcasePrefs,
): ShowcasePrefs {
  return { ...onDisk, ...pending }
}

/** Read-only by construction: an exit path may hydrate freely without re-arming
 *  auto-start (AE2). Defaults on any read or parse failure. */
export async function loadShowcasePrefs(): Promise<ShowcasePrefs> {
  try {
    const raw = await getStorage().getItem(SHOWCASE_PREFS_STORAGE_KEY)
    return parseStoredPrefs(raw)
  } catch {
    return { ...DEFAULT_SHOWCASE_PREFS }
  }
}

export async function saveShowcasePrefs(prefs: ShowcasePrefs): Promise<void> {
  try {
    await getStorage().setItem(
      SHOWCASE_PREFS_STORAGE_KEY,
      JSON.stringify(prefs),
    )
  } catch {
    // Best-effort: in-memory state already reflects the choice, so a failed
    // write only costs the next launch its newest value. Not worth a UI error.
  }
}
