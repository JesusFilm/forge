/**
 * R22's foreground rule as a pure decision, so it tests without the native
 * module: a REMOTE notification shows a banner, and a local reminder keeps
 * showing nothing. The adapter owns the registration; this owns the answer.
 */

import {
  ANNOUNCEMENT_PRESENTATION,
  SUPPRESSED_PRESENTATION,
  isRemotePushTrigger,
  presentationForTrigger,
} from "../foreground"

describe("isRemotePushTrigger", () => {
  it("names the remote trigger the push service delivers", () => {
    expect(isRemotePushTrigger({ type: "push" })).toBe(true)
  })

  it.each([
    { type: "date" },
    { type: "timeInterval" },
    { type: "calendar" },
    { type: "unknown" },
    { type: "location" },
    {},
    null,
    undefined,
    "push",
    ["push"],
  ])("does not name %p remote", (trigger) => {
    expect(isRemotePushTrigger(trigger)).toBe(false)
  })
})

describe("presentationForTrigger", () => {
  it("shows a banner and a list entry for a remote announcement (AE15)", () => {
    expect(presentationForTrigger({ type: "push" })).toEqual(
      ANNOUNCEMENT_PRESENTATION,
    )
    expect(ANNOUNCEMENT_PRESENTATION.shouldShowBanner).toBe(true)
    expect(ANNOUNCEMENT_PRESENTATION.shouldShowList).toBe(true)
  })

  it("plays no sound and sets no badge over a viewer who is already here", () => {
    expect(ANNOUNCEMENT_PRESENTATION.shouldPlaySound).toBe(false)
    expect(ANNOUNCEMENT_PRESENTATION.shouldSetBadge).toBe(false)
  })

  it("shows nothing for a local reminder that fires in the foreground (AE15)", () => {
    // The date trigger is the only kind the reminders schedule.
    expect(presentationForTrigger({ type: "date" })).toEqual(
      SUPPRESSED_PRESENTATION,
    )
    expect(Object.values(SUPPRESSED_PRESENTATION)).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it("suppresses a trigger it cannot read, which is the safe answer", () => {
    expect(presentationForTrigger(null)).toEqual(SUPPRESSED_PRESENTATION)
    expect(presentationForTrigger(undefined)).toEqual(SUPPRESSED_PRESENTATION)
    expect(presentationForTrigger({ type: "unknown" })).toEqual(
      SUPPRESSED_PRESENTATION,
    )
  })
})
