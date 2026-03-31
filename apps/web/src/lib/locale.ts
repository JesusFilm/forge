export const DEFAULT_LOCALE = "en"

export const SUPPORTED_LOCALES = ["en", "es", "fr", "pt", "de"] as const

export function isLocale(
  param: string,
): param is (typeof SUPPORTED_LOCALES)[number] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(param)
}

/** Parse the primary locale from an Accept-Language header value. */
export function parseAcceptLanguage(
  acceptLanguage: string | null,
): (typeof SUPPORTED_LOCALES)[number] | null {
  if (!acceptLanguage) return null
  const primary = acceptLanguage.split(",")[0]?.split("-")[0]?.trim()
  if (primary && isLocale(primary)) return primary
  return null
}
