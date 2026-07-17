import "server-only"

import type { ChatIdentity } from "@/auth/session-cookie"
import {
  isSeekerChatEnabled as isSeekerChatEnabledFromEnv,
  isSeekerEmailAllowed as isSeekerEmailAllowedFromEnv,
} from "@/config/env"

/** The server surfaces that ask the gate: the RSC page, the seeker route, and
 * the feat-241 history proxies (one shared surface for list + thread). */
export type SeekerGateSurface = "page" | "route" | "history"

/** The fixed R15 outcome-code set — the only values that ever reach a log line. */
export type SeekerGateLoggedOutcome =
  | "granted"
  | "kill_switch"
  | "not_allowlisted"
  | "no_email"

/**
 * Full outcome set: the four R15 codes plus the anonymous short-circuit, which
 * exists only in the return value (R3 forbids a membership check for anonymous
 * visitors; R15 scopes logging to signed-in users — it is never logged).
 */
export type SeekerGateOutcome = SeekerGateLoggedOutcome | "anonymous"

/** What both surfaces consume: the enable decision plus its outcome code. */
export type SeekerGateDecision = {
  seekerEnabled: boolean
  outcome: SeekerGateOutcome
}

/**
 * Gate inputs: the calling surface (threaded into the R15 log line) plus the
 * three injectable dependencies, each defaulting to the app's real wiring —
 * the env kill-switch read, the SEEKER_ALLOWED_EMAILS membership check, and
 * console. Tests inject all three; callers pass only surface.
 */
export type SeekerGateOptions = {
  surface: SeekerGateSurface
  isSeekerChatEnabled?: () => boolean
  isEmailAllowed?: (email: string) => boolean
  logger?: Pick<Console, "log">
}

/**
 * The whole seeker gate decision for one signed-in-or-anonymous caller (KTD1):
 * kill switch → anonymous short-circuit → strict verified-email check →
 * SEEKER_ALLOWED_EMAILS membership on the normalized email (KTD3), mapped to
 * the R15 outcome codes. The membership source is the env CSV — feat-233's
 * LaunchDarkly flag, replaced; fail-closed stays structural (an unset or empty
 * allowlist admits no one, and no external service is left to be unavailable).
 * Emits the single plain-string gate log line for signed-in identities —
 * grants and denials alike — via the injected logger (KTD8). Shared by page
 * and route so both surfaces agree by construction (R6). Async is contract:
 * both call sites and the route's injected resolver expect a promise.
 */
export async function resolveSeekerGate(
  identity: ChatIdentity | null,
  options: SeekerGateOptions,
): Promise<SeekerGateDecision> {
  const {
    surface,
    isSeekerChatEnabled = isSeekerChatEnabledFromEnv,
    isEmailAllowed = isSeekerEmailAllowedFromEnv,
    logger = console,
  } = options

  // Kill switch first: nothing downstream (not even the allowlist) runs when off.
  if (!isSeekerChatEnabled()) {
    if (identity !== null) {
      logGateDecision(logger, surface, "kill_switch", identity.sub)
    }
    return { seekerEnabled: false, outcome: "kill_switch" }
  }

  // Anonymous short-circuit: no membership check ever, no log line (R3, R15).
  if (identity === null) {
    return { seekerEnabled: false, outcome: "anonymous" }
  }

  // Strict verified-email check (R4): normalize first so a whitespace-only
  // claim reads as absent (no_email), never an empty allowlist lookup.
  const email = identity.email?.trim().toLowerCase()
  if (!email || identity.emailVerified !== true) {
    logGateDecision(logger, surface, "no_email", identity.sub)
    return { seekerEnabled: false, outcome: "no_email" }
  }

  // KTD3: the normalized email IS the membership key; no other claim consulted.
  const granted = isEmailAllowed(email)
  const outcome: SeekerGateLoggedOutcome = granted
    ? "granted"
    : "not_allowlisted"

  logGateDecision(logger, surface, outcome, identity.sub)
  return { seekerEnabled: granted, outcome }
}

/**
 * Emits the R15 gate-decision line: one plain string (Railway logsV2 silences
 * JSON payloads), attributed by the opaque sub — never the email (KTD8).
 * Decision record, not an error, hence logger.log.
 */
function logGateDecision(
  logger: Pick<Console, "log">,
  surface: SeekerGateSurface,
  outcome: SeekerGateLoggedOutcome,
  sub: string,
): void {
  logger.log(
    `[seeker-gate] event=gate_decision surface=${surface} outcome=${outcome} sub=${sub}`,
  )
}
