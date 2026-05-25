"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { DownloadModal } from "@/components/watch/DownloadModal"
import { LanguagePickerModal } from "@/components/watch/LanguagePickerModal"
import { ShareModal } from "@/components/watch/ShareModal"
import { WatchSectionRenderer } from "@/components/watch/WatchSectionRenderer"
import type {
  MergedWatchBlock,
  ResolvedWatchVideo,
  WatchSubtitle,
} from "@/lib/content"
import { LOCALE_RESOLVED_PARAM } from "@/lib/locale"
import {
  readSubtitlePreference,
  writeSubtitlePreference,
} from "@/lib/subtitle-preference-client"
import { resolvePosterUrl } from "@/lib/url"

function resolveSubtitleSlug(
  preferred: string | null,
  subtitles: WatchSubtitle[],
  audioSlug: string,
): string | null {
  if (subtitles.length === 0) return null
  if (preferred && subtitles.some((s) => s.language.slug === preferred))
    return preferred
  const audioMatch = subtitles.find((s) => s.language.slug === audioSlug)
  if (audioMatch) return audioMatch.language.slug
  const primary = subtitles.find((s) => s.primary)
  if (primary) return primary.language.slug
  return subtitles[0]!.language.slug
}

type WatchVideoRecord = ResolvedWatchVideo["video"]
type WatchVariant = ResolvedWatchVideo["selectedVariant"]

export type WatchModalState = "none" | "download" | "language" | "share"

export type WatchModalCallbacks = {
  openDownload: () => void
  openLanguage: () => void
  openShare: () => void
  closeModal: () => void
}

type WatchPageClientProps = {
  mergedBlocks: MergedWatchBlock[]
  variant: WatchVariant
  video: WatchVideoRecord
  /**
   * Override for the URL `[locale]` slug. The route may pass an ISO code
   * ("en") even when the picked variant's slug is "english", so navigation
   * links round-trip cleanly.
   */
  languageSlug?: string
  /**
   * Validated ISO locale ("en" | "es" | ...) from the URL `[locale]` segment.
   * Threaded into `BibleQuotesSection` so the wldeh/bible-api fetch and
   * BibleGateway "Read more..." link pick the right translation.
   */
  locale?: string
}

export function WatchPageClient({
  mergedBlocks,
  variant,
  video,
  languageSlug,
  locale,
}: WatchPageClientProps) {
  // Lifted so LanguagePickerModal can read `currentTime` for the `?t=` clamp
  // on language switches.
  const playerRef = useRef<MuxPlayerRef | null>(null)
  const handlePlayerReady = useCallback((player: MuxPlayerRef | null) => {
    playerRef.current = player
  }, [])

  // LOCALE_RESOLVED_PARAM is the server's URL-resolved sentinel — see
  // the watchVideo branch in `[slug]/[locale]/page.tsx` + the matching
  // bypass in proxy.ts. Strip it post-hydration via history.replaceState
  // so the user-visible URL stays clean without triggering a router
  // navigation that would re-enter the middleware.
  useEffect(() => {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (!url.searchParams.has(LOCALE_RESOLVED_PARAM)) return
    url.searchParams.delete(LOCALE_RESOLVED_PARAM)
    window.history.replaceState(window.history.state, "", url.toString())
  }, [])

  const currentLanguageSlug = languageSlug ?? variant.language?.slug ?? ""

  const subtitles = video.subtitles ?? []

  const subtitleInitRef = useRef(false)
  const initialSubtitleState = useMemo(() => {
    if (subtitles.length === 0)
      return { enabled: false, slug: null as string | null }
    const pref = readSubtitlePreference()
    const slugToUse = resolveSubtitleSlug(
      pref.languageSlug,
      subtitles,
      currentLanguageSlug,
    )
    return { enabled: pref.enabled && !!slugToUse, slug: slugToUse }
  }, [subtitles, currentLanguageSlug])

  const [subtitleEnabled, setSubtitleEnabled] = useState(false)
  const [subtitleSlug, setSubtitleSlug] = useState<string | null>(null)

  useEffect(() => {
    if (subtitleInitRef.current) return
    subtitleInitRef.current = true
    setSubtitleEnabled(initialSubtitleState.enabled)
    setSubtitleSlug(initialSubtitleState.slug)
  }, [initialSubtitleState])

  const subtitleVttSrc = useMemo((): string | null | undefined => {
    if (subtitles.length === 0) return undefined
    if (!subtitleEnabled || !subtitleSlug) return null
    return (
      subtitles.find((s) => s.language.slug === subtitleSlug)?.vttSrc ?? null
    )
  }, [subtitleEnabled, subtitleSlug, subtitles])

  const handleSubtitleChange = useCallback(
    (enabled: boolean, slug: string | null) => {
      if (enabled && !slug && subtitles.length > 0) {
        slug = resolveSubtitleSlug(null, subtitles, currentLanguageSlug)
      }
      setSubtitleEnabled(enabled)
      setSubtitleSlug(slug)
      writeSubtitlePreference(enabled, slug)
    },
    [subtitles, currentLanguageSlug],
  )

  // Drop entries missing `quality` or `url` — unrenderable / unfollowable.
  // Admin emits `VideoDubDownload.size` as a `String` (Core's bytes literal,
  // which may exceed JS number precision for very large files). Parse to
  // number for the download modal's sort bucket; non-numeric values fall
  // through as null and the modal hides the size label.
  const downloadsForModal = (variant.downloads ?? [])
    .filter(
      (d): d is NonNullable<typeof d> =>
        d != null && d.quality != null && d.url != null,
    )
    .map((d) => {
      const sizeNum =
        typeof d.size === "string" && d.size.length > 0
          ? Number.parseFloat(d.size)
          : null
      return {
        documentId: d.documentId,
        quality: d.quality as string,
        size: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
        url: d.url as string,
      }
    })

  const variantsForLanguagePicker = useMemo(
    () =>
      (video.variants ?? [])
        .filter((v): v is NonNullable<typeof v> => v != null)
        .map((v) => ({
          documentId: v.documentId,
          hls: v.hls,
          published: v.published,
          language: v.language
            ? {
                coreId: v.language.coreId,
                slug: v.language.slug,
                name: v.language.name,
              }
            : null,
        })),
    [video.variants],
  )

  // Prefer the editorial cinematic still over `images[].url` — that raw
  // `url` is a misshaped Cloudflare Images URL (missing variant path
  // segment) and 400s. Mux's thumbnail API is the last-resort fallback;
  // it's a frame from the video, not the curated poster. See
  // `resolvePosterUrl` for the full priority chain.
  const posterUrl = resolvePosterUrl(
    video.images?.[0],
    variant.muxVideo?.playbackId,
  )

  const [modalState, setModalState] = useState<WatchModalState>("none")

  const openDownload = useCallback(() => setModalState("download"), [])
  const openLanguage = useCallback(() => setModalState("language"), [])
  const openShare = useCallback(() => setModalState("share"), [])
  const closeModal = useCallback(() => setModalState("none"), [])

  const modalCallbacks: WatchModalCallbacks = {
    openDownload,
    openLanguage,
    openShare,
    closeModal,
  }

  return (
    <main
      data-testid="watch-page-client"
      data-modal-state={modalState}
      className="min-h-screen bg-stone-900 text-stone-100"
    >
      <WatchSectionRenderer
        blocks={mergedBlocks}
        modalCallbacks={modalCallbacks}
        onPlayerReady={handlePlayerReady}
        locale={locale}
        subtitleVttSrc={subtitleVttSrc}
      />

      <DownloadModal
        open={modalState === "download"}
        downloads={downloadsForModal}
        videoTitle={video.title ?? null}
        posterUrl={posterUrl}
        durationSeconds={variant.duration ?? null}
        languageName={variant.language?.name ?? null}
        onClose={closeModal}
      />
      <LanguagePickerModal
        open={modalState === "language"}
        variants={variantsForLanguagePicker}
        currentLanguageSlug={currentLanguageSlug}
        videoSlug={video.slug ?? ""}
        playerRef={playerRef}
        onClose={closeModal}
        subtitles={subtitles}
        currentSubtitleEnabled={subtitleEnabled}
        currentSubtitleSlug={subtitleSlug}
        onSubtitleChange={handleSubtitleChange}
      />
      <ShareModal
        open={modalState === "share"}
        videoSlug={video.slug ?? ""}
        currentLanguageSlug={currentLanguageSlug}
        videoTitle={video.title ?? null}
        videoDescription={video.snippet ?? video.description ?? null}
        posterUrl={posterUrl}
        playbackId={variant.muxVideo?.playbackId ?? null}
        onClose={closeModal}
      />
    </main>
  )
}

export type WatchPageClientResolved = ResolvedWatchVideo
