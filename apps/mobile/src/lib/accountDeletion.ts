/**
 * Account-deletion decisions (U7). Per auth-owner direction (2026-08-04)
 * there is no verification email — deletion verifies intent with a FRESH
 * session: better-auth rejects a stale session with SESSION_EXPIRED, and
 * the app answers by asking the user to re-authenticate (SSO re-auth),
 * then retrying. Server-side watch-data erasure rides auth's after-delete
 * hook (KTD12); the app only reflects the outcome.
 */

export type DeleteFailureKind = "fresh-session-required" | "retryable"

/**
 * Classify a rejected deleteUser call. Typed code first (the server throws
 * BASE_ERROR_CODES.SESSION_EXPIRED for a stale session); a narrow message
 * backstop covers client versions that surface only text.
 */
export function classifyDeleteFailure(error: {
  code?: string | null
  message?: string | null
}): DeleteFailureKind {
  if (error.code === "SESSION_EXPIRED") return "fresh-session-required"
  if (
    typeof error.message === "string" &&
    /session.*(expired|fresh)/i.test(error.message)
  ) {
    return "fresh-session-required"
  }
  return "retryable"
}

export type DeleteAccountOutcome =
  | { status: "deleted" }
  | { status: "fresh-session-required" }
  | { status: "error" }

export function outcomeFromDeleteResult(result: {
  error?: { code?: string | null; message?: string | null } | null
}): DeleteAccountOutcome {
  if (!result.error) return { status: "deleted" }
  return classifyDeleteFailure(result.error) === "fresh-session-required"
    ? { status: "fresh-session-required" }
    : { status: "error" }
}

export type PostReauthNext =
  | "retry-deletion"
  | "wrong-account"
  | "needs-reauth"
  | "needs-reauth-sign-in-failed"

/**
 * KTD5: decide the deletion flow's next step after the re-auth sheet
 * settles. Deletion re-runs ONLY for a verified same-subject session;
 * anything unverifiable lands in a non-destructive state.
 */
export function decidePostReauth(input: {
  /** Snapshot user id captured when deleteUser reported a stale session. */
  capturedUserId: string | null
  outcome: "success" | "cancelled" | "error"
  /** The refreshed snapshot's user id; null when signed out. */
  signedInUserId: string | null
}): PostReauthNext {
  if (input.outcome === "cancelled") return "needs-reauth"
  if (input.outcome === "error") return "needs-reauth-sign-in-failed"
  // Success without a signed-in snapshot: nobody verifiable signed in, so
  // the deletion never ran — surface the sign-in failure copy (R2).
  if (input.signedInUserId == null) return "needs-reauth-sign-in-failed"
  return input.capturedUserId != null &&
    input.signedInUserId === input.capturedUserId
    ? "retry-deletion"
    : "wrong-account"
}
