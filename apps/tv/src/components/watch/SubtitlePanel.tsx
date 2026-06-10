// On-page subtitle picker for the details screen (R9, R13).
//
// Styled to the Claude Design handoff ("Forge TV Video Page" → Subtitles sheet):
// a translucent, hairline-bordered sheet over a dimmed backdrop, a header with a
// dimmed sub-line, and a focus-trapping TVFocusGuideView. Calls
// ensureActiveVariantMedia() on open so the active dub's lazy media (subtitles)
// is fetched (GET_VIDEO_DUB), then renders the four media states distinctly:
//   - loading      → a NON-focusable "Loading…" status row,
//   - error        → a NON-focusable "Couldn't load subtitles" status row,
//   - loaded-empty → a NON-focusable "No subtitles available" status row,
//   - loaded-list  → the subtitle rows (WatchOptionRow, slug-keyed, red check on
//     the active track; focus inverts the row to a white fill).
// A "Subtitles off" row is always present and focusable (setSubtitleEnabled(false)).
// In EVERY state the Close affordance stays focusable, so the viewer is never
// trapped in an empty/loading/error panel.
//
// The media-state → UI-state mapping and the active-row test are pure helpers in
// panelState.ts (unit-tested there — jest-expo can't load this .tsx).

import { useEffect } from "react"
import { Modal, ScrollView, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { deriveSubtitlePanelState, isSubtitleRowActive } from "./panelState"
import { WatchOptionRow } from "./WatchOptionRow"
import { watchMenuStyles } from "./watchMenuStyles"

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
      <View style={watchMenuStyles.scrim}>
        <TVFocusGuideView
          autoFocus
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          trapFocusRight
          style={watchMenuStyles.panel}
        >
          <View style={watchMenuStyles.header}>
            <Text style={watchMenuStyles.title} accessibilityRole="header">
              Subtitles
            </Text>
            <Text style={watchMenuStyles.subtitle}>
              Choose a subtitle track
            </Text>
          </View>

          <ScrollView contentContainerStyle={watchMenuStyles.listContent}>
            {/* Off row — always present, always focusable, in every state. */}
            <WatchOptionRow
              icon="text-outline"
              label="Subtitles off"
              selected={!subtitleEnabled}
              hasTVPreferredFocus={!subtitleEnabled}
              onPress={() => {
                setSubtitleEnabled(false)
                onClose()
              }}
              accessibilityLabel="Subtitles off"
            />

            {/* loading: non-focusable status row. */}
            {panelState.kind === "loading" ? (
              <Text style={watchMenuStyles.status}>Loading…</Text>
            ) : null}

            {/* error: non-focusable status row (vs. a misleading empty list). */}
            {panelState.kind === "error" ? (
              <Text style={watchMenuStyles.status}>
                Couldn’t load subtitles
              </Text>
            ) : null}

            {/* loaded-empty: non-focusable status row. */}
            {panelState.kind === "loaded" &&
            panelState.subtitles.length === 0 ? (
              <Text style={watchMenuStyles.status}>No subtitles available</Text>
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
                    <WatchOptionRow
                      key={`subtitle-${subtitle.languageSlug ?? ""}-${index}`}
                      icon="text-outline"
                      label={name}
                      note={subtitle.languageNameNative}
                      selected={isActive}
                      hasTVPreferredFocus={isActive}
                      onPress={() => {
                        setActiveSubtitleSlug(subtitle.languageSlug)
                        setSubtitleEnabled(true)
                        onClose()
                      }}
                      accessibilityLabel={name}
                    />
                  )
                })
              : null}
          </ScrollView>

          {/* Dismiss affordance stays focusable in EVERY media state so the
              viewer is never trapped in a loading / error / empty panel. */}
          <View style={watchMenuStyles.footer}>
            <WatchOptionRow
              icon="close"
              label="Close"
              onPress={onClose}
              accessibilityLabel="Close"
            />
          </View>
        </TVFocusGuideView>
      </View>
    </Modal>
  )
}
