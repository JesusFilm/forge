/**
 * @vitest-environment jsdom
 *
 * Every assertion here is captured at the `window.gtag` spy with the REAL
 * contract, the real route resolver, and the real scheduling seam in the path.
 * Nothing asserts on a builder's return value: what GA4 receives is the
 * contract, and a green test on an intermediate object would not prove it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://www.jesusfilm.org",
    NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2: true as boolean | undefined,
  },
}))

vi.mock("@/env", () => ({ env: mockEnv }))

import {
  WATCH_ANALYTICS_CONTRACT_VERSION,
  WATCH_ANALYTICS_WIRE_NAMES,
  type WatchAnalyticsEventInput,
  dispatchWatchAnalyticsEvent,
  emitWatchAnalyticsPageView,
  flushWatchAnalyticsDispatches,
  isWatchAnalyticsContractV2Enabled,
  resolveCurrentWatchAnalyticsRouteContext,
  setWatchAnalyticsFrameScheduler,
  watchAnalyticsPositionBucket,
  watchAnalyticsResultCountBucket,
} from "./watch-analytics-contract"
import { resolveWatchAnalyticsRoute } from "./watch-analytics-route"

let gtag: ReturnType<typeof vi.fn>
let frames: Array<() => void>

/** Run every frame callback the seam has queued, the way a real paint would. */
function runFrame() {
  const queued = frames.splice(0, frames.length)
  for (const callback of queued) callback()
}

function gaEvents(): Array<[string, Record<string, unknown>]> {
  return gtag.mock.calls
    .filter(([command]) => command === "event")
    .map(([, name, params]) => [
      name as string,
      (params ?? {}) as Record<string, unknown>,
    ])
}

function lastParams(): Record<string, unknown> {
  const events = gaEvents()
  return events[events.length - 1]?.[1] ?? {}
}

beforeEach(() => {
  mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = true
  gtag = vi.fn()
  window.gtag = gtag
  frames = []
  setWatchAnalyticsFrameScheduler((callback) => {
    frames.push(callback)
  })
  window.history.replaceState({}, "", "/watch/jesus.html/english.html")
})

afterEach(() => {
  setWatchAnalyticsFrameScheduler(null)
  window.gtag = undefined
  vi.unstubAllGlobals()
})

describe("wire names (R25)", () => {
  it("emits the exact legacy strings GA4 receives today", () => {
    expect(WATCH_ANALYTICS_WIRE_NAMES).toEqual({
      player_started: "videostarts",
      player_play: "videoplay",
      player_pause: "video_pause",
      player_milestone_10: "a_media_progress10",
      player_milestone_25: "a_media_progress25",
      player_milestone_50: "a_media_progress50",
      player_milestone_75: "a_media_progress75",
      player_milestone_90: "a_media_progress90",
      player_meaningful_progress: "video_progress",
      player_completed: "videocomplete",
      search_completed: "search_completed",
      search_result_clicked: "search_result_clicked",
      language_picker_opened: "language_picker_opened",
      language_applied: "language_applied",
      subtitle_applied: "subtitle_applied",
      download_intent: "download_intent",
      download_started: "download_started",
      share_opened: "share_opened",
      share_completed: "share_completed",
      watch_cta_clicked: "watch_cta_clicked",
      page_view: "page_view",
    })
  })

  it("routes each declared event onto its own wire name", () => {
    const inputs: WatchAnalyticsEventInput[] = [
      { type: "player_started" },
      { type: "player_play" },
      { type: "player_pause" },
      { type: "player_milestone", milestonePercent: 10 },
      { type: "player_milestone", milestonePercent: 25 },
      { type: "player_milestone", milestonePercent: 50 },
      { type: "player_milestone", milestonePercent: 75 },
      { type: "player_milestone", milestonePercent: 90 },
      { type: "player_meaningful_progress" },
      { type: "player_completed" },
      {
        type: "search_completed",
        outcome: "results",
        resultCountBucket: "4-10",
        requestType: "search",
      },
      { type: "search_result_clicked" },
      { type: "language_picker_opened" },
      {
        type: "language_applied",
        fromLanguageClass: "english",
        toLanguageClass: "non_english",
        destinationRouteVariant: "canonical",
      },
      { type: "subtitle_applied", enabled: true, languageClass: "english" },
      { type: "download_intent" },
      {
        type: "download_started",
        qualityTier: "high",
        accessOutcome: "open",
      },
      { type: "share_opened" },
      { type: "share_completed", method: "copy_link" },
      {
        type: "watch_cta_clicked",
        ctaId: "study_questions",
        destinationClass: "outbound",
      },
    ]

    for (const input of inputs) {
      dispatchWatchAnalyticsEvent(input, { mode: "immediate" })
    }

    expect(gaEvents().map(([name]) => name)).toEqual([
      "videostarts",
      "videoplay",
      "video_pause",
      "a_media_progress10",
      "a_media_progress25",
      "a_media_progress50",
      "a_media_progress75",
      "a_media_progress90",
      "video_progress",
      "videocomplete",
      "search_completed",
      "search_result_clicked",
      "language_picker_opened",
      "language_applied",
      "subtitle_applied",
      "download_intent",
      "download_started",
      "share_opened",
      "share_completed",
      "watch_cta_clicked",
    ])
  })
})

describe("route context on every event (R10)", () => {
  it("attaches canonical route context without the call site rebuilding path logic", () => {
    dispatchWatchAnalyticsEvent({ type: "share_opened" }, { mode: "immediate" })

    expect(lastParams()).toEqual({
      event_contract_version: WATCH_ANALYTICS_CONTRACT_VERSION,
      watch_route_type: "video",
      watch_route_variant: "explicit_language_compatibility",
      watch_language_class: "english",
      watch_entry_intent: "direct",
      page_path: "/watch/jesus.html",
      page_location: "https://www.jesusfilm.org/watch/jesus.html",
      watch_raw_path: "/watch/jesus.html/english.html",
      watch_content_slug: "jesus",
      watch_language_slug: "english",
    })
  })

  it("reads the live browser location when no context is supplied", () => {
    window.history.replaceState({}, "", "/watch/jesus.html/urdu.html")

    expect(resolveCurrentWatchAnalyticsRouteContext().canonicalPath).toBe(
      "/watch/jesus.html/urdu.html",
    )

    dispatchWatchAnalyticsEvent({ type: "share_opened" }, { mode: "immediate" })

    expect(lastParams()).toMatchObject({
      page_path: "/watch/jesus.html/urdu.html",
      watch_language_class: "non_english",
    })
  })

  it("accepts an explicitly supplied context over the live location", () => {
    const context = resolveWatchAnalyticsRoute({
      pathname: "/watch/languages",
    })

    dispatchWatchAnalyticsEvent(
      { type: "share_opened" },
      { mode: "immediate", context },
    )

    expect(lastParams()).toMatchObject({
      watch_route_type: "languages",
      page_path: "/watch/languages",
    })
  })
})

describe("scheduling seam (R28, KTD9)", () => {
  it("emits an immediate dispatch before the test yields a frame", () => {
    dispatchWatchAnalyticsEvent(
      {
        type: "watch_cta_clicked",
        ctaId: "study_questions",
        destinationClass: "outbound",
      },
      { mode: "immediate" },
    )

    expect(gaEvents().map(([name]) => name)).toEqual(["watch_cta_clicked"])
  })

  it("holds a deferred dispatch until the frame advances", () => {
    dispatchWatchAnalyticsEvent(
      { type: "player_milestone", milestonePercent: 25 },
      { mode: "deferred" },
    )

    expect(gtag).not.toHaveBeenCalled()

    runFrame()

    expect(gaEvents().map(([name]) => name)).toEqual(["a_media_progress25"])
  })

  it("keeps the mode a per-dispatch input, not an event-level flag", () => {
    dispatchWatchAnalyticsEvent(
      {
        type: "watch_cta_clicked",
        ctaId: "study_questions",
        destinationClass: "internal",
      },
      { mode: "deferred" },
    )
    expect(gtag).not.toHaveBeenCalled()

    dispatchWatchAnalyticsEvent(
      {
        type: "watch_cta_clicked",
        ctaId: "study_questions",
        destinationClass: "outbound",
      },
      { mode: "immediate" },
    )
    expect(gaEvents()).toHaveLength(1)
    expect(lastParams()).toMatchObject({ watch_destination_class: "outbound" })

    runFrame()
    expect(gaEvents()).toHaveLength(2)
  })

  it("flushes a queued deferred dispatch when the tab is hidden, exactly once", () => {
    dispatchWatchAnalyticsEvent(
      { type: "player_milestone", milestonePercent: 50 },
      { mode: "deferred" },
    )

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))

    expect(gaEvents().map(([name]) => name)).toEqual(["a_media_progress50"])

    window.dispatchEvent(new Event("pagehide"))
    runFrame()

    expect(gaEvents()).toHaveLength(1)
  })

  it("does not flush on a visibilitychange back to visible", () => {
    dispatchWatchAnalyticsEvent(
      { type: "player_milestone", milestonePercent: 75 },
      { mode: "deferred" },
    )

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    })
    document.dispatchEvent(new Event("visibilitychange"))

    expect(gtag).not.toHaveBeenCalled()

    runFrame()
    expect(gaEvents()).toHaveLength(1)
  })

  it("survives an unmounted caller: the seam is module-scoped", () => {
    dispatchWatchAnalyticsEvent(
      { type: "share_completed", method: "copy_link" },
      { mode: "deferred" },
    )

    // Nothing component-scoped can cancel a queued dispatch; the only exits
    // are the frame, visibilitychange, and pagehide.
    flushWatchAnalyticsDispatches()

    expect(gaEvents().map(([name]) => name)).toEqual(["share_completed"])
  })
})

describe("page views bypass the seam (R6, KTD9)", () => {
  it("emits a page view in the same turn, without a frame yield", () => {
    const context = resolveWatchAnalyticsRoute({
      pathname: "/watch/jesus.html/english.html",
    })

    emitWatchAnalyticsPageView(context, {
      referrer: "https://www.jesusfilm.org/watch/languages.html",
    })

    expect(frames).toHaveLength(0)
    expect(gaEvents()).toEqual([
      [
        "page_view",
        {
          event_contract_version: WATCH_ANALYTICS_CONTRACT_VERSION,
          watch_route_type: "video",
          watch_route_variant: "explicit_language_compatibility",
          watch_language_class: "english",
          watch_entry_intent: "direct",
          page_path: "/watch/jesus.html",
          page_location: "https://www.jesusfilm.org/watch/jesus.html",
          page_referrer: "https://www.jesusfilm.org/watch/languages.html",
          watch_raw_path: "/watch/jesus.html/english.html",
          watch_content_slug: "jesus",
          watch_language_slug: "english",
        },
      ],
    ])
  })

  it("suppresses a referrer that fails validation rather than sending the browser default", () => {
    const context = resolveWatchAnalyticsRoute({
      pathname: "/watch/jesus.html",
    })

    emitWatchAnalyticsPageView(context, {
      referrer: "https://mail.example.com/inbox?user=viewer@example.test",
    })

    const params = lastParams()
    expect(params.page_referrer).toBe("https://mail.example.com")
    expect(JSON.stringify(params)).not.toContain("viewer@example.test")
  })

  it("omits page_referrer entirely for an unparseable referrer", () => {
    const context = resolveWatchAnalyticsRoute({
      pathname: "/watch/jesus.html",
    })

    emitWatchAnalyticsPageView(context, { referrer: "not a url" })

    expect(lastParams()).not.toHaveProperty("page_referrer")
  })

  it("keeps allowlisted campaign parameters in page_location and never the raw query", () => {
    const context = resolveWatchAnalyticsRoute({
      pathname: "/watch/jesus.html",
      search: "?utm_source=partner&utm_medium=email&t=42&secret=hunter2",
    })

    emitWatchAnalyticsPageView(context)

    const params = lastParams()
    expect(params.page_location).toBe(
      "https://www.jesusfilm.org/watch/jesus.html?utm_medium=email&utm_source=partner",
    )
    expect(params.page_path).toBe("/watch/jesus.html")
    expect(JSON.stringify(params)).not.toContain("hunter2")
  })

  it("never sends the in-memory dedupe key to a provider", () => {
    const context = resolveWatchAnalyticsRoute({
      pathname: "/watch/jesus.html",
    })

    emitWatchAnalyticsPageView(context)

    expect(JSON.stringify(lastParams())).not.toContain(context.pageViewKey)
    expect(lastParams()).not.toHaveProperty("pageViewKey")
    expect(lastParams()).not.toHaveProperty("page_view_key")
  })
})

describe("validation and privacy (R9, R19-R21)", () => {
  it("drops an undeclared event entirely", () => {
    dispatchWatchAnalyticsEvent(
      { type: "totally_made_up" } as unknown as WatchAnalyticsEventInput,
      { mode: "immediate" },
    )

    expect(gtag).not.toHaveBeenCalled()
  })

  it("drops an undeclared parameter smuggled onto a declared event", () => {
    dispatchWatchAnalyticsEvent(
      {
        type: "share_completed",
        method: "copy_link",
        result_title: "Jesus Is Brought to Pilate",
        search_request_id: "search_12345678",
      } as unknown as WatchAnalyticsEventInput,
      { mode: "immediate" },
    )

    const params = lastParams()
    expect(params).toMatchObject({ watch_share_method: "copy_link" })
    expect(params).not.toHaveProperty("result_title")
    expect(params).not.toHaveProperty("search_request_id")
  })

  it("drops objects, arrays, nulls, and non-finite numbers", () => {
    dispatchWatchAnalyticsEvent(
      {
        type: "player_pause",
        durationSeconds: Number.NaN,
        positionSeconds: Number.POSITIVE_INFINITY,
        progressPercent: null,
      } as unknown as WatchAnalyticsEventInput,
      { mode: "immediate" },
    )

    const params = lastParams()
    expect(params).not.toHaveProperty("watch_duration_seconds")
    expect(params).not.toHaveProperty("watch_position_seconds")
    expect(params).not.toHaveProperty("watch_progress_percent")
    // A dropped optional field must not suppress an otherwise valid event.
    expect(gaEvents().map(([name]) => name)).toEqual(["video_pause"])
  })

  it("rejects privacy sentinels in a declared string parameter", () => {
    for (const sentinel of [
      "viewer@example.test",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "0123456789abcdef0123456789abcdef",
      "session_id=abc",
    ]) {
      gtag.mockClear()
      dispatchWatchAnalyticsEvent(
        {
          type: "watch_cta_clicked",
          ctaId: sentinel,
          destinationClass: "outbound",
        },
        { mode: "immediate" },
      )

      const params = lastParams()
      expect(JSON.stringify(params)).not.toContain(sentinel)
      expect(params).not.toHaveProperty("watch_cta_id")
    }
  })

  it("emits nothing when no Google tag is present", () => {
    window.gtag = undefined

    expect(() =>
      dispatchWatchAnalyticsEvent(
        { type: "share_opened" },
        { mode: "immediate" },
      ),
    ).not.toThrow()
  })
})

describe("flag boundary (R24, KTD6)", () => {
  it("is inert for every call site when the v2 flag is off", () => {
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = false

    expect(isWatchAnalyticsContractV2Enabled()).toBe(false)

    dispatchWatchAnalyticsEvent({ type: "share_opened" }, { mode: "immediate" })
    dispatchWatchAnalyticsEvent({ type: "player_play" }, { mode: "deferred" })
    emitWatchAnalyticsPageView(
      resolveWatchAnalyticsRoute({ pathname: "/watch/jesus.html" }),
    )
    runFrame()
    flushWatchAnalyticsDispatches()

    expect(gtag).not.toHaveBeenCalled()
  })

  it("treats an unset flag as off", () => {
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = undefined

    expect(isWatchAnalyticsContractV2Enabled()).toBe(false)
  })
})

describe("bucket helpers keep reporting cardinality bounded (R20)", () => {
  it("buckets result counts", () => {
    expect(watchAnalyticsResultCountBucket(0)).toBe("0")
    expect(watchAnalyticsResultCountBucket(3)).toBe("1-3")
    expect(watchAnalyticsResultCountBucket(10)).toBe("4-10")
    expect(watchAnalyticsResultCountBucket(25)).toBe("11-25")
    expect(watchAnalyticsResultCountBucket(260)).toBe("26+")
    expect(watchAnalyticsResultCountBucket(Number.NaN)).toBeUndefined()
    expect(watchAnalyticsResultCountBucket(-1)).toBeUndefined()
  })

  it("buckets 1-based result positions", () => {
    expect(watchAnalyticsPositionBucket(1)).toBe("1")
    expect(watchAnalyticsPositionBucket(3)).toBe("2-3")
    expect(watchAnalyticsPositionBucket(10)).toBe("4-10")
    expect(watchAnalyticsPositionBucket(25)).toBe("11-25")
    expect(watchAnalyticsPositionBucket(99)).toBe("26+")
    expect(watchAnalyticsPositionBucket(0)).toBeUndefined()
  })
})
