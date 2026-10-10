/**
 * Pure helpers for RFC 8628 user codes.
 *
 * RFC 8628 §6.1 requires the server to tolerate the shapes a human actually
 * types: lowercase, the dashes we print for legibility, stray spaces from a
 * paste. Normalization is therefore uppercase-then-filter-to-charset, never a
 * rejection.
 *
 * The charset drops `I` and `O` so they cannot be confused with `1` and `0` on
 * a TV screen viewed from a couch.
 */
export const USER_CODE_CHARSET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"

/** Hard ceiling on normalized length, so a pasted essay never reaches the API. */
export const USER_CODE_MAX_LENGTH = 12

/**
 * The two formats the server issues: 10 digits (`019-450-7302`) and 8 letters
 * (`BXKD-QWNM`). Display grouping and plausibility both key off these.
 */
export const USER_CODE_LENGTHS: readonly number[] = [8, 10]

/**
 * Uppercase, drop every character outside {@link USER_CODE_CHARSET} (dashes,
 * spaces, punctuation, emoji, non-Latin scripts), and cap the result at
 * {@link USER_CODE_MAX_LENGTH}.
 */
export function normalizeUserCode(raw: string): string {
  let normalized = ""

  // Iterating the string yields whole code points, so an emoji is tested once
  // rather than as two lone surrogates.
  for (const character of raw.toUpperCase()) {
    if (normalized.length >= USER_CODE_MAX_LENGTH) break
    if (USER_CODE_CHARSET.includes(character)) normalized += character
  }

  return normalized
}

/**
 * Group a code for the anti-phishing display required by RFC 8628 §3.3.1:
 * 10-character codes as `019-450-7302`, 8-character codes as `BXKD-QWNM`.
 * Any other length is returned normalized but ungrouped.
 */
export function formatUserCodeForDisplay(code: string): string {
  const normalized = normalizeUserCode(code)

  if (normalized.length === 10) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6, 10)}`
  }
  if (normalized.length === 8) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`
  }

  return normalized
}

/**
 * True when the normalized code is long enough to be worth sending to the
 * server. A submit-button gate, never a security boundary — the server is the
 * only thing that decides whether a code exists.
 */
export function isPlausibleUserCode(code: string): boolean {
  return USER_CODE_LENGTHS.includes(normalizeUserCode(code).length)
}

/**
 * Pick the on-screen keyboard for the code field. Digits-so-far (including an
 * empty field, because the default issued format is numeric) get the number
 * pad; anything alphabetic falls back to the full keyboard.
 *
 * The empty-field default tracks the server's `DEVICE_USER_CODE_FORMAT`
 * default of `numbers`. If that constant is ever flipped to `letters`, flip
 * this default too — an iOS number pad has no letter keys, so a letters-format
 * code would be untypeable.
 */
export function resolveUserCodeInputMode(value: string): "numeric" | "text" {
  return /^[0-9]*$/.test(normalizeUserCode(value)) ? "numeric" : "text"
}
