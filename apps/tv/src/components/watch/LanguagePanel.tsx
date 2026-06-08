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
import { VariantRow } from "./VariantRow"

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
            {rows.map((row) => (
              <VariantRow
                key={`variant-${row.variant.documentId ?? ""}-${row.index}`}
                row={row}
                onSelect={setActiveVariantIndex}
                onClose={onClose}
              />
            ))}
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
