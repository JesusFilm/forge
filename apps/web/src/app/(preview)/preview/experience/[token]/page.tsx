import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { WatchHomeExperiencePage } from "@/components/home/WatchHomeExperiencePage"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { hasUiLocale } from "@/i18n/locales"
import {
  loadClientMessages,
  WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES,
} from "@/i18n/client-messages"
import {
  getExperiencePreview,
  getExperiencePreviewLayout,
} from "@/lib/experience-preview"
import {
  DEFAULT_LOCALE,
  publicWatchAudioLanguageSlugForLocale,
  textDirectionForLocale,
  type UiLocale,
} from "@/lib/locale"
import {
  resolveWatchHomePreview,
  type WatchHomeExperienceBlock,
} from "@/lib/watch-home"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

export const metadata: Metadata = {
  title: "Draft preview",
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
  referrer: "no-referrer",
}

type ExperiencePreviewPageProps = {
  params: Promise<{ token: string }>
}

function boundedUiLocale(locale: string): UiLocale {
  return hasUiLocale(locale) ? (locale as UiLocale) : DEFAULT_LOCALE
}

function DraftPreviewBanner({
  locale,
  homepageLayout,
}: {
  locale: string
  homepageLayout: boolean
}) {
  return (
    <aside
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[100] flex min-h-12 items-center justify-center gap-3 border-b border-amber-300/40 bg-amber-300 px-4 py-2 text-center font-sans text-base sm:text-sm font-semibold text-stone-950 shadow-lg"
    >
      <span>Draft preview</span>
      <span aria-hidden="true">•</span>
      <span>{locale}</span>
      {homepageLayout ? (
        <>
          <span aria-hidden="true">•</span>
          <span>Homepage layout, not the live homepage</span>
        </>
      ) : null}
      <span aria-hidden="true">•</span>
      <span>Not live</span>
    </aside>
  )
}

function OrdinaryExperiencePreview({
  blocks,
  languageSlug,
}: {
  blocks: readonly Section[]
  languageSlug: string
}) {
  return (
    <main className="min-h-screen bg-stone-900">
      {blocks.map((block, index) => {
        const key =
          "id" in block && typeof block.id === "string"
            ? block.id
            : `block-${index}`

        return (
          <ExperienceSectionRenderer
            key={key}
            section={block}
            languageSlug={languageSlug}
          />
        )
      })}
    </main>
  )
}

export default async function ExperiencePreviewPage({
  params,
}: ExperiencePreviewPageProps) {
  const { token } = await params
  // Parallel, so the layout probe adds no round trip to the preview render.
  const [preview, homepageLayout] = await Promise.all([
    getExperiencePreview(token),
    getExperiencePreviewLayout(token),
  ])
  if (!preview) notFound()
  // Rendering context, not assignment: a homepage duplicate renders as the
  // Watch home while `isHomepage` (live assignment) stays false.
  const rendersAsHomepage = preview.isHomepage || homepageLayout

  const locale = boundedUiLocale(preview.locale)
  const languageSlug =
    publicWatchAudioLanguageSlugForLocale(locale) ?? "english"
  const blocks = preview.blocks.filter(
    (block): block is Section => block !== null,
  )

  setRequestLocale(locale)
  const messages = await loadClientMessages(
    locale,
    WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES,
  )

  let content = (
    <OrdinaryExperiencePreview blocks={blocks} languageSlug={languageSlug} />
  )

  if (rendersAsHomepage) {
    const home = await resolveWatchHomePreview(
      locale,
      languageSlug,
      blocks as unknown as readonly WatchHomeExperienceBlock[],
    )
    if (home.data) {
      content = (
        <WatchHomeExperiencePage
          heroModel={home.data}
          blocks={blocks}
          locale={locale}
          languageSlug={languageSlug}
          dynamicCollectionCacheScope="preview"
        />
      )
    }
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div lang={locale} dir={textDirectionForLocale(locale)}>
        <DraftPreviewBanner
          locale={preview.locale}
          homepageLayout={homepageLayout && !preview.isHomepage}
        />
        {content}
      </div>
    </NextIntlClientProvider>
  )
}
