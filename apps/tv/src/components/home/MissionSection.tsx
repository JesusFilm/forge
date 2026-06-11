// The Home feed's closing band (R15): mission storytelling cards left
// (~60% of the band), the beta-signup QR right, inside one Crimson Gallery
// surface region. Nothing here performs an external-link action on-device —
// the QR is the only bridge off the TV.
//
// Exactly ONE focusable element: a non-actioning wrapper on the QR tile so
// D-pad traversal can pull the tail into view (the focus engine auto-scrolls
// to keep the focused element visible). It dispatches no card-focus events,
// so the showcase retains the last focused card automatically (R10/AE4). The
// wrapper sits in normal flexbox flow — never position:absolute on a
// focusable (react-native-tvos-porting-pitfalls-20260414.md §3).

import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"

import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import {
  MISSION_CARDS,
  MISSION_EYEBROW,
  MISSION_HEADLINE,
  QR_SCAN_HINT,
} from "./missionContent"
import { QrPanel } from "./QrPanel"

// Focusable but deliberately non-actioning (R15) — Select does nothing.
const NO_ACTION = () => {}

export function MissionSection() {
  const [qrFocused, setQrFocused] = useState(false)
  // State (not a ref) so the guide re-renders with its destination once the
  // QR node mounts — a plain ref leaves destinations empty on first render.
  const [qrNode, setQrNode] = useState<ViewType | null>(null)

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.eyebrow} numberOfLines={1}>
          {MISSION_EYEBROW}
        </Text>
        <Text
          style={styles.headline}
          numberOfLines={2}
          accessibilityRole="header"
        >
          {MISSION_HEADLINE}
        </Text>
      </View>

      {/* Full-width guide with an explicit destination: the QR sits right of
          the non-focusable text column, so down-moves from a left-positioned
          rail card have no horizontal projection overlap with it — autoFocus
          alone never catches the move (verified in sim). destinations is the
          app's established bridge for horizontally-offset focusables. */}
      <TVFocusGuideView
        autoFocus
        destinations={qrNode != null ? [qrNode] : undefined}
        style={styles.band}
      >
        <View style={styles.cardsColumn}>
          {MISSION_CARDS.map((card) => (
            <View key={`mission-card-${card.key}`} style={styles.card}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {card.title}
              </Text>
              <Text style={styles.cardBody}>{card.body}</Text>
            </View>
          ))}
        </View>

        <View style={styles.qrColumn}>
          <Pressable
            ref={setQrNode}
            onPress={NO_ACTION}
            onFocus={() => setQrFocused(true)}
            onBlur={() => setQrFocused(false)}
            accessibilityRole="button"
            accessibilityLabel="Beta signup QR code"
            accessibilityHint={QR_SCAN_HINT}
            style={[styles.qrFocusable, qrFocused && styles.qrFocused]}
          >
            <QrPanel />
          </Pressable>
        </View>
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  // Surface-container band — Crimson Gallery separates regions with
  // background shifts, never borders.
  container: {
    backgroundColor: COLORS.surfaceContainer,
    paddingVertical: scale(56),
    marginTop: scale(32),
  },
  head: {
    paddingHorizontal: scale(80),
    marginBottom: scale(36),
  },
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "700",
    letterSpacing: scale(1.8),
    textTransform: "uppercase",
    color: COLORS.primary,
    marginBottom: scale(8),
  },
  headline: {
    fontFamily: "System",
    fontSize: Math.round(scale(32)),
    fontWeight: "700",
    letterSpacing: -scale(0.4),
    color: COLORS.text,
    maxWidth: scale(1100),
  },
  band: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(80),
    gap: scale(56),
  },
  // ~60% of the band for the storytelling column (plan decision); the QR
  // column takes the rest.
  cardsColumn: {
    flex: 6,
    gap: scale(20),
  },
  card: {
    backgroundColor: COLORS.surfaceContainerHigh,
    borderRadius: scale(16),
    paddingHorizontal: scale(28),
    paddingVertical: scale(24),
  },
  cardTitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: scale(8),
  },
  cardBody: {
    fontFamily: "System",
    fontSize: Math.round(scale(19)),
    lineHeight: Math.round(scale(28)),
    color: COLORS.muted,
  },
  qrColumn: {
    flex: 4,
    alignItems: "center",
  },
  // Subtle ring: padding gives the glow room; focus lifts the tone one
  // surface step and adds a soft crimson glow — quieter than a card's
  // 1.05x lift since Select does nothing here.
  qrFocusable: {
    borderRadius: scale(24),
    padding: scale(24),
    backgroundColor: COLORS.surfaceContainerHigh,
  },
  qrFocused: {
    backgroundColor: COLORS.surfaceContainerHighest,
    transform: [{ scale: 1.02 }],
    shadowColor: COLORS.primary,
    shadowRadius: scale(20),
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 },
  },
})
