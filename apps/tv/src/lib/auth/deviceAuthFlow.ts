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

/**
 * The two user-code formats RFC 8628 §6.1 sanctions, both implemented so the
 * choice can be made from real screens instead of a spec argument.
 *
 * - `letters` — consonants minus lookalikes (no 0/O, 1/I, no vowels, so the
 *   code can never spell a word in a living room). 8 chars over a 20-char
 *   alphabet clears the RFC's brute-force bar. What most of the industry ships.
 * - `numbers` — §6.1: "Pure numeric codes are also a good choice for
 *   usability... for clients targeting locales where A-Z character keyboards
 *   are not used" (its own example is `019-450-730`). Netflix's choice, and
 *   the better fit for a majority-non-Latin-script audience: the number pad is
 *   one tap away on every keyboard, with no input-mode switch.
 *   TEN digits, not nine — 10^9 against a 5-attempt cap misses the RFC's
 *   2^-32 target; 10^10 clears it.
 */
export const USER_CODE_FORMATS = ["letters", "numbers"] as const
export type UserCodeFormat = (typeof USER_CODE_FORMATS)[number]

export const DEFAULT_USER_CODE_FORMAT: UserCodeFormat = "letters"

type CodeSpec = {
  charset: string
  length: number
  /** Where hyphens land when the code is displayed. */
  groups: number[]
  /** Shown next to the format switch. */
  label: string
  sample: string
}

export const USER_CODE_SPECS: Record<UserCodeFormat, CodeSpec> = {
  letters: {
    charset: "BCDFGHJKLMNPQRSTVWXZ",
    length: 8,
    groups: [4, 4],
    label: "Letters",
    sample: "BXKD-QWNM",
  },
  numbers: {
    charset: "0123456789",
    length: 10,
    groups: [3, 3, 4],
    label: "Numbers",
    sample: "019-450-7302",
  },
}

export type DeviceAuthSession = {
  /** Grouped for reading aloud across the room, e.g. "BXKD-QWNM". */
  userCode: string
  /** Which format minted this code — kept so the UI can label it. */
  format: UserCodeFormat
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

/**
 * Groups a bare code for display: `BXKDQWNM` → `BXKD-QWNM`,
 * `0194507302` → `019-450-7302`. Idempotent on already-hyphenated input, and
 * any remainder past the declared groups is appended rather than dropped.
 */
export function formatUserCode(
  raw: string,
  format: UserCodeFormat = DEFAULT_USER_CODE_FORMAT,
): string {
  const bare = raw.replace(/-/g, "")
  const parts: string[] = []
  let cursor = 0
  for (const size of USER_CODE_SPECS[format].groups) {
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
  /** Which code format to mint. Defaults to the shipped choice. */
  format?: UserCodeFormat
}): DeviceAuthSession {
  const format = input.format ?? DEFAULT_USER_CODE_FORMAT
  const spec = USER_CODE_SPECS[format]
  let code = ""
  for (let i = 0; i < spec.length; i++) {
    const index = Math.min(
      spec.charset.length - 1,
      Math.floor(input.random() * spec.charset.length),
    )
    code += spec.charset[index]
  }
  const userCode = formatUserCode(code, format)
  return {
    userCode,
    format,
    verificationUrl: verificationUrlWithCode(DEVICE_VERIFICATION_URL, userCode),
    expiresAtMs: input.nowMs + SESSION_TTL_MS,
  }
}
