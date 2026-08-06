/**
 * Pure sign-in flow decisions (KTD11). The two failure classes matter
 * because the UX differs (U6): a user-initiated cancel returns quietly with
 * no UI, while a failure AFTER the provider sheet succeeded surfaces a
 * dismissible error with retry — the user just completed Face ID or an
 * account picker and otherwise cannot know whether they are signed in.
 */

/** How far a sign-in progressed when it failed. */
export type SignInStage = "provider-sheet" | "exchange"

export type SignInFailureKind = "cancelled" | "retryable"

/** Native cancel signals: Apple's typed code, google-signin's status code,
 *  and expo-web-browser's cancel/dismiss result types. */
const CANCEL_CODES = new Set([
  "ERR_REQUEST_CANCELED", // expo-apple-authentication
  "SIGN_IN_CANCELLED", // @react-native-google-signin (statusCodes value)
  "12501", // Google Android raw status for user-cancel
])

export function isProviderCancel(error: unknown): boolean {
  if (typeof error !== "object" || error == null) return false
  const code = (error as { code?: unknown }).code
  return typeof code === "string" && CANCEL_CODES.has(code)
}

/**
 * Classify a sign-in failure. Cancels are only recognized at the provider
 * sheet; anything after the sheet succeeded (network drop during the
 * exchange, JWT mint failure, PKCE/state mismatch on the hosted path) is
 * retryable by construction — the discriminating case.
 */
export function classifySignInFailure(
  stage: SignInStage,
  error: unknown,
): SignInFailureKind {
  if (stage === "provider-sheet" && isProviderCancel(error)) {
    return "cancelled"
  }
  return "retryable"
}

/**
 * Apple returns fullName ONLY on a user's first authorization and never in
 * the identityToken, so dropping it here loses the name permanently. Better
 * Auth's `idToken.user.name` channel takes it in this exact shape and applies
 * it when the user row is created — omitted entirely when Apple sends nothing,
 * because an empty object would still read as "a name was supplied".
 */
export function appleNameForIdToken(
  fullName:
    | { givenName?: string | null; familyName?: string | null }
    | null
    | undefined,
): { firstName?: string; lastName?: string } | undefined {
  const firstName = fullName?.givenName?.trim() || undefined
  const lastName = fullName?.familyName?.trim() || undefined
  return firstName || lastName ? { firstName, lastName } : undefined
}
