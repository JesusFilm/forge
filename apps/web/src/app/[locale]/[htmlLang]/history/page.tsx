import type { Metadata, Route } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { WatchHistoryClient } from "@/components/watch/WatchHistoryClient"
import { verifyAuthSession } from "@/lib/auth-session"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { watchPath } from "@/lib/watch-paths"
import {
  loadClientMessages,
  WATCH_HISTORY_CLIENT_MESSAGE_NAMESPACES,
} from "@/i18n/client-messages"

export const dynamic = "force-dynamic"

type HistoryPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: HistoryPageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "WatchHistory" })
  return { title: t("metadataTitle") }
}

export default async function WatchHistoryPage({ params }: HistoryPageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const [t, messages] = await Promise.all([
    getTranslations({ locale, namespace: "WatchHistory" }),
    loadClientMessages(locale, WATCH_HISTORY_CLIENT_MESSAGE_NAMESPACES),
  ])

  const session = await verifyAuthSession(await headers())
  if (!session.authenticated) {
    redirect(
      `${watchPath("/api/auth/login")}?returnTo=${encodeURIComponent(watchPath("/history"))}` as Route,
    )
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <main className="min-h-screen bg-[#050505] pt-24 text-white">
        <div className={`${WATCH_PAGE_CONTENT_CLASSES} py-10 sm:py-14`}>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
            {t("title")}
          </h1>
          <WatchHistoryClient />
        </div>
      </main>
    </NextIntlClientProvider>
  )
}
