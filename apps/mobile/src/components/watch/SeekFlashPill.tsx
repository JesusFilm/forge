import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react"
import { Animated, Easing, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useT } from "../../i18n/useT"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { PLAYER_BAR_PADDING_H } from "../../lib/playerLayout"
import type { SeekSide } from "../../lib/tapSeek"
import { GlassSurface, type GlassFallback } from "../ui/GlassSurface"

// The skip-amount pill's look where Liquid Glass is unavailable.
const SEEK_FLASH_FALLBACK: GlassFallback = {
  kind: "fill",
  style: { backgroundColor: hexToRgba(BLACK, 0.55) },
}

// The skip pill appears at once, holds, then fades out (owner, 2026-10-16).
// The glass dissolves over the same time as the label fades.
const SEEK_FLASH_HOLD_MS = 600
const SEEK_FLASH_FADE_MS = 250
const SEEK_FLASH_DISSOLVE = { in: 0, out: SEEK_FLASH_FADE_MS / 1000 }

type SeekFlash = {
  /** The pill's key. Fabric iOS ignores React opacity on a view that a native
   *  fade drove, so each flash mounts fresh views. */
  id: number
  side: SeekSide
  delta: number
  /** A new value per flash: a reset of a value that a native fade drove
   *  lands one frame late, so a new pill would start dim. */
  fade: Animated.Value
  leaving: boolean
}

export type SeekFlashPillHandle = {
  /** Shows the pill for a `delta`-second seek on the tapped side. */
  show: (side: SeekSide, delta: number) => void
}

// The pill's outer edge aligns with the time pill and the fullscreen button.
// In fullscreen it clears the side notch, as the bottom bar does. On a narrow
// player it can overlap the skip buttons (owner, 2026-10-16).
function edgeInset(fullscreen: boolean, notch: number): number {
  return fullscreen
    ? Math.max(notch, PLAYER_BAR_PADDING_H)
    : PLAYER_BAR_PADDING_H
}

/**
 * The ±10 s pill a double tap on the video shows. It owns its state, so its
 * hold and fade re-render only the pill, not the player. It never takes a
 * touch from the video beneath it.
 */
export function SeekFlashPill({
  fullscreen,
  ref,
}: {
  fullscreen: boolean
  ref?: Ref<SeekFlashPillHandle>
}) {
  const t = useT("Player")
  const insets = useSafeAreaInsets()
  const [flash, setFlash] = useState<SeekFlash | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextIdRef = useRef(0)
  const reduceMotion = useReduceMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      show: (side, delta) => {
        const fade = new Animated.Value(1)
        nextIdRef.current += 1
        setFlash({ id: nextIdRef.current, side, delta, fade, leaving: false })
        if (timerRef.current) clearTimeout(timerRef.current)
        // Each update checks `fade`, so a late step never changes a newer pill.
        const ifCurrent = (next: (current: SeekFlash) => SeekFlash | null) =>
          setFlash((current) =>
            current?.fade === fade ? next(current) : current,
          )
        timerRef.current = setTimeout(() => {
          if (reduceMotionRef.current) {
            ifCurrent(() => null)
            return
          }
          ifCurrent((current) => ({ ...current, leaving: true }))
          Animated.timing(fade, {
            toValue: 0,
            duration: SEEK_FLASH_FADE_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) ifCurrent(() => null)
          })
        }, SEEK_FLASH_HOLD_MS)
      },
    }),
    [],
  )

  if (flash == null) return null
  const edge =
    flash.side === "left"
      ? { left: edgeInset(fullscreen, insets.left) }
      : { right: edgeInset(fullscreen, insets.right) }

  return (
    <View
      key={flash.id}
      testID="seek-flash"
      pointerEvents="none"
      style={[styles.seekFlash, edge]}
    >
      <GlassSurface
        style={styles.pill}
        fallback={SEEK_FLASH_FALLBACK}
        visible={!flash.leaving}
        dissolveSeconds={SEEK_FLASH_DISSOLVE}
        fade={flash.fade}
      >
        {/* One box, so the icon stays centered over the label inside the
            fade view that glass puts around the children. */}
        <View style={styles.content}>
          <Ionicons
            name={flash.delta < 0 ? "play-back" : "play-forward"}
            size={22}
            color={TEXT_ON_OVERLAY}
          />
          <Text style={styles.text}>
            {t("seekSeconds", { seconds: Math.abs(flash.delta) })}
          </Text>
        </View>
      </GlassSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  seekFlash: {
    position: "absolute",
    top: "50%",
    marginTop: -28,
  },
  pill: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  content: {
    alignItems: "center",
  },
  text: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
})
