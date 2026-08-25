import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"

import { WatchWhatsNewPage } from "@/components/whats-new/WatchWhatsNewPage"
import { WHATS_NEW_METADATA } from "@/components/whats-new/whats-new-content"
import {
  publicWatchHomeLanguageSlugForLocale,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"
import { resolveWatchLanguageSwitcherOptions } from "@/lib/watch-language-inventory"

export const revalidate = 3600
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
}> {
  return []
}

const CANONICAL_URL = `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/whats-new`

export function generateMetadata(): Metadata {
  return {
    title: WHATS_NEW_METADATA.title,
    description: WHATS_NEW_METADATA.description,
    alternates: { canonical: CANONICAL_URL },
    openGraph: {
      type: "article",
      title: WHATS_NEW_METADATA.title,
      description: WHATS_NEW_METADATA.description,
      url: CANONICAL_URL,
      siteName: "Jesus Film Project",
    },
    twitter: {
      card: "summary",
      title: WHATS_NEW_METADATA.title,
      description: WHATS_NEW_METADATA.description,
    },
  }
}

type PageProps = {
  params: Promise<{ locale: string; htmlLang: string }>
}

export default async function WatchWhatsNewRoute({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)

  const languageSlug = publicWatchHomeLanguageSlugForLocale(locale) ?? "english"
  const languages = await resolveWatchLanguageSwitcherOptions(languageSlug)

  return <WatchWhatsNewPage languageSlug={languageSlug} languages={languages} />
}
