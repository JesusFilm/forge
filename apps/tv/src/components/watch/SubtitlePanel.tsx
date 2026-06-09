// On-page subtitle picker for the details screen (R9, R13).
//
// Full-screen dimmed overlay with a focus-trapping TVFocusGuideView. Calls
// ensureActiveVariantMedia() on open so the active dub's lazy media (subtitles)
// is fetched (GET_VIDEO_DUB), then renders the four media states distinctly:
//   - loading  → a NON-focusable "Loading…" row,
//   - error    → a NON-focusable "Couldn't load subtitles" row,
//   - loaded-empty → a NON-focusable "No subtitles available" row,
//   - loaded-list  → the subtitle rows (slug-keyed, checkmark on active).
// An "Off" row is always present and focusable (setSubtitleEnabled(false)). In
// EVERY state the Close affordance stays focusable, so the viewer is never
// trapped in an empty/loading/error panel. No bottom sheets (DESIGN.md §4).
//
// The media-state → UI-state mapping and the active-row test are pure helpers in
// panelState.ts (unit-tested there — jest-expo can't load this .tsx).

import { useEffect } from "react"
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { FocusableCard } from "../FocusableCard"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { deriveSubtitlePanelState, isSubtitleRowActive } from "./panelState"
import { panelStyles } from "./panelStyles"

export function SubtitlePanel({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const {
    activeVariantMediaState,
    ensureActiveVariantMedia,
    subtitleEnabled,
    setSubtitleEnabled,
    activeSubtitleSlug,
    setActiveSubtitleSlug,
  } = useWatchSession()

  // Lazy-fetch the active dub's media when the panel opens (GET_VIDEO_DUB).
  useEffect(() => {
    if (visible) ensureActiveVariantMedia()
  }, [visible, ensureActiveVariantMedia])

  // Re-derive the discriminated UI state from the session's media struct; the
  // pure mapping in panelState.ts owns the loading/error/loaded precedence.
  const panelState = deriveSubtitlePanelState(activeVariantMediaState)

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
            Subtitles
          </Text>
          <ScrollView contentContainerStyle={styles.listContent}>
            {/* Off row — always present, always focusable, in every state. */}
            <FocusableCard
              onPress={() => {
                setSubtitleEnabled(false)
                onClose()
              }}
              hasTVPreferredFocus={!subtitleEnabled}
              focusScale={1.02}
              style={panelStyles.row}
              accessibilityLabel="Subtitles off"
            >
              <View style={panelStyles.rowInner}>
                <Text style={panelStyles.rowText}>Subtitles off</Text>
                {!subtitleEnabled ? (
                  <Text style={panelStyles.check}>{"✓"}</Text>
                ) : null}
              </View>
            </FocusableCard>

            {/* loading: non-focusable status row. */}
            {panelState.kind === "loading" ? (
              <Text style={styles.status}>Loading…</Text>
            ) : null}

            {/* error: non-focusable status row (vs. a misleading empty list). */}
            {panelState.kind === "error" ? (
              <Text style={styles.status}>Couldn’t load subtitles</Text>
            ) : null}

            {/* loaded-empty: non-focusable status row. */}
            {panelState.kind === "loaded" &&
            panelState.subtitles.length === 0 ? (
              <Text style={styles.status}>No subtitles available</Text>
            ) : null}

            {/* loaded-list: focusable, slug-keyed subtitle rows. */}
            {panelState.kind === "loaded"
              ? panelState.subtitles.map((subtitle, index) => {
                  const isActive = isSubtitleRowActive(
                    subtitle,
                    subtitleEnabled,
                    activeSubtitleSlug,
                  )
                  const name = subtitle.languageName || subtitle.languageSlug
                  return (
                    <FocusableCard
                      key={`subtitle-${subtitle.languageSlug ?? ""}-${index}`}
                      onPress={() => {
                        setActiveSubtitleSlug(subtitle.languageSlug)
                        setSubtitleEnabled(true)
                        onClose()
                      }}
                      hasTVPreferredFocus={isActive}
                      focusScale={1.02}
                      style={panelStyles.row}
                      accessibilityLabel={name}
                    >
                      <View style={panelStyles.rowInner}>
                        <Text style={panelStyles.rowText} numberOfLines={1}>
                          {name}
                        </Text>
                        {isActive ? (
                          <Text style={panelStyles.check}>{"✓"}</Text>
                        ) : null}
                      </View>
                    </FocusableCard>
                  )
                })
              : null}
          </ScrollView>

          {/* Dismiss affordance stays focusable in EVERY media state so the
              viewer is never trapped in a loading / error / empty panel. */}
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
  status: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    color: COLORS.muted,
    paddingVertical: scale(16),
    paddingHorizontal: scale(24),
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
