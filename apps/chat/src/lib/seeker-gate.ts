import "server-only"

import {
  featureFlags,
  type BooleanVariationDetail,
  type FeatureFlagContext,
  type FeatureFlagVariationSource,
} from "@forge/feature-flags"

import type { ChatIdentity } from "@/auth/session-cookie"
import { isSeekerChatEnabled as isSeekerChatEnabledFromEnv } from "@/config/env"

import { chatFeatureFlagClient } from "./feature-flags"

/** The two server surfaces that ask the gate: the RSC page and the seeker route. */
export type SeekerGateSurface = "page" | "route"

/** The fixed R15 outcome-code set — the only values that ever reach a log line. */
export type SeekerGateLoggedOutcome =
  | "granted"
  | "kill_switch"
  | "ld_unavailable"
  | "not_targeted"
  | "no_email"

/**
 * Full outcome set: the five R15 codes plus the anonymous short-circuit, which
 * exists only in the return value (R3 forbids flag evaluation for anonymous
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
 * the env kill-switch read, the singleton client's chatSeekerDogfood detail
 * evaluation, and console. Tests inject all three; callers pass only surface.
 */
export type SeekerGateOptions = {
  surface: SeekerGateSurface
  isSeekerChatEnabled?: () => boolean
  evaluateFlagDetail?: (
    context: FeatureFlagContext,
  ) => Promise<BooleanVariationDetail>
  logger?: Pick<Console, "log">
}

/**
 * The whole seeker gate decision for one signed-in-or-anonymous caller (KTD1):
 * kill switch → anonymous short-circuit → strict verified-email check → LD
 * flag evaluation keyed on the normalized email (KTD3), mapped to the R15
 * outcome codes. Emits the single plain-string gate log line for signed-in
 * identities — grants and denials alike — via the injected logger (KTD8).
 * Shared by page and route so both surfaces agree by construction (R6).
 */
export async function resolveSeekerGate(
  identity: ChatIdentity | null,
  options: SeekerGateOptions,
): Promise<SeekerGateDecision> {
  const {
    surface,
    isSeekerChatEnabled = isSeekerChatEnabledFromEnv,
    evaluateFlagDetail = (context: FeatureFlagContext) =>
      chatFeatureFlagClient.booleanVariationDetail(
        featureFlags.chatSeekerDogfood,
        context,
      ),
    logger = console,
  } = options

  // Kill switch first: nothing downstream (not even the flag) runs when off.
  if (!isSeekerChatEnabled()) {
    if (identity !== null) {
      logGateDecision(logger, surface, "kill_switch", identity.sub)
    }
    return { seekerEnabled: false, outcome: "kill_switch" }
  }

  // Anonymous short-circuit: no flag evaluation ever, no log line (R3, R15).
  if (identity === null) {
    return { seekerEnabled: false, outcome: "anonymous" }
  }

  // Strict verified-email check (R4): normalize first so a whitespace-only
  // claim reads as absent (no_email), never an empty LD context key.
  const email = identity.email?.trim().toLowerCase()
  if (!email || identity.emailVerified !== true) {
    logGateDecision(logger, surface, "no_email", identity.sub)
    return { seekerEnabled: false, outcome: "no_email" }
  }

  // KTD3: the normalized email IS the context key; no other attribute ships.
  const context: FeatureFlagContext = {
    kind: "user",
    key: email,
  }
  const { value, source } = await evaluateFlagDetail(context)

  // KTD4 mapping: true from ANY source grants; a false is only "not targeted"
  // when LD genuinely answered — fallback-chain falses are ld_unavailable.
  const outcome: SeekerGateLoggedOutcome = value
    ? "granted"
    : source === "launchdarkly"
      ? "not_targeted"
      : "ld_unavailable"

  logGateDecision(logger, surface, outcome, identity.sub, source)
  return { seekerEnabled: value, outcome }
}

/**
 * Emits the R15 gate-decision line: one plain string (Railway logsV2 silences
 * JSON payloads), attributed by the opaque sub — never the email (KTD8). The
 * source suffix appears only on evaluated outcomes; decision record, not an
 * error, hence logger.log.
 */
function logGateDecision(
  logger: Pick<Console, "log">,
  surface: SeekerGateSurface,
  outcome: SeekerGateLoggedOutcome,
  sub: string,
  source?: FeatureFlagVariationSource,
): void {
  const sourceSuffix = source === undefined ? "" : ` source=${source}`
  logger.log(
    `[seeker-gate] event=gate_decision surface=${surface} outcome=${outcome} sub=${sub}${sourceSuffix}`,
  )
}
