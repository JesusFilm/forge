import Link from "next/link"
import type { Route } from "next"
import { useTranslations } from "next-intl"

import { titleCaseSlug } from "@/lib/language-display"
import {
  isDeclarableHtmlLangTag,
  resolveUiLocale,
  resolveWatchLocaleIdentity,
  slugToBcp47Tag,
} from "@/lib/locale"
import { languagesIndexPath } from "@/lib/routes"
import { localizedSearchLanguageName } from "@/lib/search-language-display-name"

// The public language index at /watch/languages listed 2,329 languages on
// 2026-10-08 and again on 2026-10-09. Update this when its published count
// changes. It is a constant on purpose: the static home must not fetch the
// language index before it can render its first screen.
export const WATCH_HOME_LANGUAGE_COUNT = 2_329

/**
 * Names the language the page's videos are in, in the chrome language.
 *
 * The heading follows the content language slug, not the message catalog:
 * `arabic-najdi` renders English chrome over Najdi Arabic videos, so the
 * catalog key alone would announce "English". A slug this app cannot map to a
 * language tag falls back to its title-cased form rather than to the chrome
 * language.
 */
export function watchHomeLanguageName(
  languageSlug: string,
  uiLocale: string,
): string {
  const fallback = titleCaseSlug(languageSlug)
  const tag = slugToBcp47Tag(languageSlug)
  const knownLanguage =
    (tag !== null && isDeclarableHtmlLangTag(tag)) ||
    resolveUiLocale(languageSlug) !== null
  if (!knownLanguage) return fallback

  return localizedSearchLanguageName(
    {
      bcp47: resolveWatchLocaleIdentity(languageSlug).htmlLang,
      englishName: fallback,
      nativeName: null,
      publicSlug: languageSlug,
      regionNames: [],
    },
    uiLocale,
    fallback,
  )
}

export function WatchHomeFirstScreen({
  locale,
  languageSlug,
}: {
  locale: string
  languageSlug: string
}) {
  const inventoryT = useTranslations("LanguageInventory")
  const languagesT = useTranslations("LanguagePickerModal")
  const homeT = useTranslations("WatchHome")
  const language = watchHomeLanguageName(languageSlug, locale)

  return (
    <div
      data-testid="watch-home-first-screen"
      className="max-w-2xl text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.75)]"
    >
      <h1 className="max-w-xl text-xl leading-tight font-bold text-balance break-words sm:text-2xl 2xl:text-4xl compact-landscape:text-lg">
        {inventoryT("heroTitle", { language })}
      </h1>
      {/* One wrapping row, so the trust line shares the count's row wherever
          it fits. Short landscape phones keep only the heading; the header's
          language control stays one tap away. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 compact-landscape:hidden">
        <p
          data-testid="watch-home-language-count"
          className="text-base font-semibold 2xl:text-lg"
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
        <p
          data-testid="watch-home-trust-strip"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-white/85 sm:text-sm"
        >
          <span>{homeT("noSignUpToWatch")}</span>
          <span aria-hidden="true" className="text-white/50">
            ·
          </span>
          <span>Jesus Film Project</span>
        </p>
      </div>
    </div>
  )
}
