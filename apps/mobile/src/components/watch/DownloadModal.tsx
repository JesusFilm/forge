import { useCallback, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Linking,
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
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_BODY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"
import type { WatchDownload } from "../../lib/normalizeVideo"

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  return sorted.map((d, i) => {
    let tier: QualityTier = "Low"
    if (i === 0) tier = "Highest"
    else if (i < sorted.length - 1) tier = "High"
    return { ...d, tier }
  })
}

// ── Terms of Use Modal ────────────────────────────────────────────────────────

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
            <Text style={[styles.termsText, typography.body]}>
              By downloading this content, you agree to use it solely for
              personal, non-commercial purposes. You may share this content for
              ministry and educational purposes. Redistribution for commercial
              gain, modification of the content, or any use that misrepresents
              the original message is prohibited. All rights to the content
              remain with Jesus Film Project. By proceeding with the download,
              you acknowledge and accept these terms.
            </Text>
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

// ── DownloadModal ─────────────────────────────────────────────────────────────

export type DownloadModalProps = {
  visible: boolean
  onClose: () => void
  videoTitle: string | null
  posterUrl: string | null
  duration: number | null
  languageName: string | null
  downloads: WatchDownload[]
}

export function DownloadModal({
  visible,
  onClose,
  videoTitle,
  posterUrl,
  duration,
  languageName,
  downloads,
}: DownloadModalProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const downloadInFlight = useRef(false)

  const tiered = useMemo(() => tierDownloads(downloads), [downloads])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [touAccepted, setTouAccepted] = useState(false)
  const [termsVisible, setTermsVisible] = useState(false)

  const handleDownload = useCallback(() => {
    if (downloadInFlight.current) return
    if (!touAccepted || tiered.length === 0) return
    const selected = tiered[selectedIndex]
    if (!selected) return
    downloadInFlight.current = true
    Linking.openURL(selected.url).finally(() => {
      downloadInFlight.current = false
    })
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
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <StatusBar barStyle="light-content" />
        <View style={styles.modalOverlay}>
          <Pressable
            style={[
              styles.closeButton,
              {
                top: Platform.OS === "android" ? insets.top : insets.top + 8,
              },
            ]}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.closeIcon}>{"✕"}</Text>
          </Pressable>
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
        </View>
      </Modal>
    )
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.modalOverlay}>
        <Pressable
          style={[
            styles.closeButton,
            {
              top: Platform.OS === "android" ? insets.top : insets.top + 8,
            },
          ]}
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.closeIcon}>{"✕"}</Text>
        </Pressable>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop:
                Platform.OS === "android" ? insets.top + 64 : insets.top + 72,
              paddingBottom: insets.bottom + 24,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header: poster + info */}
          <View style={styles.header}>
            {posterUrl != null && (
              <View style={styles.posterContainer}>
                <Image
                  source={{ uri: posterUrl }}
                  style={styles.poster}
                  contentFit="cover"
                  recyclingKey={`download-poster-${posterUrl}`}
                />
                {duration != null && duration > 0 && (
                  <View style={styles.durationBadge}>
                    <Ionicons name="play" size={10} color="#ffffff" />
                    <Text style={styles.durationText}>
                      {formatDuration(duration)}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {videoTitle != null && (
              <Text
                style={[styles.videoTitle, typography.titleLarge]}
                numberOfLines={2}
              >
                {videoTitle}
              </Text>
            )}
            {languageName != null && (
              <View style={styles.languagePill}>
                <Ionicons
                  name="globe-outline"
                  size={14}
                  color={TEXT_SECONDARY}
                />
                <Text style={[styles.languagePillText, typography.bodySmall]}>
                  {languageName}
                </Text>
              </View>
            )}
          </View>

          {/* Quality selector */}
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

          {/* Terms of Use checkbox */}
          <Pressable
            style={({ pressed }) => [
              styles.touRow,
              pressed && feedback.pressed,
            ]}
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

          {/* Download button */}
          <Pressable
            style={({ pressed }) => [
              styles.downloadButton,
              !touAccepted && styles.downloadButtonDisabled,
              pressed && touAccepted && feedback.pressed,
            ]}
            onPress={handleDownload}
            disabled={!touAccepted}
            accessibilityRole="button"
            accessibilityLabel="Download video"
            accessibilityState={{ disabled: !touAccepted }}
          >
            <Ionicons name="download-outline" size={20} color="#ffffff" />
            <Text style={[styles.downloadButtonText, typography.body]}>
              Download
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
      </View>
    </Modal>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    zIndex: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "System",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
  },

  // Header
  header: {
    marginBottom: 24,
  },
  posterContainer: {
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
  },
  poster: {
    width: "100%",
    height: "100%",
  },
  durationBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  durationText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "System",
  },
  videoTitle: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 8,
  },
  languagePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: SURFACE_COLOR,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  languagePillText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },

  // Quality selector
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
    backgroundColor: SURFACE_COLOR,
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

  // Terms of Use
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
    borderColor: SURFACE_COLOR,
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

  // Download button
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

  // Terms modal
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
