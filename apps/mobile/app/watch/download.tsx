import { useEffect } from "react"
import { useLocalSearchParams, useRouter } from "expo-router"

import { DownloadSheetContent } from "../../src/components/watch/DownloadSheet"
import { SheetLoading } from "../../src/components/watch/SheetLoading"
import { SheetError } from "../../src/components/watch/SheetError"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import type { WatchDownload } from "../../src/lib/normalizeVideo"
import { resolveActiveSubtitle } from "../../src/lib/subtitleSelection"

export default function DownloadSheetRoute() {
  const router = useRouter()
  const {
    video,
    activeVariant,
    activeVariantMedia,
    activeVariantMediaLoading,
    activeVariantMediaError,
    ensureActiveVariantMedia,
    activeSubtitleSlug,
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

  // The bundled subtitle is inherited from the watch session, not picked in the
  // sheet: it's the dub's active subtitle (whatever the user set on the Video
  // Details subtitle sheet), regardless of whether subtitles are toggled on.
  // null when no subtitle is active or the active language has no track here.
  const activeSubtitle = resolveActiveSubtitle(
    activeSubtitleSlug,
    activeVariantMedia?.subtitles ?? [],
  )

  const onStartDownload = async (rendition: WatchDownload) => {
    if (!activeVariant) return
    // Audio = active dub; subtitle = the dub's active subtitle. Store identity
    // (dub + rendition documentId, subtitle slug) so the engine re-resolves fresh
    // URLs before each (re)start; title + poster feed the offline library.
    const enqueue = isSwap ? swapDownload : startDownload
    const result = await enqueue({
      videoSlug: video.slug,
      title: video.title ?? "",
      dubDocumentId: activeVariant.documentId,
      rendition,
      subtitleLanguageSlug: activeSubtitle?.languageSlug ?? null,
      subtitleUrl: activeSubtitle?.vttSrc ?? null,
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
      subtitleLanguageName={activeSubtitle?.languageName ?? null}
      onStartDownload={onStartDownload}
    />
  )
}
