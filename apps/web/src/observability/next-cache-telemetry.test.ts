import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import createRedisHandler from "@fortedigital/nextjs-cache-handler/redis-strings"
import { afterEach, describe, expect, it } from "vitest"

import {
  InstrumentedCacheHandler,
  instrumentStore,
  timedJsonSerializer,
} from "../../cache-handler.mjs"

import {
  NEXT_CACHE_METRICS,
  NEXT_CACHE_TELEMETRY_KEY,
  classifyCacheError,
  createNextCacheTelemetry,
  normalizeCacheKind,
  type NextCacheTelemetry,
  type TracerLike,
} from "./next-cache-telemetry"

type Emitted = { metric: string; value: number; tags: Record<string, string> }

type RecordedSpan = {
  name: string
  resource: string
  tags: Record<string, unknown>
}

function recorder() {
  const emitted: Emitted[] = []
  const spans: RecordedSpan[] = []
  const tracer: TracerLike = {
    trace(name, options, fn) {
      const span: RecordedSpan = {
        name,
        resource: options.resource,
        tags: { ...options.tags },
      }
      spans.push(span)
      return fn({ setTag: (key, value) => (span.tags[key] = value) })
    },
  }
  const telemetry = createNextCacheTelemetry({
    distribution: (metric, value, tags) =>
      emitted.push({ metric, value, tags }),
    tags: { replica_id: "replica-a" },
    tracer,
  })
  return { emitted, spans, telemetry }
}

function install(telemetry: NextCacheTelemetry | undefined) {
  ;(globalThis as Record<symbol, unknown>)[NEXT_CACHE_TELEMETRY_KEY] = telemetry
}

afterEach(() => install(undefined))

const PREFIX = "test:"

function storedEntry(payload: unknown) {
  return JSON.stringify({
    lastModified: Date.now(),
    lifespan: null,
    tags: [],
    value: { kind: "FETCH", data: payload },
  })
}

// Minimal node-redis surface used by the real redis-strings store. Each
// command resolves after `delayMs`, standing in for Redis round trips whose
// callbacks wait on the shared event loop.
function fakeRedis(stored: string | null, delayMs = 0, hangGet = false) {
  const later = <T>(value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), delayMs))
  return {
    isReady: true,
    get: () => (hangGet ? new Promise<never>(() => {}) : later(stored)),
    hExists: () => later(true),
    hmGet: (_key: string, fields: string[]) => later(fields.map(() => null)),
    unlink: () => later(1),
  }
}

function redisStore(client: ReturnType<typeof fakeRedis>, timeoutMs = 5_000) {
  return instrumentStore(
    createRedisHandler({
      // The fake implements only the commands a cache read issues.
      client: client as unknown as Parameters<
        typeof createRedisHandler
      >[0]["client"],
      keyPrefix: PREFIX,
      timeoutMs,
      valueSerializer: timedJsonSerializer,
    }),
  )
}

// The base CacheHandler turns a store error into a miss. Reproduce that so the
// span sees what Next sees: a null value.
async function swallowingGet(
  store: ReturnType<typeof redisStore>,
  key: string,
) {
  try {
    // Next always sends the route's implicit tags, which forces the HMGET.
    return await store.get(key, { implicitTags: ["_N_T_/layout"] })
  } catch {
    return null
  }
}

describe("next cache telemetry primitives", () => {
  it("keeps cache kinds to a fixed vocabulary", () => {
    expect(normalizeCacheKind("APP_PAGE")).toBe("app_page")
    expect(normalizeCacheKind("FETCH")).toBe("fetch")
    expect(normalizeCacheKind("/watch/some-slug")).toBe("other")
    expect(normalizeCacheKind(undefined)).toBe("other")
  })

  it("classifies the cache handler's real error shapes", () => {
    expect(classifyCacheError(new Error("Operation aborted"))).toBe("aborted")
    expect(
      classifyCacheError(
        new Error(
          "Redis client is not ready yet or connection is lost. Keep trying...",
        ),
      ),
    ).toBe("not_ready")
    expect(classifyCacheError(new DOMException("t", "TimeoutError"))).toBe(
      "timeout",
    )
    expect(classifyCacheError(new Error("ECONNRESET"))).toBe("other")
  })
})

describe("cache read attribution", () => {
  it("splits a slow HIT into waiting time and codec time", async () => {
    const { emitted, spans, telemetry } = recorder()
    install(telemetry)
    const store = redisStore(fakeRedis(storedEntry({ ok: true }), 60))

    const value = await telemetry.measure("get", "FETCH", () =>
      swallowingGet(store, "key-a"),
    )

    expect(value).not.toBeNull()
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      name: "next.cache.get",
      resource: "get fetch",
      tags: { "next_cache.kind": "fetch", "next_cache.outcome": "hit" },
    })
    const duration = emitted.find(
      (entry) => entry.metric === NEXT_CACHE_METRICS.getDurationMs,
    )
    // GET, HEXISTS and HMGET run one after another: three waits of 60 ms.
    expect(duration?.value).toBeGreaterThanOrEqual(170)
    expect(spans[0].tags["next_cache.codec_ms"]).toBeLessThan(20)
    expect(duration?.tags).toEqual({
      replica_id: "replica-a",
      kind: "fetch",
      outcome: "hit",
    })
  })

  it("attributes a large entry's time to JSON decoding", async () => {
    const { spans, telemetry } = recorder()
    install(telemetry)
    const payload = Array.from({ length: 150_000 }, (_, index) => ({
      index,
      title: `title-${index}`,
    }))
    const store = redisStore(fakeRedis(storedEntry(payload)))

    await telemetry.measure("get", "FETCH", () => swallowingGet(store, "key-b"))

    expect(spans[0].tags["next_cache.codec_ms"]).toBeGreaterThan(5)
    expect(spans[0].tags["next_cache.value_length"]).toBeGreaterThan(4_000_000)
  })

  it("reports a timed-out read as an error, not as the miss Next sees", async () => {
    const { emitted, spans, telemetry } = recorder()
    install(telemetry)
    // Real redis-strings timeout path: its AbortSignal fires and the store
    // rejects with the library's own "Operation aborted" Error.
    const store = redisStore(fakeRedis(null, 0, true), 20)

    const value = await telemetry.measure("get", "APP_PAGE", () =>
      swallowingGet(store, "key-c"),
    )

    expect(value).toBeNull()
    expect(spans[0].tags).toMatchObject({
      "next_cache.outcome": "error",
      "next_cache.error_reason": "aborted",
    })
    expect(emitted[0].tags).toMatchObject({
      kind: "app_page",
      outcome: "error",
      error_reason: "aborted",
    })
  })

  it("separates an absent entry from one discarded after it was found", async () => {
    const { spans, telemetry } = recorder()
    install(telemetry)
    const absent = redisStore(fakeRedis(null))

    await telemetry.measure("get", "APP_PAGE", () => swallowingGet(absent, "k"))
    // The base handler drops an entry past its lifespan after the store read.
    await telemetry.measure("get", "APP_PAGE", async () => {
      await swallowingGet(redisStore(fakeRedis(storedEntry({}))), "k")
      return null
    })

    expect(spans.map((span) => span.tags["next_cache.outcome"])).toEqual([
      "miss",
      "expired",
    ])
  })

  it("never puts the cache key into tags", async () => {
    const { emitted, spans, telemetry } = recorder()
    install(telemetry)
    const store = redisStore(fakeRedis(storedEntry({})))

    await telemetry.measure("get", "FETCH", () =>
      swallowingGet(store, "/watch/jesus.html/english.html"),
    )

    const serialized = JSON.stringify({ emitted, spans })
    expect(serialized).not.toContain("jesus")
    expect(serialized).not.toContain(PREFIX)
  })
})

describe("InstrumentedCacheHandler", () => {
  it("passes through untouched when telemetry is not installed", async () => {
    const handler = new InstrumentedCacheHandler({
      dev: false,
      serverDistDir: mkdtempSync(join(tmpdir(), "forge-cache-")),
    })
    await expect(
      handler.get("missing", { kind: "FETCH", softTags: [] }),
    ).resolves.toBeNull()
  })

  it("opens one span per Next cache call with Next's cache kind", async () => {
    const { spans, telemetry } = recorder()
    install(telemetry)
    const handler = new InstrumentedCacheHandler({
      dev: false,
      serverDistDir: mkdtempSync(join(tmpdir(), "forge-cache-")),
    })

    await handler.set(
      "fetch-key",
      {
        kind: "FETCH",
        data: { body: "{}", headers: {}, url: "x" },
        revalidate: 60,
      },
      { revalidate: 60, tags: [] },
    )
    const value = await handler.get("fetch-key", {
      kind: "FETCH",
      softTags: [],
    })

    expect(value).not.toBeNull()
    expect(
      spans.map((span) => [span.name, span.tags["next_cache.outcome"]]),
    ).toEqual([
      ["next.cache.set", "ok"],
      ["next.cache.get", "hit"],
    ])
    expect(spans[1].tags["next_cache.kind"]).toBe("fetch")
  })
})

describe("production Redis store wiring", () => {
  // createCacheHandlerConfig() only builds the Redis store when REDIS_URL
  // connects, which unit tests never do. Pin the source so the timed
  // serializer and the error-recording wrapper cannot silently drop out.
  it("builds the Redis store through instrumentStore with the timed serializer", async () => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile(
      new URL("../../cache-handler.mjs", import.meta.url),
      "utf8",
    )
    const call = source.match(
      /const redisCache = instrumentStore\(\s*createRedisHandler\(\{([^}]*)\}\)/,
    )

    expect(call?.[1]).toMatch(/valueSerializer:\s*timedJsonSerializer/)
    expect(source).toMatch(/handlers:\s*\[redisCache\]/)
  })
})
