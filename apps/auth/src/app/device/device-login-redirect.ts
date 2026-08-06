import { normalizeUserCode } from "@/lib/device-user-code"

/** The single name the user code travels under on the `/device` ↔ `/login` hop. */
export const DEVICE_USER_CODE_PARAM = "user_code"

/**
 * The signed-out continuation for `/device`.
 *
 * It cannot ride `callbackURL`: `src/auth/web-callback.ts` filters auth's own
 * origin out of the allowed callback origins, so a callback back to `/device`
 * is rejected. The user code therefore travels the same lane `oauth_query`
 * does — as a plain `/login` search param that `toOAuthQuery` carries through
 * the sign-in POST.
 *
 * This hop deliberately carries NO `prompt=login`. It would be decorative here:
 * `/login` does not read `prompt` (only `buildOAuthContinuationURL` does, and
 * the device lane never reaches it), and this redirect fires only when there is
 * no session — where the viewer authenticates anyway.
 *
 * The shared-phone hazard (U2.4) is the opposite case: a phone that IS signed
 * in, on a rolling SSO session, approving a TV as whoever used it last. Nothing
 * on this path can address that, because this path is not taken. The controls
 * that do are on the approval screen itself — it names the account being used
 * and offers switching — and they are tested there.
 */
export function buildDeviceLoginRedirect(
  rawUserCode: string | undefined,
): string {
  const params = new URLSearchParams()
  const userCode = normalizeUserCode(rawUserCode ?? "")
  if (userCode) params.set("user_code", userCode)

  return `/login?${params.toString()}`
}

/**
 * True when a `/login` request is the signed-out half of a `/device` approval.
 * `/login` otherwise bounces anything without an OAuth authorize request or a
 * trusted watch callback out to the marketing site.
 */
export function isDeviceLoginContinuation(
  params: Record<string, string | string[] | undefined>,
): boolean {
  const value = params[DEVICE_USER_CODE_PARAM]
  const first = Array.isArray(value) ? value[0] : value

  return normalizeUserCode(first ?? "").length > 0
}
