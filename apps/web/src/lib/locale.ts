import { headers } from "next/headers"

const DEFAULT_LOCALE = "en"

export async function getLocale(localeParam?: string): Promise<string> {
  if (localeParam) return localeParam
  const headersList = await headers()
  const acceptLanguage = headersList.get("accept-language")
  if (acceptLanguage) {
    const primary = acceptLanguage.split(",")[0]?.split("-")[0]?.trim()
    if (primary) return primary
  }
  return DEFAULT_LOCALE
}
