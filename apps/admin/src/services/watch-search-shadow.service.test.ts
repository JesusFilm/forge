import { describe, expect, it, vi } from "vitest"

import type {
  WatchSearchInput,
  WatchSearchResponse,
} from "./watch-search.service"
import {
  runWatchSearchShadow,
  WatchSearchShadowQueue,
  type WatchSearchShadowJob,
} from "./watch-search-shadow.service"

function response(
  overrides: Partial<WatchSearchResponse> = {},
): WatchSearchResponse {
  return {
    query: "jesus",
    results: [],
    hasMore: false,
    nextOffset: 20,
    searchMode: "watch-search-typesense",
    requestId: "web_search_12345678",
    degraded: false,
    latencyMs: 12,
    laneStatuses: [],
    languageInterpretation: {
      queryLanguageSlug: null,
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "english",
      targetLanguageSource: "display",
      displayLanguageSlug: "english",
      routeLanguageSlug: null,
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    },
    ...overrides,
  }
}

function job(
  overrides: Partial<WatchSearchShadowJob> = {},
): WatchSearchShadowJob {
  return {
    input: {
      query: "jesus",
      mode: "modern",
      shadowMode: "default",
      clientRequestId: "web_search_12345678",
    },
    primaryResponse: response(),
    prisma: {} as WatchSearchShadowJob["prisma"],
    service: {
      search: vi.fn(async () => response({ searchMode: "watch-search" })),
    },
    ...overrides,
  }
}

describe("runWatchSearchShadow", () => {
  it("runs DEFAULT with the primary request id and records a linked shadow trace", async () => {
    const primaryResponse = response()
    const search = vi.fn(
      async (input: WatchSearchInput): Promise<WatchSearchResponse> =>
        response({
          requestId: input.clientRequestId ?? "missing",
          searchMode: "watch-search",
        }),
    )
    const recordTrace = vi.fn(async () => ({ ok: true as const }))
    const startedAt = new Date("2026-08-06T04:00:00.000Z")
    const completedAt = new Date("2026-08-06T04:00:00.100Z")
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(startedAt)
      .mockReturnValueOnce(completedAt)

    await runWatchSearchShadow(job({ primaryResponse, service: { search } }), {
      now,
      recordTrace,
    })

    const shadowInput = expect.objectContaining({
      query: "jesus",
      mode: "default",
      shadowMode: null,
      clientRequestId: "web_search_12345678",
    })
    expect(search).toHaveBeenCalledWith(shadowInput)
    expect(recordTrace).toHaveBeenCalledWith(
      {
        input: shadowInput,
        response: expect.objectContaining({
          requestId: "web_search_12345678",
          searchMode: "watch-search",
        }),
        startedAt,
        completedAt,
        traceRole: "shadow",
        shadowOfRequestId: "web_search_12345678",
      },
      expect.anything(),
    )
  })
})

describe("WatchSearchShadowQueue", () => {
  it("starts only after the response lifecycle callback and drops excess work", async () => {
    let resolveWorker!: () => void
    const worker = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWorker = resolve
        }),
    )
    const callbacks: Array<() => Promise<void>> = []
    const queue = new WatchSearchShadowQueue({
      concurrency: 1,
      maxPending: 1,
      worker,
      scheduleAfter: (callback) => callbacks.push(callback),
      logger: { warn: vi.fn() },
    })
    const shadowJob = job()

    expect(queue.enqueue(shadowJob)).toBe(true)
    expect(queue.enqueue(shadowJob)).toBe(false)
    expect(worker).not.toHaveBeenCalled()

    const completion = callbacks[0]?.()
    expect(completion).toBeDefined()
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(1))
    resolveWorker()
    await completion

    expect(queue.enqueue(shadowJob)).toBe(true)
  })

  it("releases its reservation when response-lifecycle scheduling fails", () => {
    const logger = { warn: vi.fn() }
    const callbacks: Array<() => Promise<void>> = []
    const scheduleAfter = vi
      .fn<(callback: () => Promise<void>) => void>()
      .mockImplementationOnce(() => {
        throw new Error("request scope unavailable")
      })
      .mockImplementationOnce((callback) => callbacks.push(callback))
    const queue = new WatchSearchShadowQueue({
      concurrency: 1,
      maxPending: 1,
      worker: vi.fn(async () => undefined),
      scheduleAfter,
      logger,
    })

    expect(queue.enqueue(job())).toBe(false)
    expect(queue.enqueue(job())).toBe(true)
    expect(callbacks).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(
      "[watch-search] event=shadow_schedule_failed error_class=Error",
    )
  })
})
