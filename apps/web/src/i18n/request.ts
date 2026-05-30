import { getRequestConfig } from "next-intl/server"
import { AVAILABLE_UI_LOCALES, DEFAULT_LOCALE, hasUiLocale } from "./locales"

// next-intl reads locale from a per-request store populated by
// `setRequestLocale(locale)` in the internal /[locale]/[htmlLang] layout and
// page handlers. The public audio-language slug remains in the watch URL for
// dub selection; proxy.ts maps it to this bounded message-catalog key before
// the App Router render tree starts.

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale =
    requested && hasUiLocale(requested) ? requested : DEFAULT_LOCALE
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})

export { AVAILABLE_UI_LOCALES, DEFAULT_LOCALE, hasUiLocale }
