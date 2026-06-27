import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import {
  getWatchLanguageIndexLanguage,
  type WatchLanguageIndexLanguage,
} from "@/lib/language-index"
import {
  isPublicWatchLanguageSlug,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
import {
  languagesIndexPath,
  languageVideosIndexPath,
  tryAsLocaleSlug,
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
} from "@/lib/routes"
import { stripHtmlSuffix } from "@/lib/url-shape"

export const revalidate = 3600
export const dynamic = "force-static"
export const dynamicParams = true

type PageProps = {
  params: Promise<{ locale: string; htmlLang: string; language: string }>
}

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
  language: string
}> {
  return []
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { language } = await params
  const publicSlug = stripHtmlSuffix(language)
  const localeSlug = tryAsLocaleSlug(publicSlug)
  const entry = localeSlug
    ? await getWatchLanguageIndexLanguage(publicSlug)
    : null
  const title = entry ? `${entry.englishLabel} Videos` : "Language Videos"
  const canonical = localeSlug
    ? `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}${languageVideosIndexPath(
        localeSlug,
      )}`
    : `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/languages`

  return {
    title,
    description: entry
      ? `Browse JesusFilm videos in ${entry.englishLabel}.`
      : "Browse JesusFilm videos by language.",
    alternates: { canonical },
  }
}

export default async function LanguageVideosPage({ params }: PageProps) {
  const { locale: rawLocale, language } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)

  const publicSlug = stripHtmlSuffix(language)
  if (!isPublicWatchLanguageSlug(publicSlug)) notFound()

  const entry = await getWatchLanguageIndexLanguage(publicSlug)
  const languageLabel = entry?.englishLabel ?? titleizeSlug(publicSlug)
  const nativeLabel = entry?.nativeLabel ?? languageLabel

  return (
    <main className="min-h-screen bg-[#171412] px-5 py-8 text-stone-100 sm:px-8 md:px-12">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col justify-center">
        <Link
          href={languagesIndexPath()}
          className="mb-8 inline-flex w-fit items-center rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          All languages
        </Link>

        <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-7 shadow-[0_28px_80px_rgba(0,0,0,0.28)] sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <LanguageFlag language={entry} label={languageLabel} />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-bold uppercase tracking-[0.18em] text-stone-400">
                Videos
              </p>
              <h1 className="m-0 mt-3 text-4xl font-bold leading-tight tracking-normal text-white sm:text-5xl">
                {languageLabel}
              </h1>
              <p className="m-0 mt-3 text-lg font-semibold leading-relaxed text-stone-300">
                {nativeLabel}
              </p>
              <p className="m-0 mt-8 max-w-2xl text-base font-semibold leading-relaxed text-stone-300">
                Browse videos, series, and stories available in {languageLabel}.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function LanguageFlag({
  language,
  label,
}: {
  language: WatchLanguageIndexLanguage | null
  label: string
}) {
  if (!language?.flagPngSrc) {
    return (
      <span
        className="flex size-20 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-2xl font-bold text-white"
        aria-hidden="true"
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return (
    <span
      className="size-20 shrink-0 rounded-full bg-cover bg-center bg-no-repeat ring-4 ring-white/10"
      style={{ backgroundImage: `url(${language.flagPngSrc})` }}
      aria-hidden="true"
    />
  )
}

function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}
