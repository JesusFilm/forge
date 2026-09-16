import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { LanguageInventoryPage } from "@/components/watch-language-inventory/LanguageInventoryPage"
import {
  isPublicWatchHomeLanguageSlug,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"
import { resolveWatchLanguageInventory } from "@/lib/watch-language-inventory"
import {
  getWatchRouteManifest,
  isWatchAudioLanguageSlug,
} from "@/lib/watch-route-manifest"
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

/**
 * Whether this route may serve an inventory for `slug`.
 *
 * The compiled `PUBLIC_WATCH_LANGUAGE_SLUGS` corpus is a build-time snapshot,
 * so gating on it alone hard-404s every language admin published since the
 * last regeneration — and because the 404 comes from a compiled constant, ISR
 * re-rendering just regenerates the same 404 until the next deploy. The proxy
 * already rewrites those languages here via `isWatchAudioLanguageSlug`, so
 * this route has to admit the same corpus or the two disagree (the inventory
 * half of Linear FGE-81).
 *
 * The manifest is awaited ONLY on a corpus miss, mirroring `classify` in the
 * catch-all page, so the common path never serializes content resolution
 * behind the manifest request. A failed manifest fetch degrades to the corpus
 * alone: unknown slugs still fail closed, and a manifest outage can never
 * widen the namespace or throw into the route.
 */
async function isAdmittedInventoryLanguageSlug(slug: string): Promise<boolean> {
  if (isPublicWatchHomeLanguageSlug(slug)) return true
  return isWatchAudioLanguageSlug(
    slug,
    await getWatchRouteManifest().catch(() => null),
  )
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale: rawLocale, languageSlug } = await params
  if (!(await isAdmittedInventoryLanguageSlug(languageSlug))) notFound()

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
  if (!(await isAdmittedInventoryLanguageSlug(languageSlug))) notFound()

  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const [inventory, messages] = await Promise.all([
    resolveWatchLanguageInventory(locale, languageSlug),
    loadClientMessages(locale, LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES),
  ])

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LanguageInventoryPage inventory={inventory} />
      {/* Same shared footer, in the same position, as the watch home and
          single-video pages. It is a Server Component, so its `WatchFooter`
          namespace resolves from the request catalog and does not need adding
          to LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES. */}
      <WatchHomeFooter />
    </NextIntlClientProvider>
  )
}
