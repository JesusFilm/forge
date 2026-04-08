/** Only allow safe sectionKey values (alphanumeric, hyphens, underscores, slashes, percent-encoded). */
const SECTION_KEY_PATTERN = /^[a-zA-Z0-9_/%-]+$/

/**
 * Decode and validate a URL-encoded sectionKey from Expo Router params.
 * Returns the decoded key if valid, or null if malformed or invalid.
 */
export function parseSectionKey(raw: string | undefined): string | null {
  if (raw == null) return null
  try {
    const decoded = decodeURIComponent(raw)
    return SECTION_KEY_PATTERN.test(decoded) ? decoded : null
  } catch {
    // Malformed percent-encoding (e.g. "%ZZ")
    return null
  }
}
