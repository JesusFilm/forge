// SYNC: keep in sync with apps/mobile/src/lib/pickLocalizedName.ts
// Admin stores localized names as jsonb locale maps { "en": "...", "es": "..." };
// gql.tada types JSON as `unknown`, so TS won't catch misuse.
const LOCALE_FALLBACK_ORDER = [
  "en",
  "es",
  "fr",
  "pt",
  "de",
  "id",
  "ja",
  "ko",
  "ru",
  "th",
  "tr",
  "zh",
] as const

export function pickLocalizedName(
  value: unknown,
  preferredLocale?: string,
): string | undefined {
  if (value == null) return undefined
  if (typeof value === "string") return value

  if (typeof value === "object" && !Array.isArray(value)) {
    const map = value as Record<string, string>

    if (preferredLocale && map[preferredLocale]) {
      return map[preferredLocale]
    }

    for (const locale of LOCALE_FALLBACK_ORDER) {
      if (map[locale]) return map[locale]
    }

    const firstValue = Object.values(map)[0]
    if (firstValue) return firstValue
  }

  return undefined
}
