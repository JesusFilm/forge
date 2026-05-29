import { useCallback, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"
import { cacheDirectory, downloadAsync } from "expo-file-system/src/legacy"
import * as Sharing from "expo-sharing"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  TEXT_BODY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"
import type { WatchDownload } from "../../lib/normalizeVideo"
import { TERMS_OF_USE_PARAGRAPHS } from "../../lib/terms-of-use"

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "0:00"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function formatFileSize(sizeString: string): string {
  const bytes = Number(sizeString)
  if (Number.isNaN(bytes) || bytes <= 0) return "Unknown"
  const mb = bytes / 1048576
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb.toFixed(1)} MB`
}

type QualityTier = "Highest" | "High" | "Low"

type TieredDownload = WatchDownload & { tier: QualityTier }

function tierDownloads(downloads: WatchDownload[]): TieredDownload[] {
  const sorted = [...downloads].sort((a, b) => Number(b.size) - Number(a.size))
  if (sorted.length === 0) return []
  const head = sorted[0]
  if (sorted.length === 1) {
    return [{ ...head, tier: "Highest" }]
  }
  const tail = sorted[sorted.length - 1]
  if (sorted.length === 2) {
    return [
      { ...head, tier: "Highest" },
      { ...tail, tier: "Low" },
    ]
  }
  const middle = sorted[Math.floor(sorted.length / 2)]
  return [
    { ...head, tier: "Highest" },
    { ...middle, tier: "High" },
    { ...tail, tier: "Low" },
  ]
}

function TermsModal({
  visible,
  onAccept,
  onCancel,
}: {
  visible: boolean
  onAccept: () => void
  onCancel: () => void
}) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.termsContainer,
            {
              paddingTop:
                Platform.OS === "android" ? insets.top + 16 : insets.top + 24,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <Text style={[styles.termsTitle, typography.titleLarge]}>
            Terms of Use
          </Text>
          <ScrollView style={styles.termsScroll}>
            {TERMS_OF_USE_PARAGRAPHS.map((paragraph, index) => (
              <Text
                key={index}
                style={[
                  styles.termsText,
                  typography.body,
                  index > 0 && styles.termsParagraphGap,
                ]}
              >
                {paragraph}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.termsFooter}>
            <Pressable
              style={({ pressed }) => [
                styles.termsCancelButton,
                pressed && feedback.pressed,
              ]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.termsCancelText, typography.body]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.termsAcceptButton,
                pressed && feedback.pressed,
              ]}
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel="Accept terms of use"
            >
              <Text style={[styles.termsAcceptText, typography.body]}>
                Accept
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export type DownloadSheetProps = {
  videoTitle: string | null
  duration: number | null
  languageName: string | null
  downloads: WatchDownload[]
  onDownloadComplete?: () => void
}

export function DownloadSheetContent({
  videoTitle,
  duration,
  languageName,
  downloads,
  onDownloadComplete,
}: DownloadSheetProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const downloadInFlight = useRef(false)

  const tiered = useMemo(() => tierDownloads(downloads), [downloads])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [touAccepted, setTouAccepted] = useState(false)
  const [termsVisible, setTermsVisible] = useState(false)

  const [downloading, setDownloading] = useState(false)

  const handleDownload = useCallback(async () => {
    if (downloadInFlight.current) return
    if (!touAccepted || tiered.length === 0) return
    const selected = tiered[selectedIndex]
    if (!selected) return
    downloadInFlight.current = true
    setDownloading(true)

    try {
      if (!cacheDirectory) throw new Error("Cache directory unavailable")
      const rawName =
        selected.url.split("/").pop()?.split("?")[0] ?? "video.mp4"
      const filename = `${selected.documentId}-${rawName}`
      const localUri = `${cacheDirectory}${filename}`
      const { uri } = await downloadAsync(selected.url, localUri)
      try {
        await Sharing.shareAsync(uri, {
          mimeType: "video/mp4",
          UTI: "public.mpeg-4",
        })
      } catch {
        // User dismissed the share sheet — not an error
      }
      onDownloadComplete?.()
    } catch {
      Alert.alert(
        "Download failed",
        "Could not download the video. Please try again.",
      )
    } finally {
      downloadInFlight.current = false
      setDownloading(false)
    }
  }, [touAccepted, tiered, selectedIndex])

  const renderQualityRow = useCallback(
    ({ item, index }: { item: TieredDownload; index: number }) => {
      const isSelected = index === selectedIndex
      return (
        <Pressable
          style={({ pressed }) => [
            styles.qualityRow,
            isSelected ? styles.qualityRowSelected : styles.qualityRowDefault,
            pressed && feedback.pressed,
          ]}
          onPress={() => setSelectedIndex(index)}
          accessibilityRole="radio"
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={`${item.tier} quality, ${formatFileSize(item.size)}`}
        >
          <Text
            style={[
              styles.qualityLabel,
              typography.body,
              isSelected && styles.qualityLabelSelected,
            ]}
          >
            {item.tier}
          </Text>
          <Text
            style={[
              styles.qualitySize,
              typography.bodySmall,
              isSelected && styles.qualitySizeSelected,
            ]}
          >
            {formatFileSize(item.size)}
          </Text>
        </Pressable>
      )
    },
    [selectedIndex, typography],
  )

  if (downloads.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="cloud-download-outline"
          size={48}
          color={TEXT_SECONDARY}
        />
        <Text style={[styles.emptyText, typography.body]}>
          No downloads available
        </Text>
      </View>
    )
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          {videoTitle != null && (
            <Text
              style={[styles.videoTitle, typography.titleLarge]}
              numberOfLines={2}
            >
              {videoTitle}
            </Text>
          )}
          <View style={styles.metaRow}>
            {languageName != null && (
              <View style={styles.metaPill}>
                <Ionicons
                  name="globe-outline"
                  size={14}
                  color={TEXT_SECONDARY}
                />
                <Text style={[styles.metaPillText, typography.bodySmall]}>
                  {languageName}
                </Text>
              </View>
            )}
            {duration != null && duration > 0 && (
              <View style={styles.metaPill}>
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={TEXT_SECONDARY}
                />
                <Text style={[styles.metaPillText, typography.bodySmall]}>
                  {formatDuration(duration)}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.qualitySection}>
          <Text style={[styles.qualitySectionLabel, typography.bodySmall]}>
            Select a file size
          </Text>
          <FlatList
            data={tiered}
            keyExtractor={(item) => item.documentId}
            renderItem={renderQualityRow}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.qualityGap} />}
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.touRow, pressed && feedback.pressed]}
          onPress={() => {
            if (touAccepted) {
              setTouAccepted(false)
            } else {
              setTermsVisible(true)
            }
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: touAccepted }}
          accessibilityLabel="I agree to the Terms of Use"
        >
          <View
            style={[styles.checkbox, touAccepted && styles.checkboxChecked]}
          >
            {touAccepted && (
              <Ionicons name="checkmark" size={16} color="#ffffff" />
            )}
          </View>
          <Text style={[styles.touText, typography.bodySmall]}>
            I agree to the{" "}
          </Text>
          <Pressable
            onPress={() => setTermsVisible(true)}
            hitSlop={4}
            accessibilityRole="link"
            accessibilityLabel="Read Terms of Use"
          >
            <Text style={[styles.touLink, typography.bodySmall]}>
              Terms of Use
            </Text>
          </Pressable>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.downloadButton,
            (!touAccepted || downloading) && styles.downloadButtonDisabled,
            pressed && touAccepted && !downloading && feedback.pressed,
          ]}
          onPress={handleDownload}
          disabled={!touAccepted || downloading}
          accessibilityRole="button"
          accessibilityLabel={
            downloading ? "Downloading video" : "Download video"
          }
          accessibilityState={{ disabled: !touAccepted || downloading }}
        >
          {downloading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="download-outline" size={20} color="#ffffff" />
          )}
          <Text style={[styles.downloadButtonText, typography.body]}>
            {downloading ? "Downloading..." : "Download"}
          </Text>
        </Pressable>
      </ScrollView>

      <TermsModal
        visible={termsVisible}
        onAccept={() => {
          setTouAccepted(true)
          setTermsVisible(false)
        }}
        onCancel={() => setTermsVisible(false)}
      />
    </>
  )
}

export { type DownloadSheetProps as DownloadSheetContentProps }

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingVertical: 48,
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
  },
  header: {
    marginBottom: 24,
  },
  videoTitle: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  metaPillText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  qualitySection: {
    marginBottom: 24,
  },
  qualitySectionLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginBottom: 12,
  },
  qualityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
  },
  qualityRowDefault: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  qualityRowSelected: {
    backgroundColor: ACCENT,
  },
  qualityGap: {
    height: 8,
  },
  qualityLabel: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
    fontFamily: "System",
  },
  qualityLabelSelected: {
    color: "#ffffff",
  },
  qualitySize: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  qualitySizeSelected: {
    color: "#ffffff",
  },
  touRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  touText: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  touLink: {
    color: ACCENT,
    fontWeight: "600",
    fontFamily: "System",
    textDecorationLine: "underline",
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 48,
  },
  downloadButtonDisabled: {
    opacity: 0.5,
  },
  downloadButtonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
  },
  termsContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  termsTitle: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 16,
  },
  termsScroll: {
    flex: 1,
  },
  termsText: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  termsParagraphGap: {
    marginTop: 16,
  },
  termsFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  termsCancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  termsCancelText: {
    color: TEXT_SECONDARY,
    fontWeight: "600",
    fontFamily: "System",
  },
  termsAcceptButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  termsAcceptText: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
  },
})
