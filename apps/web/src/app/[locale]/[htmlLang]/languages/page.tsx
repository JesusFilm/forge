import type { Metadata } from "next"
import { NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { WatchLanguageIndexBrowser } from "@/components/watch/WatchLanguageIndexBrowser"
import { getWatchLanguageIndex } from "@/lib/language-index"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"
import {
  LANGUAGE_INDEX_CLIENT_MESSAGE_NAMESPACES,
  loadClientMessages,
} from "@/i18n/client-messages"

export const revalidate = 3600
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
}> {
  return []
}

type PageProps = {
  params: Promise<{ locale: string; htmlLang: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  const t = await getTranslations({ locale, namespace: "WatchLanguageIndex" })

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
    alternates: {
      canonical: `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/languages`,
    },
  }
}

export default async function LanguagesPage({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const [index, messages] = await Promise.all([
    getWatchLanguageIndex(),
    loadClientMessages(locale, LANGUAGE_INDEX_CLIENT_MESSAGE_NAMESPACES),
  ])

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <main className="min-h-screen bg-black pt-[calc(7rem+env(safe-area-inset-top,0px))] pb-4 font-sans text-stone-100 sm:pb-6 md:pt-[calc(8rem+env(safe-area-inset-top,0px))] md:pb-8">
        <WatchLanguageIndexBrowser regions={index.regions} />
      </main>
    </NextIntlClientProvider>
  )
}
