// In-player dub/subtitle menu for the FULLSCREEN overlay player (R10/R11). Shown
// ONLY when the playing URL is the session's active dub (inPlayerMenuVisible gate
// in playerSwitch.ts), so session-less experience-card playback never mounts it.
// U8 split: renders ONE section at a time via the `section` prop (dub OR
// subtitle, never stacked).
//
// Renders inside the overlay's TVFocusGuideView as its own trapFocus* overlay,
// so D-pad stays in the menu; on close the parent restores play/pause focus
// (we signal via onClose). Dub section is a VIRTUALIZED fixed-height FlatList (a
// video like JESUS carries ~2,259 dubs — mounting all froze the menu); subtitle
// section is a plain ScrollView.
//
// Rows reuse U6's pure helpers (panelState.ts): annotateVariantRows (hls==null →
// disabled) for language, deriveSubtitlePanelState for subtitles. Writes go to
// the session, which the overlay observes for live switching. Close stays
// focusable in every state so the viewer is never trapped.

import { useEffect, useMemo } from "react"
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import {
  annotateVariantRows,
  deriveSubtitlePanelState,
  isSubtitleRowActive,
} from "./panelState"
import { useVariantList } from "./useVariantList"
import { MENU_HEADING_HEIGHT } from "./watchMenuLayout"
import { WatchOptionRow } from "./WatchOptionRow"
import { watchMenuStyles } from "./watchMenuStyles"
import type { InPlayerMenuSection } from "./useSessionPlayback"

export function InPlayerMenu({
  section,
  onClose,
}: {
  section: InPlayerMenuSection
  onClose: () => void
}) {
  const {
    video,
    activeVariantIndex,
    setActiveVariantIndex,
    activeVariantMediaState,
    ensureActiveVariantMedia,
    subtitleEnabled,
    setSubtitleEnabled,
    activeSubtitleSlug,
    setActiveSubtitleSlug,
  } = useWatchSession()

  // Lazy-fetch the active dub's media (subtitles) when the subtitle section
  // mounts — the menu only mounts while open, so this is the "on open"
  // trigger. The language section doesn't need per-dub media.
  useEffect(() => {
    if (section === "subtitles") ensureActiveVariantMedia()
  }, [section, ensureActiveVariantMedia])

  const languageRows = useMemo(
    () => annotateVariantRows(video?.variants ?? [], activeVariantIndex),
    [video?.variants, activeVariantIndex],
  )

  const subtitleState = deriveSubtitlePanelState(activeVariantMediaState)

  // Shared virtualized-list wiring (preferred focus, scroll-to-active, offsets).
  // Menu unmounts on close, so each open is a fresh mount (`visible` stays
  // default); headerHeight shifts row offsets below the "Audio Language" heading.
  const {
    listRef,
    renderRow,
    keyExtractor,
    getItemLayout,
    initialScrollIndex,
  } = useVariantList({
    rows: languageRows,
    onSelect: setActiveVariantIndex,
    onClose,
    headerHeight: MENU_HEADING_HEIGHT,
  })

  return (
    // Absolute-fill scrim inside the overlay's content layer; its trapFocus*
    // TVFocusGuideView keeps D-pad in the menu. Chrome behind is non-focusable
    // because the parent suppresses auto-hide and the menu owns focus.
    <View style={styles.scrim}>
      <TVFocusGuideView
        autoFocus
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        style={watchMenuStyles.panel}
      >
        {section === "language" ? (
          // ── Language: virtualized dub list (opens AT the active dub) ────
          <FlatList
            ref={listRef}
            data={languageRows}
            renderItem={renderRow}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            initialScrollIndex={initialScrollIndex}
            initialNumToRender={14}
            windowSize={7}
            showsVerticalScrollIndicator={false}
            style={watchMenuStyles.list}
            contentContainerStyle={watchMenuStyles.listContent}
            ListHeaderComponent={
              <View style={styles.headingBox}>
                <Text style={watchMenuStyles.title} accessibilityRole="header">
                  Audio Language
                </Text>
              </View>
            }
          />
        ) : (
          // ── Subtitles: small list, mirrors SubtitlePanel's body ─────────
          <>
            <View style={styles.headingBox}>
              <Text style={watchMenuStyles.title} accessibilityRole="header">
                Subtitles
              </Text>
            </View>
            <ScrollView
              style={watchMenuStyles.list}
              contentContainerStyle={watchMenuStyles.listContent}
              showsVerticalScrollIndicator={false}
            >
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
              {subtitleState.kind === "loading" ? (
                <Text style={watchMenuStyles.status}>Loading…</Text>
              ) : null}

              {/* error: non-focusable status row (vs. a misleading empty list). */}
              {subtitleState.kind === "error" ? (
                <Text style={watchMenuStyles.status}>
                  Couldn’t load subtitles
                </Text>
              ) : null}

              {/* loaded-empty: non-focusable status row. */}
              {subtitleState.kind === "loaded" &&
              subtitleState.subtitles.length === 0 ? (
                <Text style={watchMenuStyles.status}>
                  No subtitles available
                </Text>
              ) : null}

              {/* loaded-list: focusable, slug-keyed subtitle rows. */}
              {subtitleState.kind === "loaded"
                ? subtitleState.subtitles.map((subtitle, index) => {
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
          </>
        )}

        {/* Dismiss affordance stays focusable in EVERY state so the viewer is
            never trapped. Closing returns focus to play/pause via the parent's
            one-shot hasTVPreferredFocus. */}
        <View style={watchMenuStyles.footer}>
          <WatchOptionRow
            icon="close"
            label="Close"
            onPress={onClose}
            accessibilityLabel="Close menu"
          />
        </View>
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  // Absolute-fill scrim sits ABOVE the overlay's chrome (zIndex within the
  // contentLayer). hexToRgba(_, 0.8) — never the string "transparent".
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: hexToRgba("#000000", 0.8),
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  // Fixed-height heading container (MENU_HEADING_HEIGHT, watchMenuLayout.ts)
  // so the dub FlatList's getItemLayout offsets stay exact below the header.
  headingBox: {
    height: MENU_HEADING_HEIGHT,
    justifyContent: "flex-end",
    paddingBottom: scale(12),
    paddingHorizontal: scale(20),
  },
})
