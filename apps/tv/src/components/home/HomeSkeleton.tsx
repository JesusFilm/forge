import { Dimensions, StyleSheet, View } from "react-native"

import { scale } from "../../lib/scale"
import { HOME_CARD_THUMB_HEIGHT, HOME_CARD_WIDTH } from "./HomeCard"
import {
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

const CARD_GAP = scale(28)

// One more full-size card than fits, so the rail bleeds off the right edge like a
// real one — mirrors HomeRail's edge-to-edge fill instead of a boxed-in row.
const CARD_COUNT =
  Math.ceil(Dimensions.get("window").width / (HOME_CARD_WIDTH + CARD_GAP)) + 1

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
          <View style={styles.kicker} />
          <View style={styles.titleLineOne} />
          <View style={styles.titleLineTwo} />
          <View style={styles.descriptionOne} />
          <View style={styles.descriptionTwo} />
          <View style={styles.ctaRow}>
            <View style={styles.cta} />
            <View style={styles.chevron} />
          </View>
        </View>
      </View>

      <View style={styles.rail}>
        <View style={styles.railEyebrow} />
        <View style={styles.railTitle} />
        <View style={styles.cardRow}>
          {Array.from({ length: CARD_COUNT }, (_, i) => (
            <View key={i} style={styles.card} />
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
  kicker: {
    width: scale(150),
    height: scale(18),
    borderRadius: scale(4),
    backgroundColor: BLOCK,
    marginBottom: scale(18),
  },
  titleLineOne: {
    width: scale(760),
    height: scale(66),
    borderRadius: scale(10),
    backgroundColor: BLOCK,
    marginBottom: scale(14),
  },
  titleLineTwo: {
    width: scale(520),
    height: scale(66),
    borderRadius: scale(10),
    backgroundColor: BLOCK,
    marginBottom: scale(26),
  },
  descriptionOne: {
    width: scale(900),
    height: scale(20),
    borderRadius: scale(4),
    backgroundColor: BLOCK,
    marginBottom: scale(12),
  },
  descriptionTwo: {
    width: scale(720),
    height: scale(20),
    borderRadius: scale(4),
    backgroundColor: BLOCK,
    marginBottom: scale(30),
  },
  ctaRow: { flexDirection: "row", alignItems: "center" },
  cta: {
    width: scale(210),
    height: scale(62),
    borderRadius: scale(31),
    backgroundColor: BLOCK,
    marginRight: scale(20),
  },
  chevron: {
    width: scale(62),
    height: scale(62),
    borderRadius: scale(31),
    backgroundColor: BLOCK,
  },
  rail: { flex: 1, paddingLeft: scale(80), paddingTop: scale(22) },
  railEyebrow: {
    width: scale(140),
    height: scale(16),
    borderRadius: scale(4),
    backgroundColor: CARD,
    marginBottom: scale(10),
  },
  railTitle: {
    width: scale(320),
    height: scale(30),
    borderRadius: scale(6),
    backgroundColor: CARD,
    marginBottom: scale(22),
  },
  cardRow: { flexDirection: "row" },
  card: {
    width: HOME_CARD_WIDTH,
    height: HOME_CARD_THUMB_HEIGHT,
    borderRadius: scale(12),
    backgroundColor: CARD,
    marginRight: CARD_GAP,
  },
})
