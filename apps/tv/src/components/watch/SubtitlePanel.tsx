// BASIC functional on-page subtitle picker for the details screen.
//
// Full-screen dimmed overlay with a focus-trapping TVFocusGuideView and a
// focusable list: an "Off" row plus one row per subtitle track for the active
// dub. Selecting "Off" disables subtitles; selecting a track enables subtitles
// and sets the active subtitle slug (slug-keyed — R9). Calls
// ensureActiveVariantMedia() on open so the active dub's lazy media (subtitles)
// is fetched. Checkmark on the active row, crimson glow on focus, focusable
// Close affordance.
//
// U6 HARDENING (left for later, marked below):
//   - the four media states are only partially surfaced here: this v1 shows the
//     loaded list (and an "Off" row that is always present). U6 adds a
//     non-focusable "Loading…" row while `activeVariantMediaLoading`, a
//     non-focusable error row on `activeVariantMediaError`, and a
//     "No subtitles available" row when loaded-empty — without ever ejecting
//     focus from the panel (Close stays reachable in every state).

import { useEffect } from "react"
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { FocusableCard } from "../FocusableCard"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"

export function SubtitlePanel({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const {
    activeVariantMedia,
    activeVariantMediaLoading,
    activeVariantMediaError,
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

  const subtitles = activeVariantMedia?.subtitles ?? []

  // U6: surface loading / error / loaded-empty here. v1 just notes them.
  const statusText = activeVariantMediaLoading
    ? "Loading…"
    : activeVariantMediaError
      ? "Couldn't load subtitles."
      : activeVariantMedia != null && subtitles.length === 0
        ? "No subtitles available."
        : null

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
            {/* Off row — always present, always focusable. */}
            <FocusableCard
              onPress={() => {
                setSubtitleEnabled(false)
                onClose()
              }}
              hasTVPreferredFocus={!subtitleEnabled}
              focusScale={1.02}
              style={styles.row}
              accessibilityLabel="Off"
            >
              <View style={styles.rowInner}>
                <Text style={styles.rowText}>Off</Text>
                {!subtitleEnabled ? (
                  <Text style={styles.check}>{"✓"}</Text>
                ) : null}
              </View>
            </FocusableCard>

            {statusText != null ? (
              <Text style={styles.status}>{statusText}</Text>
            ) : null}

            {subtitles.map((subtitle, index) => {
              const isActive =
                subtitleEnabled && activeSubtitleSlug === subtitle.languageSlug
              const name = subtitle.languageName || subtitle.languageSlug
              return (
                <FocusableCard
                  key={subtitle.languageSlug || `subtitle-${index}`}
                  onPress={() => {
                    setActiveSubtitleSlug(subtitle.languageSlug)
                    setSubtitleEnabled(true)
                    onClose()
                  }}
                  hasTVPreferredFocus={isActive}
                  focusScale={1.02}
                  style={styles.row}
                  accessibilityLabel={name}
                >
                  <View style={styles.rowInner}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {name}
                    </Text>
                    {isActive ? <Text style={styles.check}>{"✓"}</Text> : null}
                  </View>
                </FocusableCard>
              )
            })}
          </ScrollView>

          {/* Dismiss affordance stays focusable in every state so the viewer is
              never trapped in an empty panel. */}
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
  status: {
    fontFamily: "System",
    fontSize: scale(20),
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
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.muted,
    paddingVertical: scale(16),
  },
})
