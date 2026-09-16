/**
 * The schedule pass (U4, KTD2) against a fake adapter that records call order
 * and the pending set by identifier.
 *
 * The bound that matters most is R5: no sequence of app-state and clear events
 * may leave more than two reminders pending. The fake tracks the high-water
 * mark of its pending map, so a transient third is a failure too, not only a
 * third that survives to the end of a test.
 */

import {
  LAPSE_REMINDER_COPY,
  LAPSE_REMINDER_IDENTIFIERS,
  type LapseReminderKind,
} from "../constants"
import {
  LAPSE_REMINDER_HOME_TARGET,
  type LapseReminderPayload,
} from "../payload"
import { computeLapseReminderTargets } from "../schedule"
import {
  createLapseReminderLifecycle,
  type LapseReminderLifecycleDeps,
} from "../lifecycle"

const KINDS: readonly LapseReminderKind[] = ["day1", "day7"]

/** A fixed instant inside the delivery window, so nothing snaps in these tests
 *  unless the test asks for it. 2026-09-16 10:00 local. */
const NOW = new Date(2026, 8, 16, 10, 0, 0, 0).getTime()

type ScheduledReminder = {
  body: string
  data: LapseReminderPayload
  date: Date
}

type FakeAdapterOptions = {
  granted?: boolean
  /** Microtask hops each call waits, so overlapping passes really interleave. */
  latency?: () => number
  failSchedule?: (identifier: string) => boolean
  failCancel?: (identifier: string) => boolean
  failDismiss?: () => boolean
  failPermission?: () => boolean
  failChannel?: () => boolean
}

function createFakeAdapter(options: FakeAdapterOptions = {}) {
  const pending = new Map<string, ScheduledReminder>()
  const identifiersUsed = new Set<string>()
  const calls: string[] = []
  let maxPending = 0
  let delivered = 0
  let permissionReads = 0

  async function wait() {
    const hops = options.latency?.() ?? 0
    for (let hop = 0; hop < hops; hop += 1) await Promise.resolve()
  }

  return {
    pending,
    identifiersUsed,
    calls,
    deliver(count: number) {
      delivered += count
    },
    get delivered() {
      return delivered
    },
    get maxPending() {
      return maxPending
    },
    get permissionReads() {
      return permissionReads
    },
    async ensureChannel() {
      calls.push("channel")
      await wait()
      if (options.failChannel?.()) throw new Error("channel failed")
    },
    async getPermission() {
      calls.push("permission")
      permissionReads += 1
      await wait()
      if (options.failPermission?.()) throw new Error("permission read failed")
      return { granted: options.granted ?? true }
    },
    async schedule(input: {
      identifier: string
      body: string
      data: LapseReminderPayload
      date: Date
    }) {
      calls.push(`schedule:${input.identifier}`)
      await wait()
      if (options.failSchedule?.(input.identifier)) {
        throw new Error("schedule failed")
      }
      identifiersUsed.add(input.identifier)
      pending.set(input.identifier, {
        body: input.body,
        data: input.data,
        date: input.date,
      })
      maxPending = Math.max(maxPending, pending.size)
    },
    async cancel(identifier: string) {
      calls.push(`cancel:${identifier}`)
      await wait()
      if (options.failCancel?.(identifier)) throw new Error("cancel failed")
      pending.delete(identifier)
    },
    async dismissDelivered() {
      calls.push("dismiss")
      await wait()
      if (options.failDismiss?.()) throw new Error("dismiss failed")
      delivered = 0
    },
  }
}

type FakeAdapter = ReturnType<typeof createFakeAdapter>

type Harness = {
  adapter: FakeAdapter
  deps: LapseReminderLifecycleDeps
  logs: { event: string; context: Record<string, unknown> }[]
  emitAppState: (state: string) => void
  emitClear: () => void
  appStateListenerCount: () => number
  clearListenerCount: () => number
  setRecord: (videoSlug: string | null) => void
  resolveHydration: () => void
}

function createHarness(
  options: FakeAdapterOptions & {
    enabled?: boolean
    record?: string | null
    /** Leave hydration pending until the test resolves it. */
    deferHydration?: boolean
    now?: () => number
  } = {},
): Harness {
  const adapter = createFakeAdapter(options)
  const logs: { event: string; context: Record<string, unknown> }[] = []
  const appStateListeners = new Set<(state: string) => void>()
  const clearListeners = new Set<() => void>()
  let record = options.record ?? null
  let releaseHydration: () => void = () => {}
  const hydration = options.deferHydration
    ? new Promise<void>((resolve) => {
        releaseHydration = resolve
      })
    : Promise.resolve()

  const deps: LapseReminderLifecycleDeps = {
    adapter,
    enabled: options.enabled ?? true,
    getRecord: () =>
      record == null ? null : { videoSlug: record, recordedAt: NOW },
    hydrateRecord: () => hydration,
    subscribeToRecordClear: (listener) => {
      clearListeners.add(listener)
      return () => clearListeners.delete(listener)
    },
    subscribeToAppState: (listener) => {
      appStateListeners.add(listener)
      return () => appStateListeners.delete(listener)
    },
    now: options.now ?? (() => NOW),
    telemetry: {
      info: (event, context) => logs.push({ event, context }),
      warn: () => {},
      error: () => {},
    },
  }

  return {
    adapter,
    deps,
    logs,
    emitAppState: (state) => {
      for (const listener of [...appStateListeners]) listener(state)
    },
    emitClear: () => {
      for (const listener of [...clearListeners]) listener()
    },
    appStateListenerCount: () => appStateListeners.size,
    clearListenerCount: () => clearListeners.size,
    setRecord: (videoSlug) => {
      record = videoSlug
    },
    resolveHydration: () => releaseHydration(),
  }
}

/** Drain queued microtasks, which is all the fake adapter ever waits on. Hops
 *  rather than timers, so a suite on fake timers can still use this. */
async function settle(hops = 400) {
  for (let hop = 0; hop < hops; hop += 1) await Promise.resolve()
}

function identifiersOf(adapter: FakeAdapter): string[] {
  return [...adapter.pending.keys()].sort()
}

const BOTH_IDENTIFIERS = [
  LAPSE_REMINDER_IDENTIFIERS.day1,
  LAPSE_REMINDER_IDENTIFIERS.day7,
].sort()

describe("the lapse reminder schedule pass", () => {
  it("covers AE2: schedules both kinds at the computed targets", async () => {
    const harness = createHarness({ record: "the-birth-of-jesus" })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")

    const targets = computeLapseReminderTargets(NOW)
    expect(identifiersOf(harness.adapter)).toEqual(BOTH_IDENTIFIERS)
    for (const kind of KINDS) {
      const scheduled = harness.adapter.pending.get(
        LAPSE_REMINDER_IDENTIFIERS[kind],
      )
      expect(scheduled?.date.getTime()).toBe(targets[kind].getTime())
      expect(scheduled?.body).toBe(LAPSE_REMINDER_COPY[kind])
      expect(scheduled?.data).toEqual({
        version: 1,
        kind,
        target: "forgemobile://watch/the-birth-of-jesus",
      })
    }
  })

  it("covers AE2: a second pass replaces both and leaves two pending", async () => {
    const later = NOW + 5 * 60 * 1000
    let clock = NOW
    const harness = createHarness({
      record: "the-birth-of-jesus",
      now: () => clock,
    })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")
    clock = later
    await lifecycle.runPass("background")

    const targets = computeLapseReminderTargets(later)
    expect(harness.adapter.pending.size).toBe(2)
    expect(harness.adapter.maxPending).toBe(2)
    expect(identifiersOf(harness.adapter)).toEqual(BOTH_IDENTIFIERS)
    for (const kind of KINDS) {
      expect(
        harness.adapter.pending
          .get(LAPSE_REMINDER_IDENTIFIERS[kind])
          ?.date.getTime(),
      ).toBe(targets[kind].getTime())
    }
  })

  it("stands down when permission is not granted (R9)", async () => {
    const harness = createHarness({ granted: false })
    harness.adapter.pending.set(LAPSE_REMINDER_IDENTIFIERS.day1, {
      body: "stale",
      data: {} as LapseReminderPayload,
      date: new Date(NOW),
    })
    harness.adapter.deliver(1)
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("active")

    expect(harness.adapter.pending.size).toBe(0)
    expect(harness.adapter.delivered).toBe(0)
    expect(harness.adapter.calls).toEqual([
      "permission",
      `cancel:${LAPSE_REMINDER_IDENTIFIERS.day1}`,
      `cancel:${LAPSE_REMINDER_IDENTIFIERS.day7}`,
      "dismiss",
    ])
    expect(harness.logs).toContainEqual({
      event: "lapse_reminder.pass",
      context: { pass_reason: "active", outcome: "not_granted" },
    })
  })

  it("stands down with the gate off, without reading permission (KTD8)", async () => {
    const harness = createHarness({ enabled: false, record: "washi-gospel" })
    harness.adapter.deliver(2)
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")

    expect(harness.adapter.permissionReads).toBe(0)
    expect(harness.adapter.pending.size).toBe(0)
    expect(harness.adapter.delivered).toBe(0)
    expect(harness.adapter.calls).toEqual([
      `cancel:${LAPSE_REMINDER_IDENTIFIERS.day1}`,
      `cancel:${LAPSE_REMINDER_IDENTIFIERS.day7}`,
      "dismiss",
    ])
    expect(harness.logs).toContainEqual({
      event: "lapse_reminder.pass",
      context: { pass_reason: "mount", outcome: "gate_off" },
    })
  })

  it("waits for the record hydration before it builds payloads", async () => {
    const harness = createHarness({ deferHydration: true })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    const pass = lifecycle.runPass("mount")
    await settle()
    // Nothing may be scheduled yet: the record is still absent, and scheduling
    // now would put Home in the payload of a user who has a real record.
    expect(harness.adapter.pending.size).toBe(0)

    harness.setRecord("the-birth-of-jesus")
    harness.resolveHydration()
    await pass

    for (const kind of KINDS) {
      expect(
        harness.adapter.pending.get(LAPSE_REMINDER_IDENTIFIERS[kind])?.data
          .target,
      ).toBe("forgemobile://watch/the-birth-of-jesus")
    }
  })

  it("targets Home when there is no record (R13)", async () => {
    const harness = createHarness({ record: null })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")

    for (const kind of KINDS) {
      expect(
        harness.adapter.pending.get(LAPSE_REMINDER_IDENTIFIERS[kind])?.data
          .target,
      ).toBe(LAPSE_REMINDER_HOME_TARGET)
    }
  })

  it("re-derives on a record clear and dismisses the tray (R18)", async () => {
    const harness = createHarness({ record: "the-birth-of-jesus" })
    const lifecycle = createLapseReminderLifecycle(harness.deps)
    const detach = lifecycle.attach()
    await settle()
    harness.adapter.deliver(1)

    harness.setRecord(null)
    harness.emitClear()
    await settle()

    expect(harness.adapter.delivered).toBe(0)
    expect(harness.adapter.pending.size).toBe(2)
    for (const kind of KINDS) {
      expect(
        harness.adapter.pending.get(LAPSE_REMINDER_IDENTIFIERS[kind])?.data
          .target,
      ).toBe(LAPSE_REMINDER_HOME_TARGET)
    }
    expect(harness.logs).toContainEqual({
      event: "lapse_reminder.pass",
      context: { pass_reason: "record_cleared", outcome: "scheduled" },
    })
    detach()
  })

  it("logs a failed schedule and leaves that identifier's reminder in place", async () => {
    let failing = false
    const harness = createHarness({
      record: "the-birth-of-jesus",
      failSchedule: (identifier) =>
        failing && identifier === LAPSE_REMINDER_IDENTIFIERS.day7,
    })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")
    const kept = harness.adapter.pending.get(LAPSE_REMINDER_IDENTIFIERS.day7)
    failing = true
    await lifecycle.runPass("background")

    expect(harness.adapter.pending.get(LAPSE_REMINDER_IDENTIFIERS.day7)).toBe(
      kept,
    )
    expect(harness.adapter.pending.size).toBe(2)
    expect(
      harness.logs.filter(
        (entry) => entry.event === "lapse_reminder.step_failed",
      ),
    ).toEqual([
      {
        event: "lapse_reminder.step_failed",
        context: {
          pass_reason: "background",
          step: "schedule",
          reminder_kind: "day7",
          error_message: "schedule failed",
        },
      },
    ])
  })

  it("survives an adapter that rejects on every call", async () => {
    const harness = createHarness({
      granted: false,
      failCancel: () => true,
      failDismiss: () => true,
    })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await expect(lifecycle.runPass("active")).resolves.toBeUndefined()

    expect(
      harness.logs
        .filter((entry) => entry.event === "lapse_reminder.step_failed")
        .map((entry) => entry.context.step),
    ).toEqual(["cancel", "cancel", "dismiss"])
  })

  it("leaves correct reminders alone when the permission read rejects", async () => {
    // A failed read says NOTHING about the permission. Cancelling here would
    // destroy two correct reminders on the last pass before a lapse.
    let permissionFails = false
    const harness = createHarness({ failPermission: () => permissionFails })
    const lifecycle = createLapseReminderLifecycle(harness.deps)
    await lifecycle.runPass("mount")
    expect(harness.adapter.pending.size).toBe(2)

    harness.adapter.calls.length = 0
    permissionFails = true
    await lifecycle.runPass("background")

    expect(harness.adapter.pending.size).toBe(2)
    expect(harness.adapter.calls).not.toContain("cancel:lapse-reminder-day1")
    expect(harness.adapter.calls).not.toContain("cancel:lapse-reminder-day7")
    expect(harness.adapter.calls).not.toContain("dismiss")
  })

  it("reports an unreadable permission apart from a denial", async () => {
    // The opt-in dashboard must not count a transient fault as an opt-out.
    const harness = createHarness({ failPermission: () => true })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("background")

    expect(harness.logs).toContainEqual({
      event: "lapse_reminder.pass",
      context: { pass_reason: "background", outcome: "permission_unreadable" },
    })
    expect(harness.logs).not.toContainEqual({
      event: "lapse_reminder.pass",
      context: { pass_reason: "background", outcome: "not_granted" },
    })
  })

  it("still stands down on a record clear when the permission is unreadable", async () => {
    // The one exception: removing the previous account's video outranks
    // keeping reminders whose correctness we can no longer confirm (R18).
    const harness = createHarness({ failPermission: () => true })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("record_cleared")

    expect(harness.adapter.pending.size).toBe(0)
    expect(harness.adapter.calls).toContain("dismiss")
    expect(harness.logs).toContainEqual({
      event: "lapse_reminder.pass",
      context: {
        pass_reason: "record_cleared",
        outcome: "permission_unreadable",
      },
    })
  })

  it("cancels an identifier whose re-schedule failed on a record clear", async () => {
    // R18: a reminder left pending after a failed re-schedule still carries the
    // signed-out account's video, and nothing runs again until the app is used.
    const harness = createHarness({
      failSchedule: (identifier) => identifier === "lapse-reminder-day7",
    })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("record_cleared")

    expect(harness.adapter.calls).toContain("cancel:lapse-reminder-day7")
    expect(harness.adapter.pending.has("lapse-reminder-day7")).toBe(false)
  })

  it("does NOT cancel a failed re-schedule on an ordinary pass", async () => {
    // Discriminates the clear path from the rest: on a mount or foreground
    // pass the previous reminder is still the right one to keep.
    const harness = createHarness({
      failSchedule: (identifier) => identifier === "lapse-reminder-day7",
    })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")

    expect(harness.adapter.calls).not.toContain("cancel:lapse-reminder-day7")
  })

  it("ensures the channel before it schedules, on every pass", async () => {
    // The prompt runs once per install. A channel created only there is gone
    // for the life of the install if that one call fails, and every later
    // reminder falls back to expo's own high-importance channel.
    const harness = createHarness()
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")
    harness.adapter.calls.length = 0
    await lifecycle.runPass("active")

    const channelAt = harness.adapter.calls.indexOf("channel")
    const firstScheduleAt = harness.adapter.calls.findIndex((call) =>
      call.startsWith("schedule:"),
    )
    expect(channelAt).toBeGreaterThanOrEqual(0)
    expect(channelAt).toBeLessThan(firstScheduleAt)
  })

  it("schedules anyway when the channel call fails", async () => {
    // iOS has no channels at all, and a failed upsert must not cost the
    // reminders themselves.
    const harness = createHarness({ failChannel: () => true })
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    await lifecycle.runPass("mount")

    expect(harness.adapter.pending.size).toBe(2)
    expect(
      harness.logs
        .filter((entry) => entry.event === "lapse_reminder.step_failed")
        .map((entry) => entry.context.step),
    ).toContain("channel")
  })
})

describe("the lapse reminder attach", () => {
  it("runs one pass on mount, with no app-state event", async () => {
    const harness = createHarness()
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    const detach = lifecycle.attach()
    await settle()

    expect(
      harness.logs.filter((entry) => entry.event === "lapse_reminder.pass"),
    ).toEqual([
      {
        event: "lapse_reminder.pass",
        context: { pass_reason: "mount", outcome: "scheduled" },
      },
    ])
    detach()
  })

  it("matched pair, iOS order: active, inactive, background runs two passes", async () => {
    const harness = createHarness()
    const lifecycle = createLapseReminderLifecycle(harness.deps)
    const detach = lifecycle.attach()
    await settle()

    harness.emitAppState("active")
    harness.emitAppState("inactive")
    harness.emitAppState("background")
    await settle()

    expect(
      harness.logs
        .filter((entry) => entry.event === "lapse_reminder.pass")
        .map((entry) => entry.context.pass_reason),
    ).toEqual(["mount", "active", "background"])
    detach()
  })

  it("matched pair, Android order: background then active runs two passes", async () => {
    const harness = createHarness()
    const lifecycle = createLapseReminderLifecycle(harness.deps)
    const detach = lifecycle.attach()
    await settle()

    harness.emitAppState("background")
    harness.emitAppState("active")
    await settle()

    expect(
      harness.logs
        .filter((entry) => entry.event === "lapse_reminder.pass")
        .map((entry) => entry.context.pass_reason),
    ).toEqual(["mount", "background", "active"])
    detach()
  })

  it("runs no pass for an inactive event on its own", async () => {
    // The discriminating fixture for the `inactive` filter: iOS reports it for
    // the notification shade and the app switcher, so keying on it would
    // reschedule on every shade pull.
    const harness = createHarness()
    const lifecycle = createLapseReminderLifecycle(harness.deps)
    const detach = lifecycle.attach()
    await settle()
    const afterMount = harness.logs.length

    harness.emitAppState("inactive")
    harness.emitAppState("unknown")
    await settle()

    expect(harness.logs.length).toBe(afterMount)
    detach()
  })

  it("enqueues the background pass before the handler returns", async () => {
    jest.useFakeTimers()
    try {
      const harness = createHarness()
      const lifecycle = createLapseReminderLifecycle(harness.deps)
      const detach = lifecycle.attach()
      await settle()
      harness.logs.length = 0

      harness.emitAppState("background")
      // Android can end the process before a deferred timer runs, so no timer
      // may stand between the handler and the pass.
      expect(jest.getTimerCount()).toBe(0)
      await settle()

      expect(harness.logs.map((entry) => entry.context.pass_reason)).toContain(
        "background",
      )
      detach()
    } finally {
      jest.useRealTimers()
    }
  })

  it("stops passing once detached, and only unsubscribes", async () => {
    const harness = createHarness()
    const lifecycle = createLapseReminderLifecycle(harness.deps)

    const detach = lifecycle.attach()
    await settle()
    expect(harness.appStateListenerCount()).toBe(1)
    expect(harness.clearListenerCount()).toBe(1)
    const calls = harness.adapter.calls.length

    detach()
    harness.emitAppState("active")
    harness.emitClear()
    await settle()

    expect(harness.appStateListenerCount()).toBe(0)
    expect(harness.clearListenerCount()).toBe(0)
    expect(harness.adapter.calls.length).toBe(calls)
  })

  it("serializes overlapping passes through one chain", async () => {
    const harness = createHarness({ record: "washi-gospel", latency: () => 3 })
    const lifecycle = createLapseReminderLifecycle(harness.deps)
    const detach = lifecycle.attach()

    harness.emitAppState("background")
    harness.emitAppState("active")
    harness.emitClear()
    await settle()

    // One pass finishes before the next begins, so no two passes interleave
    // their schedule calls under the same identifier.
    const scheduleRuns = harness.adapter.calls.filter((call) =>
      call.startsWith("schedule:"),
    )
    expect(scheduleRuns).toEqual(
      Array.from({ length: 4 }, () => [
        `schedule:${LAPSE_REMINDER_IDENTIFIERS.day1}`,
        `schedule:${LAPSE_REMINDER_IDENTIFIERS.day7}`,
      ]).flat(),
    )
    expect(harness.adapter.maxPending).toBe(2)
    detach()
  })

  it("never leaves more than two pending across a random event sequence", async () => {
    // Seeded so a failure is reproducible; mulberry32, inline because the app
    // ships no random helper.
    let seed = 0x9e3779b9
    const random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const harness = createHarness({
      record: "the-birth-of-jesus",
      latency: () => Math.floor(random() * 4),
    })
    const lifecycle = createLapseReminderLifecycle(harness.deps)
    const detach = lifecycle.attach()

    const events = ["active", "inactive", "background", "clear"] as const
    for (let step = 0; step < 300; step += 1) {
      const event = events[Math.floor(random() * events.length)]
      if (event === "clear") harness.emitClear()
      else harness.emitAppState(event)
      if (random() < 0.3) await settle()
      expect(harness.adapter.maxPending).toBeLessThanOrEqual(2)
    }
    await settle(20000)

    expect(harness.adapter.maxPending).toBe(2)
    expect(harness.adapter.pending.size).toBe(2)
    expect([...harness.adapter.identifiersUsed].sort()).toEqual(
      BOTH_IDENTIFIERS,
    )
    detach()
  })
})
