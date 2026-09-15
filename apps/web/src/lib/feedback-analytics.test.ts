/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  FEEDBACK_STEP_COUNT,
  FEEDBACK_STEP_KEYS,
  reportFeedbackAbandoned,
  reportFeedbackOpened,
  reportFeedbackStepBlocked,
  reportFeedbackStepViewed,
  reportFeedbackSubmitFailed,
} from "@/lib/feedback-analytics"

function events(): Array<[string, Record<string, unknown>]> {
  const gtag = window.gtag as unknown as ReturnType<typeof vi.fn>
  return gtag.mock.calls
    .filter(([kind]) => kind === "event")
    .map(([, name, params]) => [
      name as string,
      (params ?? {}) as Record<string, unknown>,
    ])
}

beforeEach(() => {
  window.gtag = vi.fn()
})

afterEach(() => {
  window.gtag = undefined
  vi.restoreAllMocks()
})

describe("feedback funnel analytics", () => {
  it("keeps the wizard's step vocabulary and its length in one place", () => {
    expect(FEEDBACK_STEP_KEYS).toEqual([
      "type",
      "describe",
      "context",
      "point",
      "about",
    ])
    expect(FEEDBACK_STEP_COUNT).toBe(5)
  })

  it("strips the authoring prefix so GA receives the bare wire names", () => {
    reportFeedbackOpened({ source: "launcher" })
    reportFeedbackStepViewed({ step: 1, category: null })
    reportFeedbackStepBlocked({ step: 1, fields: ["category"] })
    reportFeedbackSubmitFailed({ category: null, reason: "invalid" })
    reportFeedbackAbandoned({ step: 1, category: null, reason: "dismissed" })

    expect(events().map(([name]) => name)).toEqual([
      "feedback_opened",
      "feedback_step_viewed",
      "feedback_step_blocked",
      "feedback_submit_failed",
      "feedback_abandoned",
    ])
  })

  it("sorts the blocking fields rather than passing insertion order through", () => {
    // Three fields, deliberately in neither sorted nor reversed order: with
    // two the sorted and reversed results coincide, so a two-field fixture
    // cannot tell a real sort from any other reordering.
    reportFeedbackStepBlocked({
      step: 5,
      fields: ["message", "category", "email"],
    })

    expect(events()).toEqual([
      [
        "feedback_step_blocked",
        { step: 5, step_name: "about", reason: "category_email_message" },
      ],
    ])
  })

  it("says nothing at all when nothing blocked the step", () => {
    reportFeedbackStepBlocked({ step: 2, fields: [] })

    expect(events()).toEqual([])
  })

  it("omits the category until one has been chosen", () => {
    reportFeedbackStepViewed({ step: 1, category: null })
    reportFeedbackStepViewed({ step: 2, category: "idea" })

    expect(events()).toEqual([
      ["feedback_step_viewed", { step: 1, step_name: "type" }],
      [
        "feedback_step_viewed",
        { step: 2, step_name: "describe", category: "idea" },
      ],
    ])
  })

  it("falls back to the first step's name for an out-of-range step", () => {
    // Defensive only: a step outside 1-5 is unreachable through the wizard.
    // The point is that it degrades to a valid enum value rather than
    // emitting `undefined` and widening the dimension's cardinality.
    reportFeedbackStepViewed({ step: 99, category: null })

    expect(events()).toEqual([
      ["feedback_step_viewed", { step: 99, step_name: "type" }],
    ])
  })

  it("holds an event fired before the Google tag arrives, then sends it", () => {
    // The plain v1 helper drops these. For a funnel that means losing the
    // OPEN while every later step survives — which reads as broken data
    // rather than as a lost event.
    vi.useFakeTimers()
    window.gtag = undefined

    reportFeedbackOpened({ source: "launcher" })

    const gtag = vi.fn()
    window.gtag = gtag
    vi.advanceTimersByTime(200)

    expect(gtag.mock.calls).toEqual([
      ["event", "feedback_opened", { open_source: "launcher" }],
    ])
  })

  it("gives up on a tag that never arrives instead of waiting forever", () => {
    vi.useFakeTimers()
    window.gtag = undefined

    reportFeedbackOpened({ source: "launcher" })
    // Past the ~10s ceiling: a blocked or unconfigured tag is not coming.
    vi.advanceTimersByTime(60_000)

    const gtag = vi.fn()
    window.gtag = gtag
    vi.advanceTimersByTime(60_000)

    expect(gtag).not.toHaveBeenCalled()
  })

  it("keeps the funnel in order when the tag arrives mid-journey", () => {
    // The tag can load BETWEEN two events. Without draining first, the later
    // event goes straight out while the earlier one waits for the next poll,
    // and GA receives a step view before the open that produced it.
    vi.useFakeTimers()
    window.gtag = undefined
    reportFeedbackOpened({ source: "launcher" })

    const gtag = vi.fn()
    window.gtag = gtag
    reportFeedbackStepViewed({ step: 1, category: null })

    expect(gtag.mock.calls.map(([, name]) => name)).toEqual([
      "feedback_opened",
      "feedback_step_viewed",
    ])
  })

  it("stops queueing rather than growing without bound on a cold tag", () => {
    vi.useFakeTimers()
    window.gtag = undefined
    for (let i = 0; i < 40; i += 1) {
      reportFeedbackStepViewed({ step: 1, category: null })
    }

    const gtag = vi.fn()
    window.gtag = gtag
    vi.advanceTimersByTime(200)

    expect(gtag.mock.calls.length).toBe(20)
  })

  it("never throws into the click handler when there is no tag", () => {
    window.gtag = undefined

    expect(() => reportFeedbackOpened({ source: "page_cta" })).not.toThrow()
  })
})
