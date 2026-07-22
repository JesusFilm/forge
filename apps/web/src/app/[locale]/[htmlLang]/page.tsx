import type { ReactNode } from "react"
import type { Metadata } from "next"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import {
  publicWatchHomeLanguageSlugForLocale,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
import { resolveWatchHome } from "@/lib/watch-home"
import {
  isWatchPageMissingError,
  resolveWatchPage,
  watchExperienceBlocks,
} from "@/lib/content"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import { WatchHomeExperiencePage } from "@/components/home/WatchHomeExperiencePage"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import {
  loadClientMessages,
  WATCH_HOME_CLIENT_MESSAGE_NAMESPACES,
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
  setRequestLocale(locale)
  return getWatchPageMetadata(locale)
}

export default async function HomePage({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const [heroResult, pageResult, messages] = await Promise.all([
    resolveWatchHome(locale),
    resolveWatchPage(locale),
    loadClientMessages(locale, WATCH_HOME_CLIENT_MESSAGE_NAMESPACES),
  ])

  const withMessages = (children: ReactNode) => (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )

  if (heroResult.error) {
    return withMessages(<ExperienceError message={heroResult.error.message} />)
  }

  const builderBlocks =
    pageResult.data?.kind === "experience"
      ? watchExperienceBlocks(pageResult.data.experience)
      : []

  if (
    pageResult.error &&
    !isWatchPageMissingError(pageResult.error) &&
    process.env.NODE_ENV === "development"
  ) {
    console.warn("[watch-home] Unable to load builder-authored body.", {
      error: pageResult.error.message,
    })
  }

  if (!heroResult.data.heroSlides.length && !builderBlocks.length) {
    return withMessages(<ExperienceEmpty />)
  }

  return withMessages(
    <WatchHomeExperiencePage
      heroModel={heroResult.data}
      blocks={builderBlocks}
      languageSlug={publicWatchHomeLanguageSlugForLocale(locale) ?? "english"}
    />,
  )
}
