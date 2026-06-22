import { useCallback, useEffect, useMemo, useState } from "react"
import {
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
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons"

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

type DropdownOption = {
  key: string
  label: string
  /** Optional trailing text shown on the right (e.g. a file size). */
  trailing?: string
}

/** Cap the open panel at ~5 rows so long lists scroll inside the dropdown, not grow the sheet. */
const DROPDOWN_MAX_HEIGHT = 240

/**
 * Collapsed select expanding to a bounded, internally-scrollable list, so the
 * sheet stays compact on first present regardless of option count.
 */
function Dropdown({
  sectionLabel,
  options,
  selectedKey,
  open,
  onToggle,
  onSelect,
}: {
  sectionLabel: string
  options: DropdownOption[]
  selectedKey: string
  open: boolean
  onToggle: () => void
  onSelect: (key: string) => void
}) {
  const typography = useTypography()
  const selected = options.find((o) => o.key === selectedKey) ?? options[0]

  return (
    <View style={styles.dropdownSection}>
      <Text style={[styles.dropdownSectionLabel, typography.bodySmall]}>
        {sectionLabel}
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.dropdownTrigger,
          open && styles.dropdownTriggerOpen,
          pressed && feedback.pressed,
        ]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          selected != null ? `${sectionLabel}, ${selected.label}` : sectionLabel
        }
      >
        <Text style={[styles.dropdownValue, typography.body]} numberOfLines={1}>
          {selected?.label}
        </Text>
        <View style={styles.dropdownRight}>
          {selected?.trailing != null && (
            <Text style={[styles.dropdownTrailing, typography.bodySmall]}>
              {selected.trailing}
            </Text>
          )}
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
            color={TEXT_SECONDARY}
          />
        </View>
      </Pressable>
      {open && (
        <View style={styles.dropdownPanel}>
          <ScrollView
            style={styles.dropdownPanelScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            accessibilityLabel={`${sectionLabel} options`}
          >
            <View accessibilityRole="radiogroup">
              {options.map((opt) => {
                const isSelected = opt.key === selectedKey
                return (
                  <Pressable
                    key={opt.key}
                    style={({ pressed }) => [
                      styles.dropdownOption,
                      isSelected && styles.dropdownOptionSelected,
                      pressed && feedback.pressed,
                    ]}
                    onPress={() => onSelect(opt.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={opt.label}
                  >
                    <Text
                      style={[
                        styles.dropdownOptionLabel,
                        typography.body,
                        isSelected && styles.dropdownOptionLabelSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    <View style={styles.dropdownRight}>
                      {opt.trailing != null && (
                        <Text
                          style={[
                            styles.dropdownOptionTrailing,
                            typography.bodySmall,
                            isSelected && styles.dropdownOptionLabelSelected,
                          ]}
                        >
                          {opt.trailing}
                        </Text>
                      )}
                      {isSelected && (
                        <Ionicons name="checkmark" size={18} color="#ffffff" />
                      )}
                    </View>
                  </Pressable>
                )
              })}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  )
}

export type DownloadSheetProps = {
  videoTitle: string | null
  duration: number | null
  languageName: string | null
  downloads: WatchDownload[]
  /**
   * The subtitle language that will be bundled with the download — the dub's
   * active subtitle as chosen on the Video Details subtitle sheet, or null when
   * none is active. Display-only; the route resolves and enqueues the track.
   */
  subtitleLanguageName: string | null
  /**
   * Enqueue the chosen rendition for offline download. The active subtitle is
   * inherited from the watch session (not picked here); the route builds the
   * full request, dismisses the sheet, and downloads via DownloadsProvider.
   */
  onStartDownload: (rendition: WatchDownload) => void
}

export function DownloadSheetContent({
  videoTitle,
  duration,
  languageName,
  downloads,
  subtitleLanguageName,
  onStartDownload,
}: DownloadSheetProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  const tiered = useMemo(() => tierDownloads(downloads), [downloads])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [touAccepted, setTouAccepted] = useState(false)
  const [termsVisible, setTermsVisible] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)

  // Key by tier-array index, not documentId: ids aren't unique (normalizeVideo
  // defaults documentId to "" and doesn't dedupe), so they'd collide React keys
  // and break selection (findIndex always resolving to the first match).
  const qualityOptions = useMemo<DropdownOption[]>(
    () =>
      tiered.map((t, index) => ({
        key: String(index),
        label: t.tier,
        trailing: formatFileSize(t.size),
      })),
    [tiered],
  )
  const selectedQualityKey = String(selectedIndex)

  // Keep selectedIndex in range if the renditions list changes out from under
  // it — otherwise the trigger shows a stale tier while Download silently
  // no-ops (handleDownload reads tiered[selectedIndex]).
  useEffect(() => {
    if (selectedIndex >= tiered.length) setSelectedIndex(0)
  }, [tiered.length, selectedIndex])

  const handleDownload = useCallback(() => {
    if (!touAccepted || tiered.length === 0) return
    const selected = tiered[selectedIndex]
    if (!selected) return
    // Enqueue and hand off to the background engine; the parent dismisses the
    // sheet. One copy per video is enforced by DownloadsProvider.
    onStartDownload(selected)
  }, [touAccepted, tiered, selectedIndex, onStartDownload])

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
        nestedScrollEnabled
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
            <View style={styles.metaPill}>
              <MaterialCommunityIcons
                name="closed-caption-outline"
                size={16}
                color={TEXT_SECONDARY}
              />
              <Text style={[styles.metaPillText, typography.bodySmall]}>
                {subtitleLanguageName ?? "No subtitles"}
              </Text>
            </View>
          </View>
        </View>

        <Dropdown
          sectionLabel="Select a file size"
          options={qualityOptions}
          selectedKey={selectedQualityKey}
          open={qualityOpen}
          onToggle={() => setQualityOpen((o) => !o)}
          onSelect={(key) => {
            setSelectedIndex(Number(key))
            setQualityOpen(false)
          }}
        />

        <View style={styles.touRow}>
          <Pressable
            onPress={() => setTouAccepted((v) => !v)}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: touAccepted }}
            accessibilityLabel="I agree to the Terms of Use"
            style={({ pressed }) => pressed && feedback.pressed}
          >
            <View
              style={[styles.checkbox, touAccepted && styles.checkboxChecked]}
            >
              {touAccepted && (
                <Ionicons name="checkmark" size={16} color="#ffffff" />
              )}
            </View>
          </Pressable>
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
        </View>

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
    </>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 36,
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
    // Wrap chips onto the next line instead of pushing a long language name
    // (and the chips after it) off the right edge. Row gap matches the column.
    flexWrap: "wrap",
    rowGap: 8,
    columnGap: 8,
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
  dropdownSection: {
    marginBottom: 24,
  },
  dropdownSectionLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginBottom: 12,
  },
  dropdownPanelScroll: {
    maxHeight: DROPDOWN_MAX_HEIGHT,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  dropdownTriggerOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownValue: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
    fontFamily: "System",
    flexShrink: 1,
    marginRight: 8,
  },
  dropdownRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dropdownTrailing: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  dropdownPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: "hidden",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  },
  dropdownOptionSelected: {
    backgroundColor: ACCENT,
  },
  dropdownOptionLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    flexShrink: 1,
    marginRight: 8,
  },
  dropdownOptionLabelSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  dropdownOptionTrailing: {
    color: TEXT_BODY,
    fontFamily: "System",
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
