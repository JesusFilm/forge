"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"

import type { MuxPlayerRef } from "@forge/video-player"

import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"
import type { LanguagePickerVariant } from "@/components/watch/LanguagePickerModal"
// Modals are user-triggered (download / language picker / share). Split
// them into separate chunks so they don't ship with the hero-critical
// bundle. `ssr: false` is safe — modals are hidden on first paint.
const DownloadModal = dynamic(
  () =>
    import("@/components/watch/DownloadModal").then((m) => ({
      default: m.DownloadModal,
    })),
  { ssr: false },
)
const LanguagePickerModal = dynamic(
  () =>
    import("@/components/watch/LanguagePickerModal").then((m) => ({
      default: m.LanguagePickerModal,
    })),
  { ssr: false },
)
const ShareModal = dynamic(
  () =>
    import("@/components/watch/ShareModal").then((m) => ({
      default: m.ShareModal,
    })),
  { ssr: false },
)
import { SubtitleTranscript } from "@/components/watch/SubtitleTranscript"
import { WatchQuestionPanel } from "@/components/watch/WatchQuestionPanel"
import { WatchSectionRenderer } from "@/components/watch/WatchSectionRenderer"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { redirectToAuth } from "@/components/watch/download-session-client"
import type {
  MergedWatchBlock,
  ResolvedWatchVideo,
  WatchSubtitle,
} from "@/lib/content"
import type { InitialSubtitleTranscript } from "@/lib/subtitle-transcript"
import { LOCALE_RESOLVED_PARAM } from "@/lib/locale"
import {
  readSubtitlePreference,
  writeSubtitlePreference,
} from "@/lib/subtitle-preference-client"
import { resolvePosterUrl } from "@/lib/url"
import {
  getCachedWatchLanguageOptions,
  loadWatchInteraction,
  loadWatchLanguageOptionsForVideo,
  scheduleWatchInteractionWarmup,
} from "@/lib/watch-interaction-loader"

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
  downloadButtonLabel?: string
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
  hideBibleQuotes?: boolean
  questionPanelEnabled?: boolean
  initialTranscript?: InitialSubtitleTranscript
}

type LanguageOptionsState =
  | { status: "idle"; variants: LanguagePickerVariant[] }
  | { status: "loading"; variants: LanguagePickerVariant[] }
  | { status: "ready"; variants: LanguagePickerVariant[] }
  | { status: "error"; variants: LanguagePickerVariant[] }

export function WatchPageClient({
  downloadButtonLabel,
  mergedBlocks,
  variant,
  video,
  languageSlug,
  locale,
  hideBibleQuotes = false,
  questionPanelEnabled = false,
  initialTranscript = null,
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
  const tDownloadButton = useTranslations("DownloadButton")

  const subtitles = useMemo(() => video.subtitles ?? [], [video.subtitles])

  const [subtitleEnabled, setSubtitleEnabled] = useState(false)
  const [subtitleSlug, setSubtitleSlug] = useState<string | null>(null)
  const [subtitleInit, setSubtitleInit] = useState(false)

  if (!subtitleInit && subtitles.length > 0) {
    setSubtitleInit(true)
    const pref = readSubtitlePreference()
    const slugToUse = resolveSubtitleSlug(
      pref.languageSlug,
      subtitles,
      currentLanguageSlug,
    )
    if (pref.enabled && slugToUse) {
      setSubtitleEnabled(true)
    }
    if (slugToUse) {
      setSubtitleSlug(slugToUse)
    }
  }

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

  // Drop entries missing `quality` — unrenderable in the tier selector.
  // Raw CDN URLs stay server-only and are resolved by `/watch/api/download`
  // from the opaque video/variant/download ids.
  // Admin emits `VideoDubDownload.size` as a `String` (Core's bytes literal,
  // which may exceed JS number precision for very large files). Parse to
  // number for the download modal's sort bucket; non-numeric values fall
  // through as null and the modal hides the size label.
  const downloadsForModal = (variant.downloads ?? [])
    .filter((d): d is NonNullable<typeof d> => d != null && d.quality != null)
    .map((d) => {
      const sizeNum =
        typeof d.size === "string" && d.size.length > 0
          ? Number.parseFloat(d.size)
          : null
      return {
        documentId: d.documentId,
        quality: d.quality as string,
        size: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
      }
    })

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
  const [downloadPending, setDownloadPending] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const downloadPendingRef = useRef(false)
  const videoSlug = video.slug ?? ""
  const [enabledModalChunks, setEnabledModalChunks] = useState({
    download: false,
    language: false,
    share: false,
  })
  const [languageOptionsState, setLanguageOptionsState] =
    useState<LanguageOptionsState>({
      status: "idle",
      variants: [],
    })
  const languageOptionsPendingRef = useRef(false)

  useEffect(() => {
    languageOptionsPendingRef.current = false
    const cached = videoSlug ? getCachedWatchLanguageOptions(videoSlug) : null
    setLanguageOptionsState(
      cached
        ? { status: "ready", variants: cached }
        : { status: "idle", variants: [] },
    )
  }, [videoSlug])

  useEffect(() => {
    return scheduleWatchInteractionWarmup({ videoSlug })
  }, [videoSlug])

  const loadLanguageOptions = useCallback(async () => {
    if (!videoSlug) return
    if (languageOptionsPendingRef.current) return
    if (languageOptionsState.status === "ready") return

    const cached = getCachedWatchLanguageOptions(videoSlug)
    if (cached) {
      setLanguageOptionsState({ status: "ready", variants: cached })
      return
    }

    languageOptionsPendingRef.current = true
    setLanguageOptionsState({ status: "loading", variants: [] })
    try {
      const variants = await loadWatchLanguageOptionsForVideo(videoSlug)
      setLanguageOptionsState({ status: "ready", variants })
    } catch {
      setLanguageOptionsState({ status: "error", variants: [] })
    } finally {
      languageOptionsPendingRef.current = false
    }
  }, [languageOptionsState.status, videoSlug])

  const openDownload = useCallback(async () => {
    if (downloadPendingRef.current) return
    setEnabledModalChunks((prev) => ({ ...prev, download: true }))
    void loadWatchInteraction("download").catch(() => {})
    downloadPendingRef.current = true
    setDownloadPending(true)

    try {
      const session = await resolveDownloadSessionAccess()
      if (!session.ok && session.reason === "session-unavailable") {
        setDownloadError(tDownloadButton("sessionError"))
        return
      }
      setDownloadError(null)
      if (session.ok) {
        setModalState("download")
        return
      }
      redirectToAuth(session.loginUrl)
    } finally {
      downloadPendingRef.current = false
      setDownloadPending(false)
    }
  }, [tDownloadButton])
  const openLanguage = useCallback(() => {
    setEnabledModalChunks((prev) => ({ ...prev, language: true }))
    void loadWatchInteraction("language").catch(() => {})
    setModalState("language")
    void loadLanguageOptions()
  }, [loadLanguageOptions])
  const openShare = useCallback(() => {
    setEnabledModalChunks((prev) => ({ ...prev, share: true }))
    void loadWatchInteraction("share").catch(() => {})
    setModalState("share")
  }, [])
  const closeModal = useCallback(() => setModalState("none"), [])

  // Pause the video whenever any modal (search / language / download / share)
  // opens, and restore the prior playing state on close. Captures the snapshot
  // at the open-edge so a paused video stays paused after the modal closes.
  const { searchOpen } = useFloatingSearchPinned()
  const anyModalOpen = searchOpen || modalState !== "none"
  const wasPlayingRef = useRef(false)
  const prevAnyModalOpenRef = useRef(false)
  useEffect(() => {
    const player = playerRef.current
    const wasOpen = prevAnyModalOpenRef.current
    prevAnyModalOpenRef.current = anyModalOpen
    if (!player) return
    if (anyModalOpen && !wasOpen) {
      wasPlayingRef.current = !player.paused
      if (wasPlayingRef.current) {
        player.pause()
      }
    } else if (!anyModalOpen && wasOpen) {
      if (wasPlayingRef.current) {
        const result = player.play()
        if (result && typeof (result as Promise<void>).then === "function") {
          ;(result as Promise<void>).catch(() => {})
        }
      }
      wasPlayingRef.current = false
    }
  }, [anyModalOpen])

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
      className={`min-h-screen bg-stone-900 font-sans text-stone-100 [&_button]:font-sans [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans [&_h4]:font-sans [&_h5]:font-sans [&_h6]:font-sans [&_p]:font-sans ${
        questionPanelEnabled
          ? "pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] sm:pb-0"
          : ""
      }`}
    >
      <WatchSectionRenderer
        blocks={mergedBlocks}
        downloadButtonLabel={downloadButtonLabel}
        downloadError={downloadError}
        downloadPending={downloadPending}
        modalCallbacks={modalCallbacks}
        onPlayerReady={handlePlayerReady}
        locale={locale}
        languageSlug={currentLanguageSlug}
        subtitleVttSrc={subtitleVttSrc}
        hideBibleQuotes={hideBibleQuotes}
      />

      <SubtitleTranscript
        subtitles={subtitles}
        playerRef={playerRef}
        audioSlug={currentLanguageSlug}
        durationSeconds={variant.duration ?? null}
        initialTranscript={initialTranscript}
      />

      {enabledModalChunks.download ? (
        <DownloadModal
          open={modalState === "download"}
          downloads={downloadsForModal}
          videoTitle={video.title ?? null}
          posterUrl={posterUrl}
          durationSeconds={variant.duration ?? null}
          languageName={variant.language?.name ?? null}
          variantId={variant.documentId}
          videoSlug={videoSlug}
          onClose={closeModal}
        />
      ) : null}
      {enabledModalChunks.language ? (
        <LanguagePickerModal
          open={modalState === "language"}
          variants={languageOptionsState.variants}
          currentLanguageSlug={currentLanguageSlug}
          videoSlug={videoSlug}
          playerRef={playerRef}
          onClose={closeModal}
          subtitles={subtitles}
          currentSubtitleEnabled={subtitleEnabled}
          currentSubtitleSlug={subtitleSlug}
          onSubtitleChange={handleSubtitleChange}
          languageOptionsLoading={languageOptionsState.status === "loading"}
          languageOptionsError={languageOptionsState.status === "error"}
          onRetryLanguageOptions={loadLanguageOptions}
        />
      ) : null}
      {enabledModalChunks.share ? (
        <ShareModal
          open={modalState === "share"}
          videoSlug={videoSlug}
          currentLanguageSlug={currentLanguageSlug}
          videoTitle={video.title ?? null}
          videoDescription={video.snippet ?? video.description ?? null}
          posterUrl={posterUrl}
          playbackId={variant.muxVideo?.playbackId ?? null}
          onClose={closeModal}
        />
      ) : null}
      {questionPanelEnabled ? (
        <WatchQuestionPanel
          enabled={questionPanelEnabled}
          modalSuppressed={modalState !== "none"}
        />
      ) : null}
    </main>
  )
}

export type WatchPageClientResolved = ResolvedWatchVideo
