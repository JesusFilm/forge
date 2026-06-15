// The Home billboard hero — a NON-INTERACTIVE copy block (eyebrow + title +
// description + meta) for whichever card the showcase reducer last committed,
// laid over the full-screen HomeBackdrop. Purely presentational: focus on the
// home screen lives entirely on the top bar tabs and the rails — the rail owns
// selection (press Select on a card to open it), so the hero carries no
// focusable chrome (tv-focus-driven-hero-patterns-20260420.md: non-interactive
// hero / rail owns focus).
//
// Layout: the hero region is the design's 700/1080 of the screen minus the
// in-flow top bar, with the billboard bottom-anchored via flexbox
// (justifyContent flex-end). The description is clamped to EXACTLY two lines
// with a fixed height so the layout never jumps as cards swap.

import { memo } from "react"
import { Dimensions, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { TOP_BAR_HEIGHT } from "./HomeTopBar"

/** The design's hero region: 700px of the 1080px canvas. */
const HERO_DESIGN_RATIO = 700 / 1080

/**
 * The top bar sits in flow above the scroll feed, so the in-content hero
 * region is the design height minus the bar — the billboard bottom still
 * lands 700-36 from the screen top at scroll 0.
 */
const HERO_REGION_HEIGHT =
  Math.round(Dimensions.get("window").height * HERO_DESIGN_RATIO) -
  TOP_BAR_HEIGHT

/** Description line metrics: fontSize 25 × 1.45 line-height, two lines. */
const DESCRIPTION_LINE_HEIGHT = Math.round(scale(36))

type HomeBillboardProps = {
  /** Null only for the first frame before the showcase seeds. */
  card: WatchHomeCard | null
}

export const HomeBillboard = memo(function HomeBillboard({
  card,
}: HomeBillboardProps) {
  return (
    <View style={styles.hero}>
      {card != null ? (
        // The whole hero is non-focusable: collapsable={false} keeps it a
        // discrete native view above the backdrop's media on Android TV.
        <View style={styles.billboard} pointerEvents="none" collapsable={false}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {card.label}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {card.title}
          </Text>
          {/* Fixed two-line block (empty when no description) so the layout
              never jumps as the showcase swaps cards. */}
          <Text style={styles.description} numberOfLines={2}>
            {card.description ?? ""}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {card.metaLabel ?? ""}
          </Text>
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  hero: {
    height: HERO_REGION_HEIGHT,
    justifyContent: "flex-end",
    paddingLeft: scale(80),
    paddingBottom: scale(36),
  },
  billboard: {
    maxWidth: scale(1100),
  },

  // ── Copy block ──
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(19)),
    fontWeight: "700",
    // .18em of the 19px eyebrow.
    letterSpacing: scale(3.4),
    textTransform: "uppercase",
    color: WATCH_THEME.accent,
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(80)),
    lineHeight: Math.round(scale(82)),
    fontWeight: "800",
    letterSpacing: -scale(1.5),
    color: WATCH_THEME.text,
    marginTop: scale(12),
    maxWidth: scale(1060),
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: scale(4) },
    textShadowRadius: scale(30),
  },
  description: {
    fontFamily: "System",
    fontSize: Math.round(scale(25)),
    lineHeight: DESCRIPTION_LINE_HEIGHT,
    fontWeight: "400",
    color: WATCH_THEME.text74,
    marginTop: scale(18),
    maxWidth: scale(920),
    height: DESCRIPTION_LINE_HEIGHT * 2,
  },
  meta: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
    marginTop: scale(12),
  },
})
