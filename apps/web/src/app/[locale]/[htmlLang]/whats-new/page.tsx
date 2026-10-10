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
    /* Deliberately outside search. Same block the preview surface uses, so
       the codebase has one shape for "keep this out of the index".

       NOT paired with a robots.txt Disallow, and that is the point: a
       disallowed URL is never fetched, so the noindex below is never read,
       and the address can still be listed from an inbound link with no
       description. Excluding it from crawling and excluding it from the
       index are opposite instructions — this page has to stay crawlable
       for the instruction to land.

       Open Graph and Twitter stay: they are what renders the card when
       somebody pastes the link into Slack or a message, which is how this
       page is meant to travel. */
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noarchive: true,
        noimageindex: true,
      },
    },
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
