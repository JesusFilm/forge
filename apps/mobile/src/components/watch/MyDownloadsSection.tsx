import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useDownloads } from "../../contexts/DownloadsProvider"
import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import type {
  OfflineDownloadRecord,
  OfflineDownloadState,
} from "../../lib/offlineManifest"

const DOWNLOADED_COLOR = "#34d399"
const FAILED_COLOR = "#fb7185"

/** Humanize a video slug as a fallback when the record has no stored title. */
function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** Prefer the stored human title; fall back to a humanized slug. */
function displayTitle(record: OfflineDownloadRecord): string {
  return record.title || slugToTitle(record.videoSlug)
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return ""
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

function statusLine(record: OfflineDownloadRecord): string {
  const size = formatBytes(record.totalBytes)
  switch (record.state) {
    case "downloaded":
      return size ? `Saved · ${size}` : "Saved"
    case "downloading":
      return "Downloading…"
    case "queued":
      return "Queued"
    case "paused":
      return "Paused"
    case "failed":
      return "Download failed"
    default:
      return ""
  }
}

function stateColor(state: OfflineDownloadState): string {
  if (state === "downloaded") return DOWNLOADED_COLOR
  if (state === "failed") return FAILED_COLOR
  return TEXT_SECONDARY
}

export function MyDownloadsSection() {
  const typography = useTypography()
  const router = useRouter()
  const { offlineRecords, deleteDownload } = useDownloads()

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, typography.titleSmall]}>
        My Downloads
      </Text>

      {offlineRecords.length === 0 ? (
        <Text style={[styles.empty, typography.caption]}>
          No downloads yet. Open a video and tap Download to save it for offline
          viewing.
        </Text>
      ) : (
        offlineRecords.map((record) => (
          <Pressable
            key={record.videoSlug}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() =>
              router.push(
                `/watch/${encodeURIComponent(record.videoSlug)}` as never,
              )
            }
            accessibilityRole="button"
            accessibilityLabel={`${displayTitle(record)}, ${statusLine(record)}`}
          >
            <View style={styles.thumb}>
              {record.posterPath ? (
                <Image
                  source={record.posterPath}
                  style={styles.thumbImage}
                  contentFit="cover"
                  recyclingKey={record.videoSlug}
                />
              ) : (
                <Ionicons
                  name={
                    record.state === "downloaded"
                      ? "checkmark-circle"
                      : "arrow-down-circle-outline"
                  }
                  size={22}
                  color={stateColor(record.state)}
                />
              )}
            </View>
            <View style={styles.rowText}>
              <Text
                style={[styles.rowTitle, typography.body]}
                numberOfLines={1}
              >
                {displayTitle(record)}
              </Text>
              <Text
                style={[
                  styles.rowStatus,
                  typography.caption,
                  { color: stateColor(record.state) },
                ]}
              >
                {statusLine(record)}
              </Text>
            </View>
            <Pressable
              hitSlop={10}
              onPress={() =>
                Alert.alert(
                  "Remove download",
                  `Remove "${displayTitle(record)}" from offline downloads?`,
                  [
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () => {
                        void deleteDownload(record.videoSlug)
                      },
                    },
                    { text: "Cancel", style: "cancel" },
                  ],
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Remove ${displayTitle(record)}`}
            >
              <Ionicons name="trash-outline" size={20} color={TEXT_SECONDARY} />
            </Pressable>
          </Pressable>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
    marginBottom: 10,
  },
  empty: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE_COLOR,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  rowPressed: {
    borderColor: ACCENT,
    borderWidth: 1,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    overflow: "hidden",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  rowStatus: {
    fontFamily: "System",
    marginTop: 2,
  },
})
