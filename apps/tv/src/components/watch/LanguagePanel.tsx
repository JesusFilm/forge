// On-page language (audio dub) picker for the details screen (R8, R13).
//
// Full-screen dimmed overlay with a focus-trapping TVFocusGuideView and a
// focusable list of dubs (FocusableCard rows), a checkmark on the active row,
// crimson glow on focus, and a focusable Close affordance. Selecting a playable
// dub sets the session's activeVariantIndex and dismisses.
//
// A published dub with no playable stream (`hls == null` / empty) renders as a
// DISABLED, non-selectable row: visually muted and NOT focusable, so the viewer
// can't pick an unplayable language. The annotation lives in panelState.ts
// (unit-tested there — jest-expo can't load this .tsx). The Close affordance is
// always focusable. No bottom sheets (DESIGN.md §4).

import { useMemo } from "react"
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { FocusableCard } from "../FocusableCard"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { annotateVariantRows } from "./panelState"

export function LanguagePanel({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const { video, activeVariantIndex, setActiveVariantIndex } = useWatchSession()
  const rows = useMemo(
    () => annotateVariantRows(video?.variants ?? [], activeVariantIndex),
    [video?.variants, activeVariantIndex],
  )

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
            {rows.map((row) => {
              const { variant, index, disabled, active } = row
              const name =
                variant.languageName ?? variant.languageSlug ?? variant.slug
              const native = variant.languageNameNative
                ? `  ·  ${variant.languageNameNative}`
                : ""

              // Unplayable dub (no HLS): inert, non-focusable, muted. Rendered
              // as a plain View — never wrapped in a FocusableCard — so the
              // D-pad skips it and the viewer can't select an unplayable
              // language. "Unavailable" tag mirrors DESIGN.md §4's ghosted
              // unfocusable error treatment.
              if (disabled) {
                return (
                  <View
                    key={`variant-${variant.documentId ?? ""}-${index}`}
                    style={[styles.row, styles.disabledRow]}
                    accessibilityLabel={`${name}, unavailable`}
                  >
                    <View style={styles.rowInner}>
                      <Text
                        style={[styles.rowText, styles.disabledText]}
                        numberOfLines={1}
                      >
                        {name}
                        {native}
                      </Text>
                      <Text style={styles.unavailable}>Unavailable</Text>
                    </View>
                  </View>
                )
              }

              return (
                <FocusableCard
                  key={`variant-${variant.documentId ?? ""}-${index}`}
                  onPress={() => {
                    setActiveVariantIndex(index)
                    onClose()
                  }}
                  hasTVPreferredFocus={active}
                  focusScale={1.02}
                  style={styles.row}
                  accessibilityLabel={name}
                >
                  <View style={styles.rowInner}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {name}
                      {native}
                    </Text>
                    {active ? <Text style={styles.check}>{"✓"}</Text> : null}
                  </View>
                </FocusableCard>
              )
            })}
          </ScrollView>

          {/* Dismiss affordance stays focusable in every state so the viewer is
              never trapped (kept reachable even when all dubs are disabled). */}
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
    backgroundColor: hexToRgba("#000000", 0.8),
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
    fontSize: Math.round(scale(32)),
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
    borderRadius: scale(16),
  },
  disabledRow: {
    opacity: 0.4,
    overflow: "hidden",
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
    fontSize: Math.round(scale(22)),
    fontWeight: "600",
    color: COLORS.text,
    marginRight: scale(12),
  },
  disabledText: {
    color: COLORS.muted,
  },
  unavailable: {
    fontFamily: "System",
    fontSize: Math.round(scale(16)),
    fontWeight: "600",
    color: COLORS.muted,
  },
  check: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
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
    fontSize: Math.round(scale(20)),
    fontWeight: "600",
    color: COLORS.muted,
    paddingVertical: scale(16),
  },
})
