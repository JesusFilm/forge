/**
 * The schedule pass (KTD2). One pass runs on mount, on `active`, on
 * `background`, and on a record clear, and every pass goes through one promise
 * chain, so two passes never interleave their calls.
 *
 * The pass schedules under two fixed identifiers, which REPLACES whatever is
 * pending under them. That is what holds R5's two-at-most bound by
 * construction: there is never a moment between a cancel and a schedule with
 * nothing pending. Pure, with every dependency injected; the provider wires the
 * real adapter, record store, clock, gate, and logger.
 */

import {
  LAPSE_REMINDER_COPY,
  LAPSE_REMINDER_IDENTIFIERS,
  type LapseReminderKind,
} from "./constants"
import { buildLapseReminderPayload, type LapseReminderPayload } from "./payload"
import { computeLapseReminderTargets } from "./schedule"

/** R5's two kinds, in the order a pass schedules them. */
const REMINDER_KINDS: readonly LapseReminderKind[] = ["day1", "day7"]

/** Why a pass ran. A fixed set, because KTD9 facets on it. */
export type LapseReminderPassReason =
  | "mount"
  | "active"
  | "background"
  | "record_cleared"

/** What a pass did. Also fixed for KTD9. */
export type LapseReminderPassOutcome = "scheduled" | "not_granted" | "gate_off"

/** The adapter call that failed, for the step-failure event. */
export type LapseReminderPassStep =
  | "permission"
  | "schedule"
  | "cancel"
  | "dismiss"

/**
 * The narrow slice of the notifications adapter a pass needs. The real adapter
 * is wider — U5 requests permission and U6 reads the tap — so the port stays
 * here, where its consumer can see all of it.
 */
export type LapseReminderSchedulingPort = {
  getPermission: () => Promise<{ granted: boolean }>
  schedule: (input: {
    identifier: string
    body: string
    data: LapseReminderPayload
    date: Date
  }) => Promise<void>
  cancel: (identifier: string) => Promise<void>
  dismissDelivered: () => Promise<void>
}

export type LapseReminderLifecycleDeps = {
  adapter: LapseReminderSchedulingPort
  /** KTD8's build-time gate. Off still runs the pass; it only never schedules. */
  enabled: boolean
  getRecord: () => { videoSlug: string } | null
  /** Bounded and never rejecting. Awaited before any payload is built, or a
   *  cold launch would overwrite a real record with Home. */
  hydrateRecord: () => Promise<void>
  subscribeToRecordClear: (listener: () => void) => () => void
  subscribeToAppState: (listener: (state: string) => void) => () => void
  now: () => number
  /** Named `telemetry` on purpose: datadogReservedAttributes.guard only sweeps
   *  sinks spelled datadogLog, DdLogs or telemetry, so a rename makes every
   *  emit site below invisible to it. */
  telemetry: LapseReminderTelemetry
}

/**
 * The injected sink, shaped so the provider passes `datadogLog` whole. KTD9
 * puts every event at info; warn and error are here for U5 and U6 and to match
 * the repo's existing `DownloadTelemetry` shape.
 */
export type LapseReminderTelemetry = {
  info: (event: string, context: Record<string, unknown>) => void
  warn: (event: string, context: Record<string, unknown>) => void
  error: (event: string, context: Record<string, unknown>) => void
}

export type LapseReminderLifecycle = {
  runPass: (reason: LapseReminderPassReason) => Promise<void>
  attach: () => () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createLapseReminderLifecycle(
  deps: LapseReminderLifecycleDeps,
): LapseReminderLifecycle {
  function logStepFailure(
    reason: LapseReminderPassReason,
    step: LapseReminderPassStep,
    kind: LapseReminderKind | null,
    error: unknown,
  ) {
    deps.telemetry.info("lapse_reminder.step_failed", {
      pass_reason: reason,
      step,
      ...(kind == null ? {} : { reminder_kind: kind }),
      error_message: messageOf(error),
    })
  }

  async function dismissDelivered(reason: LapseReminderPassReason) {
    try {
      await deps.adapter.dismissDelivered()
    } catch (error) {
      logStepFailure(reason, "dismiss", null, error)
    }
  }

  /** The denied, revoked, disabled and failed paths all end here: cancel both
   *  identifiers and empty the tray, so nothing stale survives them. */
  async function standDown(
    reason: LapseReminderPassReason,
    outcome: LapseReminderPassOutcome,
  ) {
    for (const kind of REMINDER_KINDS) {
      try {
        await deps.adapter.cancel(LAPSE_REMINDER_IDENTIFIERS[kind])
      } catch (error) {
        logStepFailure(reason, "cancel", kind, error)
      }
    }
    await dismissDelivered(reason)
    deps.telemetry.info("lapse_reminder.pass", { pass_reason: reason, outcome })
  }

  async function isGranted(reason: LapseReminderPassReason): Promise<boolean> {
    try {
      return (await deps.adapter.getPermission()).granted
    } catch (error) {
      logStepFailure(reason, "permission", null, error)
      return false
    }
  }

  async function runOnce(reason: LapseReminderPassReason) {
    try {
      await deps.hydrateRecord()
    } catch {
      // A failed read leaves the record absent, which reminders read as Home.
    }
    if (!deps.enabled) {
      await standDown(reason, "gate_off")
      return
    }
    if (!(await isGranted(reason))) {
      await standDown(reason, "not_granted")
      return
    }
    // R18: a clear must also take the old video out of the tray, not just out
    // of what is pending.
    if (reason === "record_cleared") await dismissDelivered(reason)

    const record = deps.getRecord()
    const targets = computeLapseReminderTargets(deps.now())
    for (const kind of REMINDER_KINDS) {
      try {
        await deps.adapter.schedule({
          identifier: LAPSE_REMINDER_IDENTIFIERS[kind],
          body: LAPSE_REMINDER_COPY[kind],
          // The record names its slug `videoSlug`; the payload takes `slug`.
          data: buildLapseReminderPayload(
            kind,
            record == null ? null : { slug: record.videoSlug },
          ),
          date: targets[kind],
        })
      } catch (error) {
        logStepFailure(reason, "schedule", kind, error)
      }
    }
    deps.telemetry.info("lapse_reminder.pass", {
      pass_reason: reason,
      outcome: "scheduled",
    })
  }

  let chain: Promise<unknown> = Promise.resolve()

  function runPass(reason: LapseReminderPassReason): Promise<void> {
    const step = () => runOnce(reason)
    // Both arms, so one failed pass cannot stop the chain (watchProgress).
    const next = chain.then(step, step).catch(() => undefined)
    chain = next
    return next
  }

  function attach(): () => void {
    const unsubscribeAppState = deps.subscribeToAppState((state) => {
      // Synchronous, not on a later tick: Android can end the process before a
      // deferred timer runs. iOS reports `inactive` for the notification shade
      // and the app switcher, so keying on it would reschedule on every pull.
      if (state === "active") void runPass("active")
      else if (state === "background") void runPass("background")
    })
    const unsubscribeClear = deps.subscribeToRecordClear(() => {
      void runPass("record_cleared")
    })
    void runPass("mount")
    return () => {
      unsubscribeAppState()
      unsubscribeClear()
    }
  }

  return { runPass, attach }
}
