const FIRST_STRONG_ISOLATE = "\u2068"
const POP_DIRECTIONAL_ISOLATE = "\u2069"

/**
 * Isolate a dynamic value at its final display or accessible-name boundary.
 *
 * The returned string contains invisible Unicode controls and must never be
 * reused as an identity, route, search, analytics, persistence, or filename
 * value. Keep the raw source value for every non-presentation concern.
 */
export function isolateBidiDisplayText(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`
}
