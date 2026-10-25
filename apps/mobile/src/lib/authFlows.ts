/**
 * Pure sign-in flow decisions (KTD11). On the hosted flow a real user
 * cancel NEVER throws — the expo plugin resolves without a session — so a
 * thrown browser open is a failure the user must see: it classifies
 * retryable, and the quiet-cancel path is the session-less settle in
 * authActions.ts, never a thrown error.
 */

export type SignInFailureKind = "retryable"

/** Classify a thrown sign-in failure. Every throw is retryable by
 *  construction; the union exists so a future kind must be mapped. */
export function classifySignInFailure(_error: unknown): SignInFailureKind {
  return "retryable"
}
