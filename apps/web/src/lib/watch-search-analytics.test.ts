import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv, sendDatadogStructuredLog } = vi.hoisted(() => ({
  mockEnv: {
    WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT: true,
  },
  sendDatadogStructuredLog: vi.fn(),
}))

vi.mock("server-only", () => ({}))

vi.mock("next/server", () => ({
  after: vi.fn((callback: () => void) => callback()),
}))

vi.mock("@/env", () => ({
  env: mockEnv,
}))

vi.mock("@/observability/datadog-logs", () => ({
  sendDatadogStructuredLog,
}))

import {
  buildWatchSearchAnalyticsLogEvent,
  scheduleWatchSearchAnalyticsEvent,
} from "./watch-search-analytics"
import {
  WATCH_SEARCH_ANALYTICS_SURFACE,
  type WatchSearchAnalyticsContext,
} from "./watch-search-analytics-contract"

describe("buildWatchSearchAnalyticsLogEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT = true
  })

  it("keeps exact query text only in watch_search.query", () => {
    const event = buildWatchSearchAnalyticsLogEvent({
      latencyMs: 12,
      outcome: "completed",
      query: "person@example.com",
      requestType: "search",
      responseSearchMode: "hybrid",
      resultCount: 3,
      resultSource: "semantic",
      searchRequestId: "search_12345678",
      surface: WATCH_SEARCH_ANALYTICS_SURFACE,
    })

    expect(event).not.toBeNull()
    expect(event?.message).toBe("watch_search analytics")
    expect(event?.message).not.toContain("person@example.com")
    expect(event?.attributes["watch_search.query"]).toBe("person@example.com")
    const attributesWithQuery = Object.entries(event?.attributes ?? {}).filter(
      ([, value]) => value === "person@example.com",
    )
    expect(attributesWithQuery.map(([key]) => key)).toEqual([
      "watch_search.query",
    ])
  })

  it("drops non-Watch surfaces", () => {
    expect(
      buildWatchSearchAnalyticsLogEvent({
        outcome: "completed",
        query: "Jesus",
        resultCount: 1,
        surface: "demo-search",
      }),
    ).toBeNull()
  })

  it("omits exact query text when the rollback flag is disabled", () => {
    mockEnv.WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT = false

    const event = buildWatchSearchAnalyticsLogEvent({
      outcome: "completed",
      query: "Jesus",
      resultCount: 1,
      searchRequestId: "search_12345678",
      surface: WATCH_SEARCH_ANALYTICS_SURFACE,
    })

    expect(event?.attributes["watch_search.exact_query_included"]).toBe(false)
    expect(event?.attributes).not.toHaveProperty("watch_search.query")
  })

  it("sanitizes optional Watch context without copying identity-like fields", () => {
    const event = buildWatchSearchAnalyticsLogEvent({
      detectedQueryLanguage: "es",
      offset: 10,
      outcome: "no_result",
      query: "Jesus",
      requestType: "load_more",
      resultCount: 0,
      searchRequestId: "search_12345678",
      surface: WATCH_SEARCH_ANALYTICS_SURFACE,
      watchContext: {
        pageRoute: "/watch/jesus.html/english.html?email=a@example.com",
        playbackPositionSeconds: 12.5,
        referrerOrigin: "https://viewer@example.com/path?token=secret#fragment",
        routeLanguageSlug: "english",
        videoId: "video_123456",
        videoSlug: "jesus",
      },
    })

    expect(event?.attributes).toMatchObject({
      "watch_context.page_route": "/watch/jesus.html/english.html",
      "watch_context.playback_position_seconds": 12.5,
      "watch_context.referrer_origin": "https://example.com",
      "watch_context.route_language_slug": "english",
      "watch_context.video_id": "video_123456",
      "watch_context.video_slug": "jesus",
      "watch_search.detected_query_language": "es",
    })
    expect(event?.attributes).not.toHaveProperty("email")
    expect(event?.attributes).not.toHaveProperty("token")
  })

  it("drops unsafe Watch context values and unknown context keys", () => {
    const watchContext = {
      email: "person@example.com",
      token: "secret-token",
      videoId: "person@example.com",
      videoSlug: "jesus\nfilm",
    } as unknown as WatchSearchAnalyticsContext

    const event = buildWatchSearchAnalyticsLogEvent({
      outcome: "completed",
      query: "Jesus",
      resultCount: 1,
      searchRequestId: "search_12345678",
      surface: WATCH_SEARCH_ANALYTICS_SURFACE,
      watchContext,
    })

    expect(event?.attributes).not.toHaveProperty("watch_context.email")
    expect(event?.attributes).not.toHaveProperty("watch_context.token")
    expect(event?.attributes).not.toHaveProperty("watch_context.video_id")
    expect(event?.attributes).not.toHaveProperty("watch_context.video_slug")
  })
})

describe("scheduleWatchSearchAnalyticsEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT = true
  })

  it("schedules the Datadog send without awaiting the sender promise", () => {
    const pending = new Promise<void>(() => {})
    const send = vi.fn(() => pending)
    const afterFn = vi.fn((callback: () => void) => callback())

    expect(() =>
      scheduleWatchSearchAnalyticsEvent(
        {
          outcome: "completed",
          query: "Jesus",
          resultCount: 1,
          searchRequestId: "search_12345678",
          surface: WATCH_SEARCH_ANALYTICS_SURFACE,
        },
        { afterFn, send },
      ),
    ).not.toThrow()

    expect(afterFn).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("swallows scheduler and sender failures", () => {
    expect(() =>
      scheduleWatchSearchAnalyticsEvent(
        {
          outcome: "failed",
          query: "Jesus",
          searchRequestId: "search_12345678",
          surface: WATCH_SEARCH_ANALYTICS_SURFACE,
        },
        {
          afterFn: () => {
            throw new Error("after failed")
          },
        },
      ),
    ).not.toThrow()

    expect(() =>
      scheduleWatchSearchAnalyticsEvent(
        {
          outcome: "failed",
          query: "Jesus",
          searchRequestId: "search_12345678",
          surface: WATCH_SEARCH_ANALYTICS_SURFACE,
        },
        {
          afterFn: (callback) => callback(),
          send: () => {
            throw new Error("send failed")
          },
        },
      ),
    ).not.toThrow()
  })

  it("swallows async sender rejections", async () => {
    const send = vi.fn(() => Promise.reject(new Error("send failed")))

    expect(() =>
      scheduleWatchSearchAnalyticsEvent(
        {
          outcome: "completed",
          query: "Jesus",
          resultCount: 1,
          searchRequestId: "search_12345678",
          surface: WATCH_SEARCH_ANALYTICS_SURFACE,
        },
        {
          afterFn: (callback) => callback(),
          send,
        },
      ),
    ).not.toThrow()

    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("uses the structured Datadog sender by default", () => {
    scheduleWatchSearchAnalyticsEvent({
      outcome: "completed",
      query: "Jesus",
      resultCount: 1,
      searchRequestId: "search_12345678",
      surface: WATCH_SEARCH_ANALYTICS_SURFACE,
    })

    expect(sendDatadogStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "watch_search analytics",
        attributes: expect.objectContaining({
          "watch_search.query": "Jesus",
        }),
      }),
    )
  })
})
