/**
 * Explore telemetry (U13, KTD17). Every case builds its own instance over fake
 * sinks and a fake clock, so no module singleton crosses a case. The return
 * cases use the real clip record, because the device date lives there.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
}))

// The app-wide instance binds the clip record, which binds AsyncStorage.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { datadogLog, reportDatadogAction } from "../../datadog"
import {
  CLIP_RECORD_STORAGE_KEY,
  createClipRecordStore,
  serializeClipRecord,
} from "../clipRecord"
import {
  EXPLORE_CLIP_WATCHED_SECONDS,
  EXPLORE_VISIT_TIMEOUT_MS,
  createExploreTelemetry,
  getExploreTelemetry,
  type ExploreClipRecordPort,
} from "../telemetry"

type Emitted = { name: string; context: Record<string, unknown> }
type Logged = Emitted & { level: "info" | "warn" }

/** Local time, so the device date is 2026-09-25. */
const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime()
const RESERVED = ["source", "host", "service", "status", "message", "trace_id"]

const ACTION_NAMES = [
  "explore.clip_watched",
  "explore.full_play_end",
  "explore.full_play_start",
  "explore.keep_watching",
  "explore.return",
  "explore.visit_end",
  "explore.visit_start",
]

const LOG_NAMES = [
  "explore.clip_failed",
  "explore.demoted",
  "explore.first_motion",
  "explore.pool_fallback",
  "explore.rebuffer",
  "explore.swipe",
]

/** A clip record whose stored date never changes and whose read lands at once. */
function fakeClipRecord(lastVisitDate: string | null = null) {
  let stored = lastVisitDate
  return {
    hydrate: jest.fn(async () => {}),
    recordVisit: jest.fn(() => {
      const previous = stored
      stored = "2026-09-25"
      return previous
    }),
    getLastVisitDate: jest.fn(() => stored),
  } satisfies ExploreClipRecordPort
}

/** The real U6 store over fake storage, seeded with a last visit date. */
function realClipRecord(
  lastVisitDate: string | null,
  readDelayMs = 0,
): ExploreClipRecordPort {
  const seed = serializeClipRecord(
    { entries: [], lastVisitDate },
    new Date(Date.now()),
  )
  return createClipRecordStore({
    getItem: (key) =>
      new Promise((resolve) => {
        setTimeout(
          () => resolve(key === CLIP_RECORD_STORAGE_KEY ? seed : null),
          readDelayMs,
        )
      }),
    setItem: async () => {},
    now: () => new Date(Date.now()),
  })
}

function makeHarness(clipRecord: ExploreClipRecordPort = fakeClipRecord()) {
  const actions: Emitted[] = []
  const logs: Logged[] = []
  const log =
    (level: Logged["level"]) =>
    (name: string, context: Record<string, unknown>) =>
      logs.push({ level, name, context })
  let nextId = 0
  const instance = createExploreTelemetry({
    reportDatadogAction: (name, context) => actions.push({ name, context }),
    telemetry: { info: log("info"), warn: log("warn") },
    clipRecord,
    createId: () => {
      nextId += 1
      return `visit-${nextId}`
    },
  })
  return {
    instance,
    actions,
    logs,
    action: (name: string) => actions.filter((a) => a.name === name),
    logged: (name: string) => logs.filter((l) => l.name === name),
  }
}

/** Lets the visit's return check settle: its hydrate and its microtasks. */
async function settle(ms = 0): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms)
}

const exploreIntent = {
  origin: "explore" as const,
  videoSlug: "jesus",
  createdAt: T0,
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(T0)
})

afterEach(() => {
  jest.useRealTimers()
})

describe("visits", () => {
  it("the first focus starts a visit with one action", () => {
    const h = makeHarness()
    h.instance.focus("two")
    expect(h.action("explore.visit_start")).toEqual([
      {
        name: "explore.visit_start",
        context: { explore_visit_id: "visit-1" },
      },
    ])
  })

  it("a 5 s tab switch keeps the same visit", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.blur()
    jest.advanceTimersByTime(5_000)
    h.instance.focus("two")
    h.instance.keepWatchingTap("jesus")

    expect(h.action("explore.visit_start")).toHaveLength(1)
    expect(h.action("explore.visit_end")).toHaveLength(0)
    expect(h.action("explore.keep_watching")[0].context).toMatchObject({
      explore_visit_id: "visit-1",
    })
  })

  it("just under 30 min away keeps the visit", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.blur()
    jest.advanceTimersByTime(EXPLORE_VISIT_TIMEOUT_MS - 1)
    h.instance.focus("two")

    expect(h.action("explore.visit_start")).toHaveLength(1)
    expect(h.action("explore.visit_end")).toHaveLength(0)
  })

  it("a visit ends after 30 min away, with its clips, taps, and focused time", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.clipProgress("0", 3)
    jest.advanceTimersByTime(10_000)
    h.instance.keepWatchingTap("jesus")
    h.instance.blur()
    jest.advanceTimersByTime(EXPLORE_VISIT_TIMEOUT_MS)

    expect(h.action("explore.visit_end")).toEqual([
      {
        name: "explore.visit_end",
        context: {
          explore_visit_id: "visit-1",
          explore_clips_watched: 1,
          explore_keep_watching_taps: 1,
          explore_visit_focused_ms: 10_000,
        },
      },
    ])

    h.instance.focus("two")
    h.instance.clipProgress("0", 3)
    expect(h.action("explore.visit_start").map((a) => a.context)).toEqual([
      { explore_visit_id: "visit-1" },
      { explore_visit_id: "visit-2" },
    ])
    // The counters start again with the new visit.
    expect(h.action("explore.clip_watched")[1].context).toEqual({
      explore_visit_id: "visit-2",
      explore_clips_watched: 1,
    })
  })

  it("a focus after 30 min ends the visit when no timer ran, and only once", () => {
    // A suspended app runs no timer, so the clock moves on without it.
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.blur()
    jest.setSystemTime(T0 + EXPLORE_VISIT_TIMEOUT_MS)
    h.instance.focus("two")
    jest.advanceTimersByTime(EXPLORE_VISIT_TIMEOUT_MS * 2)

    expect(h.action("explore.visit_end")).toHaveLength(1)
    expect(h.action("explore.visit_end")[0].context).toMatchObject({
      explore_visit_id: "visit-1",
    })
    expect(h.action("explore.visit_start")).toHaveLength(2)
  })
})

describe("clips watched", () => {
  it("a clip counts as watched at 3 s, not at 2.9 s", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.clipProgress("0", 2.9)
    expect(h.action("explore.clip_watched")).toHaveLength(0)

    h.instance.clipProgress("0", EXPLORE_CLIP_WATCHED_SECONDS)
    expect(h.action("explore.clip_watched")).toEqual([
      {
        name: "explore.clip_watched",
        context: { explore_visit_id: "visit-1", explore_clips_watched: 1 },
      },
    ])
  })

  it("a clip counts once per visit, through its loops and a replay", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.clipProgress("0", 3)
    h.instance.clipProgress("0", 12)
    h.instance.clipProgress("0", 0.5)
    h.instance.clipProgress("0", 3.5)
    h.instance.clipProgress("1", 4)

    expect(h.action("explore.clip_watched").map((a) => a.context)).toEqual([
      { explore_visit_id: "visit-1", explore_clips_watched: 1 },
      { explore_visit_id: "visit-1", explore_clips_watched: 2 },
    ])
  })

  it("progress outside a visit counts nothing", () => {
    const h = makeHarness()
    h.instance.clipProgress("0", 5)
    expect(h.actions).toEqual([])
  })
})

describe("keep watching", () => {
  it("a tap raises the visit's tap count and emits one action", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.keepWatchingTap("jesus")
    expect(h.action("explore.keep_watching")).toEqual([
      {
        name: "explore.keep_watching",
        context: {
          explore_visit_id: "visit-1",
          explore_keep_watching_taps: 1,
          explore_video_slug: "jesus",
        },
      },
    ])

    h.instance.keepWatchingTap("magdalena")
    expect(h.action("explore.keep_watching")).toHaveLength(2)
    expect(h.action("explore.keep_watching")[1].context).toMatchObject({
      explore_keep_watching_taps: 2,
    })
  })
})

describe("full play", () => {
  it("a full play opened from Explore emits its start, then its played time when the session ends", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.keepWatchingTap("jesus")
    h.instance.blur()
    h.instance.fullPlayStart(exploreIntent)
    expect(h.action("explore.full_play_start")).toEqual([
      {
        name: "explore.full_play_start",
        context: { explore_visit_id: "visit-1", explore_video_slug: "jesus" },
      },
    ])

    jest.advanceTimersByTime(60_000)
    h.instance.fullPlayPlaying(false)
    jest.advanceTimersByTime(30_000)
    h.instance.fullPlayPlaying(true)
    jest.advanceTimersByTime(20_000)
    h.instance.fullPlayEnd("dismissed")

    expect(h.action("explore.full_play_end")).toEqual([
      {
        name: "explore.full_play_end",
        context: {
          explore_visit_id: "visit-1",
          explore_video_slug: "jesus",
          explore_full_play_ms: 80_000,
          explore_end_reason: "dismissed",
        },
      },
    ])
  })

  it("a render that runs twice starts one full play, and a session ends once", () => {
    const h = makeHarness()
    expect(h.instance.fullPlayStart(exploreIntent)).toBe(true)
    expect(h.instance.fullPlayStart(exploreIntent)).toBe(false)
    jest.advanceTimersByTime(5_000)
    h.instance.fullPlayEnd("ended")
    h.instance.fullPlayEnd("abandoned")
    // The same intent after its end is the same page, not a new full play.
    h.instance.fullPlayStart(exploreIntent)

    expect(h.action("explore.full_play_start")).toHaveLength(1)
    expect(h.action("explore.full_play_end")).toHaveLength(1)
    expect(h.action("explore.full_play_end")[0].context).toMatchObject({
      explore_full_play_ms: 5_000,
      explore_end_reason: "ended",
    })
  })

  it("a new hand-off ends the open full play as replaced", () => {
    const h = makeHarness()
    h.instance.fullPlayStart(exploreIntent)
    jest.advanceTimersByTime(7_000)
    h.instance.fullPlayStart({
      ...exploreIntent,
      videoSlug: "magdalena",
      createdAt: T0 + 7_000,
    })

    expect(h.action("explore.full_play_end").map((a) => a.context)).toEqual([
      {
        explore_visit_id: null,
        explore_video_slug: "jesus",
        explore_full_play_ms: 7_000,
        explore_end_reason: "replaced",
      },
    ])
    expect(h.action("explore.full_play_start").map((a) => a.context)).toEqual([
      { explore_visit_id: null, explore_video_slug: "jesus" },
      { explore_visit_id: null, explore_video_slug: "magdalena" },
    ])
  })
})

describe("later-day return", () => {
  it("a last visit yesterday, by the device date, gives a return with one day", async () => {
    // Ten minutes after local midnight: under 24 h, and still one day.
    jest.setSystemTime(new Date(2026, 8, 25, 0, 10, 0))
    const h = makeHarness(realClipRecord("2026-09-24"))
    h.instance.focus("two")
    await settle()

    expect(h.action("explore.return")).toEqual([
      {
        name: "explore.return",
        context: {
          explore_visit_id: "visit-1",
          explore_days_since_last_visit: 1,
        },
      },
    ])
  })

  it("a visit on the same day gives no return event", async () => {
    const h = makeHarness(realClipRecord("2026-09-25"))
    h.instance.focus("two")
    await settle()
    expect(h.action("explore.return")).toHaveLength(0)
  })

  it("a first visit gives no return event", async () => {
    const h = makeHarness(realClipRecord(null))
    h.instance.focus("two")
    await settle()
    expect(h.action("explore.return")).toHaveLength(0)
  })

  it("waits for the stored date before it records today's visit", async () => {
    // U6: a visit recorded before the read lands replaces the stored date,
    // and the return is lost.
    const h = makeHarness(realClipRecord("2026-09-20", 300))
    h.instance.focus("two")
    await settle(300)

    expect(h.action("explore.return").map((a) => a.context)).toEqual([
      { explore_visit_id: "visit-1", explore_days_since_last_visit: 5 },
    ])
  })

  it("a second visit on the same day gives no second return", async () => {
    const h = makeHarness(realClipRecord("2026-09-24"))
    h.instance.focus("two")
    await settle()
    h.instance.blur()
    await settle(EXPLORE_VISIT_TIMEOUT_MS)
    h.instance.focus("two")
    await settle()

    expect(h.action("explore.visit_start")).toHaveLength(2)
    expect(h.action("explore.return")).toHaveLength(1)
  })
})

describe("playback health", () => {
  it("the first motion emits its time, its stage breakdown, and the pool state", () => {
    const h = makeHarness()
    h.instance.focus("two")
    jest.advanceTimersByTime(100)
    h.instance.poolReady("warm")
    jest.advanceTimersByTime(200)
    h.instance.firstMotionStage("clipQueued")
    jest.advanceTimersByTime(50)
    h.instance.firstMotionStage("sourceSet")
    jest.advanceTimersByTime(400)
    h.instance.firstMotionStage("sourceLoaded")
    jest.advanceTimersByTime(150)
    h.instance.motionConfirmed()

    expect(h.logged("explore.first_motion")).toEqual([
      {
        level: "info",
        name: "explore.first_motion",
        context: {
          explore_visit_id: "visit-1",
          explore_first_motion_outcome: "motion",
          explore_first_motion_ms: 900,
          explore_pool_ready_ms: 100,
          explore_clip_queued_ms: 300,
          explore_source_set_ms: 350,
          explore_source_loaded_ms: 750,
          explore_pool_state: "warm",
          explore_player_mode: "two",
        },
      },
    ])
  })

  it("a cold pool, one player, and an unmarked stage report as they are", () => {
    const h = makeHarness()
    h.instance.focus("one")
    jest.advanceTimersByTime(2_000)
    h.instance.poolReady("cold")
    jest.advanceTimersByTime(1_000)
    h.instance.motionConfirmed()

    expect(h.logged("explore.first_motion")[0].context).toMatchObject({
      explore_first_motion_ms: 3_000,
      explore_pool_state: "cold",
      explore_player_mode: "one",
      explore_clip_queued_ms: null,
    })
  })

  it("the first motion is measured once per launch", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.motionConfirmed()
    h.instance.blur()
    jest.advanceTimersByTime(EXPLORE_VISIT_TIMEOUT_MS)
    h.instance.focus("two")
    h.instance.poolReady("warm")
    h.instance.motionConfirmed()

    expect(h.logged("explore.first_motion")).toHaveLength(1)
  })

  it("a blur or a swipe before the first motion closes it without a time", () => {
    const left = makeHarness()
    left.instance.focus("two")
    jest.advanceTimersByTime(4_000)
    left.instance.blur()
    left.instance.focus("two")
    left.instance.motionConfirmed()
    expect(left.logged("explore.first_motion").map((l) => l.context)).toEqual([
      expect.objectContaining({
        explore_first_motion_outcome: "left",
        explore_first_motion_ms: null,
      }),
    ])

    const swiped = makeHarness()
    swiped.instance.focus("two")
    swiped.instance.swipe({ preloadHit: false, direction: "forward" })
    expect(swiped.logged("explore.first_motion")[0].context).toMatchObject({
      explore_first_motion_outcome: "swiped",
      explore_first_motion_ms: null,
    })
  })

  it("each swipe reports a preload hit or miss", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.motionConfirmed()

    h.instance.swipe({ preloadHit: true, direction: "forward" })
    jest.advanceTimersByTime(120)
    h.instance.motionConfirmed()
    // A fast streak: this swipe never reaches motion.
    h.instance.swipe({ preloadHit: false, direction: "forward" })
    jest.advanceTimersByTime(80)
    h.instance.swipe({ preloadHit: false, direction: "backward" })
    h.instance.blur()

    expect(h.logged("explore.swipe").map((l) => l.context)).toEqual([
      {
        explore_visit_id: "visit-1",
        explore_preload_hit: true,
        explore_swipe_direction: "forward",
        explore_swipe_outcome: "motion",
        explore_swipe_to_motion_ms: 120,
        explore_player_mode: "two",
      },
      {
        explore_visit_id: "visit-1",
        explore_preload_hit: false,
        explore_swipe_direction: "forward",
        explore_swipe_outcome: "superseded",
        explore_swipe_to_motion_ms: null,
        explore_player_mode: "two",
      },
      {
        explore_visit_id: "visit-1",
        explore_preload_hit: false,
        explore_swipe_direction: "backward",
        explore_swipe_outcome: "left",
        explore_swipe_to_motion_ms: null,
        explore_player_mode: "two",
      },
    ])
  })

  it("a rebuffer, a failed clip, a demotion, and a pool fallback go to the log sink", () => {
    const h = makeHarness()
    h.instance.focus("two")
    h.instance.rebuffer()
    h.instance.rebuffer()
    h.instance.clipFailed({
      failure: "sourceError",
      slot: "standby",
      videoId: "video-1",
      feedLanguageSlug: "english",
      errorMessage:
        "Failed to load https://stream.mux.com/abc.m3u8?token=secret\nline two",
    })
    h.instance.demoted(2)
    h.instance.poolFallback({
      tier: "subtitleOnly",
      feedLanguageSlug: "swahili",
      releasedEntries: 0,
    })
    h.instance.swipe({ preloadHit: false, direction: "forward" })
    h.instance.blur()

    expect(h.logged("explore.rebuffer").map((l) => l.context)).toEqual([
      {
        explore_visit_id: "visit-1",
        explore_visit_rebuffers: 1,
        explore_player_mode: "two",
      },
      {
        explore_visit_id: "visit-1",
        explore_visit_rebuffers: 2,
        explore_player_mode: "two",
      },
    ])
    expect(h.logged("explore.clip_failed")).toEqual([
      {
        level: "warn",
        name: "explore.clip_failed",
        context: {
          explore_visit_id: "visit-1",
          explore_failure: "sourceError",
          explore_slot: "standby",
          explore_video_id: "video-1",
          explore_feed_language: "english",
          explore_player_mode: "two",
          explore_error_message:
            "Failed to load https://stream.mux.com/abc.m3u8?[redacted] line two",
        },
      },
    ])
    expect(h.logged("explore.demoted")).toEqual([
      {
        level: "warn",
        name: "explore.demoted",
        context: { explore_visit_id: "visit-1", explore_standby_errors: 2 },
      },
    ])
    expect(h.logged("explore.pool_fallback")).toEqual([
      {
        level: "info",
        name: "explore.pool_fallback",
        context: {
          explore_visit_id: "visit-1",
          explore_clip_tier: "subtitleOnly",
          explore_feed_language: "swahili",
          explore_released_entries: 0,
        },
      },
    ])
    // A demotion holds for the launch, so later measures carry one player.
    expect(h.logged("explore.swipe")[0].context).toMatchObject({
      explore_player_mode: "one",
    })
  })
})

describe("attribute names", () => {
  function runEveryEvent() {
    const h = makeHarness(fakeClipRecord("2026-09-20"))
    h.instance.focus("two")
    h.instance.poolReady("warm")
    h.instance.firstMotionStage("clipQueued")
    h.instance.firstMotionStage("sourceSet")
    h.instance.firstMotionStage("sourceLoaded")
    h.instance.motionConfirmed()
    h.instance.clipProgress("0", 3)
    h.instance.swipe({ preloadHit: true, direction: "forward" })
    h.instance.motionConfirmed()
    h.instance.rebuffer()
    h.instance.clipFailed({
      failure: "timeout",
      slot: "active",
      videoId: "video-1",
      feedLanguageSlug: "english",
      errorMessage: null,
    })
    h.instance.demoted(2)
    h.instance.poolFallback({
      tier: "fallbackDubbed",
      feedLanguageSlug: "english",
      releasedEntries: 4,
    })
    h.instance.keepWatchingTap("jesus")
    h.instance.blur()
    h.instance.fullPlayStart(exploreIntent)
    h.instance.fullPlayEnd("ended")
    jest.advanceTimersByTime(EXPLORE_VISIT_TIMEOUT_MS)
    return h
  }

  it("every RUM-action context key starts with explore_, and no attribute uses a reserved name", async () => {
    const h = runEveryEvent()
    await settle()

    // Anti-vacuous: the run reaches every action and every log event.
    expect([...new Set(h.actions.map((a) => a.name))].sort()).toEqual(
      ACTION_NAMES,
    )
    expect([...new Set(h.logs.map((l) => l.name))].sort()).toEqual(LOG_NAMES)

    const actionKeys = h.actions.flatMap((a) => Object.keys(a.context))
    expect(actionKeys.filter((key) => !key.startsWith("explore_"))).toEqual([])
    const logKeys = h.logs.flatMap((l) => Object.keys(l.context))
    expect(logKeys.filter((key) => !key.startsWith("explore_"))).toEqual([])
    expect(
      [...actionKeys, ...logKeys].filter((key) => RESERVED.includes(key)),
    ).toEqual([])
  })
})

describe("app-wide instance", () => {
  it("sends actions through reportDatadogAction and logs through datadogLog", () => {
    const instance = getExploreTelemetry()
    expect(getExploreTelemetry()).toBe(instance)

    instance.keepWatchingTap("jesus")
    instance.demoted(2)

    expect(reportDatadogAction).toHaveBeenCalledWith("explore.keep_watching", {
      explore_visit_id: null,
      explore_keep_watching_taps: null,
      explore_video_slug: "jesus",
    })
    expect(datadogLog.warn).toHaveBeenCalledWith("explore.demoted", {
      explore_visit_id: null,
      explore_standby_errors: 2,
    })
  })
})
