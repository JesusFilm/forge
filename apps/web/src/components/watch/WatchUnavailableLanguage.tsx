import { getLocale, getMessages } from "next-intl/server"
import { NextIntlClientProvider } from "next-intl"

import { WatchUnavailableLanguageClient } from "./WatchUnavailableLanguageClient"

export async function WatchUnavailableLanguage() {
  const locale = await getLocale()
  const messages = await getMessages({ locale })
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
      <WatchUnavailableLanguageClient />
    </NextIntlClientProvider>
  )
}
