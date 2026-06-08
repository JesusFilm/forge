// In-player language (audio dub) + subtitle menu for the FULLSCREEN overlay
// player (R10, R11). Shown ONLY when the overlay's currently-playing URL is the
// watch session's active dub (the inPlayerMenuVisible gate in playerSwitch.ts) —
// so experience-card playback, which has no session, never mounts it.
//
// Unlike the on-page LanguagePanel/SubtitlePanel (which are React-Native Modals),
// this menu renders INSIDE the overlay's existing TVFocusGuideView focus trap as
// an absolutely-positioned overlay. It is itself a trapFocus* TVFocusGuideView
// while open, so D-pad stays within the menu and can't reach the chrome behind
// it. On close, the parent overlay restores focus to play/pause via a one-shot
// hasTVPreferredFocus (we don't own that flag — we signal close via onClose).
//
// Rows reuse the SAME pure helpers as U6's on-page panels (panelState.ts):
//   - language rows: annotateVariantRows (hls==null → disabled, non-selectable),
//   - subtitle rows: deriveSubtitlePanelState (loading/error/empty/list).
// Writes go to the session (setActiveVariantIndex / setSubtitleEnabled /
// setActiveSubtitleSlug), which the overlay observes for live dub-switch +
// subtitle rendering. The Close affordance stays focusable in every state so the
// viewer is never trapped in a loading/error/empty menu.

import { useEffect } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { type DubMediaState } from "../../contexts/watchSessionState"
import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { FocusableCard } from "../FocusableCard"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import {
  annotateVariantRows,
  deriveSubtitlePanelState,
  isSubtitleRowActive,
} from "./panelState"

export function InPlayerMenu({ onClose }: { onClose: () => void }) {
  const {
    video,
    activeVariantIndex,
    setActiveVariantIndex,
    activeVariantMedia,
    activeVariantMediaLoading,
    activeVariantMediaError,
    ensureActiveVariantMedia,
    subtitleEnabled,
    setSubtitleEnabled,
    activeSubtitleSlug,
    setActiveSubtitleSlug,
  } = useWatchSession()

  // Lazy-fetch the active dub's media (subtitles) once the menu is mounted —
  // the menu only mounts while open, so this is the "on open" trigger.
  useEffect(() => {
    ensureActiveVariantMedia()
  }, [ensureActiveVariantMedia])

  const languageRows = annotateVariantRows(
    video?.variants ?? [],
    activeVariantIndex,
  )

  const mediaState: DubMediaState = {
    media: activeVariantMedia,
    loading: activeVariantMediaLoading,
    error: activeVariantMediaError,
  }
  const subtitleState = deriveSubtitlePanelState(mediaState)

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
        style={styles.panel}
      >
        <ScrollView contentContainerStyle={styles.listContent}>
          {/* ── Audio Language ────────────────────────────────────────── */}
          <Text style={styles.heading} accessibilityRole="header">
            Audio Language
          </Text>
          {languageRows.map((row) => {
            const { variant, index, disabled, active } = row
            const name =
              variant.languageName ?? variant.languageSlug ?? variant.slug
            const native = variant.languageNameNative
              ? `  ·  ${variant.languageNameNative}`
              : ""

            // Unplayable dub (no HLS): inert, non-focusable, muted — the D-pad
            // skips it so the viewer can't select an unplayable language.
            if (disabled) {
              return (
                <View
                  key={variant.documentId || `variant-${index}`}
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
                key={variant.documentId || `variant-${index}`}
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

          {/* ── Subtitles ─────────────────────────────────────────────── */}
          <Text style={[styles.heading, styles.headingGap]}>Subtitles</Text>

          {/* Off row — always present, always focusable, in every state. */}
          <FocusableCard
            onPress={() => {
              setSubtitleEnabled(false)
              onClose()
            }}
            focusScale={1.02}
            style={styles.row}
            accessibilityLabel="Subtitles off"
          >
            <View style={styles.rowInner}>
              <Text style={styles.rowText}>Subtitles off</Text>
              {!subtitleEnabled ? (
                <Text style={styles.check}>{"✓"}</Text>
              ) : null}
            </View>
          </FocusableCard>

          {/* loading: non-focusable status row. */}
          {subtitleState.kind === "loading" ? (
            <Text style={styles.status}>Loading…</Text>
          ) : null}

          {/* error: non-focusable status row (vs. a misleading empty list). */}
          {subtitleState.kind === "error" ? (
            <Text style={styles.status}>Couldn’t load subtitles</Text>
          ) : null}

          {/* loaded-empty: non-focusable status row. */}
          {subtitleState.kind === "loaded" &&
          subtitleState.subtitles.length === 0 ? (
            <Text style={styles.status}>No subtitles available</Text>
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
                      {isActive ? (
                        <Text style={styles.check}>{"✓"}</Text>
                      ) : null}
                    </View>
                  </FocusableCard>
                )
              })
            : null}
        </ScrollView>

        {/* Dismiss affordance stays focusable in EVERY state so the viewer is
            never trapped. Closing returns focus to play/pause via the parent's
            one-shot hasTVPreferredFocus. */}
        <FocusableCard
          onPress={onClose}
          focusScale={1.02}
          style={styles.closeRow}
          accessibilityLabel="Close menu"
        >
          <Text style={styles.closeText}>Close</Text>
        </FocusableCard>
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
  panel: {
    width: scale(640),
    maxHeight: scale(860),
    backgroundColor: COLORS.surfaceContainer,
    borderRadius: scale(24),
    padding: scale(40),
  },
  listContent: {
    paddingBottom: scale(8),
  },
  heading: {
    fontFamily: "System",
    fontSize: Math.round(scale(30)),
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: scale(20),
  },
  headingGap: {
    marginTop: scale(28),
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
    paddingVertical: scale(16),
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
