/**
 * The first-launch permission prompt (KTD6). The app asks once per install,
 * after the splash clears, behind a persisted asked-once latch, and records
 * what happened so the opt-in rate is readable (R8, R9, R16).
 *
 * Pure, with every dependency injected, the same shape as the schedule pass:
 * the provider wires the real adapter, the real latch, the splash session and
 * the logger. Nothing here reaches a native module or storage by itself.
 */

import { telemetryErrorMessage } from "../downloadErrors"
import type { LapseReminderTelemetry } from "./lifecycle"

/** The value the latch stores. Only its presence is read (R9). */
export const LAPSE_REMINDER_PERMISSION_ASKED_VALUE = "1"

/** R16's fixed set. `already_granted` keeps an automatic grant on older
 *  Android out of the opt-in rate, and `cannot_ask` keeps a settled denial
 *  apart from a fresh one. */
export type LapseReminderPromptOutcome =
  | "granted"
  | "denied"
  | "already_granted"
  | "cannot_ask"

/** What the prompt decided, with R16's "was a system prompt shown" flag. */
export type LapseReminderPromptResult = {
  outcome: LapseReminderPromptOutcome
  prompted: boolean
}

/** The step that failed, for the failure event. Mirrors the pass's own. */
export type LapseReminderPromptStep =
  | "latch_read"
  | "channel"
  | "permission_read"
  | "request"
  | "latch_write"

export type LapseReminderPermission = {
  granted: boolean
  canAskAgain: boolean
}

/** The slice of the notifications adapter the prompt needs. The pass owns its
 *  own narrower slice, so neither one carries calls it never makes. */
export type LapseReminderPermissionPort = {
  ensureChannel: () => Promise<void>
  getPermission: () => Promise<LapseReminderPermission>
  requestPermission: () => Promise<LapseReminderPermission>
}

/** What the prompt reads of the splash session. Wider snapshots are fine. */
export type LapseReminderSplashPort = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => { resolved: boolean; visible: boolean }
}

export type LapseReminderPermissionPromptDeps = {
  adapter: LapseReminderPermissionPort
  /** KTD8's build-time gate. */
  enabled: boolean
  splash: LapseReminderSplashPort
  /** The latch's stored value, or null when nobody has asked yet. */
  readAsked: () => Promise<string | null>
  writeAsked: () => Promise<void>
  /** Runs a schedule pass. The provider decides which reason it carries. */
  runPass: () => void
  /** Named `telemetry` on purpose: datadogReservedAttributes.guard only sweeps
   *  sinks spelled datadogLog, DdLogs or telemetry, so a rename makes every
   *  emit site below invisible to it. */
  telemetry: LapseReminderTelemetry
}

/**
 * R8's moment. `resolved` is load-bearing: the session's initial snapshot is
 * not visible either, so a bare `!visible` test prompts over a splash that is
 * about to be raised.
 */
export function isSplashCleared(snapshot: {
  resolved: boolean
  visible: boolean
}): boolean {
  return snapshot.resolved && !snapshot.visible
}

/** Any stored value means somebody already asked. Fail closed: an unreadable
 *  value must never be the reason a second prompt appears (R9). */
export function isPermissionAsked(raw: string | null): boolean {
  return raw != null
}

/**
 * The pre-request classification. Null is the one state that reaches the
 * system prompt; the other two settle without showing anything.
 */
export function classifyExistingPermission(
  permission: LapseReminderPermission,
): LapseReminderPromptResult | null {
  if (permission.granted) return { outcome: "already_granted", prompted: false }
  if (!permission.canAskAgain) return { outcome: "cannot_ask", prompted: false }
  return null
}

/** The answer to a prompt that was shown, so `prompted` is always true. */
export function classifyRequestedPermission(
  permission: LapseReminderPermission,
): LapseReminderPromptResult {
  return {
    outcome: permission.granted ? "granted" : "denied",
    prompted: true,
  }
}

/** Both granted outcomes schedule: the automatic one created the Android
 *  channel in this run, which the mount pass did not have. */
export function isGrantedOutcome(outcome: LapseReminderPromptOutcome): boolean {
  return outcome === "granted" || outcome === "already_granted"
}

/**
 * Attach the prompt. It waits for the splash, runs at most once, and returns a
 * detach function. Every piece of state is local to this call, so a StrictMode
 * remount gets a fresh prompt and the detached one stops at its next await.
 */
export function attachLapseReminderPermissionPrompt(
  deps: LapseReminderPermissionPromptDeps,
): () => void {
  // KTD8: an off build asks nothing, and the unwritten latch leaves the one
  // prompt for the first launch of a build that turns the feature on.
  if (!deps.enabled) return () => {}

  let active = true
  let started = false
  let unsubscribe: (() => void) | null = null

  function logFailure(step: LapseReminderPromptStep, error: unknown) {
    deps.telemetry.info("lapse_reminder.permission_failed", {
      step,
      // The repo's only sanctioned path for a caught error into telemetry: a
      // storage error can carry a path, and it strips those and caps length.
      error_message: telemetryErrorMessage(error),
    })
  }

  async function persistAsked() {
    try {
      await deps.writeAsked()
    } catch (error) {
      logFailure("latch_write", error)
    }
  }

  /** Settles the permission, asking the system only when it can be asked. */
  async function settlePermission(
    existing: LapseReminderPermission,
  ): Promise<LapseReminderPromptResult | null> {
    const decided = classifyExistingPermission(existing)
    if (decided != null) return decided
    if (!active) return null
    try {
      return classifyRequestedPermission(await deps.adapter.requestPermission())
    } catch (error) {
      // The system may already have drawn the prompt, so the latch still
      // closes: never asking twice outranks retrying a failed ask (R9).
      logFailure("request", error)
      await persistAsked()
      return null
    }
  }

  async function run() {
    let raw: string | null
    try {
      raw = await deps.readAsked()
    } catch (error) {
      // This launch asks nothing. The latch stays unwritten, so a readable
      // store on the next launch still gets its one prompt.
      logFailure("latch_read", error)
      return
    }
    if (!active || isPermissionAsked(raw)) return

    // KTD6: Android 13 shows no prompt until a channel exists. Before the READ
    // as well as the request, so the automatic-grant path creates it too.
    try {
      await deps.adapter.ensureChannel()
    } catch (error) {
      logFailure("channel", error)
    }
    if (!active) return

    let existing: LapseReminderPermission
    try {
      existing = await deps.adapter.getPermission()
    } catch (error) {
      // Nothing was shown, so the latch stays open for the next launch.
      logFailure("permission_read", error)
      return
    }

    const result = await settlePermission(existing)
    if (result == null) return
    await persistAsked()
    deps.telemetry.info("lapse_reminder.permission", {
      prompt_outcome: result.outcome,
      prompted: result.prompted,
    })
    if (active && isGrantedOutcome(result.outcome)) deps.runPass()
  }

  function startOnce() {
    if (started || !active) return
    started = true
    unsubscribe?.()
    unsubscribe = null
    void run()
  }

  unsubscribe = deps.splash.subscribe(() => {
    if (isSplashCleared(deps.splash.getSnapshot())) startOnce()
  })
  // Inert today: the splash is off, so the session settles its snapshot
  // synchronously and this branch runs. The wait is for the re-enable path.
  if (isSplashCleared(deps.splash.getSnapshot())) startOnce()

  return () => {
    active = false
    unsubscribe?.()
    unsubscribe = null
  }
}
