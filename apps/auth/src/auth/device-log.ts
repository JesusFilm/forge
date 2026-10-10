/**
 * Structured logging for the device grant.
 *
 * Plain-string `key=value`, never `JSON.stringify`: Railway logsV2 silently
 * drops JSON payloads written from Next.js App Router runtime handlers, which
 * makes post-deploy validation look like the endpoints were never reached. See
 * docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md
 *
 * Pre-verification values are named `attemptedX=` / `claimedX=`. Canonical names
 * like `userId=` are reserved for values the request has actually proven, so a
 * log search for `userId=` never returns an attacker-supplied string. See
 * docs/solutions/security-issues/pre-verification-log-field-namespace-pollution-20260518.md
 */

const MAX_VALUE_LENGTH = 64

export function sanitizeLogValue(value: unknown): string {
  if (value == null) return "none"
  return (
    String(value)
      // Newlines would forge a whole log line; spaces and `=` would forge extra
      // key=value pairs INSIDE a line, which is the same lie in a smaller
      // package — a parser faceting on `userId=` would happily read one an
      // attacker planted in a client id. Collapse every field separator, not
      // just the line separators.
      .replace(/[\r\n\t =]/g, "_")
      .slice(0, MAX_VALUE_LENGTH)
  )
}

/**
 * Never pass a raw device code, user code, code verifier, or token here — not
 * even truncated. Log the outcome, not the credential.
 */
export function logDeviceEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const parts = [`[device] event=${sanitizeLogValue(event)}`]
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    parts.push(`${key}=${sanitizeLogValue(value)}`)
  }
  console.log(parts.join(" "))
}
