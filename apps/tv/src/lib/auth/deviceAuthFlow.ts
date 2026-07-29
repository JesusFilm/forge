// Device-authorization sign-in state for the TV profile surface (feat-322).
// React-free pure module (the repo's testable-helper convention): the UI walks
// these phases while the SERVER grant is still open — apps/auth has not enabled
// its RFC 8628 device plugin yet, so approval is stubbed behind a demo action.
// Field names mirror RFC 8628 (user code, verification URI, expiry) so the real
// grant slots in without reshaping the UI.

/** Where approval happens. Matches better-auth's device plugin route shape
 *  (`/device`) on the forge identity provider; a real flow receives this from
 *  the device-code response instead of a constant. */
export const DEVICE_VERIFICATION_URL = "https://auth.jesusfilm.org/device"

/** Mirrors apps/auth's 600s authorization-code TTL. */
export const SESSION_TTL_MS = 10 * 60_000

/** RFC 8628 §6.1-style user-code charset: consonants minus lookalikes
 *  (no 0/O, 1/I, or vowels — avoids accidental words on the living-room TV). */
const USER_CODE_CHARSET = "BCDFGHJKLMNPQRSTVWXZ"
const USER_CODE_LENGTH = 8

export type DeviceAuthSession = {
  /** Grouped for reading aloud across the room, e.g. "BXKD-QWNM". */
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

/** Placeholder identity for the stubbed approval — clearly fake, example.org. */
export const DEMO_PROFILE: TvUserProfile = {
  name: "Demo Viewer",
  email: "demo.viewer@example.org",
}

/** "BXKDQWNM" → "BXKD-QWNM". Idempotent on already-hyphenated input. */
export function formatUserCode(raw: string): string {
  const bare = raw.replace(/-/g, "")
  if (bare.length <= 4) return bare
  return `${bare.slice(0, 4)}-${bare.slice(4)}`
}

/** The QR target: verification URL with the code pre-filled so the phone user
 *  never types it (RFC 8628 `verification_uri_complete`). */
export function verificationUrlWithCode(
  baseUrl: string,
  userCode: string,
): string {
  return `${baseUrl}?user_code=${encodeURIComponent(userCode)}`
}

export function isSessionExpired(
  session: DeviceAuthSession,
  nowMs: number,
): boolean {
  return nowMs >= session.expiresAtMs
}

/** Both inputs injected (repo discipline: no clock/random reads inside pure
 *  modules) — `random` is a `Math.random`-shaped source in [0, 1). */
export function createPendingSession(input: {
  nowMs: number
  random: () => number
}): DeviceAuthSession {
  let code = ""
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    const index = Math.min(
      USER_CODE_CHARSET.length - 1,
      Math.floor(input.random() * USER_CODE_CHARSET.length),
    )
    code += USER_CODE_CHARSET[index]
  }
  const userCode = formatUserCode(code)
  return {
    userCode,
    verificationUrl: verificationUrlWithCode(DEVICE_VERIFICATION_URL, userCode),
    expiresAtMs: input.nowMs + SESSION_TTL_MS,
  }
}
