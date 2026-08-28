"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, Clapperboard, Play } from "lucide-react"
import { useState } from "react"

import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { titleCaseSlug } from "@/lib/language-display"
import {
  asLocaleSlug,
  languageVideosIndexPath,
  searchPath,
  WATCH_BASE_PATH,
} from "@/lib/routes"
import { slugToBcp47Tag } from "@/lib/locale"
import { localizedSearchLanguageName } from "@/lib/search-language-display-name"
import type { WatchUnavailableRecoveryResolution } from "@/lib/watch-unavailable-recovery-actions"
import { readWatchUnavailableRecoveryContext } from "@/lib/watch-unavailable-recovery-context"
import type { ParsedUnavailableWatchPath } from "@/lib/watch-unavailable-recovery"
import { cn } from "@/lib/utils"

import { LanguageCombobox } from "./LanguageCombobox"

const FALLBACK_ARTWORK = `${WATCH_BASE_PATH}/images/thumbnails/11_Advent0304-vertical.jpg`

const actionClasses =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-3 text-center text-sm font-bold text-white transition focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:min-h-14 sm:px-6 sm:text-base"
const primaryActionClasses = cn(
  actionClasses,
  "bg-brand-red shadow-[0_14px_32px_rgba(0,0,0,0.34)] hover:bg-brand-red/90 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-brand-red",
)
const secondaryActionClasses = cn(
  actionClasses,
  "border border-white/35 bg-black/30 shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur hover:border-white/60 hover:bg-white/12",
)

function humanizeSlug(slug: string): string {
  return titleCaseSlug(slug.replaceAll("_", "-"))
}

type WatchUnavailableLanguageClientProps = {
  parsed: ParsedUnavailableWatchPath | null
  initialResolution: WatchUnavailableRecoveryResolution
}

export function WatchUnavailableLanguageClient({
  parsed,
  initialResolution,
}: WatchUnavailableLanguageClientProps) {
  const router = useRouter()
  const uiLocale = useLocale()
  const t = useTranslations("WatchUnavailableLanguage")
  const recoveryKey = parsed
    ? `${parsed.contentSlug}:${parsed.requestedLanguageSlug}`
    : null
  const [audioSelection, setAudioSelection] = useState<{
    recoveryKey: string | null
    languageSlug: string
  }>({ recoveryKey: null, languageSlug: "" })
  const contentTitle =
    initialResolution.contentTitle ??
    humanizeSlug(parsed?.contentSlug ?? "video")
  const fallbackLanguageName = humanizeSlug(
    parsed?.requestedLanguageSlug ?? "selected-language",
  )
  const requestedLanguageBcp47 = parsed
    ? slugToBcp47Tag(parsed.requestedLanguageSlug)
    : null
  const languageName = parsed
    ? localizedSearchLanguageName(
        {
          englishName: fallbackLanguageName,
          nativeName: null,
          bcp47: requestedLanguageBcp47,
          publicSlug: parsed.requestedLanguageSlug,
          regionNames: [],
        },
        uiLocale,
        fallbackLanguageName,
      )
    : fallbackLanguageName
  const requestedLanguage = parsed
    ? asLocaleSlug(parsed.requestedLanguageSlug)
    : asLocaleSlug("english")
  const targetImageUrl = initialResolution.targetImageUrl
  const artworkUrl = targetImageUrl ?? FALLBACK_ARTWORK
  const audioOptions = initialResolution.verifiedGap
    ? initialResolution.audioOptions
    : []
  const selectedAudioLanguageSlug =
    audioSelection.recoveryKey === recoveryKey
      ? audioSelection.languageSlug
      : ""
  const selectedAudioOption = audioOptions.find(
    (option) => option.slug === selectedAudioLanguageSlug,
  )
  const usesChineseHeadingLayout = uiLocale.toLowerCase().startsWith("zh")

  return (
    <main className="relative isolate min-h-svh overflow-x-hidden overflow-y-auto bg-black text-white">
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <div
          data-testid="watch-unavailable-artwork"
          data-state={targetImageUrl ? "resolved" : "fallback"}
          className="watch-home-media-enter absolute inset-y-0 right-0 w-full md:w-[62%]"
        >
          <Image
            src={artworkUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 767px) 100vw, 62vw"
            unoptimized={targetImageUrl == null}
            className="object-cover object-center opacity-50 md:object-right"
          />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_35%,rgba(239,51,64,0.18),transparent_38%),linear-gradient(180deg,rgba(0,0,0,0.42)_0%,rgba(0,0,0,0.25)_36%,#000_72%)] md:bg-[radial-gradient(circle_at_74%_35%,rgba(239,51,64,0.18),transparent_38%),linear-gradient(90deg,#000_0%,rgba(0,0,0,0.95)_38%,rgba(0,0,0,0.62)_68%,rgba(0,0,0,0.28)_100%)]" />
      </div>

      <div
        className={`${WATCH_PAGE_CONTENT_CLASSES} relative z-10 flex min-h-svh items-center pt-[calc(env(safe-area-inset-top,0px)+7rem)] pb-[calc(env(safe-area-inset-bottom,0px)+3rem)] md:pt-[calc(env(safe-area-inset-top,0px)+8.5rem)] md:pb-[calc(env(safe-area-inset-bottom,0px)+4rem)]`}
      >
        <section
          aria-labelledby="watch-unavailable-heading"
          className={cn(
            "w-full max-w-4xl",
            usesChineseHeadingLayout && "2xl:max-w-5xl",
          )}
        >
          <p className="text-xs font-bold tracking-[0.24em] text-brand-red uppercase sm:text-sm">
            {t("eyebrow")}
          </p>
          <h1
            id="watch-unavailable-heading"
            className={cn(
              "mt-3 max-w-4xl text-4xl leading-[1.02] font-extrabold tracking-[-0.04em] text-white text-balance sm:mt-4 sm:text-5xl md:text-6xl",
              usesChineseHeadingLayout && "2xl:max-w-5xl",
            )}
          >
            {t.rich("title", {
              title: contentTitle,
              language: languageName,
              contentTitle: (chunks) => (
                <bdi dir="auto" className="inline-block max-w-full">
                  {chunks}
                </bdi>
              ),
              languageName: (chunks) => (
                <bdi dir="auto" className="inline-block max-w-full">
                  {chunks}
                </bdi>
              ),
            })}
          </h1>
          {audioOptions.length > 0 ? (
            <section
              data-testid="watch-unavailable-audio-panel"
              aria-labelledby="watch-unavailable-audio-heading"
              className="mt-6 max-w-2xl rounded-2xl border border-white/10 bg-black/45 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.3)] backdrop-blur-md sm:p-5"
            >
              <h2
                id="watch-unavailable-audio-heading"
                className="text-lg font-extrabold tracking-tight text-white sm:text-xl"
              >
                {t("audioVersionsTitle")}
              </h2>
              <p className="mt-1 text-base sm:text-sm leading-6 text-stone-300">
                {t("audioVersionsDescription")}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <p className="sr-only">{t("languageVersionLabel")}</p>
                  <LanguageCombobox
                    options={audioOptions}
                    value={selectedAudioLanguageSlug}
                    onChange={(languageSlug) =>
                      setAudioSelection({ recoveryKey, languageSlug })
                    }
                    placeholder={t("selectLanguageVersion")}
                    compact
                    triggerClassName="border-white/15 bg-stone-900/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/25 hover:bg-white/10"
                  />
                </div>
                <button
                  type="button"
                  data-testid="watch-selected-language"
                  disabled={!selectedAudioOption}
                  onClick={() => {
                    if (selectedAudioOption)
                      router.push(selectedAudioOption.href)
                  }}
                  className={primaryActionClasses}
                >
                  <Play aria-hidden="true" className="h-5 w-5 fill-current" />
                  {t("watchSelectedVersion")}
                </button>
              </div>
            </section>
          ) : null}

          <nav
            aria-label={t("actionsLabel")}
            className="mt-4 flex flex-col items-stretch gap-3 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center"
          >
            <Link
              href={languageVideosIndexPath(requestedLanguage)}
              prefetch={false}
              className={secondaryActionClasses}
            >
              <Clapperboard aria-hidden="true" className="h-5 w-5" />
              {t("browseInLanguage", { language: languageName })}
            </Link>
            <button
              type="button"
              onClick={() => {
                const searchContext = parsed
                  ? readWatchUnavailableRecoveryContext({
                      contentSlug: parsed.contentSlug,
                      requestedLanguageSlug: parsed.requestedLanguageSlug,
                    })
                  : null
                if (searchContext) {
                  window.history.back()
                } else {
                  router.push(searchPath())
                }
              }}
              className={secondaryActionClasses}
            >
              <ArrowLeft aria-hidden="true" className="h-5 w-5" />
              {t("backToSearch")}
            </button>
          </nav>
        </section>
      </div>
    </main>
  )
}
