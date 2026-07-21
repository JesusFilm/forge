/**
 * R8's minimal chrome: a lower-third naming the excerpt at its start, decaying to a
 * small persistent language tag. Every string comes from a resolved model — never a
 * raw CMS field, and never `rawLabel`.
 *
 * On the language centerpiece the whole chapter is ONE excerpt played as dub hops, so the
 * title card reveals once (keyed on the stable excerpt id, not the per-hop swap token) and
 * the language tag CROSSFADES between languages on each hop — no title/chapter card
 * re-flashing. Ordinary excerpts each carry a unique id, so they still reveal per excerpt.
 */

import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import { useEffect, useRef, useState } from "react"
import { Animated, StyleSheet, Text, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { scale } from "../../lib/scale"
import { WATCH_THEME } from "../watch/watchDetailTheme"

/** Optically matched to the 24pt tag text — a hair larger reads as equal weight. */
const TAG_ICON_SIZE = Math.round(scale(26))

const CHROME_FADE_MS = 420
/** R8's "brief": the lower-third holds ~4s, then decays to the tag. */
const CHROME_HOLD_MS = 4000
/** The language tag's per-hop dissolve — near the audio crossfade so they read as one. */
const TAG_CROSSFADE_MS = 450

const META_SEPARATOR = "  ·  "

export type ExcerptChromeProps = {
  /** The excerpt's resolved title. */
  title: string
  /** The chapter's felt-need name; "" on a fallback reel, which has no labels. */
  feltNeed: string
  languageName: string | null
  /**
   * True only for a KTD-5 hop's mid-play dub switch; false on every ordinary excerpt.
   * Trust it — naming the language anyway would be a false claim.
   */
  claimsLanguage: boolean
  /**
   * Restarts the title-card reveal. The centerpiece keeps ONE id across all its dub hops,
   * so its card reveals once; ordinary excerpts' ids differ, so they reveal per excerpt.
   */
  restartKey: number | string
}

/** The pill's contents — a globe icon plus the language name. */
function PillBody({ language }: { language: string }) {
  return (
    <>
      <Ionicons
        name="globe-outline"
        size={TAG_ICON_SIZE}
        color={WATCH_THEME.text}
      />
      <Text style={styles.tagText} numberOfLines={1}>
        {language}
      </Text>
    </>
  )
}

export function ExcerptChrome({
  title,
  feltNeed,
  languageName,
  claimsLanguage,
  restartKey,
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
  }, [lowerThird, tag, reduceMotion, restartKey])

  // Per-hop language dissolve: the live pill shows `current`; on a hop the previous
  // language becomes `exiting`, a second pill stacked on top that fades out to reveal the
  // new one — a true crossfade, never a hard cut. Driven off refs (not the `current` state
  // dep) so setting current can't re-enter this effect and cancel the fade mid-flight. A
  // restartKey change (a new excerpt) or reduce-motion adopts the language with no fade.
  const [current, setCurrent] = useState<string | null>(claimedLanguage)
  const [exiting, setExiting] = useState<string | null>(null)
  const exitOpacity = useRef(new Animated.Value(0)).current
  const currentRef = useRef<string | null>(claimedLanguage)
  const restartKeyRef = useRef(restartKey)
  useEffect(() => {
    const previous = currentRef.current
    const sameExcerpt = restartKeyRef.current === restartKey
    restartKeyRef.current = restartKey
    if (claimedLanguage === previous) return

    currentRef.current = claimedLanguage
    setCurrent(claimedLanguage)

    const shouldCrossfade =
      sameExcerpt &&
      !reduceMotion &&
      previous != null &&
      claimedLanguage != null
    if (!shouldCrossfade) {
      setExiting(null)
      return
    }
    setExiting(previous)
    exitOpacity.setValue(1)
    const anim = Animated.timing(exitOpacity, {
      toValue: 0,
      duration: TAG_CROSSFADE_MS,
      useNativeDriver: true,
    })
    anim.start(({ finished }) => {
      if (finished) setExiting(null)
    })
    return () => anim.stop()
  }, [claimedLanguage, restartKey, reduceMotion, exitOpacity])

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

      {current != null ? (
        <Animated.View
          style={[styles.tag, { opacity: tag }]}
          collapsable={false}
        >
          <PillBody language={current} />
        </Animated.View>
      ) : null}
      {exiting != null ? (
        <Animated.View
          style={[styles.tag, { opacity: exitOpacity }]}
          collapsable={false}
        >
          <PillBody language={exiting} />
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
  // Anchored to the lower-third's optical edge so the copy decays in place. The exiting
  // pill shares this exact anchor, so the two dissolve over each other in one spot.
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
