import { useEffect, useRef, useState } from "react"
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { GlassSurface, type GlassFallback } from "../ui/GlassSurface"

// The glyph fades in on a pause and out on a resume (owner, 2026-10-19). The
// glass dissolves over the same time as the glyph fades.
export const PAUSED_GLYPH_FADE_IN_MS = 150
export const PAUSED_GLYPH_FADE_OUT_MS = 250
const DISSOLVE_SECONDS = {
  in: PAUSED_GLYPH_FADE_IN_MS / 1000,
  out: PAUSED_GLYPH_FADE_OUT_MS / 1000,
}

const GLYPH_FALLBACK: GlassFallback = {
  kind: "fill",
  style: { backgroundColor: hexToRgba(BLACK, 0.45) },
}

type Glyph = {
  /** The key. Fabric iOS ignores React opacity on a view that a native fade
   *  drove, so each pause mounts fresh views. */
  id: number
  /** A new value per pause: a reset of a value that a native fade drove
   *  lands one frame late, so a new glyph would start at the old opacity. */
  fade: Animated.Value
  /** "entering" mounts the glass at the 'none' style, so it dissolves in. */
  phase: "entering" | "shown" | "leaving"
}

/**
 * The play glyph over a paused clip (R10). A tap on it resumes the clip with
 * Apple's press response; a tap anywhere else still reaches the feed's own
 * tap target. Screen readers use that target, so the glyph stays hidden.
 */
export function PausedGlyph({
  paused,
  style,
  onPress,
}: {
  paused: boolean
  /** Centres the glyph on the video region. */
  style?: StyleProp<ViewStyle>
  onPress: () => void
}) {
  const [glyph, setGlyph] = useState<Glyph | null>(null)
  const glyphRef = useRef<Glyph | null>(null)
  glyphRef.current = glyph
  const nextIdRef = useRef(0)
  const reduceMotion = useReduceMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion

  useEffect(() => {
    if (paused) {
      const snap = reduceMotionRef.current
      const fade = new Animated.Value(snap ? 1 : 0)
      nextIdRef.current += 1
      setGlyph({
        id: nextIdRef.current,
        fade,
        phase: snap ? "shown" : "entering",
      })
      if (!snap) {
        Animated.timing(fade, {
          toValue: 1,
          duration: PAUSED_GLYPH_FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start()
      }
      return
    }
    const current = glyphRef.current
    if (current == null) return
    if (reduceMotionRef.current) {
      setGlyph(null)
      return
    }
    setGlyph({ ...current, phase: "leaving" })
    Animated.timing(current.fade, {
      toValue: 0,
      duration: PAUSED_GLYPH_FADE_OUT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // A pause during the fade made a newer glyph; leave that one alone.
      if (finished) setGlyph((now) => (now?.fade === current.fade ? null : now))
    })
  }, [paused])

  // One render at the 'none' style, then 'regular', so the glass dissolves in.
  useEffect(() => {
    if (glyph?.phase !== "entering") return
    const fade = glyph.fade
    setGlyph((now) =>
      now?.fade === fade && now.phase === "entering"
        ? { ...now, phase: "shown" }
        : now,
    )
  }, [glyph])

  if (glyph == null) return null
  const leaving = glyph.phase === "leaving"
  return (
    <View
      key={glyph.id}
      testID="clip-paused-glyph"
      style={[styles.layer, style]}
      // Leaving, it takes no touch, so a quick second tap reaches the feed.
      pointerEvents={leaving ? "none" : "box-none"}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Pressable
        testID="clip-paused-glyph-button"
        onPress={onPress}
        accessible={false}
        {...{ "dd-action-name": "explore-resume-glyph" }}
      >
        {({ pressed }) => (
          <GlassSurface
            style={styles.glyph}
            fallback={GLYPH_FALLBACK}
            visible={glyph.phase === "shown"}
            dissolveSeconds={DISSOLVE_SECONDS}
            fade={glyph.fade}
            interactive
            pressed={pressed}
          >
            <Ionicons name="play" size={40} color={TEXT_ON_OVERLAY} />
          </GlassSurface>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
})
