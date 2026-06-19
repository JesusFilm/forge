import { useEffect } from "react"
import { useLocalSearchParams, useRouter } from "expo-router"

import { DownloadSheetContent } from "../../src/components/watch/DownloadSheet"
import { SheetLoading } from "../../src/components/watch/SheetLoading"
import { SheetError } from "../../src/components/watch/SheetError"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import type { WatchDownload, WatchSubtitle } from "../../src/lib/normalizeVideo"

export default function DownloadSheetRoute() {
  const router = useRouter()
  const {
    video,
    activeVariant,
    activeVariantMedia,
    activeVariantMediaLoading,
    activeVariantMediaError,
    ensureActiveVariantMedia,
    setSnackbarMessage,
  } = useWatchSession()
  const { startDownload, swapDownload } = useDownloads()
  const { wifiOnly } = useWatchPreferences()
  // Opened via "Change quality / language" on a downloaded video → swap mode.
  const { swap } = useLocalSearchParams<{ swap?: string }>()
  const isSwap = swap === "1"

  // Downloads are fetched lazily per dub — kick off the active variant's fetch
  // when the sheet opens (no-op if already loaded / in flight).
  useEffect(() => {
    ensureActiveVariantMedia()
  }, [ensureActiveVariantMedia])

  if (!video) return null
  // Variants not enriched yet (opened during partial-data load) → show loading.
  if (video.variants.length === 0) return <SheetLoading />
  // Active dub's downloads still loading → loading, not an empty list.
  if (activeVariantMedia == null && activeVariantMediaLoading)
    return <SheetLoading />
  // Fetch failed → retry, not a misleading empty list.
  if (activeVariantMedia == null && activeVariantMediaError)
    return (
      <SheetError
        message="Couldn't load downloads. Check your connection and try again."
        onRetry={ensureActiveVariantMedia}
      />
    )

  const onStartDownload = async (
    rendition: WatchDownload,
    subtitle: WatchSubtitle | null,
  ) => {
    if (!activeVariant) return
    // Audio = active dub; the optional subtitle is the user's pick. Identity
    // (dub + rendition documentId, subtitle slug) is stored so the engine can
    // re-resolve fresh URLs before each (re)start. Title + poster feed the
    // offline library (My Downloads).
    const enqueue = isSwap ? swapDownload : startDownload
    const result = await enqueue({
      videoSlug: video.slug,
      title: video.title ?? "",
      dubDocumentId: activeVariant.documentId,
      rendition,
      subtitleLanguageSlug: subtitle?.languageSlug ?? null,
      subtitleUrl: subtitle?.vttSrc ?? null,
      posterUrl: video.posterUrl,
      allowCellular: !wifiOnly,
    })
    if (!result.ok && result.reason === "insufficient-storage") {
      // Stay on the sheet so the user can pick a smaller quality.
      setSnackbarMessage("Not enough storage to download this video.")
      return
    }
    setSnackbarMessage(isSwap ? "Updating download…" : "Download started")
    router.back()
  }

  return (
    <DownloadSheetContent
      videoTitle={video.title}
      duration={video.duration}
      languageName={activeVariant?.languageName ?? null}
      downloads={activeVariantMedia?.downloads ?? []}
      subtitles={activeVariantMedia?.subtitles ?? []}
      onStartDownload={onStartDownload}
    />
  )
}
