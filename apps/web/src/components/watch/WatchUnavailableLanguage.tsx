import { headers } from "next/headers"
import { getLocale, getMessages } from "next-intl/server"
import { NextIntlClientProvider } from "next-intl"

import {
  EMPTY_WATCH_UNAVAILABLE_RECOVERY,
  resolveWatchUnavailableRecovery,
} from "@/lib/watch-unavailable-recovery-actions"
import { parseUnavailableWatchPath } from "@/lib/watch-unavailable-recovery"
import { WATCH_INTERNAL_REWRITE_HEADER } from "@/lib/watch-rewrite-headers"
import { logWatchServerEvent } from "@/lib/watch-observability"

import { WatchUnavailableLanguageClient } from "./WatchUnavailableLanguageClient"

export async function WatchUnavailableLanguage() {
  const [locale, requestHeaders] = await Promise.all([getLocale(), headers()])
  const parsed = parseUnavailableWatchPath(
    requestHeaders.get(WATCH_INTERNAL_REWRITE_HEADER) ?? "",
  )
  const recoveryPromise = parsed
    ? resolveWatchUnavailableRecovery(parsed).catch((error: unknown) => {
        logWatchServerEvent("watch_unavailable_recovery.failed", {
          contentSlug: parsed.contentSlug,
          requestedLanguageSlug: parsed.requestedLanguageSlug,
          error: error instanceof Error ? error : "unknown",
        })
        return EMPTY_WATCH_UNAVAILABLE_RECOVERY
      })
    : Promise.resolve(EMPTY_WATCH_UNAVAILABLE_RECOVERY)
  const [messages, recovery] = await Promise.all([
    getMessages({ locale }),
    recoveryPromise,
  ])
  const unavailableLanguageMessages = messages.WatchUnavailableLanguage
  const languageComboboxMessages = messages.LanguageCombobox

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        WatchUnavailableLanguage: unavailableLanguageMessages,
        LanguageCombobox: languageComboboxMessages,
      }}
    >
      <WatchUnavailableLanguageClient
        parsed={parsed}
        initialResolution={recovery}
      />
    </NextIntlClientProvider>
  )
}
