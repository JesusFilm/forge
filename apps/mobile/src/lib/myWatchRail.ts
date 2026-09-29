import {
  buildLibraryViewModel,
  compareByTime,
  libraryRowState,
  newestEnqueuedAt,
  type LibraryRowState,
  type LibrarySeriesGroup,
} from "./libraryDownloads"
import type { OfflineDownloadRecord } from "./offlineManifest"

export const MY_WATCH_RAIL_MAX_TILES = 10

export type MyWatchRailSeriesStatus = "failed" | "inProgress" | "downloaded"

export type MyWatchRailSeriesState = {
  status: MyWatchRailSeriesStatus
  /** 0..1: a finished episode counts 1, an unfinished one its byte fraction. */
  progress: number
}

export type MyWatchRailVideoTile = {
  kind: "video"
  key: string
  record: OfflineDownloadRecord
  rowState: LibraryRowState
}

export type MyWatchRailSeriesTile = {
  kind: "series"
  key: string
  group: LibrarySeriesGroup
  episodeCount: number
  state: MyWatchRailSeriesState
}

export type MyWatchRailTile = MyWatchRailVideoTile | MyWatchRailSeriesTile

type RankedTile = {
  tile: MyWatchRailTile
  time: number | undefined
  slug: string
}

function videoTile(record: OfflineDownloadRecord): RankedTile {
  return {
    tile: {
      kind: "video",
      key: `video:${record.videoSlug}`,
      record,
      rowState: libraryRowState(record),
    },
    time: record.enqueuedAt,
    slug: record.videoSlug,
  }
}

// Reads each episode through its list-row state, not its raw `state`, so a
// mid-swap episode counts as downloaded here exactly as its row shows it (R7).
function seriesState(
  episodes: readonly OfflineDownloadRecord[],
): MyWatchRailSeriesState {
  let failed = false
  let unfinished = false
  let units = 0
  for (const episode of episodes) {
    const { affordance } = libraryRowState(episode)
    if (affordance === "check") {
      units += 1
    } else if (affordance === "retry") {
      failed = true
    } else {
      unfinished = true
      if (episode.totalBytes > 0) {
        units += Math.max(
          0,
          Math.min(1, episode.bytesWritten / episode.totalBytes),
        )
      }
    }
  }
  const progress = episodes.length === 0 ? 0 : units / episodes.length
  if (failed) return { status: "failed", progress }
  if (unfinished) return { status: "inProgress", progress }
  return { status: "downloaded", progress }
}

function seriesTile(group: LibrarySeriesGroup): RankedTile {
  return {
    tile: {
      kind: "series",
      key: `series:${group.seriesSlug}`,
      group,
      episodeCount: group.episodeCount,
      state: seriesState(group.episodes),
    },
    time: newestEnqueuedAt(group.episodes),
    slug: group.seriesSlug,
  }
}

// compareByTime returns 0 for two equal known times, so the slug and then the
// tile key break that tie; the order never depends on the input order.
function compareRanked(a: RankedTile, b: RankedTile): number {
  return (
    compareByTime(a.time, b.time, a.slug, b.slug, "newestFirst") ||
    a.slug.localeCompare(b.slug) ||
    a.tile.key.localeCompare(b.tile.key)
  )
}

/**
 * The My Watch Downloads rail (KTD4): series and single videos in one order,
 * newest first, capped. A one-episode series becomes a video tile (R21).
 */
export function buildMyWatchRail(
  records: readonly OfflineDownloadRecord[],
): MyWatchRailTile[] {
  const { seriesGroups, standaloneRecords } = buildLibraryViewModel(records)
  const ranked = standaloneRecords.map(videoTile)
  for (const group of seriesGroups) {
    const onlyEpisode = group.episodes.length === 1 ? group.episodes[0] : null
    ranked.push(onlyEpisode ? videoTile(onlyEpisode) : seriesTile(group))
  }
  return ranked
    .sort(compareRanked)
    .slice(0, MY_WATCH_RAIL_MAX_TILES)
    .map((entry) => entry.tile)
}
