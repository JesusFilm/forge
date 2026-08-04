/**
 * Pure sign-in flow decisions (KTD11): failure classification and the R15
 * new-account detection. The two failure classes matter because the UX
 * differs (U6): a user-initiated cancel returns quietly with no UI, while a
 * failure AFTER the provider sheet succeeded surfaces a dismissible error
 * with retry — the user just completed Face ID or an account picker and
 * otherwise cannot know whether they are signed in.
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
 * R15: a provider sign-in whose email matched no existing account creates a
 * new one (e.g. Apple's Hide My Email relay). Surface that rather than
 * silently showing empty progress. Better Auth returns the user row, so a
 * just-created account is one whose createdAt is within the sign-in window.
 */
export const NEW_ACCOUNT_WINDOW_MS = 60_000

export function isNewlyCreatedAccount(
  user: { createdAt?: string | Date | null } | null | undefined,
  nowMs: number,
): boolean {
  const createdAt = user?.createdAt
  if (createdAt == null) return false
  const createdMs =
    createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt)
  if (!Number.isFinite(createdMs)) return false
  return nowMs - createdMs < NEW_ACCOUNT_WINDOW_MS
}
