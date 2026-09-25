// One LRU of parsed cues per network subtitle track (KTD20). The watch-page
// captions and the Explore clip engine share it, so a track loads once.

import { parseVtt, type VttCue } from "./parseVtt"
import { validateActionUrl } from "./validateUrl"

// UTF-8 bytes per track. Size it as the largest production feature-film track
// in characters x 3 bytes per character. 1.5 MB is KTD20's start value.
export const VTT_MAX_BYTES = 1_500_000
/** One budget for the request and the whole body read. */
export const VTT_FETCH_TIMEOUT_MS = 8_000
/** Pinned and loading tracks are never evicted, so they can exceed this. */
export const VTT_CACHE_MAX_TRACKS = 12

export type VttFailureReason =
  | "unsafe_url"
  | "timeout"
  | "network_error"
  | "over_cap"
  | "parse_empty"
  | "aborted"
  | `http_${number}`

export type VttLoadSuccess = {
  readonly ok: true
  /** Sorted by start. Shared by every reader, so never mutate it. */
  readonly cues: readonly VttCue[]
  readonly bytes: number
}

export type VttLoadFailure = {
  readonly ok: false
  readonly reason: VttFailureReason
  /** True when the track itself is unusable; false when a later try can pass. */
  readonly definitive: boolean
  readonly bytes: number
}

export type VttLoadResult = VttLoadSuccess | VttLoadFailure

/** A typed slot for data derived from one track. Each name must map to one type. */
export type VttDerivedKey<T> = { readonly name: string; readonly __value?: T }

type PendingEntry = {
  state: "pending"
  flight: Promise<VttLoadResult>
  controller: AbortController
  readers: number
}
type LoadedEntry = {
  state: "loaded"
  result: VttLoadSuccess
  derived: Map<string, unknown>
}
type FailedEntry = { state: "failed"; result: VttLoadFailure }
type Entry = PendingEntry | LoadedEntry | FailedEntry

// Map order is recency: the first key is the least recently used.
const entries = new Map<string, Entry>()
const pins = new Map<string, number>()

function failure(
  reason: VttFailureReason,
  definitive: boolean,
  bytes = 0,
): VttLoadFailure {
  return { ok: false, reason, definitive, bytes }
}

// A 4xx says the track is not there. A 408, a 429, or a 5xx can pass later.
function isDefinitiveStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

type CappedBody =
  | { overCap: false; bytes: number; text: string }
  | { overCap: true; bytes: number }

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<CappedBody> {
  const stream = response.body
  if (!stream) {
    // RN's own fetch (the EXPO_PUBLIC_USE_RN_FETCH opt-out) has no body stream.
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxBytes) {
      return { overCap: true, bytes: buffer.byteLength }
    }
    const text = new TextDecoder().decode(buffer)
    return { overCap: false, bytes: buffer.byteLength, text }
  }
  const decoder = new TextDecoder()
  const parts: string[] = []
  let bytes = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      // Count real bytes, never Content-Length. Cancel (not break) stops the download.
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { overCap: true, bytes }
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return { overCap: false, bytes, text: parts.join("") }
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // releaseLock throws while a read is pending; cleanup must not throw.
    }
  }
}

async function fetchTrack(
  vttSrc: string,
  controller: AbortController,
): Promise<VttLoadResult> {
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, VTT_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(vttSrc, { signal: controller.signal })
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      return failure(
        `http_${response.status}`,
        isDefinitiveStatus(response.status),
      )
    }
    const body = await readCapped(response, VTT_MAX_BYTES)
    if (body.overCap) return failure("over_cap", true, body.bytes)
    const cues = parseVtt(body.text).sort((a, b) => a.start - b.start)
    if (cues.length === 0) return failure("parse_empty", true, body.bytes)
    return { ok: true, cues, bytes: body.bytes }
  } catch {
    // Never read the error: a decode or parse message can carry body text.
    if (timedOut) return failure("timeout", false)
    return failure(
      controller.signal.aborted ? "aborted" : "network_error",
      false,
    )
  } finally {
    clearTimeout(timer)
  }
}

function touch(vttSrc: string, entry: Entry): void {
  entries.delete(vttSrc)
  entries.set(vttSrc, entry)
}

function evictOverflow(): void {
  for (const [src, entry] of entries) {
    if (entries.size <= VTT_CACHE_MAX_TRACKS) return
    if (entry.state !== "pending" && !pins.has(src)) entries.delete(src)
  }
}

function settle(
  vttSrc: string,
  entry: PendingEntry,
  result: VttLoadResult,
): VttLoadResult {
  // A flight whose readers all left no longer owns the slot; a newer one may.
  if (entries.get(vttSrc) !== entry) return result
  if (result.ok) {
    entries.set(vttSrc, { state: "loaded", result, derived: new Map() })
  } else if (result.definitive) {
    entries.set(vttSrc, { state: "failed", result })
  } else {
    entries.delete(vttSrc)
  }
  evictOverflow()
  return result
}

function startFlight(vttSrc: string): PendingEntry {
  const controller = new AbortController()
  const entry: PendingEntry = {
    state: "pending",
    controller,
    readers: 0,
    flight: fetchTrack(vttSrc, controller).then(
      (result) => settle(vttSrc, entry, result),
      () => settle(vttSrc, entry, failure("network_error", false)),
    ),
  }
  entries.set(vttSrc, entry)
  evictOverflow()
  return entry
}

function attachReader(
  vttSrc: string,
  entry: PendingEntry,
  signal: AbortSignal | undefined,
): Promise<VttLoadResult> {
  entry.readers += 1
  if (!signal) return entry.flight
  return new Promise((resolve) => {
    const onAbort = () => {
      resolve(failure("aborted", false))
      entry.readers -= 1
      // Only the last reader to leave cancels the request.
      if (entry.readers === 0 && entries.get(vttSrc) === entry) {
        entries.delete(vttSrc)
        entry.controller.abort()
      }
    }
    const finish = (result: VttLoadResult) => {
      signal.removeEventListener("abort", onAbort)
      resolve(result)
    }
    signal.addEventListener("abort", onAbort, { once: true })
    entry.flight.then(finish, () => finish(failure("network_error", false)))
  })
}

/** Parsed, sorted cues for a network track. Never rejects. */
export async function loadVttCues(
  vttSrc: string,
  /** An abort detaches only this reader; a fetch that others share goes on. */
  options: { signal?: AbortSignal } = {},
): Promise<VttLoadResult> {
  try {
    const { signal } = options
    if (signal?.aborted) return failure("aborted", false)
    // Refuses `file:` too, so a downloaded track never enters the cache.
    if (!validateActionUrl(vttSrc)) return failure("unsafe_url", true)
    const existing = entries.get(vttSrc)
    if (existing) touch(vttSrc, existing)
    if (existing && existing.state !== "pending") return existing.result
    return await attachReader(vttSrc, existing ?? startFlight(vttSrc), signal)
  } catch {
    return failure("network_error", false)
  }
}

/** The loaded cues for a track, without a fetch and without a change to recency. */
export function peekVttCues(vttSrc: string): readonly VttCue[] | undefined {
  const entry = entries.get(vttSrc)
  return entry?.state === "loaded" ? entry.result.cues : undefined
}

/** Holds a track through eviction until the returned release runs. Pins count. */
export function pinVtt(vttSrc: string): () => void {
  pins.set(vttSrc, (pins.get(vttSrc) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (pins.get(vttSrc) ?? 1) - 1
    if (left > 0) pins.set(vttSrc, left)
    else pins.delete(vttSrc)
  }
}

export function vttDerivedKey<T>(name: string): VttDerivedKey<T> {
  return { name }
}

export function getVttDerived<T>(
  vttSrc: string,
  key: VttDerivedKey<T>,
): T | undefined {
  const entry = entries.get(vttSrc)
  if (entry?.state !== "loaded") return undefined
  return entry.derived.get(key.name) as T | undefined
}

/** Stores data derived from a loaded track. False when the track is not loaded. */
export function setVttDerived<T>(
  vttSrc: string,
  key: VttDerivedKey<T>,
  value: T,
): boolean {
  const entry = entries.get(vttSrc)
  if (entry?.state !== "loaded") return false
  entry.derived.set(key.name, value)
  return true
}

export function resetVttCacheForTests(): void {
  for (const entry of entries.values()) {
    if (entry.state === "pending") entry.controller.abort()
  }
  entries.clear()
  pins.clear()
}
