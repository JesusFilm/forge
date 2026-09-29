import { memo, type ComponentProps } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  BG_COLOR,
  STATUS_DONE_COLOR,
  STATUS_FAILED_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import {
  formatLibraryDuration,
  seriesGroupContentEqual,
} from "../../lib/libraryDownloads"
import type { MyWatchRailTile } from "../../lib/myWatchRail"
import { card, feedback } from "../../styles/shared"
import { DownloadProgressRing } from "../watch/DownloadProgressRing"

type IconName = ComponentProps<typeof Ionicons>["name"]

type TileBadge =
  | { kind: "done" }
  | { kind: "ring"; progress: number }
  | { kind: "pill"; icon: IconName; failed: boolean }

type TileView = {
  title: string
  stateText: string
  badge: TileBadge
  /** The series line under the title; null for a video. */
  episodesText: string | null
  duration: string | null
  posterPath: string | null
}

export type DownloadTileProps = {
  tile: MyWatchRailTile
  width: number
  onPress: (tile: MyWatchRailTile) => void
}

const POSTER_ASPECT = 16 / 9
const THUMB_GRADIENT: readonly [string, string] = ["#2a2f37", "#15171c"]
const RING_TRACK_COLOR = "rgba(255, 255, 255, 0.18)"
const CHIP_SIZE = 30
const TILE_ACTION_NAME = "my-watch-download-tile"

const QUEUED: TileBadge = { kind: "pill", icon: "time-outline", failed: false }
const PAUSED: TileBadge = { kind: "pill", icon: "pause", failed: false }
const FAILED: TileBadge = { kind: "pill", icon: "alert-circle", failed: true }

/** The list row's title fallback, for a legacy record stored without one. */
function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function tileView(tile: MyWatchRailTile): TileView {
  if (tile.kind === "series") {
    const { group, state } = tile
    const base = {
      title: group.seriesTitle,
      episodesText: `${tile.episodeCount} episodes`,
      duration: null,
      posterPath: group.episodes[0]?.posterPath ?? null,
    }
    if (state.status === "failed") {
      return { ...base, stateText: "Failed", badge: FAILED }
    }
    if (state.status === "inProgress") {
      return {
        ...base,
        stateText: "Downloading",
        badge: { kind: "ring", progress: state.progress },
      }
    }
    return { ...base, stateText: "Downloaded", badge: { kind: "done" } }
  }

  const { record, rowState } = tile
  const base = {
    title: record.title || slugToTitle(record.videoSlug),
    episodesText: null,
    duration: formatLibraryDuration(record.durationSeconds),
    posterPath: record.posterPath,
  }
  switch (rowState.affordance) {
    case "check":
      return { ...base, stateText: "Downloaded", badge: { kind: "done" } }
    case "ring":
      return {
        ...base,
        stateText: "Downloading",
        badge: { kind: "ring", progress: rowState.progress ?? 0 },
      }
    case "resume":
      return { ...base, stateText: "Paused", badge: PAUSED }
    case "retry":
      return { ...base, stateText: "Failed", badge: FAILED }
    case "none":
    default:
      return { ...base, stateText: "Queued", badge: QUEUED }
  }
}

function accessibilityLabelFor(view: TileView): string {
  const parts = [view.title]
  if (view.episodesText != null) parts.push(view.episodesText)
  parts.push(view.stateText)
  if (view.badge.kind === "ring") {
    parts.push(`${Math.round(view.badge.progress * 100)}%`)
  }
  return parts.join(", ")
}

function StateBadge({ view }: { view: TileView }) {
  const typography = useTypography()
  const { badge } = view
  if (badge.kind === "done") {
    return (
      <View style={[styles.corner, styles.chip]}>
        <Ionicons name="checkmark-circle" size={22} color={STATUS_DONE_COLOR} />
      </View>
    )
  }
  if (badge.kind === "ring") {
    return (
      <View style={[styles.corner, styles.chip, styles.ringChip]}>
        <DownloadProgressRing
          size={22}
          strokeWidth={2.5}
          progress={badge.progress}
          color={ACCENT}
          trackColor={RING_TRACK_COLOR}
          cutoutColor={BG_COLOR}
        />
      </View>
    )
  }
  const tint = badge.failed ? STATUS_FAILED_COLOR : TEXT_ON_OVERLAY
  return (
    <View style={[card.badge, styles.pill]}>
      <Ionicons name={badge.icon} size={13} color={tint} />
      <Text
        style={[card.badgeText, typography.caption, { color: tint }]}
        numberOfLines={1}
      >
        {view.stateText}
      </Text>
    </View>
  )
}

/** One rail tile (R7): the list row's state as a poster badge, with no Retry
 *  or Resume control. Every tap goes to `onPress`, which decides the route. */
function DownloadTileBase({ tile, width, onPress }: DownloadTileProps) {
  const typography = useTypography()
  const view = tileView(tile)

  return (
    <Pressable
      onPress={() => onPress(tile)}
      style={({ pressed }) => [{ width }, pressed && feedback.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor(view)}
      accessibilityHint={
        tile.kind === "series"
          ? "Opens this series in Downloads"
          : "Opens this video"
      }
      // Datadog names a tap from the label unless this is set; the title
      // would give every tile its own action name.
      {...{ "dd-action-name": TILE_ACTION_NAME }}
    >
      <View style={[card.surface, { width, aspectRatio: POSTER_ASPECT }]}>
        {view.posterPath ? (
          <Image
            source={view.posterPath}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={tile.key}
          />
        ) : (
          <LinearGradient
            colors={THUMB_GRADIENT}
            style={[StyleSheet.absoluteFill, styles.fallback]}
          >
            <Ionicons name="film-outline" size={28} color={TEXT_SECONDARY} />
          </LinearGradient>
        )}
        <StateBadge view={view} />
        {tile.kind === "series" ? (
          <View style={[styles.bottomBadge, styles.stackBadge]}>
            <Ionicons name="albums-outline" size={16} color={TEXT_ON_OVERLAY} />
          </View>
        ) : view.duration != null ? (
          <View style={styles.bottomBadge}>
            <Text style={styles.durationText}>{view.duration}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.title, typography.bodySmall]} numberOfLines={2}>
        {view.title}
      </Text>
      {view.episodesText != null && (
        <Text style={[styles.meta, typography.caption]} numberOfLines={1}>
          {view.episodesText}
        </Text>
      )}
    </Pressable>
  )
}

// The selector rebuilds every tile on each progress tick. Compare what the
// tile draws from: a record's identity, or a series group's content.
function sameTileContent(a: MyWatchRailTile, b: MyWatchRailTile): boolean {
  if (a === b) return true
  if (a.kind === "video" && b.kind === "video") return a.record === b.record
  if (a.kind === "series" && b.kind === "series") {
    return seriesGroupContentEqual(a.group, b.group)
  }
  return false
}

export const DownloadTile = memo(
  DownloadTileBase,
  (prev, next) =>
    prev.width === next.width &&
    prev.onPress === next.onPress &&
    sameTileContent(prev.tile, next.tile),
)

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  corner: {
    position: "absolute",
    top: 8,
    right: 8,
  },
  chip: {
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderRadius: CHIP_SIZE / 2,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  // The ring punches its centre with an opaque colour, so its chip matches it.
  ringChip: {
    backgroundColor: BG_COLOR,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  bottomBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stackBadge: {
    paddingVertical: 4,
  },
  durationText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 11,
    fontWeight: "700",
  },
  title: {
    marginTop: 8,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  meta: {
    marginTop: 2,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "500",
  },
})
