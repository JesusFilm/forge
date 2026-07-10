import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"

import { LanguageInventoryPage } from "@/components/watch-language-inventory/LanguageInventoryPage"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"
import {
  resolveWatchLanguageInventory,
  watchLanguageInventorySeoDescription,
  watchLanguageInventorySeoTitle,
} from "@/lib/watch-language-inventory"
import { resolveLanguageHomeSections } from "@/lib/watch-language-home-sections"

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
  const inventory = await resolveWatchLanguageInventory(locale, rawLocale)
  const title = watchLanguageInventorySeoTitle(inventory.languageName)
  const description = watchLanguageInventorySeoDescription(
    inventory.languageName,
  )
  const canonical = `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/videos`

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Jesus Film Project",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  }
}

export default async function VideosPage({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const inventory = await resolveWatchLanguageInventory(locale, rawLocale)
  const homeSections = await resolveLanguageHomeSections(
    locale,
    inventory.languageSlug,
  )

  return (
    <LanguageInventoryPage inventory={inventory} homeSections={homeSections} />
  )
}
