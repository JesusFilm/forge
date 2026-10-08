import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { LanguageInventoryPage } from "@/components/watch-language-inventory/LanguageInventoryPage"
import { WatchStructuredData } from "@/components/watch/WatchStructuredData"
import { WATCH_DEFAULT_OG_IMAGE } from "@/lib/experience-metadata"
import { resolveWatchLocaleIdentity, slugToBcp47Tag } from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"
import { watchLanguageInventoryStructuredDataJson } from "@/lib/watch-structured-data"
import {
  isAdmittedWatchInventoryLanguageSlug,
  resolveWatchLanguageInventory,
} from "@/lib/watch-language-inventory"
import { WatchHomeFooter } from "@/components/home/WatchHomeFooter"
import {
  LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES,
  loadClientMessages,
} from "@/i18n/client-messages"

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
  if (!(await isAdmittedWatchInventoryLanguageSlug(languageSlug))) notFound()

  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  const inventory = await resolveWatchLanguageInventory(locale, languageSlug)
  const t = await getTranslations({ locale, namespace: "LanguageInventory" })
  const languageDisplayName =
    inventory.languageNativeName?.trim() || inventory.languageName
  const title = t("metadataTitle", { language: languageDisplayName })
  const description = t("metadataDescription", {
    language: languageDisplayName,
  })
  const canonical = `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/${languageSlug}.html/videos`
  const image =
    inventory.audioCollections.find((item) => item.imageUrl)?.imageUrl ??
    inventory.audioVideos.find((item) => item.imageUrl)?.imageUrl ??
    inventory.promoted.find((item) => item.imageUrl)?.imageUrl ??
    inventory.subtitleOnlyVideos.find((item) => item.imageUrl)?.imageUrl ??
    WATCH_DEFAULT_OG_IMAGE.url

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
      images: [{ url: image, alt: languageDisplayName }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  }
}

export default async function LanguageVideosPage({ params }: PageProps) {
  const { locale: rawLocale, languageSlug } = await params
  if (!(await isAdmittedWatchInventoryLanguageSlug(languageSlug))) notFound()

  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const [inventory, messages] = await Promise.all([
    resolveWatchLanguageInventory(locale, languageSlug),
    loadClientMessages(locale, LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES),
  ])
  const t = await getTranslations({ locale, namespace: "LanguageInventory" })
  const languageDisplayName =
    inventory.languageNativeName?.trim() || inventory.languageName
  const structuredData = watchLanguageInventoryStructuredDataJson({
    destinations: [
      ...inventory.audioCollections,
      ...inventory.audioVideos,
    ].flatMap((item) =>
      item.href
        ? [{ name: item.title, url: `${WATCH_BASE_PATH}${item.href}` }]
        : [],
    ),
    canonicalUrl: `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/${languageSlug}.html/videos`,
    inLanguage: slugToBcp47Tag(languageSlug),
    name: t("metadataTitle", { language: languageDisplayName }),
    description: t("metadataDescription", { language: languageDisplayName }),
  })

  return (
    <>
      <WatchStructuredData json={structuredData} />
      <NextIntlClientProvider locale={locale} messages={messages}>
        <LanguageInventoryPage inventory={inventory} />
        {/* Same shared footer, in the same position, as the watch home and
            single-video pages. It is a Server Component, so its `WatchFooter`
            namespace resolves from the request catalog and does not need adding
            to LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES. */}
        <WatchHomeFooter />
      </NextIntlClientProvider>
    </>
  )
}
