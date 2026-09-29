/**
 * The tap handler, driven through fakes for the router and the registry. The
 * last two describes wire the REAL deep-link registry instead, because the one
 * thing a fake cannot prove is that the slug the handler registers is the slug
 * the watch route later consumes.
 */

import {
  consumeDeepLinkArrival,
  registerDeepLinkSlug,
  resetDeepLinkOrigins,
  watchSlugFromUrl,
  type DeepLinkEntry,
  type DeepLinkOrigin,
} from "../../deepLinkOrigin"
import {
  PUSH_ANNOUNCEMENT_FAMILY,
  PUSH_ANNOUNCEMENT_MAX_PAYLOAD_BYTES,
  PUSH_ANNOUNCEMENT_PAYLOAD_VERSION,
} from "../../push/announcementPayload"
import { PUSH_UNRESOLVABLE_DESTINATION_MESSAGE } from "../../push/copy"
import { LAPSE_REMINDER_PAYLOAD_VERSION } from "../constants"
import {
  LAPSE_REMINDER_HOME_TARGET,
  LAPSE_REMINDER_MAX_SLUG_LENGTH,
  buildLapseReminderPayload,
} from "../payload"
import {
  LAPSE_REMINDER_TAP_DEADLINE_MS,
  createLapseReminderTapHandler,
  decideLapseReminderTap,
  type LapseReminderTapDeps,
  type LapseReminderTapTarget,
} from "../tapHandler"

const SLUG = "the-birth-of-jesus"

/** KTD14's shape: 32 random bytes base64url. Opaque to the app. */
const NONCE = "aBcD1234_-efGHijkLMNopQRstuVWXyz0123456789A"

/** An announcement as admin builds it and the OS hands it back. */
function announcement(overrides: Record<string, unknown> = {}) {
  return {
    version: PUSH_ANNOUNCEMENT_PAYLOAD_VERSION,
    family: PUSH_ANNOUNCEMENT_FAMILY,
    kind: "video",
    slug: SLUG,
    nonce: NONCE,
    ...overrides,
  } as unknown
}

/** A payload as the OS hands it back: a plain object, trusted by nobody. */
function payload(target: string, overrides: Record<string, unknown> = {}) {
  return {
    version: LAPSE_REMINDER_PAYLOAD_VERSION,
    kind: "day1",
    target,
    ...overrides,
  }
}

function watchPayload(kind: "day1" | "day7", slug: string) {
  return buildLapseReminderPayload(kind, { slug }) as unknown
}

type Harness = {
  deps: LapseReminderTapDeps
  navigate: jest.Mock<void, [LapseReminderTapTarget]>
  registerArrival: jest.Mock<
    void,
    [string, DeepLinkEntry, DeepLinkOrigin, string | null]
  >
  reportOpen: jest.Mock<void, [string]>
  showNotice: jest.Mock<void, [string]>
  clearLastResponse: jest.Mock
  unsubscribe: jest.Mock
  telemetry: { info: jest.Mock; warn: jest.Mock; error: jest.Mock }
  /** Fires a warm tap through the subscribed listener. */
  emitResponse: (data: unknown) => void
}

function harness(
  lastResponse: unknown = null,
  overrides: Partial<LapseReminderTapDeps> = {},
): Harness {
  const listeners = new Set<(data: unknown) => void>()
  const unsubscribe = jest.fn()
  const navigate = jest.fn<void, [LapseReminderTapTarget]>()
  const registerArrival = jest.fn<
    void,
    [string, DeepLinkEntry, DeepLinkOrigin, string | null]
  >()
  const reportOpen = jest.fn<void, [string]>()
  const showNotice = jest.fn<void, [string]>()
  const clearLastResponse = jest.fn()
  const telemetry = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const deps: LapseReminderTapDeps = {
    adapter: {
      getLastResponseData: () => lastResponse,
      clearLastResponse,
      subscribeToResponses: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribe()
        }
      },
    },
    enabled: true,
    navigate,
    registerArrival,
    reportOpen,
    showNotice,
    telemetry,
    ...overrides,
  }
  return {
    deps,
    navigate,
    registerArrival,
    reportOpen,
    showNotice,
    clearLastResponse,
    unsubscribe,
    telemetry,
    emitResponse: (data) => {
      for (const listener of [...listeners]) listener(data)
    },
  }
}

/** The one selection state that releases the cold wait. */
const READY = { isReady: true, slug: "watch-home" }

function tapEvents(telemetry: { info: jest.Mock }) {
  return telemetry.info.mock.calls.filter(
    ([event]) => event === "lapse_reminder.tap",
  )
}

beforeEach(() => {
  jest.useFakeTimers()
  resetDeepLinkOrigins()
})

afterEach(() => {
  jest.useRealTimers()
})

describe("decideLapseReminderTap", () => {
  it("sends a day-7 watch payload to the watch screen (AE8)", () => {
    expect(decideLapseReminderTap(watchPayload("day7", SLUG), true)).toEqual({
      target: { screen: "watch", slug: SLUG },
      outcome: "watch",
      family: "reminder",
      reminderKind: "day7",
      destinationKind: null,
      slug: SLUG,
      reason: null,
      nonce: null,
      notice: false,
    })
  })

  it("sends the Home marker to Home with a null slug (AE6)", () => {
    expect(
      decideLapseReminderTap(payload(LAPSE_REMINDER_HOME_TARGET), true),
    ).toEqual({
      target: { screen: "home" },
      outcome: "home",
      family: "reminder",
      reminderKind: "day1",
      destinationKind: null,
      slug: null,
      reason: null,
      nonce: null,
      notice: false,
    })
  })

  it.each([
    ["not_an_object", null],
    ["too_large", payload(`forgemobile://watch/${"a".repeat(5000)}`)],
    ["version_mismatch", payload(LAPSE_REMINDER_HOME_TARGET, { version: 99 })],
    ["unknown_kind", payload(LAPSE_REMINDER_HOME_TARGET, { kind: "day30" })],
    ["malformed_target", payload("javascript:alert(1)")],
    ["invalid_slug", payload("forgemobile://watch/..")],
  ])(
    "sends a payload rejected for %s to Home, naming the reason",
    (reason, data) => {
      expect(decideLapseReminderTap(data, true)).toEqual({
        target: { screen: "home" },
        outcome: "rejected",
        family: "reminder",
        reminderKind: null,
        destinationKind: null,
        slug: null,
        reason,
        nonce: null,
        notice: false,
      })
    },
  )

  // KTD4/KTD9: the reason set is fixed and the raw payload never leaves here.
  it("never carries anything from the raw payload", () => {
    const decision = decideLapseReminderTap(
      payload("forgemobile://watch/jesus", { note: "a-secret-value" }),
      true,
    )

    expect(JSON.stringify(decision)).not.toContain("a-secret-value")
    expect(Object.keys(decision).sort()).toEqual([
      "destinationKind",
      "family",
      "nonce",
      "notice",
      "outcome",
      "reason",
      "reminderKind",
      "slug",
      "target",
    ])
  })

  it("navigates nowhere with the gate off, and names the gate", () => {
    expect(decideLapseReminderTap(watchPayload("day7", SLUG), false)).toEqual({
      target: null,
      outcome: "gate_off",
      family: "reminder",
      reminderKind: "day7",
      destinationKind: null,
      slug: SLUG,
      reason: null,
      nonce: null,
      notice: false,
    })
  })

  it("names the gate over the parse reason with the gate off", () => {
    expect(
      decideLapseReminderTap(payload("javascript:alert(1)"), false),
    ).toEqual({
      target: null,
      outcome: "gate_off",
      family: "reminder",
      reminderKind: null,
      destinationKind: null,
      slug: null,
      reason: "malformed_target",
      nonce: null,
      notice: false,
    })
  })

  // AE7: the reminder does not check availability in advance. A slug whose
  // video was unpublished after the reminder was scheduled reaches the watch
  // route, which owns the "Video Not Found" state.
  it("sends a slug that no longer resolves to the watch screen anyway", () => {
    const decision = decideLapseReminderTap(
      watchPayload("day1", "an-unpublished-video"),
      true,
    )

    expect(decision.target).toEqual({
      screen: "watch",
      slug: "an-unpublished-video",
    })
  })

  it("accepts a slug at the parser's length limit", () => {
    const slug = "a".repeat(LAPSE_REMINDER_MAX_SLUG_LENGTH)

    expect(decideLapseReminderTap(watchPayload("day1", slug), true).slug).toBe(
      slug,
    )
  })
})

describe("the cold path", () => {
  it("registers, navigates, logs and clears once the selection settles (AE8)", () => {
    const h = harness(watchPayload("day7", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    handler.selectionChanged(READY)

    expect(h.registerArrival).toHaveBeenCalledWith(
      SLUG,
      "cold",
      "reminder",
      null,
    )
    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith({ screen: "watch", slug: SLUG })
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap", {
      outcome: "watch",
      arrival: "cold",
      family: "reminder",
      reminder_kind: "day7",
      destination_kind: null,
      content_id: SLUG,
      parse_reason: null,
    })
    expect(h.clearLastResponse).toHaveBeenCalledTimes(1)
  })

  // The registry must hold the arrival before the route can consume it.
  it("registers the arrival before it navigates", () => {
    const h = harness(watchPayload("day1", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()
    handler.selectionChanged(READY)

    expect(h.registerArrival.mock.invocationCallOrder[0]).toBeLessThan(
      h.navigate.mock.invocationCallOrder[0],
    )
  })

  it("opens Home for the Home marker and registers nothing (AE6)", () => {
    const h = harness(payload(LAPSE_REMINDER_HOME_TARGET))
    createLapseReminderTapHandler(h.deps).attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).toHaveBeenCalledWith({ screen: "home" })
    expect(h.registerArrival).not.toHaveBeenCalled()
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap", {
      outcome: "home",
      arrival: "cold",
      family: "reminder",
      reminder_kind: "day1",
      destination_kind: null,
      content_id: null,
      parse_reason: null,
    })
  })

  it("opens Home for a rejected payload, naming the reason", () => {
    const h = harness(payload(LAPSE_REMINDER_HOME_TARGET, { version: 99 }))
    createLapseReminderTapHandler(h.deps).attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).toHaveBeenCalledWith({ screen: "home" })
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap", {
      outcome: "rejected",
      arrival: "cold",
      family: "reminder",
      reminder_kind: null,
      destination_kind: null,
      content_id: null,
      parse_reason: "version_mismatch",
    })
  })

  // KTD7: the experience shell swaps element type once the stored slug
  // resolves, which remounts the navigation stack under a pushed route.
  it("waits while the selection is not ready", () => {
    const h = harness(watchPayload("day1", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    handler.selectionChanged({ isReady: false, slug: null })
    handler.selectionChanged({ isReady: false, slug: "watch-home" })

    expect(h.navigate).not.toHaveBeenCalled()
  })

  it("waits while the selection is ready with no slug", () => {
    const h = harness(watchPayload("day1", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    handler.selectionChanged({ isReady: true, slug: null })

    expect(h.navigate).not.toHaveBeenCalled()
  })

  it("proceeds after the deadline when the slug never arrives", () => {
    const h = harness(watchPayload("day1", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()
    handler.selectionChanged({ isReady: true, slug: null })

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS - 1)
    expect(h.navigate).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1)
    expect(h.navigate).toHaveBeenCalledTimes(1)
  })

  it("navigates exactly once when the selection settles and the deadline passes", () => {
    const h = harness(watchPayload("day1", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    handler.selectionChanged(READY)
    handler.selectionChanged(READY)
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS * 2)

    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(tapEvents(h.telemetry)).toHaveLength(1)
  })

  it("does nothing when there is no pending response", () => {
    const h = harness(null)
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    handler.selectionChanged(READY)
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.clearLastResponse).not.toHaveBeenCalled()
    expect(h.telemetry.info).not.toHaveBeenCalled()
  })

  // A StrictMode remount detaches mid-wait. The detached handler must not
  // navigate from the response the new one is about to read.
  it("ignores a stale response after it is detached", () => {
    const h = harness(watchPayload("day1", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)
    const detach = handler.attach()

    detach()
    handler.selectionChanged(READY)
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.clearLastResponse).not.toHaveBeenCalled()
  })

  it("navigates once across a detach and a fresh attach of the same response", () => {
    const h = harness(watchPayload("day1", SLUG))
    const first = createLapseReminderTapHandler(h.deps)
    first.attach()()
    const second = createLapseReminderTapHandler(h.deps)
    second.attach()

    first.selectionChanged(READY)
    second.selectionChanged(READY)
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).toHaveBeenCalledTimes(1)
  })

  // The real adapter stops handing back a response once it is cleared, which is
  // what makes a remount after a consumed tap inert.
  it("does not navigate again when the cleared response is gone", () => {
    let last: unknown = watchPayload("day1", SLUG)
    const h = harness(null, {
      adapter: {
        getLastResponseData: () => last,
        clearLastResponse: () => {
          last = null
        },
        subscribeToResponses: () => () => {},
      },
    })
    const first = createLapseReminderTapHandler(h.deps)
    first.attach()
    first.selectionChanged(READY)
    expect(h.navigate).toHaveBeenCalledTimes(1)

    const second = createLapseReminderTapHandler(h.deps)
    second.attach()
    second.selectionChanged(READY)

    expect(h.navigate).toHaveBeenCalledTimes(1)
  })

  it("ignores a selection change before it is attached", () => {
    const h = harness(watchPayload("day1", SLUG))
    const handler = createLapseReminderTapHandler(h.deps)

    handler.selectionChanged(READY)

    expect(h.navigate).not.toHaveBeenCalled()
  })
})

describe("the warm path", () => {
  it("registers, navigates, logs and clears at once", () => {
    const h = harness(null)
    createLapseReminderTapHandler(h.deps).attach()

    h.emitResponse(watchPayload("day7", SLUG))

    expect(h.registerArrival).toHaveBeenCalledWith(
      SLUG,
      "warm",
      "reminder",
      null,
    )
    expect(h.navigate).toHaveBeenCalledWith({ screen: "watch", slug: SLUG })
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap", {
      outcome: "watch",
      arrival: "warm",
      family: "reminder",
      reminder_kind: "day7",
      destination_kind: null,
      content_id: SLUG,
      parse_reason: null,
    })
    expect(h.clearLastResponse).toHaveBeenCalledTimes(1)
  })

  it("does not wait for the selection", () => {
    const h = harness(null)
    createLapseReminderTapHandler(h.deps).attach()

    h.emitResponse(payload(LAPSE_REMINDER_HOME_TARGET))

    expect(h.navigate).toHaveBeenCalledWith({ screen: "home" })
  })

  // Both taps would otherwise navigate, and the cold one to a stale target.
  it("cancels a cold wait that has not settled", () => {
    const h = harness(watchPayload("day1", "an-older-video"))
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    h.emitResponse(watchPayload("day7", SLUG))
    handler.selectionChanged(READY)
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith({ screen: "watch", slug: SLUG })
  })

  it("stops listening once it is detached", () => {
    const h = harness(null)
    const detach = createLapseReminderTapHandler(h.deps).attach()

    detach()
    h.emitResponse(watchPayload("day1", SLUG))

    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    expect(h.navigate).not.toHaveBeenCalled()
  })
})

describe("the build-time gate (KTD8)", () => {
  it("consumes and logs a pending cold response, and navigates nowhere", () => {
    const h = harness(watchPayload("day7", SLUG), { enabled: false })
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()
    handler.selectionChanged(READY)
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.registerArrival).not.toHaveBeenCalled()
    expect(h.clearLastResponse).toHaveBeenCalledTimes(1)
    expect(tapEvents(h.telemetry)).toEqual([
      [
        "lapse_reminder.tap",
        {
          outcome: "gate_off",
          arrival: "cold",
          family: "reminder",
          reminder_kind: "day7",
          destination_kind: null,
          content_id: SLUG,
          parse_reason: null,
        },
      ],
    ])
  })

  it("consumes and logs a warm tap too", () => {
    const h = harness(null, { enabled: false })
    createLapseReminderTapHandler(h.deps).attach()

    h.emitResponse(watchPayload("day1", SLUG))

    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.clearLastResponse).toHaveBeenCalledTimes(1)
    expect(tapEvents(h.telemetry)).toHaveLength(1)
  })
})

describe("a dependency that throws", () => {
  it("survives a failing response read", () => {
    const h = harness(null, {
      adapter: {
        getLastResponseData: () => {
          throw new Error("bridge down")
        },
        clearLastResponse: jest.fn(),
        subscribeToResponses: () => () => {},
      },
    })
    const handler = createLapseReminderTapHandler(h.deps)

    expect(() => handler.attach()).not.toThrow()
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap_failed", {
      step: "read",
      error_message: "bridge down",
    })
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it("survives a failing subscription and still runs the cold path", () => {
    const h = harness(null, {
      adapter: {
        getLastResponseData: () => watchPayload("day1", SLUG),
        clearLastResponse: jest.fn(),
        subscribeToResponses: () => {
          throw new Error("no listener")
        },
      },
    })
    const handler = createLapseReminderTapHandler(h.deps)
    const detach = handler.attach()
    handler.selectionChanged(READY)

    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap_failed", {
      step: "subscribe",
      error_message: "no listener",
    })
    expect(() => detach()).not.toThrow()
  })

  it("navigates even when the registry throws", () => {
    const h = harness(watchPayload("day1", SLUG), {
      registerArrival: jest.fn(() => {
        throw new Error("registry down")
      }),
    })
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()
    handler.selectionChanged(READY)

    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap_failed", {
      step: "register",
      error_message: "registry down",
    })
  })

  // A failed navigation must still clear, or the response replays on every
  // launch and the tap never stops trying.
  it("clears and logs even when the router throws", () => {
    const h = harness(watchPayload("day1", SLUG), {
      navigate: jest.fn(() => {
        throw new Error("no navigator")
      }),
    })
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()
    handler.selectionChanged(READY)

    expect(h.clearLastResponse).toHaveBeenCalledTimes(1)
    expect(tapEvents(h.telemetry)).toHaveLength(1)
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap_failed", {
      step: "navigate",
      error_message: "no navigator",
    })
  })

  it("survives a failing clear", () => {
    const h = harness(watchPayload("day1", SLUG), {
      adapter: {
        getLastResponseData: () => watchPayload("day1", SLUG),
        clearLastResponse: () => {
          throw new Error("no module")
        },
        subscribeToResponses: () => () => {},
      },
    })
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    expect(() => handler.selectionChanged(READY)).not.toThrow()
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap_failed", {
      step: "clear",
      error_message: "no module",
    })
  })
})

// No fake registry here: the handler's slug and the watch route's slug have to
// be the same string, and only the real module can say whether they are.
describe("through the real deep-link registry", () => {
  function realHarness(lastResponse: unknown, enabled = true) {
    const h = harness(lastResponse, {
      enabled,
      registerArrival: (slug, entry, origin, campaign) =>
        registerDeepLinkSlug(slug, entry, origin, Date.now(), campaign),
    })
    return h
  }

  it("leaves an arrival the watch route can claim", () => {
    const h = realHarness(watchPayload("day7", SLUG))
    createLapseReminderTapHandler(h.deps).attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(consumeDeepLinkArrival(SLUG)).toEqual({
      entry: "cold",
      origin: "reminder",
    })
  })

  it("leaves a warm arrival for a warm tap", () => {
    const h = realHarness(null)
    createLapseReminderTapHandler(h.deps).attach()

    h.emitResponse(watchPayload("day1", SLUG))

    expect(consumeDeepLinkArrival(SLUG)).toEqual({
      entry: "warm",
      origin: "reminder",
    })
  })

  it("leaves nothing for a Home target", () => {
    const h = realHarness(payload(LAPSE_REMINDER_HOME_TARGET))
    createLapseReminderTapHandler(h.deps).attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(consumeDeepLinkArrival(LAPSE_REMINDER_HOME_TARGET)).toBeNull()
    expect(consumeDeepLinkArrival(SLUG)).toBeNull()
  })

  // The divergence this handler exists to route around: the payload's own
  // target reads as "foo" through the URL parser and as "foo.html" through the
  // payload parser, and the watch route consumes the latter.
  it("keys a .html slug the way the watch route reads it", () => {
    const built = buildLapseReminderPayload("day1", { slug: "foo.html" })
    const h = realHarness(built as unknown)
    createLapseReminderTapHandler(h.deps).attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(watchSlugFromUrl(built.target)).toBe("foo")
    expect(h.navigate).toHaveBeenCalledWith({
      screen: "watch",
      slug: "foo.html",
    })
    expect(consumeDeepLinkArrival("foo.html")).toEqual({
      entry: "cold",
      origin: "reminder",
    })
    // Anti-vacuous: registering by the url would have filed it here instead.
    expect(consumeDeepLinkArrival("foo")).toBeNull()
  })

  it("registers nothing with the gate off", () => {
    const h = realHarness(watchPayload("day1", SLUG), false)
    createLapseReminderTapHandler(h.deps).attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(consumeDeepLinkArrival(SLUG)).toBeNull()
  })
})

// U8. The second payload family on the same handler: a notification names a
// DESTINATION and one opaque campaign identifier, and the reminder path above
// must keep behaving exactly as it did.
describe("decideLapseReminderTap on an announcement", () => {
  it("sends a video destination to the watch route (AE13)", () => {
    expect(decideLapseReminderTap(announcement(), true)).toEqual({
      target: { screen: "watch", slug: SLUG },
      outcome: "watch",
      family: "announcement",
      reminderKind: null,
      destinationKind: "video",
      slug: SLUG,
      reason: null,
      nonce: NONCE,
      notice: false,
    })
  })

  it("sends a series destination to the series route (AE13)", () => {
    const decision = decideLapseReminderTap(
      announcement({ kind: "series", slug: "washi-gospel" }),
      true,
    )

    expect(decision.target).toEqual({ screen: "series", slug: "washi-gospel" })
    expect(decision.outcome).toBe("series")
    expect(decision.destinationKind).toBe("series")
    expect(decision.notice).toBe(false)
  })

  it("sends an experience destination to the experience route", () => {
    const decision = decideLapseReminderTap(
      announcement({ kind: "experience", slug: "watch-home" }),
      true,
    )

    expect(decision.target).toEqual({
      screen: "experience",
      slug: "watch-home",
    })
    expect(decision.outcome).toBe("experience")
    expect(decision.destinationKind).toBe("experience")
  })

  it("opens home and asks for the message on an unknown kind (AE14)", () => {
    const decision = decideLapseReminderTap(
      announcement({ kind: "collection" }),
      true,
    )

    expect(decision.target).toEqual({ screen: "home" })
    expect(decision.outcome).toBe("unresolvable")
    expect(decision.notice).toBe(true)
    expect(decision.reason).toBe("unknown_kind")
    expect(decision.slug).toBeNull()
  })

  it("still carries the nonce when the destination is unreadable (R23)", () => {
    // Admin may name a kind a released build does not know. The tap is still an
    // OPEN, so the campaign's report must not silently under-count it.
    const decision = decideLapseReminderTap(
      announcement({ kind: "collection" }),
      true,
    )

    expect(decision.nonce).toBe(NONCE)
  })

  it("opens home and asks for the message on an oversized payload", () => {
    const decision = decideLapseReminderTap(
      announcement({ note: "a".repeat(PUSH_ANNOUNCEMENT_MAX_PAYLOAD_BYTES) }),
      true,
    )

    expect(decision.target).toEqual({ screen: "home" })
    expect(decision.outcome).toBe("unresolvable")
    expect(decision.reason).toBe("too_large")
    expect(decision.notice).toBe(true)
    // Nothing is trusted out of an over-cap payload, the nonce included.
    expect(decision.nonce).toBeNull()
  })

  it("routes an announcement even with the reminders gate off (KTD12)", () => {
    // The gate belongs to the LOCAL reminders. An announcement has already been
    // delivered by the push service, and opening it is a different feature.
    const decision = decideLapseReminderTap(announcement(), false)

    expect(decision.target).toEqual({ screen: "watch", slug: SLUG })
    expect(decision.outcome).toBe("watch")
  })

  it("keeps the reminder contract on a reminder payload", () => {
    const decision = decideLapseReminderTap(watchPayload("day7", SLUG), true)

    expect(decision.family).toBe("reminder")
    expect(decision.nonce).toBeNull()
    expect(decision.destinationKind).toBeNull()
    expect(decision.notice).toBe(false)
    expect(decision.target).toEqual({ screen: "watch", slug: SLUG })
  })
})

describe("an announcement tap", () => {
  it("reports the open BEFORE it navigates (R23)", () => {
    const h = harness(announcement())
    const order: string[] = []
    h.reportOpen.mockImplementation(() => order.push("report"))
    h.navigate.mockImplementation(() => order.push("navigate"))
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.reportOpen).toHaveBeenCalledWith(NONCE)
    expect(h.reportOpen).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["report", "navigate"])
  })

  it("navigates when the report throws, and never retries it", () => {
    const h = harness(announcement())
    h.reportOpen.mockImplementation(() => {
      throw new Error("no network")
    })
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).toHaveBeenCalledWith({ screen: "watch", slug: SLUG })
    expect(h.reportOpen).toHaveBeenCalledTimes(1)
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap_failed", {
      step: "report",
      error_message: "no network",
    })
  })

  it("reports one open per tap, not one per attach", () => {
    const h = harness(announcement())
    const handler = createLapseReminderTapHandler(h.deps)
    const detach = handler.attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)
    detach()

    expect(h.reportOpen).toHaveBeenCalledTimes(1)
    expect(h.clearLastResponse).toHaveBeenCalled()
  })

  it("shows the copy constant on an unresolvable destination (AE14)", () => {
    const h = harness(announcement({ kind: "collection" }))
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.showNotice).toHaveBeenCalledWith(
      PUSH_UNRESOLVABLE_DESTINATION_MESSAGE,
    )
    expect(h.navigate).toHaveBeenCalledWith({ screen: "home" })
  })

  it("navigates even when showing the message throws", () => {
    const h = harness(announcement({ kind: "collection" }))
    h.showNotice.mockImplementation(() => {
      throw new Error("no host")
    })
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.navigate).toHaveBeenCalledWith({ screen: "home" })
    expect(h.telemetry.info).toHaveBeenCalledWith("lapse_reminder.tap_failed", {
      step: "notice",
      error_message: "no host",
    })
  })

  it("shows no message when the destination resolved", () => {
    const h = harness(announcement())
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.showNotice).not.toHaveBeenCalled()
  })

  it("registers a campaign arrival carrying the nonce for a VIDEO only", () => {
    const h = harness(announcement())
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.registerArrival).toHaveBeenCalledWith(
      SLUG,
      "cold",
      "campaign",
      NONCE,
    )
  })

  it("registers nothing for a series or an experience destination", () => {
    // Only the watch route reads an arrival; a list route has no episode yet.
    for (const kind of ["series", "experience"] as const) {
      const h = harness(announcement({ kind }))
      createLapseReminderTapHandler(h.deps).attach()
      jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

      expect(h.registerArrival).not.toHaveBeenCalled()
    }
  })

  it("keeps a reminder arrival on the reminder origin", () => {
    // Anti-vacuous for the origin above: a reminder must not become a campaign.
    const h = harness(watchPayload("day1", SLUG))
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.registerArrival).toHaveBeenCalledWith(
      SLUG,
      "cold",
      "reminder",
      null,
    )
    expect(h.reportOpen).not.toHaveBeenCalled()
  })

  it("routes a warm announcement tap through the listener (AE13)", () => {
    const h = harness(null)
    createLapseReminderTapHandler(h.deps).attach()

    h.emitResponse(announcement({ kind: "series", slug: "washi-gospel" }))

    expect(h.navigate).toHaveBeenCalledWith({
      screen: "series",
      slug: "washi-gospel",
    })
    expect(h.reportOpen).toHaveBeenCalledWith(NONCE)
  })

  it("waits for the experience selection on a cold announcement tap", () => {
    const h = harness(announcement())
    const handler = createLapseReminderTapHandler(h.deps)
    handler.attach()

    expect(h.navigate).not.toHaveBeenCalled()
    handler.selectionChanged(READY)

    expect(h.navigate).toHaveBeenCalledWith({ screen: "watch", slug: SLUG })
  })

  it("clears the last response so a remount cannot re-route", () => {
    const h = harness(announcement())
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(h.clearLastResponse).toHaveBeenCalledTimes(1)
  })

  it("names the family and the destination kind in the tap event", () => {
    const h = harness(announcement({ kind: "series", slug: "washi-gospel" }))
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(tapEvents(h.telemetry)).toEqual([
      [
        "lapse_reminder.tap",
        {
          outcome: "series",
          arrival: "cold",
          family: "announcement",
          reminder_kind: null,
          destination_kind: "series",
          content_id: "washi-gospel",
          parse_reason: null,
        },
      ],
    ])
  })

  it("never puts the campaign identifier in a log", () => {
    const h = harness(announcement())
    createLapseReminderTapHandler(h.deps).attach()

    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(JSON.stringify(h.telemetry.info.mock.calls)).not.toContain(NONCE)
  })
})

describe("an announcement through the real deep-link registry", () => {
  it("leaves a campaign arrival the watch route can claim (KTD8)", () => {
    const h = harness(announcement(), {
      registerArrival: (slug, entry, origin, campaign) =>
        registerDeepLinkSlug(slug, entry, origin, Date.now(), campaign),
    })
    createLapseReminderTapHandler(h.deps).attach()
    jest.advanceTimersByTime(LAPSE_REMINDER_TAP_DEADLINE_MS)

    expect(consumeDeepLinkArrival(SLUG)).toEqual({
      entry: "cold",
      origin: "campaign",
      campaign: NONCE,
    })
  })
})
