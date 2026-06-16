import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"

import { LanguageInventoryPage } from "@/components/watch-language-inventory/LanguageInventoryPage"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"
import { resolveWatchLanguageInventory } from "@/lib/watch-language-inventory"

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
  title: "All Videos",
  description: "Browse the full catalog of JesusFilm videos.",
  alternates: {
    canonical: `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/videos`,
  },
}

type PageProps = {
  params: Promise<{ locale: string; htmlLang: string }>
}

export default async function VideosPage({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const inventory = await resolveWatchLanguageInventory(locale, rawLocale)
  return <LanguageInventoryPage inventory={inventory} />
}
