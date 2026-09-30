/**
 * Sentence timing or a fallback verdict per candidate, inside KTD24's per-visit
 * probe budget. A transient failure stores nothing, so the video stays eligible
 * (R47). Verdicts last 7 days and clear on an app version change (KTD20).
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  getVttDerived,
  loadVttCues,
  peekVttCues,
  setVttDerived,
  vttDerivedKey,
  type VttFailureReason,
  type VttLoadResult,
} from "../vttCache"
import { withTimeout } from "../withTimeout"
import type { EligibleStartsMemo, MemoSlot } from "./clipWindow"
import type { ClipTiming } from "./sentenceTiming"
import { parseObject, persistQuietly } from "./storage"
import {
  checkTimingTrack,
  timingTrackOrder,
  type TimingDub,
  type TimingSubtitle,
  type TimingTrackFailure,
  type TimingTrackTier,
  type TimingTrackVerdict,
} from "./timingTrack"

export const CLIP_TIMING_STORAGE_KEY = "explore-clip-timing"

/** Bump when the persisted shape changes — old verdicts then read as empty. */
export const CLIP_TIMING_VERSION = 1

/** KTD24: a verdict older than 7 days counts as absent. */
export const CLIP_TIMING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const CLIP_TIMING_MAX_VERDICTS = 2000

const CLIP_TIMING_WRITE_INTERVAL_MS = 5000

/** The first clip waits for hydration, so a hung read must not hold it. */
export const CLIP_TIMING_HYDRATE_TIMEOUT_MS = 400

/** Ids and slugs come from admin. Bound them so one bad row cannot grow the blob. */
const CLIP_TIMING_MAX_ID_LENGTH = 200
const CLIP_TIMING_MAX_SRC_LENGTH = 2048

/** KTD24: this many definitive track-read failures in a row end a visit's probes. */
export const PROBE_MAX_CONSECUTIVE_FAILURES = 4

/** KTD24: the bytes of failed track reads that end a visit's probes. */
export const PROBE_MAX_FAILED_BYTES = 1_000_000

export type ClipTimingVerdict =
  | { kind: "sentence"; vttSrc: string }
  | { kind: "fallback" }

export type ClipTimingVerdictEntry = {
  videoId: string
  editionId: string
  /** KTD5's track order starts with the feed language, so a verdict holds for one. */
  feedLanguageSlug: string
  verdict: ClipTimingVerdict
  /** Epoch ms when a track walk decided it. */
  storedAt: number
}

/** Why one track gave no timing. Each one is definitive for that track. */
export type ClipTimingTrackFailure =
  | "unsafe_url"
  | "over_cap"
  | "parse_empty"
  | "http_4xx"
  | TimingTrackFailure

export type ClipTimingTransientReason =
  | "timeout"
  | "network_error"
  | "aborted"
  | "http_408"
  | "http_429"
  | "http_5xx"
  | "http_other"

export type ClipTimingFallbackReason =
  /** The dub has no subtitle track, so no read was made. */
  | "no_track"
  /** Every track failed definitively. */
  | "tracks_failed"
  /** A stored fallback verdict, so no read was made. */
  | "stored_verdict"
  /** No dub length: no check can pass, and nothing is stored. */
  | "unknown_duration"

export type ClipTimingResult =
  | {
      status: "sentence"
      vttSrc: string
      tier: TimingTrackTier
      timing: ClipTiming
    }
  | {
      status: "fallback"
      reason: ClipTimingFallbackReason
      /** The failure of each track read, in walk order. */
      failures: readonly ClipTimingTrackFailure[]
    }
  /** Try again later. Nothing was stored, so the candidate stays eligible. */
  | { status: "transient"; reason: ClipTimingTransientReason }
  /** No probe was made. Nothing was stored. */
  | { status: "budget_exhausted" }

export type ProbeBudgetState = {
  exhausted: boolean
  consecutiveFailures: number
  failedBytes: number
}

export type ClipTimingRequest<T extends TimingSubtitle> = {
  videoId: string
  /** The playing dub's Video Edition. Null: no verdict is read or stored. */
  editionId: string | null
  playingDub: TimingDub<T>
  feedLanguageSlug: string
  dubDurationSeconds: number
  signal?: AbortSignal
}

export type ClipTimingSourceDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  now: () => Date
  appVersion: string
  /** The cue cache's loader. Tests replace it to model a track over the cap. */
  loadCues?: (
    vttSrc: string,
    options: { signal?: AbortSignal },
  ) => Promise<VttLoadResult>
}

/** [video id, edition id, feed language, stored-at ms, sentence track or null] */
type StoredVerdict = [string, string, string, number, string | null]

type StoredVerdicts = { v: number; app: string; e: StoredVerdict[] }

function clipTimingVerdictKey(
  videoId: string,
  editionId: string,
  feedLanguageSlug: string,
): string {
  return JSON.stringify([videoId, editionId, feedLanguageSlug])
}

function keyOf(entry: ClipTimingVerdictEntry): string {
  return clipTimingVerdictKey(
    entry.videoId,
    entry.editionId,
    entry.feedLanguageSlug,
  )
}

function isStorableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CLIP_TIMING_MAX_ID_LENGTH
  )
}

function isStorableSrc(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CLIP_TIMING_MAX_SRC_LENGTH
  )
}

function isExpired(storedAt: number, nowMs: number): boolean {
  return nowMs - storedAt > CLIP_TIMING_MAX_AGE_MS
}

/** Oldest first. A later entry replaces an earlier one with the same key. */
function dedupeAndCap(
  list: readonly ClipTimingVerdictEntry[],
): ClipTimingVerdictEntry[] {
  const byKey = new Map<string, ClipTimingVerdictEntry>()
  for (const entry of list) {
    const key = keyOf(entry)
    byKey.delete(key)
    byKey.set(key, entry)
  }
  const out = [...byKey.values()]
  return out.length > CLIP_TIMING_MAX_VERDICTS
    ? out.slice(out.length - CLIP_TIMING_MAX_VERDICTS)
    : out
}

function decodeEntry(tuple: unknown): ClipTimingVerdictEntry | null {
  if (!Array.isArray(tuple) || tuple.length !== 5) return null
  const [videoId, editionId, feedLanguageSlug, storedAt, vttSrc] =
    tuple as unknown[]
  if (!isStorableId(videoId) || !isStorableId(editionId)) return null
  if (!isStorableId(feedLanguageSlug)) return null
  if (!Number.isSafeInteger(storedAt)) return null
  if (vttSrc !== null && !isStorableSrc(vttSrc)) return null
  return {
    videoId,
    editionId,
    feedLanguageSlug,
    verdict:
      vttSrc === null ? { kind: "fallback" } : { kind: "sentence", vttSrc },
    storedAt: storedAt as number,
  }
}

/**
 * Parse the persisted verdicts, oldest first. Tolerant: bad JSON, a version
 * or app version change, or a bad shape reads as empty, and a single bad
 * entry is dropped. Expired entries are dropped here too.
 */
export function parseStoredClipTimingVerdicts(
  raw: string | null,
  now: Date,
  appVersion: string,
): ClipTimingVerdictEntry[] {
  const stored = parseObject(raw) as Partial<
    Record<keyof StoredVerdicts, unknown>
  > | null
  if (stored == null) return []
  if (stored.v !== CLIP_TIMING_VERSION || stored.app !== appVersion) return []
  if (!Array.isArray(stored.e)) return []
  const nowMs = now.getTime()
  const decoded: ClipTimingVerdictEntry[] = []
  for (const tuple of stored.e) {
    const entry = decodeEntry(tuple)
    if (entry != null && !isExpired(entry.storedAt, nowMs)) decoded.push(entry)
  }
  return dedupeAndCap(decoded)
}

/** Serialize for persistence, oldest first. Expired entries are left out. */
export function serializeClipTimingVerdicts(
  entries: readonly ClipTimingVerdictEntry[],
  now: Date,
  appVersion: string,
): string {
  const nowMs = now.getTime()
  const e: StoredVerdict[] = []
  for (const entry of entries) {
    if (isExpired(entry.storedAt, nowMs)) continue
    e.push([
      entry.videoId,
      entry.editionId,
      entry.feedLanguageSlug,
      Math.round(entry.storedAt),
      entry.verdict.kind === "sentence" ? entry.verdict.vttSrc : null,
    ])
  }
  const stored: StoredVerdicts = { v: CLIP_TIMING_VERSION, app: appVersion, e }
  return JSON.stringify(stored)
}

/**
 * KTD24's memo slot for `eligibleStartsOnce`, one per track and video. It
 * lives on the track's cache entry, so it leaves the cache with the track.
 */
export function eligibleStartsSlot(
  vttSrc: string,
  videoId: string,
): MemoSlot<EligibleStartsMemo> {
  const key = vttDerivedKey<EligibleStartsMemo>(
    `explore.eligibleStarts:${videoId}`,
  )
  return {
    get: () => getVttDerived(vttSrc, key),
    set: (value) => {
      setVttDerived(vttSrc, key, value)
    },
  }
}

/** The track check depends on the dub length, so the memo is keyed on it. */
function checkOnce(
  vttSrc: string,
  cues: Parameters<typeof checkTimingTrack>[0],
  dubDurationSeconds: number,
): TimingTrackVerdict {
  const key = vttDerivedKey<TimingTrackVerdict>(
    `explore.timingCheck:${dubDurationSeconds}`,
  )
  const held = getVttDerived(vttSrc, key)
  if (held) return held
  const verdict = checkTimingTrack(cues, dubDurationSeconds)
  setVttDerived(vttSrc, key, verdict)
  return verdict
}

/** Called only for definitive reasons; the cache's other definitive one is a 4xx. */
function trackFailure(reason: VttFailureReason): ClipTimingTrackFailure {
  if (reason === "unsafe_url") return "unsafe_url"
  if (reason === "over_cap") return "over_cap"
  if (reason === "parse_empty") return "parse_empty"
  return "http_4xx"
}

function transientReason(reason: VttFailureReason): ClipTimingTransientReason {
  if (reason === "timeout") return "timeout"
  if (reason === "aborted") return "aborted"
  if (reason === "http_408") return "http_408"
  if (reason === "http_429") return "http_429"
  const status = reason.startsWith("http_") ? Number(reason.slice(5)) : NaN
  if (status >= 500 && status < 600) return "http_5xx"
  return Number.isFinite(status) ? "http_other" : "network_error"
}

const ABORTED: ClipTimingResult = { status: "transient", reason: "aborted" }

export type ClipTimingSource = ReturnType<typeof createClipTimingSource>

export function createClipTimingSource(deps: ClipTimingSourceDeps) {
  const loadCues = deps.loadCues ?? loadVttCues
  /** Map order is age: the first key is the oldest verdict. */
  let verdicts = new Map<string, ClipTimingVerdictEntry>()

  let consecutiveFailures = 0
  let failedBytes = 0
  /** Each track counts at most once in a visit, however often a walk meets it. */
  let countedThisVisit = new Set<string>()

  let gestureActive = false
  let gestureWaiters = new Set<() => void>()

  let dirty = false
  let writeTimer: ReturnType<typeof setTimeout> | null = null
  /** The write interval has passed, but a gesture or the first read holds it. */
  let writeDue = false
  /** Writes land in the order they start, so an older blob never lands last. */
  let writeChain: Promise<void> = Promise.resolve()

  let readFlight: Promise<void> | null = null
  let readLanded = false
  let hydration: Promise<void> | null = null
  /** A reset between a read's start and its landing voids that read. */
  let epoch = 0

  function budgetExhausted(): boolean {
    return (
      consecutiveFailures >= PROBE_MAX_CONSECUTIVE_FAILURES ||
      failedBytes >= PROBE_MAX_FAILED_BYTES
    )
  }

  function countFailure(
    vttSrc: string,
    reason: ClipTimingTrackFailure,
    bytes: number,
  ): void {
    // An unsafe URL is refused before any request, so it costs no read.
    if (reason === "unsafe_url" || countedThisVisit.has(vttSrc)) return
    countedThisVisit.add(vttSrc)
    consecutiveFailures += 1
    if (Number.isFinite(bytes) && bytes > 0) failedBytes += bytes
  }

  function readVerdict(key: string): ClipTimingVerdict | null {
    const held = verdicts.get(key)
    if (held == null) return null
    if (isExpired(held.storedAt, deps.now().getTime())) {
      verdicts.delete(key)
      return null
    }
    return held.verdict
  }

  function storeVerdict(
    request: { videoId: string; feedLanguageSlug: string },
    editionId: string,
    verdict: ClipTimingVerdict,
  ): void {
    const entry: ClipTimingVerdictEntry = {
      videoId: request.videoId,
      editionId,
      feedLanguageSlug: request.feedLanguageSlug,
      verdict,
      storedAt: deps.now().getTime(),
    }
    const key = keyOf(entry)
    verdicts.delete(key)
    verdicts.set(key, entry)
    for (const oldest of verdicts.keys()) {
      if (verdicts.size <= CLIP_TIMING_MAX_VERDICTS) break
      verdicts.delete(oldest)
    }
    markDirty()
  }

  function dropVerdict(key: string): void {
    if (verdicts.delete(key)) markDirty()
  }

  function mergeStored(stored: ClipTimingVerdictEntry[]): void {
    if (stored.length === 0) return
    // Every stored verdict predates the ones this launch decided.
    verdicts = new Map(
      dedupeAndCap([...stored, ...verdicts.values()]).map((entry) => [
        keyOf(entry),
        entry,
      ]),
    )
  }

  function startRead(): Promise<void> {
    if (readFlight != null) return readFlight
    const epochAtStart = epoch
    readFlight = (async () => {
      let raw: string | null = null
      try {
        raw = await deps.getItem(CLIP_TIMING_STORAGE_KEY)
      } catch {
        // An unreadable key reads as empty, the same as a corrupt one.
      }
      if (epoch !== epochAtStart) return
      mergeStored(
        parseStoredClipTimingVerdicts(raw, deps.now(), deps.appVersion),
      )
      readLanded = true
      tryWrite()
    })()
    return readFlight
  }

  function startWrite(): Promise<void> {
    dirty = false
    writeDue = false
    const blob = serializeClipTimingVerdicts(
      [...verdicts.values()],
      deps.now(),
      deps.appVersion,
    )
    writeChain = writeChain.then(async () => {
      const written = await persistQuietly(() =>
        deps.setItem(CLIP_TIMING_STORAGE_KEY, blob),
      )
      // Memory still holds everything, so the next flush writes it again.
      if (!written) dirty = true
    })
    return writeChain
  }

  function tryWrite(): void {
    if (!writeDue) return
    if (!dirty) {
      writeDue = false
      return
    }
    if (gestureActive) return
    if (!readLanded) {
      // The read's landing calls back here.
      void startRead()
      return
    }
    void startWrite()
  }

  function markDirty(): void {
    dirty = true
    if (writeTimer != null || writeDue) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      writeDue = true
      tryWrite()
    }, CLIP_TIMING_WRITE_INTERVAL_MS)
  }

  function hydrate(): Promise<void> {
    if (hydration != null) return hydration
    hydration = withTimeout(startRead(), CLIP_TIMING_HYDRATE_TIMEOUT_MS).catch(
      () => {},
    )
    return hydration
  }

  /** False when the caller aborts first. Loops, since a new gesture can start
   *  between the clear and the waiter's turn. */
  async function waitForGestureClear(signal?: AbortSignal): Promise<boolean> {
    while (gestureActive) {
      if (signal?.aborted) return false
      const cleared = await new Promise<boolean>((resolve) => {
        const onAbort = () => {
          gestureWaiters.delete(onClear)
          resolve(false)
        }
        const onClear = () => {
          signal?.removeEventListener("abort", onAbort)
          resolve(true)
        }
        gestureWaiters.add(onClear)
        signal?.addEventListener("abort", onAbort, { once: true })
      })
      if (!cleared) return false
    }
    return !signal?.aborted
  }

  async function walk<T extends TimingSubtitle>(
    request: ClipTimingRequest<T>,
  ): Promise<ClipTimingResult> {
    const { editionId, signal, dubDurationSeconds } = request
    if (signal?.aborted) return ABORTED
    if (!Number.isFinite(dubDurationSeconds) || dubDurationSeconds <= 0) {
      return { status: "fallback", reason: "unknown_duration", failures: [] }
    }
    await hydrate()

    const storable =
      editionId != null &&
      isStorableId(request.videoId) &&
      isStorableId(editionId) &&
      isStorableId(request.feedLanguageSlug)
    const key = storable
      ? clipTimingVerdictKey(
          request.videoId,
          editionId,
          request.feedLanguageSlug,
        )
      : null
    const stored = key != null ? readVerdict(key) : null
    if (stored?.kind === "fallback") {
      return { status: "fallback", reason: "stored_verdict", failures: [] }
    }

    const order = timingTrackOrder(request.playingDub, request.feedLanguageSlug)
    // A stored track is used only while the dub still lists it.
    const storedTrack =
      stored?.kind === "sentence"
        ? order.find((candidate) => candidate.vttSrc === stored.vttSrc)
        : undefined
    const tracks = storedTrack
      ? [storedTrack, ...order.filter((c) => c !== storedTrack)]
      : order
    const failures: ClipTimingTrackFailure[] = []

    for (const candidate of tracks) {
      const { vttSrc } = candidate
      const isStoredTrack = candidate === storedTrack
      if (!(await waitForGestureClear(signal))) return ABORTED
      // Cached cues cost no fetch, and a stored verdict's own track is exempt.
      if (!isStoredTrack && peekVttCues(vttSrc) == null && budgetExhausted()) {
        return { status: "budget_exhausted" }
      }

      const load = await loadCues(vttSrc, { signal })
      if (!load.ok) {
        if (!load.definitive) {
          return { status: "transient", reason: transientReason(load.reason) }
        }
        const reason = trackFailure(load.reason)
        failures.push(reason)
        countFailure(vttSrc, reason, load.bytes)
        if (isStoredTrack && key != null) dropVerdict(key)
        continue
      }

      if (!(await waitForGestureClear(signal))) return ABORTED
      const check = checkOnce(vttSrc, load.cues, dubDurationSeconds)
      if (!check.ok) {
        failures.push(check.reason)
        countFailure(vttSrc, check.reason, load.bytes)
        if (isStoredTrack && key != null) dropVerdict(key)
        continue
      }

      // A passing track costs no budget, however large (KTD24).
      consecutiveFailures = 0
      // Only a new walk stores, so a verdict still expires 7 days after it.
      if (key != null && editionId != null && !isStoredTrack) {
        storeVerdict(request, editionId, { kind: "sentence", vttSrc })
      }
      return {
        status: "sentence",
        vttSrc,
        tier: candidate.tier,
        timing: check.timing,
      }
    }

    if (key != null && editionId != null) {
      storeVerdict(request, editionId, { kind: "fallback" })
    }
    return {
      status: "fallback",
      reason: order.length === 0 ? "no_track" : "tracks_failed",
      failures,
    }
  }

  return {
    /** Bounded wait for the stored verdicts, memoized, and it never rejects. */
    hydrate,

    /**
     * Timing for one candidate, or why there is none. Never rejects. Each
     * fetch and each track check waits for the gesture latch to clear.
     */
    async acquire<T extends TimingSubtitle>(
      request: ClipTimingRequest<T>,
    ): Promise<ClipTimingResult> {
      try {
        return await walk(request)
      } catch {
        // Unknown means try again later, never a verdict that sticks.
        return { status: "transient", reason: "network_error" }
      }
    },

    /** The unexpired verdict in memory, with no read and no fetch. */
    peekVerdict(
      videoId: string,
      editionId: string,
      feedLanguageSlug: string,
    ): ClipTimingVerdict | null {
      return readVerdict(
        clipTimingVerdictKey(videoId, editionId, feedLanguageSlug),
      )
    },

    getBudget(): ProbeBudgetState {
      return {
        exhausted: budgetExhausted(),
        consecutiveFailures,
        failedBytes,
      }
    },

    /** KTD24's budget is per visit. Call it when a new Explore visit starts. */
    resetVisit(): void {
      consecutiveFailures = 0
      failedBytes = 0
      countedThisVisit = new Set()
    },

    /**
     * KTD22 settle signal. While true, no fetch, track check, or write starts;
     * waiting work resumes when it turns false.
     */
    setGestureActive(active: boolean): void {
      gestureActive = active
      if (active) return
      const waiters = gestureWaiters
      gestureWaiters = new Set()
      for (const resume of waiters) resume()
      tryWrite()
    },

    /** The background write: at once, past the interval and any gesture. It
     *  still waits for the stored read. Settles with the write, never rejects. */
    flushNow(): Promise<void> {
      if (writeTimer != null) {
        clearTimeout(writeTimer)
        writeTimer = null
      }
      writeDue = false
      if (!dirty) return writeChain
      if (readLanded) return startWrite()
      return startRead().then(() =>
        readLanded && dirty ? startWrite() : writeChain,
      )
    },

    /** Module singletons outlive a test file; this clears one. */
    reset(): void {
      if (writeTimer != null) clearTimeout(writeTimer)
      writeTimer = null
      verdicts = new Map()
      consecutiveFailures = 0
      failedBytes = 0
      countedThisVisit = new Set()
      gestureActive = false
      const waiters = gestureWaiters
      gestureWaiters = new Set()
      for (const resume of waiters) resume()
      dirty = false
      writeDue = false
      writeChain = Promise.resolve()
      readFlight = null
      readLanded = false
      hydration = null
      epoch += 1
    },
  }
}

let source: ClipTimingSource | null = null

/** The app-wide source. The app version cannot change in a process, so the
 *  first call's version is the one it keeps. */
export function getClipTimingSource(appVersion: string): ClipTimingSource {
  if (source == null) {
    source = createClipTimingSource({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      now: () => new Date(),
      appVersion,
    })
  }
  return source
}
