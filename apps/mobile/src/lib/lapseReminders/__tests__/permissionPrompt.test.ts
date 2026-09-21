/**
 * The first-launch permission prompt (U5, KTD6) against a fake adapter, a fake
 * latch and a fake splash session, so every case runs with no native module.
 *
 * The bound that matters most is R9: the request is made at most once per
 * install. The harness counts every adapter call by name, so a second request
 * fails a case rather than hiding behind a "was it called" assertion.
 */

import { LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY } from "../constants"
import {
  LAPSE_REMINDER_PERMISSION_ASKED_VALUE,
  attachLapseReminderPermissionPrompt,
  classifyExistingPermission,
  classifyRequestedPermission,
  isGrantedOutcome,
  isPermissionAsked,
  isSplashCleared,
  type LapseReminderPermissionPromptDeps,
} from "../permissionPrompt"

type FakePermission = { granted: boolean; canAskAgain: boolean }

/** The pre-request states the two platforms really produce. */
const CAN_ASK: FakePermission = { granted: false, canAskAgain: true }
const ALREADY_GRANTED: FakePermission = { granted: true, canAskAgain: false }
const CANNOT_ASK: FakePermission = { granted: false, canAskAgain: false }

type HarnessOptions = {
  asked?: string | null
  enabled?: boolean
  permission?: FakePermission
  requested?: FakePermission
  splash?: { resolved: boolean; visible: boolean }
  failChannel?: boolean
  failPermission?: boolean
  failRead?: boolean
  failRequest?: boolean
  failWrite?: boolean
}

/** Enough microtask hops for the whole chain to settle, however long it is. */
async function settle() {
  for (let hop = 0; hop < 20; hop += 1) await Promise.resolve()
}

function createHarness(options: HarnessOptions = {}) {
  const calls: string[] = []
  const events: { event: string; context: Record<string, unknown> }[] = []
  const listeners = new Set<() => void>()
  let snapshot = options.splash ?? { resolved: true, visible: false }
  let stored = options.asked ?? null
  let passes = 0

  const deps: LapseReminderPermissionPromptDeps = {
    enabled: options.enabled ?? true,
    adapter: {
      async ensureChannel() {
        calls.push("ensureChannel")
        if (options.failChannel) throw new Error("channel failed")
      },
      async getPermission() {
        calls.push("getPermission")
        if (options.failPermission) throw new Error("permission read failed")
        return options.permission ?? CAN_ASK
      },
      async requestPermission() {
        calls.push("requestPermission")
        if (options.failRequest) throw new Error("request failed")
        return options.requested ?? ALREADY_GRANTED
      },
    },
    splash: {
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      getSnapshot: () => snapshot,
    },
    readAsked: async () => {
      calls.push("readAsked")
      if (options.failRead) throw new Error("latch read failed")
      return stored
    },
    writeAsked: async () => {
      calls.push("writeAsked")
      if (options.failWrite) throw new Error("latch write failed")
      stored = LAPSE_REMINDER_PERMISSION_ASKED_VALUE
    },
    runPass: () => {
      passes += 1
    },
    telemetry: {
      info: (event, context) => events.push({ event, context }),
      warn: (event, context) => events.push({ event, context }),
      error: (event, context) => events.push({ event, context }),
    },
  }

  const detach = attachLapseReminderPermissionPrompt(deps)

  return {
    calls,
    detach,
    events,
    get passes() {
      return passes
    },
    get stored() {
      return stored
    },
    countOf(call: string) {
      return calls.filter((entry) => entry === call).length
    },
    eventsNamed(event: string) {
      return events.filter((entry) => entry.event === event)
    },
    /** Commits a new splash snapshot and notifies, the way the session does. */
    setSplash(next: { resolved: boolean; visible: boolean }) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    get splashListenerCount() {
      return listeners.size
    },
  }
}

describe("the pure prompt decisions", () => {
  it("clears only on a RESOLVED snapshot that is not visible", () => {
    expect(isSplashCleared({ resolved: true, visible: false })).toBe(true)
    expect(isSplashCleared({ resolved: true, visible: true })).toBe(false)
    // The discriminating case: the initial snapshot is not visible either, so
    // a bare `!visible` test would prompt over a splash about to be raised.
    expect(isSplashCleared({ resolved: false, visible: false })).toBe(false)
  })

  it("reads any stored value as asked, and only absence as unasked", () => {
    expect(isPermissionAsked(null)).toBe(false)
    expect(isPermissionAsked(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)).toBe(true)
    // Fail closed: an unrecognised value still means somebody asked once.
    expect(isPermissionAsked("")).toBe(true)
    expect(isPermissionAsked("0")).toBe(true)
  })

  it("classifies a pre-request status, and asks only when it can", () => {
    expect(classifyExistingPermission(ALREADY_GRANTED)).toEqual({
      outcome: "already_granted",
      prompted: false,
    })
    expect(classifyExistingPermission(CANNOT_ASK)).toEqual({
      outcome: "cannot_ask",
      prompted: false,
    })
    // Null is the one state that reaches the system prompt.
    expect(classifyExistingPermission(CAN_ASK)).toBeNull()
  })

  it("classifies the answer to a prompt that was shown", () => {
    expect(
      classifyRequestedPermission({ granted: true, canAskAgain: false }),
    ).toEqual({ outcome: "granted", prompted: true })
    expect(
      classifyRequestedPermission({ granted: false, canAskAgain: false }),
    ).toEqual({ outcome: "denied", prompted: true })
  })

  it("treats both granted outcomes as a reason to schedule", () => {
    expect(isGrantedOutcome("granted")).toBe(true)
    expect(isGrantedOutcome("already_granted")).toBe(true)
    expect(isGrantedOutcome("denied")).toBe(false)
    expect(isGrantedOutcome("cannot_ask")).toBe(false)
  })
})

describe("the first-launch prompt", () => {
  it("records a denial, schedules nothing, and surfaces no error (AE4)", async () => {
    const harness = createHarness({
      permission: CAN_ASK,
      requested: { granted: false, canAskAgain: false },
    })

    await settle()

    expect(harness.countOf("requestPermission")).toBe(1)
    expect(harness.stored).toBe(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)
    expect(harness.passes).toBe(0)
    expect(harness.eventsNamed("lapse_reminder.permission")).toEqual([
      {
        event: "lapse_reminder.permission",
        context: { prompt_outcome: "denied", prompted: true },
      },
    ])
    expect(harness.eventsNamed("lapse_reminder.permission_failed")).toEqual([])
    harness.detach()
  })

  it("writes the latch and runs one pass on a grant", async () => {
    const harness = createHarness({
      permission: CAN_ASK,
      requested: ALREADY_GRANTED,
    })

    await settle()

    expect(harness.stored).toBe(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)
    expect(harness.passes).toBe(1)
    expect(harness.eventsNamed("lapse_reminder.permission")[0].context).toEqual(
      {
        prompt_outcome: "granted",
        prompted: true,
      },
    )
    harness.detach()
  })

  it("ensures the channel BEFORE the request (KTD6, Android 13)", async () => {
    const harness = createHarness({ permission: CAN_ASK })

    await settle()

    // Order, not presence: a channel created after the request is a prompt
    // Android never shows.
    expect(harness.calls).toEqual([
      "readAsked",
      "ensureChannel",
      "getPermission",
      "requestPermission",
      "writeAsked",
    ])
    harness.detach()
  })

  it("reports an automatic grant as a choice nobody made", async () => {
    const harness = createHarness({ permission: ALREADY_GRANTED })

    await settle()

    expect(harness.countOf("requestPermission")).toBe(0)
    expect(harness.eventsNamed("lapse_reminder.permission")[0].context).toEqual(
      {
        prompt_outcome: "already_granted",
        prompted: false,
      },
    )
    // The channel was created in this pass, so the reminders are re-scheduled
    // into it rather than into the channel the mount pass did not have.
    expect(harness.passes).toBe(1)
    expect(harness.stored).toBe(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)
    harness.detach()
  })

  it("never asks when the system says it cannot", async () => {
    const harness = createHarness({ permission: CANNOT_ASK })

    await settle()

    expect(harness.countOf("requestPermission")).toBe(0)
    expect(harness.eventsNamed("lapse_reminder.permission")[0].context).toEqual(
      {
        prompt_outcome: "cannot_ask",
        prompted: false,
      },
    )
    expect(harness.passes).toBe(0)
    expect(harness.stored).toBe(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)
    harness.detach()
  })
})

describe("the asked-once latch", () => {
  it("asks nothing on a later launch, even while permission is denied", async () => {
    const harness = createHarness({
      asked: LAPSE_REMINDER_PERMISSION_ASKED_VALUE,
      permission: CAN_ASK,
    })

    await settle()

    expect(harness.calls).toEqual(["readAsked"])
    expect(harness.events).toEqual([])
    expect(harness.passes).toBe(0)
    harness.detach()
  })

  it("closes the latch even when the request itself fails", async () => {
    // The OS may already have drawn the prompt, so R9 outranks a retry.
    const harness = createHarness({ permission: CAN_ASK, failRequest: true })

    await settle()

    expect(harness.stored).toBe(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)
    expect(harness.eventsNamed("lapse_reminder.permission")).toEqual([])
    expect(
      harness.eventsNamed("lapse_reminder.permission_failed")[0].context,
    ).toEqual({ step: "request", error_message: "request failed" })
    expect(harness.passes).toBe(0)
    harness.detach()
  })

  it("asks nothing this launch when the latch cannot be read", async () => {
    const harness = createHarness({ failRead: true })

    await settle()

    expect(harness.countOf("requestPermission")).toBe(0)
    expect(harness.stored).toBeNull()
    expect(
      harness.eventsNamed("lapse_reminder.permission_failed")[0].context,
    ).toEqual({ step: "latch_read", error_message: "latch read failed" })
    harness.detach()
  })

  it("still records the outcome when the latch cannot be written", async () => {
    const harness = createHarness({
      permission: CAN_ASK,
      requested: ALREADY_GRANTED,
      failWrite: true,
    })

    await settle()

    expect(
      harness.eventsNamed("lapse_reminder.permission_failed")[0].context,
    ).toEqual({ step: "latch_write", error_message: "latch write failed" })
    // The person answered; the outcome and the schedule must not be lost too.
    expect(harness.eventsNamed("lapse_reminder.permission")[0].context).toEqual(
      {
        prompt_outcome: "granted",
        prompted: true,
      },
    )
    expect(harness.passes).toBe(1)
    harness.detach()
  })
})

describe("the failure paths never surface an error (R9)", () => {
  it("asks anyway when the channel cannot be created", async () => {
    const harness = createHarness({ permission: CAN_ASK, failChannel: true })

    await settle()

    expect(harness.countOf("requestPermission")).toBe(1)
    expect(
      harness.eventsNamed("lapse_reminder.permission_failed")[0].context,
    ).toEqual({ step: "channel", error_message: "channel failed" })
    harness.detach()
  })

  it("leaves the latch open when the status cannot be read", async () => {
    const harness = createHarness({ failPermission: true })

    await settle()

    expect(harness.countOf("requestPermission")).toBe(0)
    // Nothing was shown, so the next launch may still ask.
    expect(harness.stored).toBeNull()
    expect(
      harness.eventsNamed("lapse_reminder.permission_failed")[0].context,
    ).toEqual({
      step: "permission_read",
      error_message: "permission read failed",
    })
    harness.detach()
  })

  it("logs no reserved attribute name on any emit site", async () => {
    const reserved = [
      "source",
      "host",
      "service",
      "status",
      "message",
      "trace_id",
    ]
    const harness = createHarness({ permission: CAN_ASK, failChannel: true })

    await settle()

    expect(harness.events.length).toBeGreaterThan(1)
    for (const entry of harness.events) {
      expect(
        Object.keys(entry.context).filter((key) => reserved.includes(key)),
      ).toEqual([])
    }
    harness.detach()
  })
})

describe("the wait for the splash", () => {
  it("holds while the splash is visible and fires when it clears", async () => {
    const harness = createHarness({
      permission: CAN_ASK,
      splash: { resolved: true, visible: true },
    })

    await settle()
    // Anti-vacuous: nothing at all has run yet, so the assertion after the
    // flip cannot pass for a reason other than the flip.
    expect(harness.calls).toEqual([])

    harness.setSplash({ resolved: true, visible: false })
    await settle()

    expect(harness.countOf("requestPermission")).toBe(1)
    harness.detach()
  })

  it("holds while the splash has not resolved yet", async () => {
    const harness = createHarness({
      permission: CAN_ASK,
      splash: { resolved: false, visible: false },
    })

    await settle()

    expect(harness.calls).toEqual([])
    harness.detach()
  })

  it("stops listening once it has run", async () => {
    const harness = createHarness({
      permission: CAN_ASK,
      splash: { resolved: true, visible: true },
    })

    harness.setSplash({ resolved: true, visible: false })
    await settle()
    harness.setSplash({ resolved: true, visible: false })
    await settle()

    expect(harness.countOf("requestPermission")).toBe(1)
    expect(harness.splashListenerCount).toBe(0)
    harness.detach()
  })

  it("asks nothing after a detach that beats the splash", async () => {
    const harness = createHarness({
      permission: CAN_ASK,
      splash: { resolved: true, visible: true },
    })

    harness.detach()
    harness.setSplash({ resolved: true, visible: false })
    await settle()

    expect(harness.calls).toEqual([])
    expect(harness.splashListenerCount).toBe(0)
  })

  it("asks nothing after a detach mid-flight (StrictMode remount)", async () => {
    // The remount's first attach is detached before its latch read settles.
    const harness = createHarness({ permission: CAN_ASK })

    harness.detach()
    await settle()

    expect(harness.countOf("requestPermission")).toBe(0)
    expect(harness.stored).toBeNull()
  })
})

describe("the build-time gate", () => {
  it("reads nothing and asks nothing while the feature is off (KTD8)", async () => {
    const harness = createHarness({ enabled: false, permission: CAN_ASK })

    await settle()

    expect(harness.calls).toEqual([])
    expect(harness.events).toEqual([])
    harness.detach()
  })
})

describe("verification: at most one request per install", () => {
  // The done signal for U5, over the four fixtures the plan names.
  const fixtures: {
    name: string
    options: HarnessOptions
    requests: number
  }[] = [
    {
      name: "fresh install, granted",
      options: { permission: CAN_ASK, requested: ALREADY_GRANTED },
      requests: 1,
    },
    {
      name: "fresh install, denied",
      options: {
        permission: CAN_ASK,
        requested: { granted: false, canAskAgain: false },
      },
      requests: 1,
    },
    {
      name: "fresh install, automatic grant",
      options: { permission: ALREADY_GRANTED },
      requests: 0,
    },
    {
      name: "upgraded install, latch already set",
      options: {
        asked: LAPSE_REMINDER_PERMISSION_ASKED_VALUE,
        permission: CAN_ASK,
      },
      requests: 0,
    },
  ]

  for (const fixture of fixtures) {
    it(`asks at most once: ${fixture.name}`, async () => {
      const harness = createHarness(fixture.options)

      // Several splash notifications and a long settle: no sequence of them
      // may produce a second request.
      await settle()
      harness.setSplash({ resolved: true, visible: false })
      harness.setSplash({ resolved: true, visible: false })
      await settle()

      expect(harness.countOf("requestPermission")).toBe(fixture.requests)
      expect(harness.countOf("requestPermission")).toBeLessThanOrEqual(1)
      harness.detach()
    })
  }
})

describe("the storage key", () => {
  it("is the key the constants module owns", () => {
    // The provider wires the latch from this pair; a divergence here is a
    // latch that never reads what it wrote.
    expect(LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY).toBe(
      "lapse-reminders-permission-asked",
    )
    expect(LAPSE_REMINDER_PERMISSION_ASKED_VALUE.length).toBeGreaterThan(0)
  })
})
