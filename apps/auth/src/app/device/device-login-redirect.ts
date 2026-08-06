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
 * `prompt=login` is the U2.4 control, not decoration: the phone rides a rolling
 * SSO session, so a shared family phone would otherwise approve a TV as
 * whoever signed in last.
 */
export function buildDeviceLoginRedirect(
  rawUserCode: string | undefined,
): string {
  const params = new URLSearchParams()
  const userCode = normalizeUserCode(rawUserCode ?? "")
  if (userCode) params.set("user_code", userCode)
  params.set("prompt", "login")

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
