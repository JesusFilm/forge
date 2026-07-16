import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"

import { WatchLanguageIndexBrowser } from "@/components/watch/WatchLanguageIndexBrowser"
import { getWatchLanguageIndex } from "@/lib/language-index"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"

export const revalidate = 3600
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
}> {
  return []
}

export const metadata: Metadata = {
  title: "Languages",
  description: "Browse JesusFilm videos by language.",
  alternates: {
    canonical: `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/languages`,
  },
}

type PageProps = {
  params: Promise<{ locale: string; htmlLang: string }>
}

export default async function LanguagesPage({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const index = await getWatchLanguageIndex()

  return (
    <main className="min-h-screen bg-black pt-[calc(7rem+env(safe-area-inset-top,0px))] pb-4 font-sans text-stone-100 sm:pb-6 md:pt-[calc(8rem+env(safe-area-inset-top,0px))] md:pb-8">
      <WatchLanguageIndexBrowser regions={index.regions} />
    </main>
  )
}
