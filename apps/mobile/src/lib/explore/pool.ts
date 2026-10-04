/**
 * The candidate pool (KTD6): a lean projection of the Watch Language Inventory,
 * stored for 24 h, and the next ready clip stored beside it, so a warm open
 * makes no request before motion. Storage comes through an injected interface.
 */

import type { ExploreInventoryData } from "../queries"
import { AUDIO_LANGUAGE_SLUG_PATTERN } from "../recommendations/context"
import { MIN_CLIP_VIDEO_SECONDS, overlaps } from "./clipWindow"
import { parseObject, settle } from "./storage"
import type {
  CandidateAvailability,
  ClipCandidate,
  ClipWindow,
  ReadyClip,
} from "./types"

/** One stored pool, for the language it names. A language change replaces it. */
export const EXPLORE_POOL_STORAGE_KEY = "explore-pool"
export const EXPLORE_READY_CLIP_STORAGE_KEY = "explore-ready-clip"

/** Bump when a persisted shape changes — old values then read as absent. */
export const EXPLORE_POOL_VERSION = 1

export const EXPLORE_POOL_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** A stored pool older than this is used at once and refreshed behind it. */
export const EXPLORE_POOL_REFRESH_AFTER_MS = 60 * 60 * 1000

/** Admin's per-bucket cap. The data probe measured about 2 s at every limit. */
export const EXPLORE_INVENTORY_LIMIT = 1000

/** Inventory labels are camelCase. A collection row plays only as a film. */
const PLAYABLE_COLLECTION_LABELS: ReadonlySet<string> = new Set([
  "featureFilm",
  "shortFilm",
])

/** A pool row. The veil's authored image arrives with the hydration. */
export type PoolCandidate = Omit<ClipCandidate, "imageUrl">

export type ExplorePool = {
  languageSlug: string
  /** Epoch ms of the inventory fetch. */
  fetchedAt: number
  /** Audio videos, then playable film collections (R20, R22). */
  dubbed: PoolCandidate[]
  /** Each row names its fallback audio language in `watchLanguageSlug`. */
  subtitleOnly: PoolCandidate[]
  /** Admin's `Language.name` map for the feed language, keyed by Admin's raw
   *  tags; null when Admin sent none (R9). */
  languageName: Readonly<Record<string, string>> | null
}

export type ExploreInventory = ExploreInventoryData["watchLanguageInventory"]
type InventoryRow = ExploreInventory["audioVideos"][number]

export function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isLanguageSlug(value: unknown): value is string {
  return typeof value === "string" && AUDIO_LANGUAGE_SLUG_PATTERN.test(value)
}

/** A name map with its non-blank string values only; null when none is left. */
function nameMap(value: unknown): Record<string, string> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  const out: Record<string, string> = {}
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (nonBlank(text)) out[key] = text
  }
  return Object.keys(out).length > 0 ? out : null
}

function positiveSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null
}

function toCandidate(
  row: InventoryRow,
  availability: CandidateAvailability,
): PoolCandidate | null {
  if (!nonBlank(row.id) || !nonBlank(row.coreId) || !nonBlank(row.slug)) {
    return null
  }
  if (!isLanguageSlug(row.watchLanguageSlug)) return null
  const durationSeconds = positiveSeconds(row.durationSeconds)
  if (durationSeconds != null && durationSeconds < MIN_CLIP_VIDEO_SECONDS) {
    return null
  }
  return {
    videoId: row.id,
    coreId: row.coreId,
    slug: row.slug,
    label: typeof row.label === "string" ? row.label : null,
    availability,
    durationSeconds,
    muxPlaybackId: nonBlank(row.muxPlaybackId) ? row.muxPlaybackId : null,
    watchLanguageSlug: row.watchLanguageSlug,
    title: typeof row.title === "string" ? row.title : "",
    description: nonBlank(row.description) ? row.description : null,
  }
}

/** The lean pool for one feed language. Audio outranks subtitle-only. */
export function projectInventory(
  inventory: ExploreInventory,
  feedLanguageSlug: string,
  fetchedAt: number,
): ExplorePool {
  const seen = new Set<string>()
  const take = (
    rows: readonly InventoryRow[] | null | undefined,
    availability: CandidateAvailability,
    keep: (row: InventoryRow) => boolean = () => true,
  ): PoolCandidate[] => {
    const out: PoolCandidate[] = []
    for (const row of rows ?? []) {
      if (!keep(row)) continue
      const candidate = toCandidate(row, availability)
      if (candidate == null || seen.has(candidate.videoId)) continue
      seen.add(candidate.videoId)
      out.push(candidate)
    }
    return out
  }
  const dubbed = [
    ...take(inventory?.audioVideos, "AUDIO"),
    ...take(inventory?.audioCollections, "AUDIO", (row) =>
      PLAYABLE_COLLECTION_LABELS.has(row.label ?? ""),
    ),
  ]
  const subtitleOnly = take(inventory?.subtitleOnlyVideos, "SUBTITLE_ONLY")
  return {
    languageSlug: feedLanguageSlug,
    fetchedAt,
    dubbed,
    subtitleOnly,
    languageName: nameMap(inventory?.language?.name),
  }
}

/** R37: a successful fetch with no row means no eligible video exists. */
export function isPoolEmpty(pool: ExplorePool): boolean {
  return pool.dubbed.length === 0 && pool.subtitleOnly.length === 0
}

export type PoolPlan = {
  use: ExplorePool | null
  fetch: "none" | "background" | "now"
}

/** A pool younger than 24 h is used at once; an older one is fetched again. */
export function planPoolLoad(
  stored: ExplorePool | null,
  nowMs: number,
): PoolPlan {
  if (stored == null) return { use: null, fetch: "now" }
  const age = nowMs - stored.fetchedAt
  if (!(age >= 0) || age >= EXPLORE_POOL_MAX_AGE_MS) {
    return { use: null, fetch: "now" }
  }
  return {
    use: stored,
    fetch: age >= EXPLORE_POOL_REFRESH_AFTER_MS ? "background" : "none",
  }
}

// ── Persistence ─────────────────────────────────────────────────────

/** [videoId, coreId, slug, label, seconds, mux id, audio slug, title, description] */
type StoredRow = [
  string,
  string,
  string,
  string | null,
  number | null,
  string | null,
  string,
  string,
  string | null,
]

type StoredPool = {
  v: number
  lang: string
  at: number
  d: StoredRow[]
  s: StoredRow[]
  /** The language's name map. Absent in a pool stored before U7. */
  n?: Record<string, string> | null
}

function toStoredRow(candidate: PoolCandidate): StoredRow {
  return [
    candidate.videoId,
    candidate.coreId,
    candidate.slug,
    candidate.label,
    candidate.durationSeconds,
    candidate.muxPlaybackId,
    candidate.watchLanguageSlug,
    candidate.title,
    candidate.description,
  ]
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function fromStoredRow(
  tuple: unknown,
  availability: CandidateAvailability,
): PoolCandidate | null {
  if (!Array.isArray(tuple) || tuple.length !== 9) return null
  const [videoId, coreId, slug, label, seconds, mux, audio, title, text] =
    tuple as unknown[]
  if (!nonBlank(videoId) || !nonBlank(coreId) || !nonBlank(slug)) return null
  if (!isLanguageSlug(audio) || typeof title !== "string") return null
  if (!nullableString(label) || !nullableString(mux)) return null
  if (!nullableString(text)) return null
  if (seconds !== null && positiveSeconds(seconds) == null) return null
  return {
    videoId,
    coreId,
    slug,
    label,
    availability,
    durationSeconds: seconds as number | null,
    muxPlaybackId: mux,
    watchLanguageSlug: audio,
    title,
    description: text,
  }
}

function fromStoredRows(
  rows: unknown,
  availability: CandidateAvailability,
): PoolCandidate[] {
  if (!Array.isArray(rows)) return []
  const out: PoolCandidate[] = []
  for (const tuple of rows) {
    const candidate = fromStoredRow(tuple, availability)
    if (candidate != null) out.push(candidate)
  }
  return out
}

export function serializePool(pool: ExplorePool): string {
  const stored: StoredPool = {
    v: EXPLORE_POOL_VERSION,
    lang: pool.languageSlug,
    at: pool.fetchedAt,
    d: pool.dubbed.map(toStoredRow),
    s: pool.subtitleOnly.map(toStoredRow),
    n: pool.languageName == null ? null : { ...pool.languageName },
  }
  return JSON.stringify(stored)
}

/**
 * Tolerant: bad JSON, a version change, another language, or a bad shape
 * reads as no pool, and a single bad row is dropped. Freshness is
 * `planPoolLoad`'s decision, not this one.
 */
export function parseStoredPool(
  raw: string | null,
  languageSlug: string,
): ExplorePool | null {
  const stored = parseObject(raw)
  if (stored == null || stored.v !== EXPLORE_POOL_VERSION) return null
  if (stored.lang !== languageSlug) return null
  if (!Number.isSafeInteger(stored.at)) return null
  if (!Array.isArray(stored.d) || !Array.isArray(stored.s)) return null
  return {
    languageSlug,
    fetchedAt: stored.at as number,
    dubbed: fromStoredRows(stored.d, "AUDIO"),
    subtitleOnly: fromStoredRows(stored.s, "SUBTITLE_ONLY"),
    languageName: nameMap(stored.n),
  }
}

export type StoredReadyClip = {
  /** Epoch ms when the queue stored it. */
  storedAt: number
  clip: ReadyClip
}

const READY_CLIP_STRINGS = [
  "videoId",
  "coreId",
  "slug",
  "watchLanguageSlug",
  "feedLanguageSlug",
  "streamUrl",
  "audioLanguageSlug",
] as const

const READY_CLIP_NULLABLE_STRINGS = [
  "label",
  "muxPlaybackId",
  "description",
  "imageUrl",
  "subtitleLanguageSlug",
  "subtitleVttSrc",
] as const

function isWindow(value: unknown): value is ClipWindow {
  if (value == null || typeof value !== "object") return false
  const { startSeconds, endSeconds } = value as Record<string, unknown>
  return (
    typeof startSeconds === "number" &&
    typeof endSeconds === "number" &&
    Number.isFinite(startSeconds) &&
    Number.isFinite(endSeconds) &&
    startSeconds >= 0 &&
    endSeconds > startSeconds
  )
}

function isReadyClip(value: unknown): value is ReadyClip {
  if (value == null || typeof value !== "object") return false
  const clip = value as Record<string, unknown>
  if (!READY_CLIP_STRINGS.every((key) => nonBlank(clip[key]))) return false
  if (!READY_CLIP_NULLABLE_STRINGS.every((key) => nullableString(clip[key]))) {
    return false
  }
  if (typeof clip.title !== "string") return false
  // Optional since U7: a clip stored before then has none of them.
  const optional = [clip.titleLang, clip.descriptionLang, clip.textSlug]
  if (!optional.every((v) => v === undefined || nullableString(v))) return false
  if (clip.availability !== "AUDIO" && clip.availability !== "SUBTITLE_ONLY") {
    return false
  }
  if (
    clip.durationSeconds !== null &&
    positiveSeconds(clip.durationSeconds) == null
  ) {
    return false
  }
  if (typeof clip.subtitleOnly !== "boolean") return false
  if (clip.cut !== "sentence" && clip.cut !== "fallback") return false
  return isWindow(clip.window)
}

export function serializeReadyClip(clip: ReadyClip, storedAt: number): string {
  return JSON.stringify({ v: EXPLORE_POOL_VERSION, at: storedAt, clip })
}

export function parseStoredReadyClip(
  raw: string | null,
): StoredReadyClip | null {
  const stored = parseObject(raw)
  if (stored == null || stored.v !== EXPLORE_POOL_VERSION) return null
  if (!Number.isSafeInteger(stored.at) || !isReadyClip(stored.clip)) return null
  return { storedAt: stored.at as number, clip: stored.clip }
}

/**
 * The stored clip a warm open may start with, or null. It is dropped when it
 * is older than the pool, when the record holds its window, when the feed
 * language changed, or when its text was read in another UI language (R4).
 */
export function usableStoredClip(
  stored: StoredReadyClip | null,
  context: {
    feedLanguageSlug: string
    /** The `$textSlug` the feed reads its text with now. */
    textSlug: string
    poolFetchedAt: number
    recordedWindows: (videoId: string) => readonly ClipWindow[]
  },
): ReadyClip | null {
  if (stored == null) return null
  const { clip } = stored
  if (clip.feedLanguageSlug !== context.feedLanguageSlug) return null
  if (clip.textSlug !== context.textSlug) return null
  if (stored.storedAt < context.poolFetchedAt) return null
  const held = context
    .recordedWindows(clip.videoId)
    .some((w) => overlaps(w, clip.window))
  return held ? null : clip
}

export type ExplorePoolStoreDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

export type ExplorePoolStore = ReturnType<typeof createExplorePoolStore>

export function createExplorePoolStore(deps: ExplorePoolStoreDeps) {
  return {
    async readPool(languageSlug: string): Promise<ExplorePool | null> {
      const raw = await settle(
        () => deps.getItem(EXPLORE_POOL_STORAGE_KEY),
        null,
      )
      return parseStoredPool(raw, languageSlug)
    },

    /** Resolves true when the write landed. */
    writePool(pool: ExplorePool): Promise<boolean> {
      return settle(
        () =>
          deps
            .setItem(EXPLORE_POOL_STORAGE_KEY, serializePool(pool))
            .then(() => true),
        false,
      )
    },

    async readReadyClip(): Promise<StoredReadyClip | null> {
      const raw = await settle(
        () => deps.getItem(EXPLORE_READY_CLIP_STORAGE_KEY),
        null,
      )
      return parseStoredReadyClip(raw)
    },

    writeReadyClip(clip: ReadyClip, storedAt: number): Promise<boolean> {
      return settle(
        () =>
          deps
            .setItem(
              EXPLORE_READY_CLIP_STORAGE_KEY,
              serializeReadyClip(clip, storedAt),
            )
            .then(() => true),
        false,
      )
    },
  }
}

let store: ExplorePoolStore | null = null

/* eslint-disable @typescript-eslint/no-require-imports */
/** The app-wide store. AsyncStorage loads on first use, so this module and its
 *  tests stay free of the native module. */
export function getExplorePoolStore(): ExplorePoolStore {
  if (store == null) {
    const AsyncStorage = (
      require("@react-native-async-storage/async-storage") as {
        default: ExplorePoolStoreDeps
      }
    ).default
    store = createExplorePoolStore({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
    })
  }
  return store
}
/* eslint-enable @typescript-eslint/no-require-imports */
