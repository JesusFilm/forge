// BASIC functional on-page language (audio dub) picker for the details screen.
//
// Full-screen dimmed overlay with a focus-trapping TVFocusGuideView and a
// focusable list of dubs (FocusableCard rows), a checkmark on the active row,
// crimson glow on focus, and a focusable Close affordance. Selecting a dub sets
// the session's activeVariantIndex (R8) and dismisses.
//
// U6 HARDENING (left for later, marked below):
//   - a published dub with `hls == null` should render as a disabled /
//     annotated row (not selectable);
//   - loading / error / empty-list states (variants are part of the bulk
//     payload so they're usually present, but a partial-data window can show an
//     empty list — U6 adds the "no languages yet" affordance).

import { Modal, ScrollView, StyleSheet, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { FocusableCard } from "../FocusableCard"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"

export function LanguagePanel({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const { video, activeVariantIndex, setActiveVariantIndex } = useWatchSession()
  const variants = video?.variants ?? []

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TVFocusGuideView
          autoFocus
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          trapFocusRight
          style={styles.panel}
        >
          <Text style={styles.heading} accessibilityRole="header">
            Audio Language
          </Text>
          <ScrollView contentContainerStyle={styles.listContent}>
            {variants.map((variant, index) => {
              const isActive = index === activeVariantIndex
              const name =
                variant.languageName ?? variant.languageSlug ?? variant.slug
              return (
                <FocusableCard
                  key={variant.documentId || `variant-${index}`}
                  onPress={() => {
                    setActiveVariantIndex(index)
                    onClose()
                  }}
                  // First row gets initial focus when no active selection is
                  // visible; the active row otherwise.
                  hasTVPreferredFocus={isActive}
                  focusScale={1.02}
                  style={styles.row}
                  accessibilityLabel={name}
                >
                  <View style={styles.rowInner}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {name}
                      {variant.languageNameNative
                        ? `  ·  ${variant.languageNameNative}`
                        : ""}
                    </Text>
                    {isActive ? <Text style={styles.check}>{"✓"}</Text> : null}
                  </View>
                </FocusableCard>
              )
            })}
          </ScrollView>

          {/* Dismiss affordance stays focusable in every state so the viewer is
              never trapped (U6 keeps this invariant across loading/empty). */}
          <FocusableCard
            onPress={onClose}
            focusScale={1.02}
            style={styles.closeRow}
            accessibilityLabel="Close"
          >
            <Text style={styles.closeText}>Close</Text>
          </FocusableCard>
        </TVFocusGuideView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    width: scale(640),
    maxHeight: scale(820),
    backgroundColor: COLORS.surfaceContainer,
    borderRadius: scale(24),
    padding: scale(40),
  },
  heading: {
    fontFamily: "System",
    fontSize: scale(32),
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: scale(24),
  },
  listContent: {
    paddingBottom: scale(8),
  },
  row: {
    backgroundColor: COLORS.surfaceContainerHigh,
    marginBottom: scale(12),
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: scale(18),
    paddingHorizontal: scale(24),
  },
  rowText: {
    flex: 1,
    fontFamily: "System",
    fontSize: scale(22),
    fontWeight: "600",
    color: COLORS.text,
    marginRight: scale(12),
  },
  check: {
    fontFamily: "System",
    fontSize: scale(24),
    color: COLORS.primary,
    fontWeight: "700",
  },
  closeRow: {
    marginTop: scale(12),
    backgroundColor: COLORS.surfaceContainerHigh,
    alignItems: "center",
  },
  closeText: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.muted,
    paddingVertical: scale(16),
  },
})
