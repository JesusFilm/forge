import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useTypography } from "../../hooks/useTypography"
import { pickLocalizedName } from "../../lib/pickLocalizedName"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { feedback, HORIZONTAL_PADDING, text } from "../../styles/shared"
import type { WatchSubtitle, WatchVariant } from "../../lib/normalizeVideo"

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveLanguageName(name: string | null): string {
  if (name == null) return "Unknown"
  // Admin stores some language names as JSON locale maps
  const parsed = pickLocalizedName(name)
  return parsed ?? name
}

function sortedVariants(variants: WatchVariant[]): WatchVariant[] {
  return [...variants].sort((a, b) => {
    const nameA = resolveLanguageName(a.languageName).toLowerCase()
    const nameB = resolveLanguageName(b.languageName).toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

function sortedSubtitles(subtitles: WatchSubtitle[]): WatchSubtitle[] {
  return [...subtitles].sort((a, b) => {
    const nameA = a.languageName.toLowerCase()
    const nameB = b.languageName.toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

// ── LanguageSubtitleModal ─────────────────────────────────────────────────────

export type LanguageSubtitleModalProps = {
  visible: boolean
  onClose: () => void
  variants: WatchVariant[]
  activeVariantSlug: string
  onLanguageChange: (variantSlug: string, hlsUrl: string) => void
  subtitles: WatchSubtitle[]
  subtitleEnabled: boolean
  activeSubtitleSlug: string | null
  onSubtitleChange: (enabled: boolean, slug: string | null) => void
}

export function LanguageSubtitleModal({
  visible,
  onClose,
  variants,
  activeVariantSlug,
  onLanguageChange,
  subtitles,
  subtitleEnabled,
  activeSubtitleSlug,
  onSubtitleChange,
}: LanguageSubtitleModalProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  // Draft state: staged changes applied only on "Apply"
  const [draftLanguageSlug, setDraftLanguageSlug] = useState(activeVariantSlug)
  const [draftSubtitleEnabled, setDraftSubtitleEnabled] =
    useState(subtitleEnabled)
  const [draftSubtitleSlug, setDraftSubtitleSlug] = useState(activeSubtitleSlug)

  // Reset drafts when modal opens
  useEffect(() => {
    if (visible) {
      setDraftLanguageSlug(activeVariantSlug)
      setDraftSubtitleEnabled(subtitleEnabled)
      setDraftSubtitleSlug(activeSubtitleSlug)
    }
  }, [visible, activeVariantSlug, subtitleEnabled, activeSubtitleSlug])

  const sorted = useMemo(() => sortedVariants(variants), [variants])
  const sortedSubs = useMemo(() => sortedSubtitles(subtitles), [subtitles])

  const isDirty =
    draftLanguageSlug !== activeVariantSlug ||
    draftSubtitleEnabled !== subtitleEnabled ||
    draftSubtitleSlug !== activeSubtitleSlug

  const handleApply = useCallback(() => {
    if (draftLanguageSlug !== activeVariantSlug) {
      const variant = variants.find((v) => v.slug === draftLanguageSlug)
      if (variant?.hls) {
        onLanguageChange(variant.slug, variant.hls)
      }
    }
    if (
      draftSubtitleEnabled !== subtitleEnabled ||
      draftSubtitleSlug !== activeSubtitleSlug
    ) {
      onSubtitleChange(draftSubtitleEnabled, draftSubtitleSlug)
    }
    onClose()
  }, [
    draftLanguageSlug,
    activeVariantSlug,
    variants,
    onLanguageChange,
    draftSubtitleEnabled,
    subtitleEnabled,
    draftSubtitleSlug,
    activeSubtitleSlug,
    onSubtitleChange,
    onClose,
  ])

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
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Language section */}
          <View style={styles.sectionHeader}>
            <Text style={[text.sectionHeading, typography.titleLarge]}>
              Language
            </Text>
            <Text style={[styles.countBadge, typography.bodySmall]}>
              ({variants.length} language{variants.length !== 1 ? "s" : ""})
            </Text>
          </View>

          <View style={styles.listContainer}>
            {sorted.map((variant) => {
              const isActive = variant.slug === draftLanguageSlug
              return (
                <Pressable
                  key={variant.documentId}
                  style={({ pressed }) => [
                    styles.listRow,
                    isActive && styles.listRowActive,
                    pressed && feedback.pressed,
                  ]}
                  onPress={() => setDraftLanguageSlug(variant.slug)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={resolveLanguageName(variant.languageName)}
                >
                  <Text
                    style={[
                      styles.listRowText,
                      typography.body,
                      isActive && styles.listRowTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {resolveLanguageName(variant.languageName)}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {/* Subtitle section */}
          {subtitles.length > 0 && (
            <>
              <View style={styles.divider} />

              <View style={styles.subtitleHeader}>
                <Text style={[text.sectionHeading, typography.titleLarge]}>
                  Subtitles
                </Text>
                <Switch
                  value={draftSubtitleEnabled}
                  onValueChange={setDraftSubtitleEnabled}
                  trackColor={{ false: SURFACE_COLOR, true: ACCENT }}
                  thumbColor="#ffffff"
                  accessibilityRole="switch"
                  accessibilityLabel="Enable subtitles"
                />
              </View>

              <View
                style={[
                  styles.listContainer,
                  !draftSubtitleEnabled && styles.listDisabled,
                ]}
                pointerEvents={draftSubtitleEnabled ? "auto" : "none"}
              >
                {sortedSubs.map((sub) => {
                  const isActive = sub.languageSlug === draftSubtitleSlug
                  return (
                    <Pressable
                      key={sub.documentId}
                      style={({ pressed }) => [
                        styles.listRow,
                        isActive && styles.listRowActive,
                        pressed && feedback.pressed,
                      ]}
                      onPress={() => setDraftSubtitleSlug(sub.languageSlug)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={sub.languageName}
                    >
                      <Text
                        style={[
                          styles.listRowText,
                          typography.body,
                          isActive && styles.listRowTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {sub.languageName}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={({ pressed }) => [
              styles.footerCloseButton,
              pressed && feedback.pressed,
            ]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close without applying"
          >
            <Text style={[styles.footerCloseText, typography.body]}>Close</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.footerApplyButton,
              !isDirty && styles.footerApplyDisabled,
              pressed && isDirty && feedback.pressed,
            ]}
            onPress={handleApply}
            disabled={!isDirty}
            accessibilityRole="button"
            accessibilityLabel="Apply changes"
            accessibilityState={{ disabled: !isDirty }}
          >
            <Text style={[styles.footerApplyText, typography.body]}>Apply</Text>
          </Pressable>
        </View>
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
    paddingBottom: 16,
  },

  // Section headers
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 16,
  },
  countBadge: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  subtitleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },

  // List rows
  listContainer: {
    gap: 4,
  },
  listDisabled: {
    opacity: 0.5,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    borderLeftWidth: 3,
    borderLeftColor: "rgba(0, 0, 0, 0)",
  },
  listRowActive: {
    borderLeftColor: ACCENT,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  listRowText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    flex: 1,
  },
  listRowTextActive: {
    fontWeight: "600",
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginVertical: 24,
  },

  // Footer
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  footerCloseButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  footerCloseText: {
    color: TEXT_SECONDARY,
    fontWeight: "600",
    fontFamily: "System",
  },
  footerApplyButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  footerApplyDisabled: {
    opacity: 0.5,
  },
  footerApplyText: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
  },
})
