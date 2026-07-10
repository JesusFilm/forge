// Hero copy (eyebrow + title + description + meta) for one slide; purely
// presentational, one per slide cell in HeroPager. Description clamped to 3 lines
// with tail ellipsis so long CMS blurbs can't overrun the hero.

import { memo } from "react"
import { StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { WATCH_THEME } from "../watch/watchDetailTheme"

/** Description line height: fontSize 25 × 1.45. */
const DESCRIPTION_LINE_HEIGHT = Math.round(scale(36))

export const HeroCopyBlock = memo(function HeroCopyBlock({
  card,
}: {
  card: WatchHomeCard
}) {
  return (
    <View style={styles.block} pointerEvents="none">
      <Text style={styles.eyebrow} numberOfLines={1}>
        {card.label}
      </Text>
      <Text style={styles.title} numberOfLines={2}>
        {card.title}
      </Text>
      <Text style={styles.description} numberOfLines={3} ellipsizeMode="tail">
        {card.description ?? ""}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {card.metaLabel ?? ""}
      </Text>
    </View>
  )
})

const styles = StyleSheet.create({
  block: {
    maxWidth: scale(1100),
  },
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
  },
  meta: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
    marginTop: scale(12),
  },
})
