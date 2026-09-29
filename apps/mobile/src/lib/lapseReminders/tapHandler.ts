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
import { telemetryErrorMessage } from "../downloadErrors"
import {
  notificationFamily,
  parsePushAnnouncementPayload,
  pushAnnouncementNonce,
  type NotificationFamily,
  type PushAnnouncementKind,
  type PushAnnouncementParseReason,
} from "../push/announcementPayload"
import { PUSH_UNRESOLVABLE_DESTINATION_MESSAGE } from "../push/copy"
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

/** Where a tap sends the viewer. The three slug routes plus Home. */
export type LapseReminderTapTarget =
  | { screen: "watch"; slug: string }
  | { screen: "series"; slug: string }
  | { screen: "experience"; slug: string }
  | { screen: "home" }

/** What a tap did. A fixed set, because KTD9 facets on it. */
export type LapseReminderTapOutcome =
  | "watch"
  | "series"
  | "experience"
  | "home"
  | "rejected"
  | "gate_off"
  /** An announcement whose destination this build cannot read (R21). */
  | "unresolvable"

/** The dependency that failed, for the failure event. Mirrors the pass's own. */
export type LapseReminderTapStep =
  | "read"
  | "subscribe"
  | "register"
  | "report"
  | "notice"
  | "navigate"
  | "clear"

/** The whole decision, and nothing from the payload that made it (KTD4). */
export type LapseReminderTapDecision = {
  /** Null means navigate nowhere, which only the build-time gate produces. */
  target: LapseReminderTapTarget | null
  outcome: LapseReminderTapOutcome
  /** Which payload contract matched (KTD9). */
  family: NotificationFamily
  reminderKind: LapseReminderKind | null
  /** The announcement destination kind; null on the reminder family. */
  destinationKind: PushAnnouncementKind | null
  slug: string | null
  reason: LapseReminderParseReason | PushAnnouncementParseReason | null
  /** The opaque campaign identifier, for the open report (KTD14). */
  nonce: string | null
  /** True when the viewer must be told the destination could not be opened. */
  notice: boolean
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
   *  is filed under a name the watch route never consumes. The campaign
   *  identifier rides along so the watch route can mark the acquisition. */
  registerArrival: (
    slug: string,
    entry: DeepLinkEntry,
    origin: DeepLinkOrigin,
    campaign: string | null,
  ) => void
  /** R23: starts one open report and returns. It must never block navigation,
   *  and KTD7 defers a rate limit rather than retrying it. */
  reportOpen: (nonce: string) => void
  /** R21's message surface, for a destination this build cannot read. */
  showNotice: (message: string) => void
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

/** The route each destination kind opens (R20). */
const ANNOUNCEMENT_SCREENS: Record<
  PushAnnouncementKind,
  "watch" | "series" | "experience"
> = {
  video: "watch",
  series: "series",
  experience: "experience",
}

/**
 * One announcement's destination (R20, R21, R30). It never checks whether the
 * destination still exists: that route owns its own not-found screen, and a
 * check would delay every cold tap by a round trip.
 */
function decideAnnouncementTap(data: unknown): LapseReminderTapDecision {
  const parsed = parsePushAnnouncementPayload(data)
  if (!parsed.ok) {
    return {
      target: { screen: "home" },
      outcome: "unresolvable",
      family: "announcement",
      reminderKind: null,
      destinationKind: null,
      slug: null,
      reason: parsed.reason,
      // R23: a tap on a destination this build cannot read is still an OPEN, so
      // the report must not under-count it when admin names a newer kind.
      nonce: pushAnnouncementNonce(data),
      notice: true,
    }
  }
  const screen = ANNOUNCEMENT_SCREENS[parsed.kind]
  return {
    target: { screen, slug: parsed.slug },
    outcome: screen,
    family: "announcement",
    reminderKind: null,
    destinationKind: parsed.kind,
    slug: parsed.slug,
    reason: null,
    nonce: parsed.nonce,
    notice: false,
  }
}

/**
 * Validates one arriving payload and decides where it sends the viewer. Pure,
 * and it returns nothing the payload carried beyond the validated slug and the
 * opaque campaign identifier: KTD9 facets on the kinds, the outcome and the
 * reason, all fixed sets.
 */
export function decideLapseReminderTap(
  data: unknown,
  enabled: boolean,
): LapseReminderTapDecision {
  // KTD9: dispatch by family first. Anything without the announcement
  // discriminator is a reminder, so a reminder pending from an older build
  // still routes exactly as it did.
  //
  // `enabled` is the LOCAL reminders' gate, so an announcement ignores it: the
  // push service already delivered that notification, and KTD12 keeps an
  // already-delivered notification's open working whatever a switch says.
  if (notificationFamily(data) === "announcement") {
    return decideAnnouncementTap(data)
  }

  const parsed = parseLapseReminderPayload(data)
  const reminderKind = parsed.ok ? parsed.kind : null
  const slug = parsed.ok ? parsed.slug : null
  const reason = parsed.ok ? null : parsed.reason
  const base = {
    family: "reminder" as const,
    reminderKind,
    destinationKind: null,
    slug,
    reason,
    nonce: null,
    notice: false,
  }

  // KTD8: an off build still names the tap it consumed, so a reminder left
  // pending by an earlier build stays visible instead of going quiet.
  if (!enabled) {
    return { ...base, target: null, outcome: "gate_off" }
  }
  if (slug != null) {
    return { ...base, target: { screen: "watch", slug }, outcome: "watch" }
  }
  // R13: the Home marker and every rejected payload both land on Home. The
  // outcome keeps them apart, and only a rejection carries a reason.
  return {
    ...base,
    target: { screen: "home" },
    outcome: parsed.ok ? "home" : "rejected",
  }
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
      // The repo's only sanctioned path for a caught error into telemetry. A
      // failed navigate echoes the attempted href, so this strips the path.
      error_message: telemetryErrorMessage(error),
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
    // R23: before the navigation, and fire-and-forget, so a slow or failing
    // report cannot delay the screen the viewer asked for.
    if (decision.nonce != null) {
      try {
        deps.reportOpen(decision.nonce)
      } catch (error) {
        logFailure("report", error)
      }
    }
    if (target != null && target.screen === "watch") {
      try {
        deps.registerArrival(
          target.slug,
          arrival,
          decision.family === "announcement" ? "campaign" : "reminder",
          decision.nonce,
        )
      } catch (error) {
        logFailure("register", error)
      }
    }
    if (decision.notice) {
      try {
        deps.showNotice(PUSH_UNRESOLVABLE_DESTINATION_MESSAGE)
      } catch (error) {
        logFailure("notice", error)
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
      family: decision.family,
      reminder_kind: decision.reminderKind,
      destination_kind: decision.destinationKind,
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
      // for: consume it now and leave nothing pending. An announcement still
      // navigates with that gate off, so it still waits for the selection.
      const navigates =
        deps.enabled || notificationFamily(last) === "announcement"
      if (!navigates) consume(last, "cold")
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
