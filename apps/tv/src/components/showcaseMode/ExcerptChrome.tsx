/**
 * R8's minimal chrome: a lower-third naming the excerpt at its start, decaying to a
 * small persistent language tag. Every string comes from a resolved model — never a
 * raw CMS field, and never `rawLabel`.
 */

import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import { useEffect, useRef } from "react"
import { Animated, StyleSheet, Text, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { scale } from "../../lib/scale"
import { WATCH_THEME } from "../watch/watchDetailTheme"

/** Optically matched to the 24pt tag text — a hair larger reads as equal weight. */
const TAG_ICON_SIZE = Math.round(scale(26))

const CHROME_FADE_MS = 420
/** R8's "brief": the lower-third holds ~4s, then decays to the tag. */
const CHROME_HOLD_MS = 4000

const META_SEPARATOR = "  ·  "

export type ExcerptChromeProps = {
  /** The excerpt's resolved title. */
  title: string
  /** The chapter's felt-need name; "" on a fallback reel, which has no labels. */
  feltNeed: string
  languageName: string | null
  /**
   * AE4: false when the language did not actually rotate (single-language video, or a
   * forced repeat). Trust it — naming the language anyway would be a false claim.
   */
  claimsLanguage: boolean
  /** Restarts the reveal on each new excerpt (reelState's source-swap token). */
  excerptToken: number
}

export function ExcerptChrome({
  title,
  feltNeed,
  languageName,
  claimsLanguage,
  excerptToken,
}: ExcerptChromeProps) {
  const reduceMotion = useReduceMotion()
  const lowerThird = useRef(new Animated.Value(0)).current
  const tag = useRef(new Animated.Value(0)).current

  const claimedLanguage = claimsLanguage ? languageName : null
  const meta = [feltNeed, claimedLanguage]
    .filter((part): part is string => part != null && part.trim().length > 0)
    .join(META_SEPARATOR)

  useEffect(() => {
    if (reduceMotion) {
      // Reduce motion still gets the decay, just without the dissolve — the
      // lower-third is transient copy, not something to pin over the film.
      lowerThird.setValue(1)
      tag.setValue(0)
      const timer = setTimeout(() => {
        lowerThird.setValue(0)
        tag.setValue(1)
      }, CHROME_HOLD_MS)
      return () => clearTimeout(timer)
    }
    lowerThird.setValue(0)
    tag.setValue(0)
    // One-shot sequence, not a loop: Animated.loop(Animated.sequence(...)) runs once
    // on Fabric. A plain sequence is safe and is VideoBackdrop's poster-hold shape.
    const anim = Animated.sequence([
      Animated.timing(lowerThird, {
        toValue: 1,
        duration: CHROME_FADE_MS,
        useNativeDriver: true,
      }),
      Animated.delay(CHROME_HOLD_MS),
      Animated.timing(lowerThird, {
        toValue: 0,
        duration: CHROME_FADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(tag, {
        toValue: 1,
        duration: CHROME_FADE_MS,
        useNativeDriver: true,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [lowerThird, tag, reduceMotion, excerptToken])

  return (
    <View
      style={styles.root}
      pointerEvents="none"
      collapsable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[styles.lowerThird, { opacity: lowerThird }]}
        collapsable={false}
      >
        <LinearGradient
          colors={[
            WATCH_THEME.scrim(0),
            WATCH_THEME.scrim(0.55),
            WATCH_THEME.scrim(0.85),
          ]}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.lowerThirdCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {meta.length > 0 ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Animated.View>

      {claimedLanguage != null ? (
        <Animated.View
          style={[styles.tag, { opacity: tag }]}
          collapsable={false}
        >
          <Ionicons
            name="globe-outline"
            size={TAG_ICON_SIZE}
            color={WATCH_THEME.text}
          />
          <Text style={styles.tagText} numberOfLines={1}>
            {claimedLanguage}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  lowerThird: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: scale(340),
    justifyContent: "flex-end",
  },
  lowerThirdCopy: {
    paddingHorizontal: scale(80),
    paddingBottom: scale(72),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(40)),
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
  meta: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "500",
    color: WATCH_THEME.text74,
    marginTop: scale(10),
  },
  // Anchored to the lower-third's optical edge so the copy decays in place.
  tag: {
    position: "absolute",
    left: scale(80),
    bottom: scale(72),
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
    paddingHorizontal: scale(20),
    paddingVertical: scale(10),
    borderRadius: scale(10),
    // Near-black, NOT the theme's translucent-white badgeBg: that chip sits on a
    // controlled scrim, while the reel plays whatever the film is graded like —
    // white-on-white vanished it. Dark holds white text on any frame.
    backgroundColor: WATCH_THEME.scrim(0.75),
  },
  tagText: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
    // Full white, not text82: this rides live film, not a fixed dark surface.
    color: WATCH_THEME.text,
  },
})
