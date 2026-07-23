"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Download, ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"

import type { MuxPlayerRef } from "@forge/video-player"

import { Button } from "@/components/ui/button"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { DOWNLOAD_RETURN_INTENT_PARAM } from "@/components/watch/download-session-client"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import {
  LanguagePickerModal,
  type LanguagePickerVariant,
} from "@/components/watch/LanguagePickerModal"
import { SeriesEpisodesGrid } from "@/components/watch/SeriesEpisodesGrid"
import { SeriesHero } from "@/components/watch/SeriesHero"
import { ShareModal } from "@/components/watch/ShareModal"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"
import type { ResolvedSeriesBySlug } from "@/lib/content"
import { resolveEpisodeImageUrl } from "@/lib/episode-image"
import { languageCodeFor } from "@/lib/language-code"
import { deriveLanguageDisplay } from "@/lib/language-display"
import { LOCALE_RESOLVED_PARAM } from "@/lib/locale"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { resolveSeriesLanguageIdentity } from "@/lib/series-language"
import { tryAsContentSlug, tryAsLocaleSlug, watchVideoPath } from "@/lib/routes"
import { resolvePosterUrl } from "@/lib/url"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
} from "@/lib/watch-player-chrome-events"

const CollectionDownloadModal = dynamic(
  () =>
    import("@/components/watch/CollectionDownloadModal").then((module) => ({
      default: module.CollectionDownloadModal,
    })),
  { ssr: false },
)

// Non-null `hls` marker for the synthesized LanguagePickerVariant entries.
// `series.childDubLanguages` is server-guaranteed playable but ships no
// stream URL; the shared LanguagePickerModal filters its input through
// isPlayableLanguageVariant (which checks `hls != null`), so a non-null
// placeholder satisfies the gate. The modal never reads the value — it
// navigates by language slug — so the real URL is intentionally elided.
const SERVER_GUARANTEED_PLAYABLE = "server-guaranteed-playable"

type SeriesModalState = "none" | "download" | "share" | "language"

type SeriesPageClientProps = {
  series: ResolvedSeriesBySlug["video"]
  selectedVariant: ResolvedSeriesBySlug["selectedVariant"]
  locale: string
}

export function SeriesPageClient({
  series,
  selectedVariant,
  locale,
}: SeriesPageClientProps) {
  const t = useTranslations("SeriesPage")
  const router = useRouter()
  const [modalState, setModalState] = useState<SeriesModalState>("none")
  useWatchModalActivity(modalState !== "none")
  const [downloadPending, setDownloadPending] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadLoginUrl, setDownloadLoginUrl] = useState<string | null>(null)
  const [downloadAccountGateEnabled, setDownloadAccountGateEnabled] =
    useState(false)
  const downloadPendingRef = useRef(false)
  const downloadSessionRequestVersionRef = useRef(0)
  const cancelDownloadSessionRequest = useCallback(() => {
    downloadSessionRequestVersionRef.current += 1
    downloadPendingRef.current = false
    setDownloadPending(false)
  }, [])
  const openShare = useCallback(() => {
    cancelDownloadSessionRequest()
    setModalState("share")
  }, [cancelDownloadSessionRequest])
  const openLanguage = useCallback(() => {
    cancelDownloadSessionRequest()
    setModalState("language")
  }, [cancelDownloadSessionRequest])
  const closeModal = useCallback(() => {
    cancelDownloadSessionRequest()
    setModalState("none")
  }, [cancelDownloadSessionRequest])

  useEffect(
    () => () => {
      downloadSessionRequestVersionRef.current += 1
    },
    [],
  )

  // Mirror `WatchPageClient`'s `LOCALE_RESOLVED_PARAM` strip — series
  // pages can also receive the server-side URL-↔-variant sync redirect
  // (when the requested locale has no matching dub for any of the
  // series' children), so the sentinel must be cleaned up here too.
  useEffect(() => {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (!url.searchParams.has(LOCALE_RESOLVED_PARAM)) return
    url.searchParams.delete(LOCALE_RESOLVED_PARAM)
    window.history.replaceState(window.history.state, "", url.toString())
  }, [])

  // LanguagePickerModal expects a MuxPlayerRef to read currentTime for
  // the `?t=` query clamp. The series page has no player, so we hand
  // it a permanently-null ref — the modal's optional chain on
  // playerRef.current?.currentTime resolves to 0, which is exactly
  // what we want for series-level language switching.
  const playerRef = useRef<MuxPlayerRef | null>(null)

  const episodes = (series.children ?? []).filter(
    (child): child is NonNullable<(typeof series.children)[number]> =>
      child != null,
  )
  // R8 pluralization: ICU plural covers N === 0 / 1 / 2+. The "SERIES · …"
  // composite is built from the localized episode-count string.
  const episodeLabel = t("episodeCount", { count: episodes.length })
  const description = series.description ?? series.snippet ?? null
  const posterUrl = resolvePosterUrl(series.images?.[0], null)

  // `series.childDubLanguages` is the distinct dub-language union across all
  // episodes, aggregated + deduped server-side (DISTINCT ON) and guaranteed
  // playable — so it carries only display fields {slug, name, bcp47}, never
  // each episode's full dub list (the ~45 MB payload that broke
  // unstable_cache). We re-dedupe by slug here purely as a belt-and-braces
  // guard.
  //
  // Two downstream consumers need a per-language projection, built in one
  // pass keyed by slug:
  //  - languageOptions — the inline LanguageCombobox feed (sorted A→Z
  //    by English form via deriveLanguageDisplay).
  //  - variantsForLanguagePicker — the LanguagePickerModal feed. The modal
  //    filters its input through isPlayableLanguageVariant (it also serves
  //    the watch page, which passes unfiltered variants). These entries are
  //    already server-guaranteed playable but carry no dub fields, so we
  //    synthesize the shape that filter checks: `published: true` (the server
  //    only returns published dubs) and a non-null `hls` marker. The modal
  //    reads only hls's PRESENCE, never its value — it navigates by slug —
  //    so eliding the real stream URL here is safe.
  const { languageOptions, variantsForLanguagePicker } = useMemo(() => {
    const bySlug = new Map<
      string,
      {
        display: LanguageComboboxOption
        variant: LanguagePickerVariant
      }
    >()
    for (const language of series.childDubLanguages ?? []) {
      if (!language?.slug) continue
      const slug = language.slug
      const bcp47 = language.bcp47 ?? null
      if (bySlug.has(slug)) continue
      bySlug.set(slug, {
        display: {
          ...deriveLanguageDisplay(slug, language.name),
          bcp47,
        },
        variant: {
          documentId: slug,
          published: true,
          hls: SERVER_GUARANTEED_PLAYABLE,
          language: {
            bcp47: language.bcp47,
            slug: language.slug,
            name: language.name,
          },
        },
      })
    }
    const entries = Array.from(bySlug.values())
    return {
      languageOptions: entries
        .map((e) => e.display)
        .sort((a, b) => a.name.localeCompare(b.name)),
      variantsForLanguagePicker: entries.map((e) => e.variant),
    }
  }, [series.childDubLanguages])

  // Resolve the current language slug from the URL locale. Accept either
  // form — language-slug form ("english") OR bcp47 ("en") — since the
  // resolver matches variants on either. Falls back to the first option
  // so the combobox's controlled value always has a matching entry.
  const currentLanguageSlug =
    resolveSeriesLanguageIdentity(languageOptions, locale)?.slug ?? ""
  const currentLanguageCode = languageCodeFor(
    languageOptions.find((option) => option.slug === currentLanguageSlug) ?? {},
  )
  const headerLanguageSwitcherOwnerToken = useRef(
    Symbol("series-page-language-switcher"),
  ).current

  const openDownload = useCallback(async () => {
    if (downloadPendingRef.current) return
    downloadPendingRef.current = true
    setDownloadPending(true)
    const requestVersion = ++downloadSessionRequestVersionRef.current
    try {
      const session = await resolveDownloadSessionAccess()
      if (downloadSessionRequestVersionRef.current !== requestVersion) return
      if (!session.ok && session.reason === "session-unavailable") {
        setDownloadError(t("downloadSessionError"))
        return
      }
      setDownloadError(null)
      if (session.ok) {
        setDownloadAccountGateEnabled(session.accountGateEnabled)
        setDownloadLoginUrl(null)
      } else {
        setDownloadAccountGateEnabled(true)
        setDownloadLoginUrl(session.loginUrl)
      }
      setModalState("download")
    } finally {
      if (downloadSessionRequestVersionRef.current === requestVersion) {
        downloadPendingRef.current = false
        setDownloadPending(false)
      }
    }
  }, [t])

  useEffect(() => {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (url.searchParams.get(DOWNLOAD_RETURN_INTENT_PARAM) !== "1") return
    url.searchParams.delete(DOWNLOAD_RETURN_INTENT_PARAM)
    window.history.replaceState(window.history.state, "", url.toString())
    void openDownload()
  }, [openDownload])

  const headerLanguageSwitcherVisible = variantsForLanguagePicker.length >= 2
  const heroOwnsHeaderLanguageSwitcher = Boolean(selectedVariant?.hls)
  useEffect(() => {
    if (typeof window === "undefined" || heroOwnsHeaderLanguageSwitcher) return

    window.dispatchEvent(
      new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
        WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
        {
          detail: {
            visible: headerLanguageSwitcherVisible,
            onClick: headerLanguageSwitcherVisible ? openLanguage : null,
            languageCode: headerLanguageSwitcherVisible
              ? currentLanguageCode
              : null,
            ownerToken: headerLanguageSwitcherOwnerToken,
          },
        },
      ),
    )

    return () => {
      window.dispatchEvent(
        new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
          WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
          {
            detail: {
              visible: false,
              onClick: null,
              languageCode: null,
              ownerToken: headerLanguageSwitcherOwnerToken,
            },
          },
        ),
      )
    }
  }, [
    currentLanguageCode,
    headerLanguageSwitcherOwnerToken,
    headerLanguageSwitcherVisible,
    heroOwnsHeaderLanguageSwitcher,
    openLanguage,
  ])

  const handleLanguageChange = useCallback(
    (nextSlug: string) => {
      const seriesSlug = series.slug
      if (!nextSlug || !seriesSlug || nextSlug === currentLanguageSlug) return
      // Validate both segments BEFORE writing the cookie or navigating —
      // an invalid slug must neither persist a preference nor push a URL.
      const slug = tryAsContentSlug(seriesSlug)
      const lang = tryAsLocaleSlug(nextSlug)
      if (!slug || !lang) return
      // Persist preference cookie so subsequent visits respect the choice
      // — matches the watch page's behavior via proxy.ts canonical redirect.
      writePreferredLanguageSlug(nextSlug)
      router.push(watchVideoPath(slug, lang))
    },
    [router, series.slug, currentLanguageSlug],
  )

  const showMetaSection = Boolean(description) || languageOptions.length > 0

  return (
    <main
      data-testid="series-page-client"
      data-modal-state={modalState}
      className="min-h-screen bg-stone-900 text-stone-100"
    >
      <SeriesHero
        series={series}
        selectedVariant={selectedVariant}
        onLanguageClick={openLanguage}
        languageSlug={currentLanguageSlug}
        playableLanguageCount={variantsForLanguagePicker.length}
        overlay={
          // Stack the label on top, then a horizontal row with the title
          // on the left and the share pill on the right. Using
          // `items-center` on that row aligns the share button to the
          // title's vertical midline rather than its bottom — earlier
          // `items-end` alignment positioned the share slightly below
          // the title baseline because the pill is shorter than the H1.
          <div
            data-testid="series-page-hero-overlay"
            className="absolute right-10 bottom-0 left-10 flex flex-col items-stretch gap-3 pb-8 md:right-16 md:left-16 md:pb-10 xl:right-24 xl:left-24"
          >
            <span
              data-testid="series-page-label"
              className="text-sm font-semibold tracking-wider text-amber-400 uppercase md:text-base"
            >
              {t("seriesLabel", { episodes: episodeLabel })}
            </span>
            <div className="flex items-end justify-between gap-4">
              <h1
                data-testid="series-page-title"
                className="min-w-0 text-3xl font-bold text-white drop-shadow-lg md:text-5xl xl:text-6xl"
              >
                {series.title ?? ""}
              </h1>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {episodes.length > 0 ? (
                  <Button
                    variant="pill"
                    onClick={openDownload}
                    disabled={downloadPending}
                    aria-label={t("downloadCollection")}
                    data-testid="series-page-download-button"
                  >
                    <Download size={16} />
                    <span>
                      {downloadPending
                        ? t("checkingDownloads")
                        : t("downloadCollection")}
                    </span>
                  </Button>
                ) : null}
                <Button
                  variant="pill"
                  onClick={openShare}
                  aria-label={t("share")}
                  data-testid="series-page-share-button"
                >
                  <ExternalLink size={16} />
                  <span>{t("share")}</span>
                </Button>
              </div>
            </div>
            {downloadError ? (
              <p role="alert" className="text-sm font-semibold text-red-300">
                {downloadError}
              </p>
            ) : null}
          </div>
        }
      />

      {/* Meta section sits below the hero. Two-column on md+: description
          on the left (col-span 2/3), language combobox on the right
          (col-span 1/3). Single-column on mobile stacks them top-to-
          bottom. Tight padding keeps the section visually attached to
          the hero band above and the episode grid below.
          `bg-stone-900` is load-bearing — the hero is `position: sticky`
          and stays painted in the viewport as the body scrolls up. A
          transparent meta section lets the still-pinned hero bleed
          through (description text on top of trailer = unreadable). The
          opaque bg covers the hero as soon as the section overlaps it. */}
      {showMetaSection ? (
        <section
          data-testid="series-page-meta"
          className="relative z-30 grid w-full grid-cols-1 gap-6 bg-stone-900/80 px-5 pt-10 pb-6 text-stone-100 backdrop-blur-2xl backdrop-saturate-150 md:grid-cols-4 md:gap-10 md:px-16 md:pt-12 md:pb-8 xl:px-24"
        >
          {description ? (
            <div className="md:col-span-3">
              <p
                data-testid="series-page-description"
                className="text-base leading-relaxed text-stone-200/80 md:text-lg"
              >
                {description}
              </p>
            </div>
          ) : (
            // Reserve the left columns so the combobox stays in the right
            // rail even when description is missing.
            <div className="hidden md:col-span-3 md:block" aria-hidden="true" />
          )}
          {languageOptions.length > 0 ? (
            <div
              data-testid="series-page-languages"
              className="flex flex-col gap-2"
            >
              <span
                data-testid="series-page-languages-label"
                className="text-xs font-semibold tracking-[0.18em] text-stone-400 uppercase"
              >
                {t("languages")}
              </span>
              <LanguageCombobox
                options={languageOptions}
                value={currentLanguageSlug}
                onChange={handleLanguageChange}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Episode grid. For zero children the grid renders empty
          (acceptable low-content state per the doc-review deferral —
          editors mid-populating a series still see the hero + metadata
          so they can confirm they're on the right page).
          The grid owns its own full-bleed section element (bg + padding
          + z-20 to cover the sticky hero) and accepts the series poster
          as a default backdrop. SeriesPageClient no longer wraps it. */}
      <SeriesEpisodesGrid
        episodes={episodes}
        languageSlug={currentLanguageSlug}
        parentSlug={series.slug ?? ""}
        seriesPosterUrl={posterUrl}
      />

      {modalState === "download" ? (
        <CollectionDownloadModal
          open
          collectionSlug={series.slug ?? ""}
          collectionTitle={series.title}
          episodes={episodes.map((episode) => ({
            documentId: episode.documentId,
            slug: episode.slug,
            title: episode.title,
            thumbnailUrl: resolveEpisodeImageUrl(episode),
          }))}
          languages={languageOptions}
          currentLanguageSlug={currentLanguageSlug}
          accountGateEnabled={downloadAccountGateEnabled}
          authRequiredLoginUrl={downloadLoginUrl}
          onClose={closeModal}
        />
      ) : null}

      <LanguagePickerModal
        open={modalState === "language"}
        variants={variantsForLanguagePicker}
        currentLanguageSlug={currentLanguageSlug}
        videoSlug={series.slug ?? ""}
        playerRef={playerRef}
        onClose={closeModal}
        kind="series"
      />

      <ShareModal
        open={modalState === "share"}
        videoSlug={series.slug ?? ""}
        currentLanguageSlug={locale}
        videoTitle={series.title ?? null}
        videoDescription={description}
        posterUrl={posterUrl}
        // Series-level share never embeds the trailer — Embed tab
        // suppresses on null playbackId by ShareModal's own gate.
        playbackId={null}
        onClose={closeModal}
      />
    </main>
  )
}
