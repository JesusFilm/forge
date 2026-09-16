/**
 * The reminder tap (KTD7). A tap arrives on one of two paths and never both:
 * on a cold start the OS replays it into the last response, and while the app
 * runs it arrives through the listener.
 *
 * The cold path waits for the experience selection to settle before it
 * navigates, because the experience shell swaps its element type once the
 * stored slug resolves and that remounts the navigation stack under any route
 * pushed before it. The wait is bounded, so a selection that never settles
 * delays the tap rather than losing it.
 *
 * Router-free and registry-free, with every dependency injected, the same split
 * the player host uses: the provider bridges the router and the selection.
 */

import type { DeepLinkEntry, DeepLinkOrigin } from "../deepLinkOrigin"
import type { LapseReminderKind } from "./constants"
import type { LapseReminderTelemetry } from "./lifecycle"
import {
  parseLapseReminderPayload,
  type LapseReminderParseReason,
} from "./payload"

/**
 * KTD7's bound on the cold wait. Long enough for the shell's stored-slug read,
 * short enough that a viewer who tapped a reminder is not left on Home.
 */
export const LAPSE_REMINDER_TAP_DEADLINE_MS = 3_000

/** Where a tap sends the viewer. */
export type LapseReminderTapTarget =
  | { screen: "watch"; slug: string }
  | { screen: "home" }

/** What a tap did. A fixed set, because KTD9 facets on it. */
export type LapseReminderTapOutcome = "watch" | "home" | "rejected" | "gate_off"

/** The dependency that failed, for the failure event. Mirrors the pass's own. */
export type LapseReminderTapStep =
  | "read"
  | "subscribe"
  | "register"
  | "navigate"
  | "clear"

/** The whole decision, and nothing from the payload that made it (KTD4). */
export type LapseReminderTapDecision = {
  /** Null means navigate nowhere, which only the build-time gate produces. */
  target: LapseReminderTapTarget | null
  outcome: LapseReminderTapOutcome
  reminderKind: LapseReminderKind | null
  slug: string | null
  reason: LapseReminderParseReason | null
}

/** What the experience selection looks like to the cold wait. */
export type LapseReminderSelection = {
  isReady: boolean
  slug: string | null
}

/**
 * The slice of the notifications adapter a tap needs. The pass and the prompt
 * own their own narrower slices, so none of the three carries a call it never
 * makes.
 */
export type LapseReminderTapPort = {
  getLastResponseData: () => unknown
  clearLastResponse: () => void
  subscribeToResponses: (listener: (data: unknown) => void) => () => void
}

export type LapseReminderTapDeps = {
  adapter: LapseReminderTapPort
  /** KTD8's build-time gate. Off still consumes a tap; it only never navigates. */
  enabled: boolean
  navigate: (target: LapseReminderTapTarget) => void
  /** Keyed by the VALIDATED slug, never by the payload's own url: the deep-link
   *  url parser strips a `.html` suffix, so a url-keyed arrival for such a slug
   *  is filed under a name the watch route never consumes. */
  registerArrival: (
    slug: string,
    entry: DeepLinkEntry,
    origin: DeepLinkOrigin,
  ) => void
  /** Named `telemetry` on purpose: datadogReservedAttributes.guard only sweeps
   *  sinks spelled datadogLog, DdLogs or telemetry, so a rename makes every
   *  emit site below invisible to it. */
  telemetry: LapseReminderTelemetry
}

export type LapseReminderTapHandler = {
  attach: () => () => void
  /** The provider calls this on every experience-selection change. */
  selectionChanged: (selection: LapseReminderSelection) => void
}

/**
 * Validates one arriving payload and decides where it sends the viewer. Pure,
 * and it returns nothing the payload carried beyond the validated slug: KTD9
 * facets on the kind, the outcome and the reason, all fixed sets.
 */
export function decideLapseReminderTap(
  data: unknown,
  enabled: boolean,
): LapseReminderTapDecision {
  const parsed = parseLapseReminderPayload(data)
  const reminderKind = parsed.ok ? parsed.kind : null
  const slug = parsed.ok ? parsed.slug : null
  const reason = parsed.ok ? null : parsed.reason

  // KTD8: an off build still names the tap it consumed, so a reminder left
  // pending by an earlier build stays visible instead of going quiet.
  if (!enabled) {
    return { target: null, outcome: "gate_off", reminderKind, slug, reason }
  }
  if (slug != null) {
    return {
      target: { screen: "watch", slug },
      outcome: "watch",
      reminderKind,
      slug,
      reason,
    }
  }
  // R13: the Home marker and every rejected payload both land on Home. The
  // outcome keeps them apart, and only a rejection carries a reason.
  return {
    target: { screen: "home" },
    outcome: parsed.ok ? "home" : "rejected",
    reminderKind,
    slug,
    reason,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Attach the tap handler. Every piece of state is local to this call, so a
 * StrictMode remount gets a fresh one and the detached one settles nothing.
 */
export function createLapseReminderTapHandler(
  deps: LapseReminderTapDeps,
): LapseReminderTapHandler {
  let active = false
  let pending: { data: unknown } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function logFailure(step: LapseReminderTapStep, error: unknown) {
    deps.telemetry.info("lapse_reminder.tap_failed", {
      step,
      error_message: messageOf(error),
    })
  }

  function clearWait() {
    pending = null
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function consume(data: unknown, arrival: DeepLinkEntry) {
    const decision = decideLapseReminderTap(data, deps.enabled)
    const target = decision.target
    if (target != null && target.screen === "watch") {
      try {
        deps.registerArrival(target.slug, arrival, "reminder")
      } catch (error) {
        logFailure("register", error)
      }
    }
    if (target != null) {
      try {
        deps.navigate(target)
      } catch (error) {
        logFailure("navigate", error)
      }
    }
    deps.telemetry.info("lapse_reminder.tap", {
      outcome: decision.outcome,
      arrival,
      reminder_kind: decision.reminderKind,
      content_id: decision.slug,
      parse_reason: decision.reason,
    })
    // After a failed navigation too: an uncleared response is read again on
    // every later attach, so the tap would replay for the life of the install.
    try {
      deps.adapter.clearLastResponse()
    } catch (error) {
      logFailure("clear", error)
    }
  }

  function settleCold() {
    if (!active || pending == null) return
    const { data } = pending
    clearWait()
    consume(data, "cold")
  }

  function attach(): () => void {
    active = true
    let unsubscribe = () => {}
    try {
      unsubscribe = deps.adapter.subscribeToResponses((data) => {
        if (!active) return
        // A warm tap needs no wait, and it outranks a cold one still waiting:
        // the older target is no longer the video the viewer asked for.
        clearWait()
        consume(data, "warm")
      })
    } catch (error) {
      logFailure("subscribe", error)
    }

    let last: unknown = null
    try {
      last = deps.adapter.getLastResponseData()
    } catch (error) {
      logFailure("read", error)
    }
    if (last != null) {
      // With the gate off there is no navigation, so there is nothing to wait
      // for: consume it now and leave nothing pending.
      if (!deps.enabled) consume(last, "cold")
      else {
        pending = { data: last }
        timer = setTimeout(settleCold, LAPSE_REMINDER_TAP_DEADLINE_MS)
      }
    }

    return () => {
      active = false
      clearWait()
      unsubscribe()
    }
  }

  function selectionChanged(selection: LapseReminderSelection) {
    if (!selection.isReady || selection.slug == null) return
    settleCold()
  }

  return { attach, selectionChanged }
}
