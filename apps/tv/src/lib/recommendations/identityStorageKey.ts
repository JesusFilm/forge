const RELEASE_IDENTITY_KEY = "tv.recommendations.identity.v1"

/** Development endpoints must never share a fixture or real viewer identity. */
export function recommendationIdentityStorageKey(
  endpoint: string,
  development: boolean,
): string {
  if (!development) return RELEASE_IDENTITY_KEY
  const url = new URL(endpoint)
  url.hostname = url.hostname.toLowerCase()
  const normalized = url.href
  // Escape every delimiter (including underscore) without collisions. SecureStore
  // accepts only alphanumeric characters, dots, hyphens and underscores in keys.
  const encoded = Array.from(normalized)
    .map((character) =>
      /^[A-Za-z0-9.-]$/.test(character)
        ? character
        : `_${character.codePointAt(0)!.toString(16)}_`,
    )
    .join("")
  return `tv.recommendations.identity.dev.v2.${encoded}`
}
