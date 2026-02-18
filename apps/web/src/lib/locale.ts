import { headers } from "next/headers"

export const DEFAULT_LOCALE = "en"

export const SUPPORTED_LOCALES = ["en", "es", "fr", "pt", "de"] as const

export function isLocale(
  param: string,
): param is (typeof SUPPORTED_LOCALES)[number] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(param)
}

export async function getLocale(localeParam?: string): Promise<string> {
  if (localeParam && isLocale(localeParam)) return localeParam
  const headersList = await headers()
  const acceptLanguage = headersList.get("accept-language")
  if (acceptLanguage) {
    const primary = acceptLanguage.split(",")[0]?.split("-")[0]?.trim()
    if (primary && isLocale(primary)) return primary
  }
  return DEFAULT_LOCALE
}
