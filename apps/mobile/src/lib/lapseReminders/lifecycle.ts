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

import { telemetryErrorMessage } from "../downloadErrors"
import { withTimeout } from "../withTimeout"
import {
  LAPSE_REMINDER_COPY,
  LAPSE_REMINDER_IDENTIFIERS,
  LAPSE_REMINDER_KINDS,
  type LapseReminderKind,
} from "./constants"
import { buildLapseReminderPayload, type LapseReminderPayload } from "./payload"
import { computeLapseReminderTargets } from "./schedule"

/**
 * One budget for each adapter call, so a native call that never settles cannot
 * wedge the chain that every pass runs on. No caller sets a deadline here, so
 * this is the tap handler's cold wait: far above a bridge call, below a freeze.
 */
export const LAPSE_REMINDER_ADAPTER_DEADLINE_MS = 3_000

/** Why a pass ran. A fixed set, because KTD9 facets on it. */
export type LapseReminderPassReason =
  | "mount"
  | "active"
  | "background"
  | "record_cleared"

/** What a pass did. Also fixed for KTD9. */
export type LapseReminderPassOutcome =
  | "scheduled"
  | "not_granted"
  | "gate_off"
  | "permission_unreadable"

/** The adapter call that failed, for the step-failure event. */
export type LapseReminderPassStep =
  | "permission"
  | "channel"
  | "schedule"
  | "cancel"
  | "dismiss"

/**
 * The narrow slice of the notifications adapter a pass needs. The real adapter
 * is wider — U5 requests permission and U6 reads the tap — so the port stays
 * here, where its consumer can see all of it.
 */
export type LapseReminderSchedulingPort = {
  /** Idempotent upsert, owned by the pass rather than by the one-shot prompt.
   *  A channel created only on the prompt's single launch is gone for the life
   *  of the install if that one call fails. */
  ensureChannel: () => Promise<void>
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
      // The repo's only sanctioned path for a caught error into telemetry: it
      // strips urls and paths and caps the length. A native scheduling error
      // can echo the request, which carries a forgemobile://watch/<slug> url.
      error_message: telemetryErrorMessage(error),
    })
  }

  /** Each removal step reports whether it landed, so a clear that could not
   *  finish can hand the rest of its cleanup to the next pass. */
  async function dismissDelivered(
    reason: LapseReminderPassReason,
  ): Promise<boolean> {
    try {
      await withTimeout(
        deps.adapter.dismissDelivered(),
        LAPSE_REMINDER_ADAPTER_DEADLINE_MS,
      )
      return true
    } catch (error) {
      logStepFailure(reason, "dismiss", null, error)
      return false
    }
  }

  async function cancelReminder(
    reason: LapseReminderPassReason,
    kind: LapseReminderKind,
  ): Promise<boolean> {
    try {
      await withTimeout(
        deps.adapter.cancel(LAPSE_REMINDER_IDENTIFIERS[kind]),
        LAPSE_REMINDER_ADAPTER_DEADLINE_MS,
      )
      return true
    } catch (error) {
      logStepFailure(reason, "cancel", kind, error)
      return false
    }
  }

  /** The denied, revoked, disabled and failed paths all end here: cancel both
   *  identifiers and empty the tray, so nothing stale survives them. */
  async function standDown(
    reason: LapseReminderPassReason,
    outcome: LapseReminderPassOutcome,
  ): Promise<boolean> {
    let cleaned = true
    for (const kind of LAPSE_REMINDER_KINDS) {
      if (!(await cancelReminder(reason, kind))) cleaned = false
    }
    if (!(await dismissDelivered(reason))) cleaned = false
    deps.telemetry.info("lapse_reminder.pass", { pass_reason: reason, outcome })
    return cleaned
  }

  /** A read that FAILED is not a denial. The two stay apart: one is the
   *  viewer's choice, the other is a transient fault that says nothing. */
  async function readPermission(
    reason: LapseReminderPassReason,
  ): Promise<"granted" | "denied" | "unreadable"> {
    try {
      const status = await withTimeout(
        deps.adapter.getPermission(),
        LAPSE_REMINDER_ADAPTER_DEADLINE_MS,
      )
      return status.granted ? "granted" : "denied"
    } catch (error) {
      logStepFailure(reason, "permission", null, error)
      return "unreadable"
    }
  }

  /** A clear is the only pass that empties the tray, and only a sign-out makes
   *  another clear. A cleanup that did not land latches here, so the next
   *  ordinary pass finishes it instead of waiting for that sign-out. */
  let clearCleanupPending = false

  async function runOnce(reason: LapseReminderPassReason) {
    const clearing = reason === "record_cleared" || clearCleanupPending
    let cleaned = true
    try {
      try {
        await deps.hydrateRecord()
      } catch {
        // A failed read leaves the record absent, which reminders read as Home.
      }
      if (!deps.enabled) {
        cleaned = await standDown(reason, "gate_off")
        return
      }
      const permission = await readPermission(reason)
      if (permission === "denied") {
        cleaned = await standDown(reason, "not_granted")
        return
      }
      if (permission === "unreadable") {
        // Cancelling here destroys reminders that were correct, and reporting a
        // denial bills a transient fault to the opt-in rate. A clear is the one
        // exception: removing the previous account's video still wins.
        if (clearing) {
          cleaned = await standDown(reason, "permission_unreadable")
          return
        }
        deps.telemetry.info("lapse_reminder.pass", {
          pass_reason: reason,
          outcome: "permission_unreadable",
        })
        return
      }
      // R18: a clear must also take the old video out of the tray, not just out
      // of what is pending.
      if (clearing) cleaned = await dismissDelivered(reason)

      try {
        await withTimeout(
          deps.adapter.ensureChannel(),
          LAPSE_REMINDER_ADAPTER_DEADLINE_MS,
        )
      } catch (error) {
        logStepFailure(reason, "channel", null, error)
      }

      const record = deps.getRecord()
      const targets = computeLapseReminderTargets(deps.now())
      for (const kind of LAPSE_REMINDER_KINDS) {
        try {
          await withTimeout(
            deps.adapter.schedule({
              identifier: LAPSE_REMINDER_IDENTIFIERS[kind],
              body: LAPSE_REMINDER_COPY[kind],
              // The record names its slug `videoSlug`; the payload takes `slug`.
              data: buildLapseReminderPayload(
                kind,
                record == null ? null : { slug: record.videoSlug },
              ),
              date: targets[kind],
            }),
            LAPSE_REMINDER_ADAPTER_DEADLINE_MS,
          )
        } catch (error) {
          logStepFailure(reason, "schedule", kind, error)
          // On a clear, removal outranks freshness: a reminder left pending here
          // still carries the previous account's video (R18).
          if (clearing && !(await cancelReminder(reason, kind))) cleaned = false
        }
      }
      deps.telemetry.info("lapse_reminder.pass", {
        pass_reason: reason,
        outcome: "scheduled",
      })
    } finally {
      clearCleanupPending = clearing && !cleaned
    }
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
