// The Home feed's closing band (R15): mission storytelling cards left
// (~60% of the band), the beta-signup QR right. The band wears the shared
// mission "wash" (burgundy → purple → ember) so it reads in the same colourful
// language as the mobile rail (HomeMissionSection) and web promo
// (WatchHomePromo) — not the flat Crimson Gallery surface it used before.
// Nothing here performs an external-link action on-device — the QR is the only
// bridge off the TV.
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
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"

import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import {
  MISSION_CARDS,
  MISSION_EYEBROW,
  MISSION_HEADLINE,
  MISSION_WASH,
  QR_SCAN_HINT,
} from "./missionContent"
import { QrPanel } from "./QrPanel"

// Focusable but deliberately non-actioning (R15) — Select does nothing.
const NO_ACTION = () => {}

// Diagonal stops for every wash in the band — top-left → bottom-right, the
// 135° web promo uses.
const WASH_START = { x: 0, y: 0 } as const
const WASH_END = { x: 1, y: 1 } as const

// Section wash drawn over the band's deep base. Kept close to web's subtle
// 0.6/0.2/0.1 alphas so the colour reads without overpowering the band — more
// transparent here lets the dark base show through, keeping the background
// restrained while the per-card washes carry the colour.
const SECTION_WASH = [
  hexToRgba(MISSION_WASH.burgundy, 0.58),
  hexToRgba(MISSION_WASH.purple, 0.28),
  hexToRgba(MISSION_WASH.ember, 0.15),
] as const

type MissionSectionProps = {
  /** Fires when the QR tile gains focus — the home screen scrolls the tail
      into view itself now that the ScrollView's native focus-scroll is off. */
  onQrFocus?: () => void
}

export function MissionSection({ onQrFocus }: MissionSectionProps) {
  const [qrFocused, setQrFocused] = useState(false)
  // State (not a ref) so the guide re-renders with its destination once the
  // QR node mounts — a plain ref leaves destinations empty on first render.
  const [qrNode, setQrNode] = useState<ViewType | null>(null)

  return (
    <View style={styles.container}>
      {/* Colourful section wash behind everything — non-interactive. */}
      <LinearGradient
        colors={SECTION_WASH}
        locations={[0, 0.52, 1]}
        start={WASH_START}
        end={WASH_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

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
              {/* Per-card diagonal wash + faint watermark icon — mirrors the
                  mobile rail's gradient cards. */}
              <LinearGradient
                colors={[
                  hexToRgba(card.wash[0], 0.82),
                  hexToRgba(card.wash[1], 0.42),
                ]}
                start={WASH_START}
                end={WASH_END}
                style={styles.cardWash}
              />
              <Ionicons
                name={card.icon}
                size={scale(92)}
                color="rgba(255,255,255,0.13)"
                style={styles.cardIcon}
              />
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
            onFocus={() => {
              setQrFocused(true)
              onQrFocus?.()
            }}
            onBlur={() => setQrFocused(false)}
            // role "image", not "button": the tile is focusable only so D-pad
            // traversal can scroll the tail into view — Select does nothing
            // (NO_ACTION). "button" would tell a screen reader it is
            // actionable; "image" honestly names it (a QR you scan).
            accessibilityRole="image"
            accessibilityLabel="Beta signup QR code"
            accessibilityHint={QR_SCAN_HINT}
            style={[styles.qrFocusable, qrFocused && styles.qrFocused]}
          >
            {/* Frosted ember→burgundy wash behind the beta card, clipped to the
                card radius (borderRadius on the gradient, not overflow:hidden,
                so the focus glow shadow isn't clipped). */}
            <LinearGradient
              colors={[
                hexToRgba(MISSION_WASH.ember, 0.34),
                hexToRgba(MISSION_WASH.burgundy, 0.6),
              ]}
              start={WASH_START}
              end={WASH_END}
              style={styles.qrWash}
            />
            <QrPanel />
          </Pressable>
        </View>
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  // Deep near-black plum base under the section wash. Darker than before so
  // the more-transparent wash reads as a restrained tint, not a bright band.
  container: {
    backgroundColor: "#0c080c",
    paddingVertical: scale(56),
    marginTop: scale(32),
    overflow: "hidden",
  },
  head: {
    paddingHorizontal: scale(80),
    marginBottom: scale(36),
  },
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "700",
    letterSpacing: scale(2.6),
    textTransform: "uppercase",
    // Light red — the same eyebrow tone the mobile rail + web promo use.
    color: "rgba(254,226,226,0.82)",
    marginBottom: scale(12),
  },
  headline: {
    fontFamily: "System",
    fontSize: Math.round(scale(44)),
    fontWeight: "800",
    letterSpacing: -scale(0.6),
    color: COLORS.text,
    maxWidth: scale(1180),
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: scale(2) },
    textShadowRadius: scale(16),
  },
  band: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: scale(80),
    gap: scale(56),
  },
  // ~60% of the band for the storytelling column (plan decision); the QR
  // column takes the rest.
  cardsColumn: {
    flex: 6,
    gap: scale(20),
  },
  // Frosted translucent card; the per-card gradient wash paints over this base
  // and the white hairline matches the mobile/web card border.
  card: {
    borderRadius: scale(18),
    paddingHorizontal: scale(30),
    paddingVertical: scale(26),
    paddingRight: scale(96),
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  cardWash: {
    ...StyleSheet.absoluteFillObject,
  },
  cardIcon: {
    position: "absolute",
    top: scale(16),
    right: scale(22),
  },
  cardTitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(27)),
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: scale(10),
  },
  cardBody: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    lineHeight: Math.round(scale(31)),
    // Bright body text — the old COLORS.muted (#A8A29E) read as the "bland"
    // grey the redesign is fixing.
    color: "rgba(245,245,244,0.84)",
  },
  qrColumn: {
    flex: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  // Frosted beta card: a translucent white panel (matches the mission cards)
  // with the ember→burgundy wash behind the QR. The border width is constant
  // so focus only changes its colour (no reflow); focus turns it into the
  // WATCH_THEME white ring — matching Home cards and the watch detail page,
  // not a crimson glow.
  qrFocusable: {
    borderRadius: scale(24),
    padding: scale(28),
    overflow: "visible",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: scale(3),
    borderColor: "rgba(255,255,255,0.12)",
  },
  qrWash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(24),
  },
  qrFocused: {
    backgroundColor: "rgba(255,255,255,0.12)",
    // White ring + neutral dark shadow (the WATCH_THEME focus look).
    borderColor: "rgba(255,255,255,0.9)",
    transform: [{ scale: 1.02 }],
    shadowColor: "#000000",
    shadowRadius: scale(22),
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: scale(10) },
  },
})
