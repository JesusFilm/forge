import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"

import { WatchChromeShell } from "@/components/WatchChromeShell"
import {
  loadClientMessages,
  USER_PLAYLIST_CLIENT_MESSAGE_NAMESPACES,
} from "@/i18n/client-messages"
import { resolveWatchLocaleIdentity } from "@/lib/locale"

export default async function UserPlaylistLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const { locale: uiLocale } = resolveWatchLocaleIdentity(locale)
  const messages = await loadClientMessages(
    uiLocale,
    USER_PLAYLIST_CLIENT_MESSAGE_NAMESPACES,
  )
  return (
    <WatchChromeShell locale={locale}>
      <NextIntlClientProvider locale={uiLocale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </WatchChromeShell>
  )
}
