/**
 * The series raw export: one run over the episodes the sheet resolved, saved
 * strictly one at a time in episode order (R19, R20). Every crossing is
 * injected — the adapter, the viewer's cancel check and the report channel — so
 * this module imports nothing at runtime and unit-tests with no native module.
 */

import type { ExportReportSignal } from "../components/ExportReportHost"
import type { ExportSizing, RawExportRendition } from "./rawExport"
import type { RawExportInput, RawExportResult } from "./rawExportAdapter"
import type { SeriesEpisodeResolution } from "./seriesDownloadResolver"

/** One episode of the run, already reduced to what an export needs. */
export type SeriesExportEpisode = {
  videoSlug: string
  /** R34: the viewer-legible name the staged file takes. */
  title: string | null
  rendition: RawExportRendition
}

export type SeriesExportRun = {
  /** One run id for the whole series, so the host folds it into ONE report. */
  runId: string
  seriesSlug: string
  seriesTitle: string | null
  wifiOnly: boolean
  episodes: readonly SeriesExportEpisode[]
  /**
   * R8/KTD9: the run's space sizing, derived ONCE. Peak use is every library
   * copy plus one staged file, so a reused local copy counts like a transfer.
   */
  runExports: ExportSizing[]
}

export type SeriesExportRunInput = {
  runId: string
  seriesSlug: string
  seriesTitle: string | null
  wifiOnly: boolean
  /** The resolved set, exactly as the sheet resolved it (R19). */
  episodes: readonly SeriesEpisodeResolution[]
}

export type SeriesExportRunDeps = {
  exportVideo: (input: RawExportInput) => Promise<RawExportResult>
  /** R22: read before each episode starts, for a cancel the outcome missed. */
  isCancelRequested: () => boolean
  /** R29: the ONE report channel, for the results the adapter cannot publish. */
  report: (signal: ExportReportSignal) => void
}

/**
 * R21: `saved` plus `failed` equals `total` for a run that reaches its end, and
 * no skipped count exists — raw mode attempts every resolved episode.
 */
export type SeriesExportRunSummary = {
  runId: string
  /** The resolved set the run covers. */
  total: number
  saved: number
  failed: number
  /** KTD4: staged episodes whose library write a later foreground finishes.
   *  They count inside `saved`, because that write still happens. */
  deferred: number
  /** R22: the viewer stopped the run; what already saved stays saved. */
  cancelled: boolean
}

/** A catalogue size of 0, "" or a non-number is UNKNOWN, never zero bytes. */
export function sizeBytesOf(size: string | null | undefined): number | null {
  const bytes = Number(size)
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null
}

/** R20: admin's episode order when the whole set carries it, else as given. */
function inEpisodeOrder(
  episodes: readonly SeriesEpisodeResolution[],
): SeriesEpisodeResolution[] {
  const ordered = episodes.every((episode) =>
    Number.isFinite(episode.seriesEpisodeIndex),
  )
  if (!ordered) return [...episodes]
  return [...episodes].sort(
    (a, b) => (a.seriesEpisodeIndex ?? 0) - (b.seriesEpisodeIndex ?? 0),
  )
}

/**
 * Reduce the sheet's resolved set to a run: episode order fixed, and the space
 * sizing derived once for every episode the run will save.
 */
export function buildSeriesExportRun(
  input: SeriesExportRunInput,
): SeriesExportRun {
  const episodes: SeriesExportEpisode[] = []
  for (const episode of inEpisodeOrder(input.episodes)) {
    const rendition = episode.rendition
    // A resolved episode always carries a rendition; without one there is no
    // url to transfer, and an empty url would fail every attempt.
    if (!rendition || !rendition.url) continue
    episodes.push({
      videoSlug: episode.slug,
      title: episode.title,
      rendition: {
        documentId: rendition.documentId,
        qualityLabel: rendition.quality,
        url: rendition.url,
        sizeBytes: sizeBytesOf(rendition.size),
      },
    })
  }

  return {
    runId: input.runId,
    seriesSlug: input.seriesSlug,
    seriesTitle: input.seriesTitle,
    wifiOnly: input.wifiOnly,
    episodes,
    runExports: episodes.map((episode) => ({
      sizeBytes: episode.rendition.sizeBytes,
    })),
  }
}

/**
 * Save the run's episodes one at a time. A failing episode is passed over
 * (R31), and a cancel stops the run without touching what already saved (R22).
 */
export async function runSeriesRawExport(
  run: SeriesExportRun,
  deps: SeriesExportRunDeps,
): Promise<SeriesExportRunSummary> {
  const total = run.episodes.length
  let saved = 0
  let failed = 0
  let deferred = 0
  let cancelled = false

  const reportFor = (
    episode: SeriesExportEpisode,
    outcome: ExportReportSignal["outcome"],
  ): void => {
    deps.report({
      runId: run.runId,
      target: episode.videoSlug,
      outcome,
      runSize: total,
      title: episode.title,
    })
  }

  for (const [index, episode] of run.episodes.entries()) {
    if (deps.isCancelRequested()) {
      cancelled = true
      break
    }

    let result: RawExportResult
    try {
      result = await deps.exportVideo({
        videoSlug: episode.videoSlug,
        runId: run.runId,
        title: episode.title,
        rendition: episode.rendition,
        wifiOnly: run.wifiOnly,
        seriesSlug: run.seriesSlug,
        runSize: total,
        // The SUFFIX, not the whole run: the adapter re-reads free space per
        // episode, and that space has already dropped by the copies earlier
        // episodes wrote. Re-charging the full total would refuse a run midway.
        runExports: run.runExports.slice(index),
      })
    } catch {
      // R31: one episode's fault never stops the run, and a throw reports
      // nothing of its own, so the run reports for it.
      failed += 1
      reportFor(episode, "failed")
      continue
    }

    if (result.kind === "deferred") {
      // The write is handed to the next foreground, which publishes the real
      // outcome under this same run id. A guess here would only be overwritten.
      deferred += 1
      saved += 1
      continue
    }
    if (result.kind === "already-exporting") {
      // R27: another surface owns this episode's export, so it saves under a
      // different run. This one did not save it.
      failed += 1
      reportFor(episode, "failed")
      continue
    }
    if (result.outcome === "saved") {
      saved += 1
      continue
    }
    if (result.outcome === "cancelled") {
      cancelled = true
      break
    }
    failed += 1
  }

  return { runId: run.runId, total, saved, failed, deferred, cancelled }
}
