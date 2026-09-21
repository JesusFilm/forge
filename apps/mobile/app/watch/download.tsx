import { useEffect, useRef } from "react"
import { useLocalSearchParams, useRouter } from "expo-router"

import {
  DownloadSheetContent,
  type DownloadMode,
} from "../../src/components/watch/DownloadSheet"
import { SheetLoading } from "../../src/components/watch/SheetLoading"
import { SheetError } from "../../src/components/watch/SheetError"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import type { WatchDownload } from "../../src/lib/normalizeVideo"
import { RAW_EXPORT_ENABLED } from "../../src/lib/rawExportConstants"
import { getRawExportAdapter } from "../../src/lib/rawExportRuntime"
import { startRawExportAfterPick } from "../../src/lib/rawExportStart"
import {
  buildWatchRawExportRequest,
  startWatchRawExport,
} from "../../src/lib/watchRawExportStart"
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
  const { startDownload, swapDownload, getRecord } = useDownloads()
  const { wifiOnly } = useWatchPreferences()
  // Opened via "Change quality / language" on a downloaded video → swap mode.
  // `mode=raw` is the "Save to Files" entry, which opens straight on export.
  const { swap, mode: modeParam } = useLocalSearchParams<{
    swap?: string
    mode?: string
  }>()
  const isSwap = swap === "1"
  // The switch gates the seed as well as the control: raw mode without the
  // mode control is a sheet with no way back to offline and a confirm that
  // refuses. Mirrors app/series/download.tsx.
  const initialMode: DownloadMode =
    RAW_EXPORT_ENABLED && modeParam === "raw" ? "raw" : "offline"
  // The confirm button stays enabled while the folder picker is open, so this
  // latch is the only thing that stops a second tap opening a second picker.
  const exportInFlightRef = useRef(false)

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

  // The bundled subtitle is inherited from the watch session, not picked here:
  // the dub's active subtitle (set on the Video Details sheet), regardless of the
  // toggle. null when none is active or the active language has no track here.
  const subtitles = activeVariantMedia?.subtitles ?? []
  const activeSubtitle = resolveActiveSubtitle(activeSubtitleSlug, subtitles)

  // R37: only a verified copy is reusable, so an in-flight or failed record
  // names no quality.
  const offlineRecord = getRecord(video.slug)
  const offlineCopy =
    offlineRecord?.state === "downloaded"
      ? {
          renditionId: offlineRecord.renditionDocumentId,
          quality: offlineRecord.qualityLabel,
        }
      : null

  /**
   * The raw branch. R33 refuses every new export, and R15 dismisses the sheet
   * once a folder is chosen, because the export outlives this route (R29) — its
   * outcome is reported by the root-level host, not here.
   *
   * The picker runs FIRST, while this sheet is still on screen: a run that has
   * already dismissed it has no view controller to present from. A viewer who
   * dismisses the picker keeps the sheet and nothing starts.
   */
  const startRawExport = async (rendition: WatchDownload) => {
    const adapter = getRawExportAdapter()
    await startWatchRawExport(
      exportInFlightRef,
      buildWatchRawExportRequest({
        videoSlug: video.slug,
        title: video.title,
        rendition,
        wifiOnly,
        subtitle: activeSubtitle,
        startedAt: Date.now(),
      }),
      (request) =>
        startRawExportAfterPick({
          pickFolder: () => adapter.pickExportFolder(),
          dismiss: () => router.back(),
          start: (folder) => void adapter.exportVideo({ ...request, folder }),
        }),
    )
  }

  const onStartDownload = async (
    rendition: WatchDownload,
    mode: DownloadMode,
    subtitleSlug: string | null,
  ) => {
    // The SHEET owns the subtitle now, so raw mode's R23 payload has to name
    // the track the sheet hid — not whatever the watch session was showing.
    const chosenSubtitle = subtitles.find(
      (sub) => sub.languageSlug === subtitleSlug,
    )
    if (mode === "raw") {
      await startRawExport(rendition)
      return
    }
    if (!activeVariant) return
    // Audio = active dub; subtitle = the one picked in the sheet. Store identity
    // (dub + rendition documentId, subtitle slug) so the engine re-resolves fresh
    // URLs before each (re)start; title + poster feed the offline library.
    const enqueue = isSwap ? swapDownload : startDownload
    const result = await enqueue({
      videoSlug: video.slug,
      title: video.title ?? "",
      dubDocumentId: activeVariant.documentId,
      rendition,
      subtitleLanguageSlug: chosenSubtitle?.languageSlug ?? null,
      subtitleUrl: chosenSubtitle?.vttSrc ?? null,
      posterUrl: video.posterUrl,
      allowCellular: !wifiOnly,
      // seriesEpisodeIndex stays undefined here — episode order is a series-batch
      // concept (R22 falls back to enqueue time for a lone watch-route download).
      seriesSlug: video.parentSeries?.slug,
      seriesTitle: video.parentSeries?.title,
      durationSeconds: video.duration ?? undefined,
      enqueuedAt: Date.now(),
    })
    if (!result.ok && result.reason === "insufficient-storage") {
      // Stay on the sheet so the user can pick a smaller quality.
      setSnackbarMessage("Not enough storage to download this video.")
      return
    }
    // `exists` means the pipeline did NOTHING — the same rendition AND the same
    // subtitle are already held, or a live record blocks a fresh start. Saying
    // "Download started" there is a lie the subtitle picker makes easy to hit.
    if (!result.ok && result.reason === "exists") {
      setSnackbarMessage("This download is already saved at that quality.")
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
      initialMode={initialMode}
      subtitles={subtitles}
      subtitleLanguageSlug={activeSubtitle?.languageSlug ?? null}
      offlineCopy={offlineCopy}
      offlineCopySubtitleSlug={
        offlineRecord?.state === "downloaded"
          ? offlineRecord.subtitleLanguageSlug
          : undefined
      }
      onStartDownload={onStartDownload}
    />
  )
}
