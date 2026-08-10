// Device-authorization sign-in shapes for the TV profile surface (feat-322).
// React-free pure module (the repo's testable-helper convention).
//
// The SERVER mints the code. `apps/auth`'s device grant issues a bare ten-digit
// user code (`generateUserCode` in `apps/auth/src/services/device-grant.service.ts`,
// `DEVICE_USER_CODE_FORMAT = "numbers"`); the TV only groups it for reading
// aloud across a living room. The local code minter and the letters/numbers
// evaluation switch that stood in before the grant existed are gone (plan U4.5)
// — the format must be identical on every platform forever, so there is exactly
// one decision point and it lives on the server.
//
// Field names mirror RFC 8628 (user code, verification URI, expiry) so these
// shapes line up with the real `/device/code` response.

/** Where approval happens, for display when no live session is on screen. A
 *  live grant carries `verification_uri` from the server instead. */
export const DEVICE_VERIFICATION_URL = "https://auth.jesusfilm.org/device"

/**
 * Where hyphens land when the server's ten-digit code is displayed:
 * `0194507302` → `019-450-7302`. Mirrors the server's numeric format; RFC 8628
 * §6.1's own example uses the same shape.
 */
export const USER_CODE_DISPLAY_GROUPS = [3, 3, 4] as const

export type DeviceAuthSession = {
  /** Grouped for reading aloud across the room, e.g. "019-450-7302". */
  userCode: string
  /** Where the phone lands after scanning; carries the code pre-filled. */
  verificationUrl: string
  expiresAtMs: number
}

export type TvUserProfile = {
  name: string
  email: string
}

export type DeviceAuthPhase =
  | { kind: "signedOut" }
  | { kind: "pending"; session: DeviceAuthSession }
  | { kind: "signedIn"; profile: TvUserProfile }

/**
 * Groups a bare code for display: `0194507302` → `019-450-7302`. Idempotent on
 * already-hyphenated input, and any remainder past the declared groups is
 * appended rather than dropped — a server that ever lengthens the code must
 * degrade to an ugly display, never a truncated one.
 */
export function formatUserCode(raw: string): string {
  const bare = raw.replace(/-/g, "")
  const parts: string[] = []
  let cursor = 0
  for (const size of USER_CODE_DISPLAY_GROUPS) {
    if (cursor >= bare.length) break
    parts.push(bare.slice(cursor, cursor + size))
    cursor += size
  }
  if (cursor < bare.length) parts.push(bare.slice(cursor))
  return parts.join("-")
}

/** The QR target: verification URL with the code pre-filled so the phone user
 *  never types it (RFC 8628 `verification_uri_complete`). */
export function verificationUrlWithCode(
  baseUrl: string,
  userCode: string,
): string {
  return `${baseUrl}?user_code=${encodeURIComponent(userCode)}`
}

/**
 * The caption printed under the QR tile: scheme and query stripped, e.g.
 * `auth.jesusfilm.org/device`.
 *
 * The query is dropped deliberately, not cosmetically — `verification_uri_complete`
 * carries `?user_code=…`, and this caption sits under a tile people photograph
 * and screen-share. The code already has its own large display; repeating it in
 * a URL only widens where it can leak.
 */
export function displayVerificationUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "")
}

export function isSessionExpired(
  session: DeviceAuthSession,
  nowMs: number,
): boolean {
  return nowMs >= session.expiresAtMs
}
