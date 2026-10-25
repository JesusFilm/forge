/**
 * R16's floor: when nothing is playable the reel shows the last-good queue's poster
 * art, crossfading on a slow beat. Deliberately no spinner and no error copy — the
 * shell keeps re-resolving behind this, and a walk-past viewer must never see a fault.
 */

import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useCallback, useEffect, useRef, useState } from "react"
import { Animated, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import { WATCH_THEME } from "../watch/watchDetailTheme"

/** Slow enough to read as ambient art rather than a slideshow demo. */
const STILL_DURATION_MS = 7000
const STILL_FADE_MS = 1200

const BRAND_MARK = "JESUS FILM WATCH"

type Slot = string | null

export type StillsSlideshowProps = {
  /** Deduped poster URLs from the last-good queue; may be empty (cold-start failure). */
  posters: string[]
}

export function StillsSlideshow({ posters }: StillsSlideshowProps) {
  const hasArt = posters.length > 0

  // Two-cell ring: the incoming cell fades up over the resting one, so the screen is
  // never blank mid-transition (HeroPager's shape, opacity-only for Android TV).
  const [slots, setSlots] = useState<[Slot, Slot]>(() => [
    posters[0] ?? null,
    null,
  ])
  const slotsRef = useRef<[Slot, Slot]>(slots)
  const frontRef = useRef<0 | 1>(0)
  const indexRef = useRef(0)
  const opRef = useRef([new Animated.Value(1), new Animated.Value(0)] as const)
  const postersRef = useRef(posters)
  postersRef.current = posters

  const paint = useCallback((cell: 0 | 1, url: Slot) => {
    const next: [Slot, Slot] =
      cell === 0 ? [url, slotsRef.current[1]] : [slotsRef.current[0], url]
    slotsRef.current = next
    setSlots(next)
  }, [])

  useEffect(() => {
    // One still can't rotate; keyed on the count so identity churn upstream can't
    // restart the beat mid-fade.
    if (postersRef.current.length < 2) return
    const timer = setInterval(() => {
      const all = postersRef.current
      const next = (indexRef.current + 1) % all.length
      indexRef.current = next
      const front = frontRef.current
      const back: 0 | 1 = front === 0 ? 1 : 0
      paint(back, all[next])
      opRef.current[back].setValue(0)
      Animated.parallel([
        Animated.timing(opRef.current[back], {
          toValue: 1,
          duration: STILL_FADE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opRef.current[front], {
          toValue: 0,
          duration: STILL_FADE_MS,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return
        frontRef.current = back
      })
    }, STILL_DURATION_MS)
    return () => clearInterval(timer)
  }, [posters.length, paint])

  useEffect(() => {
    const op = opRef.current
    return () => {
      op[0].stopAnimation()
      op[1].stopAnimation()
    }
  }, [])

  return (
    // collapsable={false}: Android TV paints the still-mounted VideoView over
    // flattened RN views, and this state must fully cover the frozen last frame.
    <View
      style={styles.root}
      pointerEvents="none"
      collapsable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {([0, 1] as const).map((cell) => {
        const url = slots[cell]
        return url != null ? (
          <Animated.View
            key={`still-cell-${cell}`}
            style={[StyleSheet.absoluteFill, { opacity: opRef.current[cell] }]}
            collapsable={false}
          >
            <Image
              source={{ uri: url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`stills-${url}`}
            />
          </Animated.View>
        ) : null
      })}

      {hasArt ? (
        <>
          <LinearGradient
            colors={[WATCH_THEME.scrim(0), WATCH_THEME.scrim(0.75)]}
            locations={[0, 1]}
            style={styles.brandScrim}
            pointerEvents="none"
          />
          <Text style={[styles.brandText, styles.brandCorner]}>
            {BRAND_MARK}
          </Text>
        </>
      ) : (
        // No art at all: centring the mark reads as a deliberate title card rather
        // than a stray label on a dead screen.
        <View style={styles.brandCenter}>
          <Text style={styles.brandText}>{BRAND_MARK}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: WATCH_THEME.below,
  },
  brandScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: scale(220),
  },
  brandCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  brandCorner: {
    position: "absolute",
    left: scale(80),
    bottom: scale(72),
  },
  brandText: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "600",
    letterSpacing: scale(4),
    color: WATCH_THEME.text50,
  },
})
