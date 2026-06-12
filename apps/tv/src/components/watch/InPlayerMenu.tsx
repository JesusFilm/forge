// In-player language (audio dub) / subtitle menu for the FULLSCREEN overlay
// player (R10, R11). Shown ONLY when the overlay's currently-playing URL is the
// watch session's active dub (the inPlayerMenuVisible gate in playerSwitch.ts) —
// so experience-card playback, which has no session, never mounts it.
//
// U8 split: the overlay has separate Language / Subtitles pills (mirroring the
// details page's two pickers), so this menu renders ONE section at a time via
// the `section` prop — the dub list OR the subtitle list, never both stacked.
//
// Unlike the on-page LanguagePanel/SubtitlePanel (which are React-Native Modals),
// this menu renders INSIDE the overlay's existing TVFocusGuideView focus trap as
// an absolutely-positioned overlay. It is itself a trapFocus* TVFocusGuideView
// while open, so D-pad stays within the menu and can't reach the chrome behind
// it. On close, the parent overlay restores focus to play/pause via a one-shot
// hasTVPreferredFocus (we don't own that flag — we signal close via onClose).
//
// Rows are the same WatchOptionRow the on-page sheets use (white-fill focus,
// red check, disabled "Unavailable"), and the chrome is watchMenuStyles — one
// design language across every watch menu. The dub section is a VIRTUALIZED
// FlatList (a video like the JESUS film carries ~2,259 dubs; mounting them all
// froze the menu open). Headings and rows are fixed-height, so getItemLayout +
// initialScrollIndex open the menu AT the active dub. The subtitle section is
// a plain ScrollView (typically tens of rows) mirroring SubtitlePanel's body.
//
// Rows reuse the SAME pure helpers as U6's on-page panels (panelState.ts):
//   - language rows: annotateVariantRows (hls==null → disabled, non-selectable),
//   - subtitle rows: deriveSubtitlePanelState (loading/error/empty/list).
// Writes go to the session (setActiveVariantIndex / setSubtitleEnabled /
// setActiveSubtitleSlug), which the overlay observes for live dub-switch +
// subtitle rendering. The Close affordance stays focusable in every state so the
// viewer is never trapped in a loading/error/empty menu.

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

  // Shared virtualized-list wiring (one-shot preferred focus, scroll-to-active,
  // fixed-height offsets). The menu unmounts on close, so each open is a fresh
  // mount and `visible` can stay at its default. headerHeight shifts the row
  // offsets below the in-list "Audio Language" heading.
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
    // Absolute-fill scrim INSIDE the overlay's content layer. Its own
    // trapFocus* TVFocusGuideView keeps D-pad within the menu while open; the
    // overlay's chrome (play/pause etc.) is non-focusable behind it because the
    // parent suppresses auto-hide and the menu owns focus.
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
