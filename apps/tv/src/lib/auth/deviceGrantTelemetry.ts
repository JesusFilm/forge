// Device-grant telemetry (feat-322 U4.8, R8: no PII once accounts exist).
//
// TV's Datadog posture is zero-PII by construction — no `setUser`/`setUserInfo`
// anywhere in the app, and RUM action names come from `accessibilityLabel`, so a
// label carrying user text becomes telemetry. Sign-in is the first surface where
// that posture had something to protect, so the emitters below are the ONLY way
// device-grant signals reach Datadog, and every free-form string they accept is
// sanitized inside the function where a caller cannot skip it.
//
// The specific hazard, named in the plan: a `/token` error string can embed
// `verification_uri_complete`, which carries `?user_code=…`. That is the live
// sign-in code, on screen, one URL away from a phone that grants an account —
// telemetry is not where it should also exist. `sanitizeDeviceGrantDetail` is
// therefore code-shaped-token redaction FIRST and truncation LAST: capping first
// would still ship a guessable prefix.

import { datadogLog, reportDatadogAction } from "../datadog"

/** Free-form detail is capped hard — an upstream error string is not a payload. */
export const MAX_DETAIL_LENGTH = 120

export const REDACTED = "[redacted]"

/**
 * Patterns that could carry the user code, most specific first.
 *
 * The server's format is ten digits (`DEVICE_USER_CODE_FORMAT = "numbers"` in
 * `apps/auth/src/services/device-grant.service.ts`), which is what the numeric
 * rules target. The consonant rule covers the letters format the same constant
 * can be flipped to — a server-side change that would otherwise silently
 * reopen the leak on every already-installed TV.
 */
const CODE_PATTERNS: readonly RegExp[] = [
  // `user_code=0194507302`, `user_code%3D…`, `"userCode":"…"` — the parameter
  // itself, whatever follows it, before any URL handling.
  /user[_-]?code(["']?\s*[=:]\s*["']?|%3D)[^\s"'&,;)]*/gi,
  // Six or more digits, tolerating one separator between them: catches
  // `0194507302`, `019-450-7302`, `019 450 7302`.
  /\d(?:[\s-]?\d){5,}/g,
  // The letters format: 8 consonants, optionally hyphenated 4-4.
  /\b[BCDFGHJKLMNPQRSTVWXZ]{4}-?[BCDFGHJKLMNPQRSTVWXZ]{4}\b/gi,
]

/** Strips the query and fragment off any URL in the string. */
function stripUrlTails(value: string): string {
  return value.replace(/(https?:\/\/[^\s]*)/gi, (url) =>
    url.replace(/[?#].*$/, ""),
  )
}

/**
 * Make an arbitrary upstream string safe to report.
 *
 * Order is load-bearing:
 *  1. strip URL query/fragment — where `verification_uri_complete` hides it;
 *  2. redact code-shaped tokens ANYWHERE — the code also appears in prose,
 *     in JSON bodies, and in URLs this app never constructed;
 *  3. flatten newlines/tabs — a multi-line error otherwise fragments the log
 *     line and can smuggle a code past a single-line eyeball check;
 *  4. cap length LAST, so truncation can never publish a code prefix.
 */
export function sanitizeDeviceGrantDetail(value: unknown): string {
  const raw =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : String(value)

  let out = stripUrlTails(raw)
  for (const pattern of CODE_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  out = out.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ")
  return out.trim().slice(0, MAX_DETAIL_LENGTH)
}

// ── Signals ─────────────────────────────────────────────────────────────────
//
// Names are namespaced `device_grant.*` so one Datadog facet covers the whole
// sign-in surface. Contexts carry counts, closed unions and sanitized strings —
// never an id, an email, a token or a code.

export const DEVICE_GRANT_APPROVED_ACTION = "device_grant.approved"

export function reportDeviceGrantCodeRequested(): void {
  datadogLog.info("device_grant.code_requested", {})
}

export function reportDeviceGrantCodeRequestFailed(reason: unknown): void {
  datadogLog.warn("device_grant.code_request_failed", {
    reason: sanitizeDeviceGrantDetail(reason),
  })
}

/** The success signal. `waited_seconds` is how long the QR was on screen — the
 *  activation metric — and is a duration, not an identifier. */
export function reportDeviceGrantApproved(waitedSeconds: number): void {
  reportDatadogAction(DEVICE_GRANT_APPROVED_ACTION, {
    waited_seconds: Math.max(0, Math.round(waitedSeconds)),
  })
}

export function reportDeviceGrantDenied(): void {
  datadogLog.info("device_grant.denied", {})
}

export function reportDeviceGrantExpired(): void {
  datadogLog.info("device_grant.expired", {})
}

/** A terminal error from the poll. `code` is an RFC 8628 error code in the
 *  expected case, but it comes off the wire, so it is sanitized like any other
 *  upstream string. */
export function reportDeviceGrantError(code: unknown): void {
  datadogLog.warn("device_grant.error", {
    code: sanitizeDeviceGrantDetail(code),
  })
}

/** Still polling, but transport has failed repeatedly — the flaky-wifi signal. */
export function reportDeviceGrantDegraded(consecutiveErrors: number): void {
  datadogLog.warn("device_grant.transport_degraded", {
    consecutive_errors: Math.max(0, Math.round(consecutiveErrors)),
  })
}

export function reportDeviceGrantRefreshFailed(reason: unknown): void {
  datadogLog.warn("device_grant.token_refresh_failed", {
    reason: sanitizeDeviceGrantDetail(reason),
  })
}

/** Whether sign-out reached the server, or only wiped locally — a local-only
 *  sign-out leaves a live rotating refresh token server-side (plan U4.4). */
export type SignOutScope = "revoked" | "local_only"

export function reportDeviceGrantSignedOut(scope: SignOutScope): void {
  datadogLog.info("device_grant.signed_out", { scope })
}

/**
 * The U4.6 promotion result. `status` is the closed outcome union and the
 * counts are counts — no viewer id, no user id, and deliberately nothing that
 * would let two accounts on one TV be correlated in Datadog.
 */
export function reportAnonymousMergeOutcome(input: {
  status:
    | "promoted"
    | "already_merged"
    | "reset_for_other_user"
    | "nothing_to_promote"
    | "failed"
  eventsSubmitted?: number
  eventsRetained?: number
}): void {
  datadogLog.info("device_grant.anonymous_merge", {
    status: input.status,
    events_submitted: Math.max(0, Math.round(input.eventsSubmitted ?? 0)),
    events_retained: Math.max(0, Math.round(input.eventsRetained ?? 0)),
  })
}
