import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import { LanguageInventoryPage } from "@/components/watch-language-inventory/LanguageInventoryPage"
import {
  isPublicWatchHomeLanguageSlug,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
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
  languageSlug: string
}> {
  return []
}

type PageProps = {
  params: Promise<{
    locale: string
    htmlLang: string
    languageSlug: string
  }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale: rawLocale, languageSlug } = await params
  if (!isPublicWatchHomeLanguageSlug(languageSlug)) notFound()

  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  const inventory = await resolveWatchLanguageInventory(locale, languageSlug)
  const title = watchLanguageInventorySeoTitle(inventory.languageName)
  const description = watchLanguageInventorySeoDescription(
    inventory.languageName,
  )
  const canonical = `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/${languageSlug}.html/videos`

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

export default async function LanguageVideosPage({ params }: PageProps) {
  const { locale: rawLocale, languageSlug } = await params
  if (!isPublicWatchHomeLanguageSlug(languageSlug)) notFound()

  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const inventory = await resolveWatchLanguageInventory(locale, languageSlug)
  const homeSections = await resolveLanguageHomeSections(
    locale,
    inventory.languageSlug,
  )

  return (
    <LanguageInventoryPage inventory={inventory} homeSections={homeSections} />
  )
}
