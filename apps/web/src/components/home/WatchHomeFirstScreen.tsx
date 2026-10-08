import Link from "next/link"
import type { Route } from "next"
import { useTranslations } from "next-intl"

import { languagesIndexPath } from "@/lib/routes"

// The public language index at /watch/languages listed 2,329 languages on
// 2026-10-08. Update this when its published count changes.
export const WATCH_HOME_LANGUAGE_COUNT = 2_329

function languageDisplayName(locale: string, htmlLang: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(htmlLang) ??
      htmlLang
    )
  } catch {
    return locale
  }
}

export function WatchHomeFirstScreen({
  locale,
  htmlLang,
}: {
  locale: string
  htmlLang: string
}) {
  const inventoryT = useTranslations("LanguageInventory")
  const languagesT = useTranslations("LanguagePickerModal")
  const trustT = useTranslations("WatchHomeTrust")
  const language = languageDisplayName(locale, htmlLang)

  return (
    <div
      data-testid="watch-home-first-screen"
      className="pointer-events-auto mx-auto w-full max-w-[1920px] px-4 pt-24 sm:px-6 sm:pt-28 md:px-8 lg:pt-32"
    >
      <div className="max-w-2xl text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.75)]">
        <h1 className="max-w-xl text-3xl leading-tight font-bold text-balance sm:text-4xl lg:text-5xl">
          {inventoryT("heroTitle", { language })}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/90 sm:text-base">
          {inventoryT("heroDescription", { language })}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <p
            data-testid="watch-home-language-count"
            className="text-base font-semibold sm:text-lg"
          >
            {languagesT("languageCount", {
              count: WATCH_HOME_LANGUAGE_COUNT,
            })}
          </p>
          <Link
            href={languagesIndexPath() as Route}
            data-testid="watch-home-find-language"
            className="inline-flex min-h-11 items-center rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {languagesT("seeAllLanguages")}
          </Link>
        </div>
        <div
          data-testid="watch-home-trust-strip"
          className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-white/85 sm:text-sm"
        >
          <span>{trustT("noSignUpRequired")}</span>
          <span aria-hidden="true" className="text-white/50">
            ·
          </span>
          <span>Jesus Film Project</span>
        </div>
      </div>
    </div>
  )
}
