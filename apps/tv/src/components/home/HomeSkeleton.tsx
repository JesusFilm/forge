import { StyleSheet, View } from "react-native"

import { scale } from "../../lib/scale"

// Placeholder block fill — a faint translucent white over the near-black home
// background. Static (no shimmer): an animated sweep adds RN Animated/Fabric risk
// for a view that lives <1s; the shimmer treatment is deferred (plan Open Q).
const BLOCK = "rgba(255,255,255,0.07)"

const CARD_W = scale(214)
const CARD_H = scale(120)

/**
 * Non-focusable cold-launch placeholder, shown in the home "loading" branch in
 * place of the spinner. It holds NO focusable nodes (pointerEvents="none"), so
 * when the content branch mounts the hero's hasTVPreferredFocus claims focus
 * exactly as today (KTD2). Static blocks; layout echoes the hero + two rails.
 */
export function HomeSkeleton() {
  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.hero}>
        <View style={styles.kicker} />
        <View style={styles.title} />
        <View style={styles.meta} />
        <View style={styles.cta} />
      </View>
      {[0, 1].map((row) => (
        <View key={row} style={styles.rail}>
          <View style={styles.railLabel} />
          <View style={styles.cardRow}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={styles.card} />
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: scale(48) },
  hero: { paddingTop: scale(40), paddingBottom: scale(28) },
  kicker: {
    width: scale(120),
    height: scale(16),
    borderRadius: scale(4),
    backgroundColor: BLOCK,
    marginBottom: scale(16),
  },
  title: {
    width: scale(360),
    height: scale(56),
    borderRadius: scale(8),
    backgroundColor: BLOCK,
    marginBottom: scale(18),
  },
  meta: {
    width: scale(520),
    height: scale(18),
    borderRadius: scale(4),
    backgroundColor: BLOCK,
    marginBottom: scale(24),
  },
  cta: {
    width: scale(180),
    height: scale(52),
    borderRadius: scale(26),
    backgroundColor: BLOCK,
  },
  rail: { marginTop: scale(20) },
  railLabel: {
    width: scale(220),
    height: scale(22),
    borderRadius: scale(4),
    backgroundColor: BLOCK,
    marginBottom: scale(14),
  },
  cardRow: { flexDirection: "row" },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: scale(12),
    backgroundColor: BLOCK,
    marginRight: scale(16),
  },
})
