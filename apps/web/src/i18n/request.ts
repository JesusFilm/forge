import { getRequestConfig } from "next-intl/server"
import { AVAILABLE_UI_LOCALES, DEFAULT_LOCALE, hasUiLocale } from "./locales"

// next-intl reads locale from a per-request store populated by
// `setRequestLocale(locale)` in the page handler. No middleware, no
// URL segment — the audio-language slug in the existing watch URL is
// the locale carrier. Phase 2's resolveUiLocale() collapses it to a UI
// locale; we gate that against AVAILABLE_UI_LOCALES so a request whose
// audio language doesn't have a catalog falls back to English chrome.

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
