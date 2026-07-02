"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Route } from "next"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import type { MuxPlayerRef } from "@forge/video-player"

import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"
import type { LanguagePickerVariant } from "@/components/watch/LanguagePickerModal"
import {
  WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY,
  type WatchChapterCarouselPreserveState,
  type WatchChapterNavigationIntent,
} from "@/components/watch/chapter-navigation"
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
import { WatchEventRecorder } from "@/components/watch/WatchEventRecorder"
import { WatchQuestionPanel } from "@/components/watch/WatchQuestionPanel"
import { WatchSectionRenderer } from "@/components/watch/WatchSectionRenderer"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { DOWNLOAD_RETURN_INTENT_PARAM } from "@/components/watch/download-session-client"
import {
  buildMediaProxyUrl,
  buildDownloadFilename,
  buildDownloadProxyUrl,
} from "@/components/watch/download-link"
import { selectDefaultDownloadTier } from "@/components/watch/download-options"
import { env } from "@/env"
import type {
  MergedWatchBlock,
  ResolvedWatchVideo,
  WatchSiblingCarouselBlock,
  WatchSubtitle,
} from "@/lib/content"
import { isWatchBlock } from "@/lib/watch-blocks"
import type { InitialSubtitleTranscript } from "@/lib/subtitle-transcript"
import { LOCALE_RESOLVED_PARAM } from "@/lib/locale"
import {
  WATCH_BASE_PATH,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { buildFbShareUrl } from "@/lib/share"
import {
  readSubtitlePreference,
  writeSubtitlePreference,
} from "@/lib/subtitle-preference-client"
import {
  PUBLIC_SHARE_FALLBACK_ORIGIN,
  isPublicShareableOrigin,
  resolvePosterUrl,
} from "@/lib/url"
import {
  getCachedWatchLanguageOptions,
  loadWatchInteraction,
  loadWatchLanguageOptionsForVideo,
} from "@/lib/watch-interaction-loader"

function resolveSubtitleSlug(
  preferred: string | null,
  subtitles: WatchSubtitle[],
  audioSlug: string,
  allowTranslatedPreference = false,
): string | null {
  const audioSubtitles = filterSubtitlesForAudio(subtitles, audioSlug)
  if (
    allowTranslatedPreference &&
    preferred &&
    subtitles.some((s) => s.language.slug === preferred)
  ) {
    return preferred
  }
  if (preferred && audioSubtitles.some((s) => s.language.slug === preferred))
    return preferred
  if (audioSubtitles.length === 0) return null
  const audioMatch = audioSubtitles.find((s) => s.language.slug === audioSlug)
  if (audioMatch) return audioMatch.language.slug
  return audioSubtitles[0]?.language.slug ?? null
}

function filterSubtitlesForAudio(
  subtitles: WatchSubtitle[],
  audioSlug: string,
): WatchSubtitle[] {
  if (!audioSlug) return subtitles
  return subtitles.filter((s) => s.language.slug === audioSlug)
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

function isPendingChapterStillRoutable(
  pendingChapter: WatchChapterNavigationIntent,
  blocks: MergedWatchBlock[],
  languageSlug: string,
): boolean {
  const lang = tryAsLocaleSlug(languageSlug)
  if (!lang) return false

  for (const block of blocks) {
    if (!isWatchBlock(block) || block.kind !== "SiblingCarousel") continue

    const carouselBlock: WatchSiblingCarouselBlock = block
    const parentSlug =
      typeof carouselBlock.canonicalParent.slug === "string"
        ? tryAsContentSlug(carouselBlock.canonicalParent.slug)
        : null
    for (const child of carouselBlock.canonicalParent.children ?? []) {
      if (
        child == null ||
        child.documentId !== pendingChapter.targetVideoDocumentId
      ) {
        continue
      }

      if (typeof child.slug !== "string") return false
      const slug = tryAsContentSlug(child.slug)
      if (!slug) return false
      const href = parentSlug
        ? watchEpisodePath(parentSlug, slug, lang)
        : watchVideoPath(slug, lang)
      return href === pendingChapter.href
    }
  }

  return false
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
  collectionSlug?: string | null
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

const WATCH_CHAPTER_ROUTE_WARM_TIMEOUT_MS = 10_000

function appendAutoplaySignal(href: string): string {
  try {
    const url = new URL(href, "http://watch.local")
    url.searchParams.set("autoplay", "1")
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return href.includes("?") ? `${href}&autoplay=1` : `${href}?autoplay=1`
  }
}

async function warmWatchChapterRoute(href: string): Promise<void> {
  if (typeof window === "undefined") return
  if (typeof window.fetch !== "function") return

  const controller =
    typeof window.AbortController === "function"
      ? new window.AbortController()
      : null
  const timeout = window.setTimeout(() => {
    controller?.abort()
  }, WATCH_CHAPTER_ROUTE_WARM_TIMEOUT_MS)

  try {
    const response = await window.fetch(href, {
      cache: "force-cache",
      credentials: "same-origin",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller?.signal,
    })
    await response.text()
  } catch {
    // If the background warm fails, fall back to normal router navigation.
  } finally {
    window.clearTimeout(timeout)
  }
}

function buildShareFallbackHref({
  origin,
  currentLanguageSlug,
  videoSlug,
}: {
  origin: string
  currentLanguageSlug: string
  videoSlug: string
}): string | undefined {
  const slug = tryAsContentSlug(videoSlug)
  const lang = tryAsLocaleSlug(currentLanguageSlug)
  if (!slug || !lang) return undefined

  const shareOrigin = isPublicShareableOrigin(origin)
    ? origin
    : PUBLIC_SHARE_FALLBACK_ORIGIN
  const shareableUrl = `${shareOrigin}${WATCH_BASE_PATH}${watchVideoPath(
    slug,
    lang,
  )}`
  return buildFbShareUrl(shareableUrl)
}

export function WatchPageClient({
  downloadButtonLabel,
  mergedBlocks,
  variant,
  video,
  languageSlug,
  collectionSlug = null,
  locale,
  hideBibleQuotes = false,
  questionPanelEnabled = false,
  initialTranscript = null,
}: WatchPageClientProps) {
  const router = useRouter()
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
  const selectedLanguageCode =
    [variant.language?.iso3, variant.language?.bcp47, variant.language?.slug]
      .map((code) => code?.trim())
      .find(Boolean) ?? null
  const videoSlug = video.slug ?? ""
  const tDownloadButton = useTranslations("DownloadButton")
  const routeWarmPromisesRef = useRef(new Map<string, Promise<void>>())
  const pendingChapterHrefRef = useRef<string | null>(null)
  const [chapterAutoplayEnabled, setChapterAutoplayEnabled] = useState(false)
  const [pendingChapter, setPendingChapter] =
    useState<WatchChapterNavigationIntent | null>(null)
  const validPendingChapter =
    pendingChapter != null &&
    pendingChapter.languageSlug === currentLanguageSlug &&
    pendingChapter.sourceVideoDocumentId === video.documentId &&
    isPendingChapterStillRoutable(
      pendingChapter,
      mergedBlocks,
      currentLanguageSlug,
    )
      ? pendingChapter
      : null

  const warmChapterRoute = useCallback((href: string) => {
    const existing = routeWarmPromisesRef.current.get(href)
    if (existing) return existing

    const promise = warmWatchChapterRoute(href)
    routeWarmPromisesRef.current.set(href, promise)
    return promise
  }, [])

  const handlePlayerActivated = useCallback(() => {
    setChapterAutoplayEnabled(true)
  }, [])

  const handleChapterNavigateIntent = useCallback(
    (intent: WatchChapterNavigationIntent) => {
      pendingChapterHrefRef.current = intent.href
      setPendingChapter(intent)
      const routeWarmPromise = warmChapterRoute(intent.href)
      try {
        router.prefetch(intent.href as Route)
      } catch {
        // The explicit HTML warm above is the real navigation gate.
      }
      void routeWarmPromise.finally(() => {
        if (pendingChapterHrefRef.current !== intent.href) return
        if (typeof window !== "undefined") {
          const preserveState: WatchChapterCarouselPreserveState = {
            languageSlug: intent.languageSlug,
            sourceVideoDocumentId: intent.sourceVideoDocumentId,
            targetVideoDocumentId: intent.targetVideoDocumentId,
            sourceCarouselIndex: intent.sourceCarouselIndex ?? null,
          }
          window.sessionStorage.setItem(
            WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY,
            JSON.stringify(preserveState),
          )
        }
        const nextHref = chapterAutoplayEnabled
          ? appendAutoplaySignal(intent.href)
          : intent.href
        router.push(nextHref as Route, {
          scroll: false,
        })
      })
    },
    [chapterAutoplayEnabled, router, warmChapterRoute],
  )

  const coverBlackoutKey = null
  const coverBlackoutPhase = null

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
      pref.explicit,
    )
    if (pref.enabled && slugToUse) {
      setSubtitleEnabled(true)
    }
    if (slugToUse) {
      setSubtitleSlug(slugToUse)
    }
  }

  useEffect(() => {
    if (!subtitleInit) return
    const pref = readSubtitlePreference()
    const slugToUse = resolveSubtitleSlug(
      pref.languageSlug,
      subtitles,
      currentLanguageSlug,
      pref.explicit,
    )
    setSubtitleSlug(slugToUse)
    setSubtitleEnabled(pref.enabled && slugToUse != null)
  }, [currentLanguageSlug, subtitleInit, subtitles])

  const subtitleVttSrc = useMemo((): string | null | undefined => {
    if (subtitles.length === 0) return undefined
    if (!subtitleEnabled || !subtitleSlug) return null
    const rawVttSrc =
      subtitles.find((s) => s.language.slug === subtitleSlug)?.vttSrc ?? null
    return rawVttSrc ? buildMediaProxyUrl(rawVttSrc) : null
  }, [subtitleEnabled, subtitleSlug, subtitles])

  const handleSubtitleChange = useCallback(
    (enabled: boolean, slug: string | null) => {
      if (enabled && !slug) {
        slug = resolveSubtitleSlug(null, subtitles, currentLanguageSlug)
      }
      const nextEnabled = enabled && slug != null
      setSubtitleEnabled(nextEnabled)
      setSubtitleSlug(slug)
      writeSubtitlePreference(nextEnabled, slug)
    },
    [currentLanguageSlug, subtitles],
  )

  // Drop entries missing `quality` — unrenderable in the tier selector.
  // Raw CDN URLs stay server-only and are resolved by `/watch/api/download`
  // from the opaque video/variant/download ids.
  // Admin emits `VideoDubDownload.size` as a `String` (Core's bytes literal,
  // which may exceed JS number precision for very large files). Parse to
  // number for the download modal's sort bucket; non-numeric values fall
  // through as null and the modal hides the size label.
  const downloadsForModal = useMemo(
    () =>
      (variant.downloads ?? [])
        .filter(
          (d): d is NonNullable<typeof d> => d != null && d.quality != null,
        )
        .map((d) => {
          const sizeNum =
            typeof d.size === "string" && d.size.length > 0
              ? Number.parseFloat(d.size)
              : null
          return {
            documentId: d.documentId,
            height:
              typeof d.height === "number" &&
              Number.isFinite(d.height) &&
              d.height > 0
                ? d.height
                : null,
            quality: d.quality as string,
            size: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
          }
        }),
    [variant.downloads],
  )

  const downloadHref = useMemo(() => {
    if (!videoSlug) return undefined
    const fallbackTier = selectDefaultDownloadTier(downloadsForModal)
    if (!fallbackTier) return undefined
    return buildDownloadProxyUrl({
      downloadId: fallbackTier.download.documentId,
      filename: buildDownloadFilename({
        languageCode: selectedLanguageCode,
        languageName: variant.language?.name ?? null,
        languageSlug: variant.language?.slug ?? null,
        renditionHeight: fallbackTier.download.height,
        tier: fallbackTier.tier,
        videoSlug,
        videoTitle: video.title,
      }),
      variantId: variant.documentId,
      videoSlug,
    })
  }, [
    downloadsForModal,
    selectedLanguageCode,
    variant.documentId,
    variant.language?.name,
    variant.language?.slug,
    video.title,
    videoSlug,
  ])

  const shareHref = useMemo(
    () =>
      buildShareFallbackHref({
        origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
        currentLanguageSlug,
        videoSlug,
      }),
    [currentLanguageSlug, videoSlug],
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
  const [downloadPending, setDownloadPending] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadLoginUrl, setDownloadLoginUrl] = useState<string | null>(null)
  const downloadPendingRef = useRef(false)
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
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (url.searchParams.get(DOWNLOAD_RETURN_INTENT_PARAM) !== "1") return

    url.searchParams.delete(DOWNLOAD_RETURN_INTENT_PARAM)
    window.history.replaceState(window.history.state, "", url.toString())
    setDownloadError(null)
    setDownloadLoginUrl(null)
    setEnabledModalChunks((prev) => ({ ...prev, download: true }))
    void loadWatchInteraction("download").catch(() => {})
    setModalState("download")
  }, [])

  useEffect(() => {
    languageOptionsPendingRef.current = false
    const cached = videoSlug ? getCachedWatchLanguageOptions(videoSlug) : null
    setLanguageOptionsState(
      cached
        ? { status: "ready", variants: cached }
        : { status: "idle", variants: [] },
    )
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
        setDownloadLoginUrl(null)
        setModalState("download")
        return
      }
      setDownloadLoginUrl(session.loginUrl)
      setModalState("download")
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
  const closeModal = useCallback(() => {
    setModalState("none")
  }, [])

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
        downloadHref={downloadHref}
        downloadPending={downloadPending}
        modalCallbacks={modalCallbacks}
        onPlayerReady={handlePlayerReady}
        onPlayerActivated={handlePlayerActivated}
        locale={locale}
        languageSlug={currentLanguageSlug}
        subtitleVttSrc={subtitleVttSrc}
        shareHref={shareHref}
        hideBibleQuotes={hideBibleQuotes}
        pendingChapter={validPendingChapter}
        coverBlackoutKey={coverBlackoutKey}
        coverBlackoutPhase={coverBlackoutPhase}
        onChapterNavigateIntent={handleChapterNavigateIntent}
      />

      <WatchEventRecorder
        playerRef={playerRef}
        videoId={video.documentId}
        videoDubId={variant.documentId}
        durationSeconds={variant.duration ?? null}
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
          languageCode={selectedLanguageCode}
          languageName={variant.language?.name ?? null}
          languageSlug={variant.language?.slug ?? null}
          variantId={variant.documentId}
          videoSlug={videoSlug}
          authRequiredLoginUrl={downloadLoginUrl}
          onClose={closeModal}
        />
      ) : null}
      {enabledModalChunks.language ? (
        <LanguagePickerModal
          open={modalState === "language"}
          variants={languageOptionsState.variants}
          currentLanguageSlug={currentLanguageSlug}
          collectionSlug={collectionSlug}
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
