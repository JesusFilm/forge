import { useEffect } from "react"
import { useRouter } from "expo-router"

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
  const { startDownload } = useDownloads()
  const { wifiOnly } = useWatchPreferences()

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

  const onStartDownload = (
    rendition: WatchDownload,
    subtitle: WatchSubtitle | null,
  ) => {
    if (!activeVariant) return
    // Audio = active dub; the optional subtitle is the user's pick. Identity
    // (dub + rendition documentId, subtitle slug) is stored so the engine can
    // re-resolve fresh URLs before each (re)start. Poster caching is U12.
    void startDownload({
      videoSlug: video.slug,
      dubDocumentId: activeVariant.documentId,
      rendition,
      subtitleLanguageSlug: subtitle?.languageSlug ?? null,
      subtitleUrl: subtitle?.vttSrc ?? null,
      posterUrl: null,
      allowCellular: !wifiOnly,
    })
    setSnackbarMessage("Download started")
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
