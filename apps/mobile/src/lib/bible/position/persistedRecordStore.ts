// A small record kept in memory and in one AsyncStorage key (feat-551 KTD5).
// The position store and the settings store share it, after the lastWatched
// store: memory is the authority, and the read is memoized with a time limit.
//
// A live write stays safe from the read (AE15): the read applies only fields
// that no live write set, and a write saves only after a good read, so it
// never saves over an unseen record. A write before any read starts the read.
import { withTimeout } from "../../withTimeout"

export type RecordStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

/** `loading` until the first read settles, with an answer or without one. */
export type RecordStatus = "loading" | "ready"

export type RecordSnapshot<T> = Readonly<T & { status: RecordStatus }>

export type RecordStore<T> = {
  /** The same object until something changes (useSyncExternalStore). */
  getSnapshot(): RecordSnapshot<T>
  /** Also starts the read, once. */
  subscribe(listener: () => void): () => void
  /** Never rejects. After a failed read, the next call reads again. */
  hydrate(): Promise<void>
  /** Sets the fields in memory now; the save follows the rules above. */
  update(patch: Partial<T>): void
  /** Test-only: back to the defaults, with no read and no listeners. */
  reset(): void
}

export type RecordStoreOptions<T> = {
  storageKey: string
  defaults: T
  /** Null for no usable record. A field it cannot read comes back as default. */
  parse: (raw: string | null) => T | null
  /** Null skips the save. */
  serialize: (value: T) => string | null
  hydrateTimeoutMs: number
  storage: RecordStorage
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** One level deep, enough for a verse reference. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  )
}

/** The returned promise never rejects, and a synchronous throw stays here. */
function persistQuietly(operation: () => Promise<unknown>): void {
  try {
    operation().then(
      () => {},
      () => {},
    )
  } catch {
    // Storage is best effort; memory already holds the value.
  }
}

export function createPersistedRecordStore<T extends Record<string, unknown>>(
  options: RecordStoreOptions<T>,
): RecordStore<T> {
  const fields = Object.keys(options.defaults) as (keyof T)[]
  const listeners = new Set<() => void>()
  let value: T = { ...options.defaults }
  let status: RecordStatus = "loading"
  let snapshot: RecordSnapshot<T> = { ...value, status }
  let hydration: Promise<void> | null = null
  /** True after a read that got an answer; only then may a write save. */
  let readDone = false
  /** Fields a live write set before the good read; that read skips them. */
  const liveFields = new Set<keyof T>()
  /** A live write that waits for the good read before it saves. */
  let saveAfterRead = false
  /** A reset during a read makes that read's result stale. */
  let epoch = 0

  function publish() {
    snapshot = { ...value, status }
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // One failing listener must not hold back the others.
      }
    }
  }

  function save() {
    const blob = options.serialize(value)
    if (blob == null) return
    persistQuietly(() => options.storage.setItem(options.storageKey, blob))
  }

  function applyRead(raw: string | null) {
    const stored = options.parse(raw)
    readDone = true
    let changed = status !== "ready"
    status = "ready"
    if (stored) {
      const next = { ...value }
      for (const field of fields) {
        if (liveFields.has(field) || sameValue(value[field], stored[field])) {
          continue
        }
        next[field] = stored[field]
        changed = true
      }
      value = next
    }
    liveFields.clear()
    if (changed) publish()
    if (saveAfterRead) {
      saveAfterRead = false
      save()
    }
  }

  function hydrate(): Promise<void> {
    if (readDone) return Promise.resolve()
    if (hydration != null) return hydration
    const epochAtStart = epoch
    let failed = false
    const flight = (async () => {
      let raw: string | null
      try {
        raw = await withTimeout(
          options.storage.getItem(options.storageKey),
          options.hydrateTimeoutMs,
        )
      } catch {
        failed = true
        if (epoch !== epochAtStart || status === "ready") return
        // The reader opens with what memory holds; a later call reads again.
        status = "ready"
        publish()
        return
      }
      if (epoch === epochAtStart) applyRead(raw)
    })()
    hydration = flight
    // Registered on the flight, not in its body: a synchronous throw would run
    // the release before the assignment above, and wedge the memo.
    const release = () => {
      if (failed && hydration === flight) hydration = null
    }
    void flight.then(release, release)
    return flight
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)
      void hydrate()
      return () => {
        listeners.delete(listener)
      }
    },

    hydrate,

    update(patch) {
      const next = { ...value }
      let changed = false
      for (const field of Object.keys(patch) as (keyof T)[]) {
        const incoming = patch[field]
        if (!(field in options.defaults) || incoming === undefined) continue
        if (!readDone) liveFields.add(field)
        if (sameValue(value[field], incoming)) continue
        next[field] = incoming
        changed = true
      }
      if (changed) {
        value = next
        publish()
      }
      if (readDone) {
        if (changed) save()
        return
      }
      saveAfterRead = true
      void hydrate()
    },

    reset() {
      epoch += 1
      value = { ...options.defaults }
      status = "loading"
      snapshot = { ...value, status }
      hydration = null
      readDone = false
      liveFields.clear()
      saveAfterRead = false
      listeners.clear()
    },
  }
}
