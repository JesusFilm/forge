import { useEffect, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useT } from "../../i18n/useT"
import { BLACK, SURFACE_COLOR, TEXT_PRIMARY, hexToRgba } from "../../lib/color"
import { GlassSurface, type GlassFallback } from "../ui/GlassSurface"

const FADE_MS = 200
// The glass dissolves with the chevron's fade.
const DISSOLVE_SECONDS = { in: FADE_MS / 1000, out: FADE_MS / 1000 }

// The button's look where Liquid Glass is unavailable.
const BUTTON_FALLBACK: GlassFallback = {
  kind: "fill",
  style: {
    backgroundColor: hexToRgba(SURFACE_COLOR, 0.85),
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
}

export type ScrollTopButtonProps = {
  /** True once the page scrolls past the player. */
  visible: boolean
  onPress: () => void
}

/**
 * The watch page's scroll-to-top button (feat-699 R7). It stays mounted after
 * its first show, so the glass can dissolve on a hide and return on a show.
 */
export function ScrollTopButton({ visible, onPress }: ScrollTopButtonProps) {
  const t = useT("Watch")
  const insets = useSafeAreaInsets()
  const reduceMotion = useReduceMotion()
  const opacity = useRef(new Animated.Value(0)).current
  const [shown, setShown] = useState(visible)
  if (visible && !shown) setShown(true)

  useEffect(() => {
    const to = visible ? 1 : 0
    if (reduceMotion) {
      opacity.setValue(to)
      return
    }
    Animated.timing(opacity, {
      toValue: to,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start()
  }, [visible, reduceMotion, opacity])

  if (!shown) return null

  return (
    <View
      style={[styles.fab, { bottom: insets.bottom + 16 }]}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("scrollToTopAriaLabel")}
        {...{ "dd-action-name": "watch-scroll-top" }}
      >
        <GlassSurface
          style={styles.button}
          fallback={BUTTON_FALLBACK}
          visible={visible}
          dissolveSeconds={DISSOLVE_SECONDS}
          fade={opacity}
        >
          <Ionicons name="chevron-up" size={22} color={TEXT_PRIMARY} />
        </GlassSurface>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
})
