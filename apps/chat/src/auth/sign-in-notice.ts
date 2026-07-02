/**
 * The R12 sign-in-failure marker. The callback appends this fixed query param
 * to the home redirect on ANY failed/cancelled sign-in; the home page reads it
 * to show a brief, non-PII notice and the client strips it after first read so
 * a refresh/share/bookmark doesn't re-show the notice (KTD7 — a FIXED enum
 * value, never reflected error text).
 */
export const SIGN_IN_ERROR_PARAM = "signin"
export const SIGN_IN_ERROR_VALUE = "failed"

/** Whether a resolved searchParam value marks a failed sign-in attempt (R12). */
export function isSignInError(value: string | undefined | null): boolean {
  return value === SIGN_IN_ERROR_VALUE
}
