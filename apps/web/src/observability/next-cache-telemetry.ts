import { AsyncLocalStorage } from "node:async_hooks"
import { performance } from "node:perf_hooks"

import type { MetricTags } from "./scheduler-pressure"

// A Watch response served as `x-nextjs-cache: HIT` can still take tens of
// seconds, and its trace shows no span for that time: dd-trace does not trace
// this Redis client and the cache handler hides its own work. Each Next cache
// read or write becomes a `next.cache.get` / `next.cache.set` span (a child of
// the request span) carrying its outcome and JSON parse/stringify elapsed time,
// plus a duration distribution per kind and outcome (feat-745). The rest of a
// span's duration is unattributed: Redis round trips, base64 conversion, tag
// checks, scheduling delay and this telemetry all land there.
//
// Telemetry is observational. A throwing emitter, span or tracer must never
// change a cache result or replace a cache error, so every hook is guarded.
//
// `cache-handler.mjs` cannot import application modules, so it reaches this
// recorder through a process-global symbol that `configureDatadog()` installs.
// Without it every hook is a no-op and cache behaviour is unchanged.

export const NEXT_CACHE_TELEMETRY_KEY = Symbol.for(
  "forge.web.nextCacheTelemetry",
)

export const NEXT_CACHE_METRICS = {
  getDurationMs: "forge.web.next_cache.get.duration_ms",
  setDurationMs: "forge.web.next_cache.set.duration_ms",
  codecMs: "forge.web.next_cache.codec_ms",
} as const

export type NextCacheMetric =
  (typeof NEXT_CACHE_METRICS)[keyof typeof NEXT_CACHE_METRICS]

type Operation = "get" | "set"
// `expired`: Redis returned an entry that the handler then discarded as past
// its lifespan, so Next renders it as a MISS.
type Outcome = "hit" | "miss" | "expired" | "ok" | "error"
type ErrorReason = "aborted" | "not_ready" | "timeout" | "other"
type CodecDirection = "decode" | "encode"

const KNOWN_KINDS = new Set([
  "APP_PAGE",
  "APP_ROUTE",
  "FETCH",
  "IMAGE",
  "PAGES",
  "REDIRECT",
])

// Literal messages thrown by @fortedigital/nextjs-cache-handler 3.2.1. Its
// per-command `AbortSignal.timeout(5000)` surfaces through `withAbortSignal`
// as a plain Error, so the message is the only discriminator it offers.
const ABORT_MESSAGES = new Set(["Operation aborted", "Aborted"])
const NOT_READY_PREFIX = "Redis client is not ready"

type SpanLike = { setTag(key: string, value: unknown): unknown }

export type TracerLike = {
  trace<T>(
    name: string,
    options: { resource: string; tags: Record<string, string> },
    fn: (span: SpanLike) => T,
  ): T
}

type OperationRecord = {
  op: Operation
  kind: string
  storeFound?: boolean
  errorReason?: ErrorReason
  codecMs: number
  valueLength?: number
}

export type NextCacheTelemetry = {
  measure<T>(
    op: Operation,
    kind: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T>
  noteResult(found: boolean): void
  noteError(error: unknown): void
  noteCodec(direction: CodecDirection, ms: number, valueLength: number): void
}

type NextCacheTelemetryOptions = {
  distribution: (
    metric: NextCacheMetric,
    value: number,
    tags: MetricTags,
  ) => void
  tags?: MetricTags
  tracer?: TracerLike
  now?: () => number
}

export function normalizeCacheKind(kind: unknown): string {
  return typeof kind === "string" && KNOWN_KINDS.has(kind)
    ? kind.toLowerCase()
    : "other"
}

export function classifyCacheError(error: unknown): ErrorReason {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "timeout"
    if (ABORT_MESSAGES.has(error.message)) return "aborted"
    if (error.message.startsWith(NOT_READY_PREFIX)) return "not_ready"
  }
  return "other"
}

function observe(action: () => void): void {
  try {
    action()
  } catch {
    // Dropped on purpose: see the module comment.
  }
}

export function createNextCacheTelemetry(
  options: NextCacheTelemetryOptions,
): NextCacheTelemetry {
  const storage = new AsyncLocalStorage<OperationRecord>()
  const now = options.now ?? (() => performance.now())
  const baseTags = options.tags ?? {}

  async function run<T>(
    record: OperationRecord,
    fn: () => Promise<T>,
    span?: SpanLike,
  ): Promise<T> {
    const startMs = now()
    let outcome: Outcome = "error"
    try {
      const result = await storage.run(record, fn)
      // The handler swallows its own Redis errors and reports a miss, so an
      // error noted inside the store wins over the result it returned.
      if (!record.errorReason) {
        if (record.op === "set") outcome = "ok"
        else if (result) outcome = "hit"
        else outcome = record.storeFound ? "expired" : "miss"
      }
      return result
    } catch (error) {
      record.errorReason ??= classifyCacheError(error)
      throw error
    } finally {
      observe(() => {
        const durationMs = now() - startMs
        const tags: MetricTags = { ...baseTags, kind: record.kind, outcome }
        if (record.errorReason) tags.error_reason = record.errorReason

        span?.setTag("next_cache.outcome", outcome)
        span?.setTag("next_cache.codec_ms", record.codecMs)
        if (record.errorReason) {
          span?.setTag("next_cache.error_reason", record.errorReason)
        }
        if (record.valueLength !== undefined) {
          span?.setTag("next_cache.value_length", record.valueLength)
        }

        options.distribution(
          record.op === "get"
            ? NEXT_CACHE_METRICS.getDurationMs
            : NEXT_CACHE_METRICS.setDurationMs,
          durationMs,
          tags,
        )
      })
    }
  }

  return {
    measure<T>(op: Operation, kind: string | undefined, fn: () => Promise<T>) {
      const record: OperationRecord = {
        op,
        kind: normalizeCacheKind(kind),
        codecMs: 0,
      }
      const tracer = options.tracer
      if (!tracer) return run(record, fn)
      // If the tracer throws, return the cache operation it already started,
      // or start it untraced; never run it twice.
      let started: Promise<T> | undefined
      try {
        // One-argument callback: dd-trace treats a two-argument callback as
        // callback-style and would wait for `done()`.
        const traced = tracer.trace(
          `next.cache.${op}`,
          {
            resource: `${op} ${record.kind}`,
            tags: { "next_cache.kind": record.kind },
          },
          (span) => (started = run(record, fn, span)),
        )
        if (!started) return traced
        // Return the cache operation itself, not the tracer's wrapper, so a
        // failure while finishing the span cannot reject a good result. The
        // wrapper's own rejection is then handled here.
        if (traced !== started) traced.then(undefined, () => undefined)
        return started
      } catch {
        return started ?? run(record, fn)
      }
    },
    noteResult(found) {
      const record = storage.getStore()
      if (record) record.storeFound = found
    },
    noteError(error) {
      const record = storage.getStore()
      if (record) record.errorReason = classifyCacheError(error)
    },
    noteCodec(direction, ms, valueLength) {
      const record = storage.getStore()
      if (record) {
        record.codecMs += ms
        record.valueLength = valueLength
      }
      observe(() =>
        options.distribution(NEXT_CACHE_METRICS.codecMs, ms, {
          ...baseTags,
          direction,
          kind: record?.kind ?? "other",
        }),
      )
    },
  }
}

type TelemetryGlobal = typeof globalThis & {
  [NEXT_CACHE_TELEMETRY_KEY]?: NextCacheTelemetry
}

/** Production-only wiring used by `configureDatadog()`. */
export function installNextCacheTelemetry(
  options: NextCacheTelemetryOptions,
): void {
  if (process.env.NODE_ENV !== "production") return
  if (process.env.FORGE_NEXT_CACHE_TELEMETRY === "false") return
  const global = globalThis as TelemetryGlobal
  global[NEXT_CACHE_TELEMETRY_KEY] ??= createNextCacheTelemetry(options)
}
