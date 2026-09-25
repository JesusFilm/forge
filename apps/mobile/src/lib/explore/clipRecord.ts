/**
 * Explore clip record (KTD15): the clips shown in the last 7 days (R29) and the
 * last visit date (KTD17). Memory is authoritative, and storage follows it. No
 * write starts before the stored read lands, so no write drops stored entries.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import { withTimeout } from "../withTimeout"

export const CLIP_RECORD_STORAGE_KEY = "explore-clip-record"

/** Bump when the persisted shape changes — old records then read as empty. */
export const CLIP_RECORD_VERSION = 1

/** R28: an entry older than 7 days counts as absent. */
export const CLIP_RECORD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const CLIP_RECORD_MAX_ENTRIES = 2000

export const CLIP_RECORD_WRITE_INTERVAL_MS = 5000

/** The first clip waits for hydration, so a hung read must not hold it. */
export const CLIP_RECORD_HYDRATE_TIMEOUT_MS = 400

/** Ids and slugs come from admin. Bound them so one bad row cannot grow the blob. */
export const CLIP_RECORD_MAX_ID_LENGTH = 200

const DAY_MS = 24 * 60 * 60 * 1000

export type ClipRecordEntry = {
  videoId: string
  /** The feed language the clip played in. R31 releases per language. */
  languageSlug: string
  startSeconds: number
  endSeconds: number
  /** Epoch ms when the clip started to play. */
  shownAt: number
}

export type ClipRecordInput = Omit<ClipRecordEntry, "shownAt">

export type RecordedWindow = { startSeconds: number; endSeconds: number }

export type ClipRecordSnapshot = {
  /** Oldest first. */
  entries: ClipRecordEntry[]
  /** The device's local date of the last Explore visit, as `YYYY-MM-DD`. */
  lastVisitDate: string | null
}

/** [video index, language index, start ms, end ms, shown-at ms] */
type StoredEntry = [number, number, number, number, number]

/** Each video id and language is written once; entries point at them by index. */
type StoredClipRecord = {
  v: number
  d: string | null
  ids: string[]
  langs: string[]
  e: StoredEntry[]
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/** The device's local calendar date, as `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(
    date.getMonth() + 1,
  )}-${pad2(date.getDate())}`
}

function dateKeyToDayNumber(key: string): number | null {
  const match = DATE_KEY.exec(key)
  if (match == null) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month, day))
  // Date.UTC rolls 2026-02-30 over to March; a real date survives unchanged.
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month ||
    utc.getUTCDate() !== day
  ) {
    return null
  }
  return utc.getTime() / DAY_MS
}

/**
 * Whole calendar days from `earlier` to `later`, or null for a malformed key.
 * Counted on UTC midnights, so a daylight-saving change cannot add or lose a day.
 */
export function daysBetweenDateKeys(
  earlier: string,
  later: string,
): number | null {
  const from = dateKeyToDayNumber(earlier)
  const to = dateKeyToDayNumber(later)
  if (from == null || to == null) return null
  return to - from
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && dateKeyToDayNumber(value) != null
}

function isStorableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CLIP_RECORD_MAX_ID_LENGTH
  )
}

function toMs(seconds: number): number {
  return Math.round(seconds * 1000)
}

function isExpired(shownAt: number, nowMs: number): boolean {
  return nowMs - shownAt > CLIP_RECORD_MAX_AGE_MS
}

/** Numbers never hold a colon, so the id after the second colon is unambiguous. */
function clipKey(entry: ClipRecordEntry): string {
  return `${entry.startSeconds}:${entry.endSeconds}:${entry.videoId}`
}

/** Keeps the first copy of each clip, then the newest entries up to the cap. */
function dedupeAndCap(list: ClipRecordEntry[]): ClipRecordEntry[] {
  const seen = new Set<string>()
  const out: ClipRecordEntry[] = []
  for (const entry of list) {
    const key = clipKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out.length > CLIP_RECORD_MAX_ENTRIES
    ? out.slice(out.length - CLIP_RECORD_MAX_ENTRIES)
    : out
}

function decodeEntry(
  tuple: unknown,
  ids: unknown[],
  langs: unknown[],
): ClipRecordEntry | null {
  if (!Array.isArray(tuple) || tuple.length !== 5) return null
  if (!tuple.every(Number.isSafeInteger)) return null
  const [idIndex, langIndex, startMs, endMs, shownAt] = tuple as StoredEntry
  const videoId = ids[idIndex]
  const languageSlug = langs[langIndex]
  if (!isStorableId(videoId) || !isStorableId(languageSlug)) return null
  if (startMs < 0 || endMs <= startMs) return null
  return {
    videoId,
    languageSlug,
    startSeconds: startMs / 1000,
    endSeconds: endMs / 1000,
    shownAt,
  }
}

/**
 * Parse the persisted record. Tolerant: bad JSON, a version change, or a bad
 * shape reads as an empty record, and a single bad entry is dropped. Expired
 * entries are dropped here too.
 */
export function parseStoredClipRecord(
  raw: string | null,
  now: Date,
): ClipRecordSnapshot {
  const empty: ClipRecordSnapshot = { entries: [], lastVisitDate: null }
  if (raw == null) return empty
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return empty
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return empty
  }
  const stored = data as Partial<Record<keyof StoredClipRecord, unknown>>
  if (stored.v !== CLIP_RECORD_VERSION) return empty
  if (
    !Array.isArray(stored.ids) ||
    !Array.isArray(stored.langs) ||
    !Array.isArray(stored.e)
  ) {
    return empty
  }
  const nowMs = now.getTime()
  const decoded: ClipRecordEntry[] = []
  for (const tuple of stored.e) {
    const entry = decodeEntry(tuple, stored.ids, stored.langs)
    if (entry != null && !isExpired(entry.shownAt, nowMs)) decoded.push(entry)
  }
  return {
    entries: dedupeAndCap(decoded),
    lastVisitDate: isDateKey(stored.d) ? stored.d : null,
  }
}

/** Serialize for persistence, oldest first. Expired entries are left out. */
export function serializeClipRecord(
  snapshot: ClipRecordSnapshot,
  now: Date,
): string {
  const nowMs = now.getTime()
  const ids: string[] = []
  const langs: string[] = []
  const idIndex = new Map<string, number>()
  const langIndex = new Map<string, number>()
  const intern = (
    value: string,
    list: string[],
    index: Map<string, number>,
  ): number => {
    let position = index.get(value)
    if (position === undefined) {
      position = list.length
      list.push(value)
      index.set(value, position)
    }
    return position
  }
  const e: StoredEntry[] = []
  for (const entry of snapshot.entries) {
    if (isExpired(entry.shownAt, nowMs)) continue
    e.push([
      intern(entry.videoId, ids, idIndex),
      intern(entry.languageSlug, langs, langIndex),
      toMs(entry.startSeconds),
      toMs(entry.endSeconds),
      Math.round(entry.shownAt),
    ])
  }
  const stored: StoredClipRecord = {
    v: CLIP_RECORD_VERSION,
    d: snapshot.lastVisitDate,
    ids,
    langs,
    e,
  }
  return JSON.stringify(stored)
}

export type ClipRecordStoreDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  now: () => Date
}

export type ClipRecordStore = ReturnType<typeof createClipRecordStore>

/** Settles with the operation and never rejects, even on a synchronous throw.
 *  Resolves true when the operation succeeded. */
function persistQuietly(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    return operation().then(
      () => true,
      () => false,
    )
  } catch {
    return Promise.resolve(false)
  }
}

export function createClipRecordStore(deps: ClipRecordStoreDeps) {
  let entries: ClipRecordEntry[] = []
  let lastVisitDate: string | null = null
  /** Changes whenever any recorded window changes (KTD24 caches on it). */
  let version = 0

  let dirty = false
  let writeTimer: ReturnType<typeof setTimeout> | null = null
  /** The write interval has passed, but a gesture or the first read holds it. */
  let writeDue = false
  let gestureActive = false
  /** Writes land in the order they start, so an older blob never lands last. */
  let writeChain: Promise<void> = Promise.resolve()

  let readFlight: Promise<void> | null = null
  let readLanded = false
  let hydration: Promise<void> | null = null
  /** A reset between a read's start and its landing voids that read. */
  let epoch = 0

  function pruneExpired(): void {
    const nowMs = deps.now().getTime()
    if (!entries.some((entry) => isExpired(entry.shownAt, nowMs))) return
    entries = entries.filter((entry) => !isExpired(entry.shownAt, nowMs))
    version += 1
  }

  function mergeStored(stored: ClipRecordSnapshot): void {
    if (lastVisitDate == null) lastVisitDate = stored.lastVisitDate
    if (stored.entries.length === 0) return
    // Every stored entry predates the entries this launch added.
    entries = dedupeAndCap([...stored.entries, ...entries])
    version += 1
  }

  function startRead(): Promise<void> {
    if (readFlight != null) return readFlight
    const epochAtStart = epoch
    readFlight = (async () => {
      let raw: string | null = null
      try {
        raw = await deps.getItem(CLIP_RECORD_STORAGE_KEY)
      } catch {
        // An unreadable key reads as empty, the same as a corrupt one.
      }
      if (epoch !== epochAtStart) return
      mergeStored(parseStoredClipRecord(raw, deps.now()))
      readLanded = true
      tryWrite()
    })()
    return readFlight
  }

  function startWrite(): Promise<void> {
    dirty = false
    writeDue = false
    const blob = serializeClipRecord({ entries, lastVisitDate }, deps.now())
    writeChain = writeChain.then(async () => {
      const written = await persistQuietly(() =>
        deps.setItem(CLIP_RECORD_STORAGE_KEY, blob),
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
    }, CLIP_RECORD_WRITE_INTERVAL_MS)
  }

  return {
    /**
     * Bounded wait for the stored record, memoized, and it never rejects. A
     * read that outlives the wait keeps going, and it merges when it lands.
     */
    hydrate(): Promise<void> {
      if (hydration != null) return hydration
      hydration = withTimeout(
        startRead(),
        CLIP_RECORD_HYDRATE_TIMEOUT_MS,
      ).catch(() => {})
      return hydration
    },

    /**
     * Records a clip when it starts to play (not at preload). A clip that the
     * record already holds, such as a replay from history, adds nothing.
     * Returns true when it added an entry.
     */
    add(input: ClipRecordInput): boolean {
      const { videoId, languageSlug } = input
      if (!isStorableId(videoId) || !isStorableId(languageSlug)) return false
      if (
        !Number.isFinite(input.startSeconds) ||
        !Number.isFinite(input.endSeconds)
      ) {
        return false
      }
      // Held at the stored precision, so memory and a relaunch agree exactly.
      const startSeconds = toMs(input.startSeconds) / 1000
      const endSeconds = toMs(input.endSeconds) / 1000
      if (startSeconds < 0 || endSeconds <= startSeconds) return false
      pruneExpired()
      const held = entries.some(
        (entry) =>
          entry.videoId === videoId &&
          entry.startSeconds === startSeconds &&
          entry.endSeconds === endSeconds,
      )
      if (held) return false
      entries.push({
        videoId,
        languageSlug,
        startSeconds,
        endSeconds,
        shownAt: deps.now().getTime(),
      })
      if (entries.length > CLIP_RECORD_MAX_ENTRIES) {
        entries.splice(0, entries.length - CLIP_RECORD_MAX_ENTRIES)
      }
      version += 1
      markDirty()
      return true
    },

    /** Unexpired entries, oldest first. */
    getEntries(): readonly ClipRecordEntry[] {
      pruneExpired()
      return entries.slice()
    },

    /** The recorded windows of one video, ordered by start (R29). */
    getWindows(videoId: string): RecordedWindow[] {
      pruneExpired()
      const windows: RecordedWindow[] = []
      for (const entry of entries) {
        if (entry.videoId !== videoId) continue
        windows.push({
          startSeconds: entry.startSeconds,
          endSeconds: entry.endSeconds,
        })
      }
      return windows.sort((a, b) => a.startSeconds - b.startSeconds)
    },

    getVersion(): number {
      pruneExpired()
      return version
    },

    /** R31: removes up to `count` of the oldest entries for one language only.
     *  Returns how many it removed. */
    releaseOldestForLanguage(languageSlug: string, count: number): number {
      pruneExpired()
      const limit = Math.floor(count)
      if (!(limit > 0)) return 0
      let released = 0
      entries = entries.filter((entry) => {
        if (released >= limit || entry.languageSlug !== languageSlug) {
          return true
        }
        released += 1
        return false
      })
      if (released > 0) {
        version += 1
        markDirty()
      }
      return released
    },

    getLastVisitDate(): string | null {
      return lastVisitDate
    },

    /**
     * Stores today's local date as the last visit and returns the date it
     * replaced. Hydrate first: before the read lands, the stored date is unknown.
     */
    recordVisit(): string | null {
      const previous = lastVisitDate
      const today = localDateKey(deps.now())
      if (today !== previous) {
        lastVisitDate = today
        markDirty()
      }
      return previous
    },

    /**
     * KTD22 settle signal. While true, no write starts; a write that came due
     * in that time starts when it turns false.
     */
    setGestureActive(active: boolean): void {
      gestureActive = active
      if (!active) tryWrite()
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
      entries = []
      lastVisitDate = null
      // Moves on rather than back to 0, so a cache keyed on it stays honest.
      version += 1
      dirty = false
      writeDue = false
      gestureActive = false
      writeChain = Promise.resolve()
      readFlight = null
      readLanded = false
      hydration = null
      epoch += 1
    },
  }
}

let store: ClipRecordStore | null = null

/** The app-wide clip record store. */
export function getClipRecordStore(): ClipRecordStore {
  if (store == null) {
    store = createClipRecordStore({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      now: () => new Date(),
    })
  }
  return store
}
