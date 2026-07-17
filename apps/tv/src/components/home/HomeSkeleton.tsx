import { Dimensions, StyleSheet, View } from "react-native"

import { REFERENCE_WIDTH, scale } from "../../lib/scale"
import { HOME_CARD_THUMB_HEIGHT, HOME_CARD_WIDTH } from "./HomeCard"
import {
  COLUMN_WIDTH,
  HEAD_CARD_GAP,
  ITEM_GAP,
  RAIL_PADDING_LEFT,
} from "./HomeRail"
import {
  HERO_ACTION_HEIGHT,
  HERO_PADDING_BOTTOM,
  HERO_PADDING_LEFT,
  HERO_REGION_HEIGHT,
} from "./heroLayout"

// Placeholder fills — faint translucent white over the near-black home canvas.
// Static (no shimmer): an animated sweep adds RN Animated/Fabric risk for a view
// that lives <1s; the shimmer treatment is deferred (plan Open Q).
const HERO_ART = "rgba(255,255,255,0.08)"
const BLOCK = "rgba(255,255,255,0.13)"
const CARD = "rgba(255,255,255,0.08)"

// Mirror HomeRail's VISIBLE_COLUMNS (shared COLUMN_WIDTH + RAIL_PADDING_LEFT) plus
// one card so the rail bleeds off the right edge like a real one. Guard a 0-width
// module-load read (as scale.ts does) so cold launch never collapses to one card.
const SCREEN_WIDTH = Dimensions.get("window").width || REFERENCE_WIDTH
const CARD_COUNT =
  Math.ceil((SCREEN_WIDTH - RAIL_PADDING_LEFT) / COLUMN_WIDTH) + 1

/**
 * Non-focusable cold-launch placeholder, shown in the home "loading" branch in
 * place of the spinner. It holds NO focusable nodes (pointerEvents="none"), so
 * when the content branch mounts the hero's hasTVPreferredFocus claims focus
 * exactly as today (KTD2). Static blocks; layout mirrors the loaded home so it
 * fills the screen: full-bleed hero with bottom-left copy + a rail peek below.
 */
export function HomeSkeleton() {
  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <View style={[styles.bar, styles.kicker]} />
          <View style={[styles.bar, styles.titleLineOne]} />
          <View style={[styles.bar, styles.titleLineTwo]} />
          <View style={[styles.bar, styles.descriptionOne]} />
          <View style={[styles.bar, styles.descriptionTwo]} />
          <View style={styles.ctaRow}>
            <View style={[styles.bar, styles.cta]} />
            <View style={[styles.bar, styles.chevron]} />
          </View>
        </View>
      </View>

      <View style={styles.rail}>
        <View style={[styles.tile, styles.railEyebrow]} />
        <View style={[styles.tile, styles.railTitle]} />
        <View style={styles.cardRow}>
          {Array.from({ length: CARD_COUNT }, (_, i) => (
            <View key={i} style={[styles.tile, styles.card]} />
          ))}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  hero: {
    height: HERO_REGION_HEIGHT,
    justifyContent: "flex-end",
    paddingLeft: HERO_PADDING_LEFT,
    paddingBottom: HERO_PADDING_BOTTOM,
    backgroundColor: HERO_ART,
  },
  heroCopy: { maxWidth: scale(1060) },
  // Shared fills so a tone change edits one place: hero copy bars vs rail tiles.
  bar: { backgroundColor: BLOCK },
  tile: { backgroundColor: CARD },
  kicker: {
    width: scale(150),
    height: scale(18),
    borderRadius: scale(4),
    marginBottom: scale(18),
  },
  titleLineOne: {
    width: scale(760),
    height: scale(66),
    borderRadius: scale(10),
    marginBottom: scale(14),
  },
  titleLineTwo: {
    width: scale(520),
    height: scale(66),
    borderRadius: scale(10),
    marginBottom: scale(26),
  },
  descriptionOne: {
    width: scale(900),
    height: scale(20),
    borderRadius: scale(4),
    marginBottom: scale(12),
  },
  descriptionTwo: {
    width: scale(720),
    height: scale(20),
    borderRadius: scale(4),
    marginBottom: scale(30),
  },
  ctaRow: { flexDirection: "row", alignItems: "center" },
  cta: {
    width: scale(210),
    height: HERO_ACTION_HEIGHT,
    borderRadius: HERO_ACTION_HEIGHT / 2,
    marginRight: scale(20),
  },
  chevron: {
    width: HERO_ACTION_HEIGHT,
    height: HERO_ACTION_HEIGHT,
    borderRadius: HERO_ACTION_HEIGHT / 2,
  },
  rail: { flex: 1, paddingLeft: RAIL_PADDING_LEFT, paddingTop: scale(22) },
  railEyebrow: {
    width: scale(140),
    height: scale(16),
    borderRadius: scale(4),
    marginBottom: scale(10),
  },
  railTitle: {
    width: scale(320),
    height: scale(30),
    borderRadius: scale(6),
    marginBottom: HEAD_CARD_GAP,
  },
  cardRow: { flexDirection: "row" },
  card: {
    width: HOME_CARD_WIDTH,
    height: HOME_CARD_THUMB_HEIGHT,
    borderRadius: scale(12),
    marginRight: ITEM_GAP,
  },
})
