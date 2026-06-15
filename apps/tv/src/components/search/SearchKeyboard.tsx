import Ionicons from "@expo/vector-icons/Ionicons"
import { useMemo } from "react"
import { Animated, Pressable, StyleSheet, Text } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"
import {
  applyStripKey,
  buildSearchStrip,
  KEY_GAP,
  KEY_HEIGHT,
  KEY_WIDTH,
  KEY_WIDTH_WIDE,
  type StripKey,
  type StripKeyAction,
} from "./keyStrip"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
}

/**
 * Single horizontal letter strip (design: .s-keys) — A–Z, then wide
 * space / delete / submit keys. Replaces the earlier multi-row QWERTY-ish
 * keyboard; digits and punctuation are gone per the design (the backend
 * search is forgiving enough that letter-only queries are the norm on TV).
 *
 * Letters dispatch uppercase characters — see buildSearchStrip. All writes
 * route through onChange, which the parent sanitizes at the write site.
 */
export function SearchKeyboard({ value, onChange, onSubmit }: Props) {
  const keys = useMemo(() => buildSearchStrip(), [])

  // Thin caller over applyStripKey (the tested pure reducer in keyStrip.ts):
  // submit fires onSubmit; every value-mutating action forwards its non-null
  // next-value to onChange. Guarded no-ops (space/backspace on empty) return
  // null and fall through without touching onChange.
  const dispatch = (action: StripKeyAction) => {
    if (action.kind === "submit") {
      onSubmit()
      return
    }
    const next = applyStripKey(value, action)
    if (next != null) onChange(next)
  }

  // trapFocusLeft / trapFocusRight keep D-pad horizontal travel inside the
  // strip (past-the-end presses stay put instead of escaping to offscreen
  // chrome). Down exits naturally to the results region below; up has
  // nothing above it by design.
  return (
    <TVFocusGuideView style={styles.strip} trapFocusLeft trapFocusRight>
      {keys.map((key, index) => (
        <StripKeyButton
          key={key.id}
          cell={key}
          // One-shot focus claim on entry: the "A" key. Only consulted on
          // first mount; subsequent typing leaves focus on whichever key
          // the user pressed last, which is what we want.
          hasTVPreferredFocus={index === 0}
          onPress={() => dispatch(key.action)}
        />
      ))}
    </TVFocusGuideView>
  )
}

function StripKeyButton({
  cell,
  hasTVPreferredFocus,
  onPress,
}: {
  cell: StripKey
  hasTVPreferredFocus: boolean
  onPress: () => void
}) {
  // Focus pop driven by the shared useFocusAnimation hook (same as HomeCard
  // / WatchOptionRow): one 0→1 `progress` feeds focusTransform, which stops
  // the prior timing before starting the next so a rapid D-pad sweep can't
  // orphan animations. `focused` gates the non-animated focus styles
  // (background, ink color). The key only magnifies (no lift), so lift: 0.
  const { focused, setFocused, progress } = useFocusAnimation()

  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const keyTransform = useMemo(
    () => focusTransform(progress, { lift: 0, magnify: 1.12 }),
    [progress],
  )

  const inkColor = focused ? SEARCH_THEME.keyFocusText : SEARCH_THEME.keyText

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={cell.accessibilityLabel ?? cell.label}
    >
      <Animated.View
        style={[
          styles.key,
          cell.wide && styles.keyWide,
          focused && styles.keyFocused,
          { transform: keyTransform },
        ]}
      >
        {cell.action.kind === "backspace" ? (
          <Ionicons
            name="backspace-outline"
            size={scale(26)}
            color={inkColor}
          />
        ) : (
          <Text style={[styles.keyLabel, { color: inkColor }]}>
            {cell.label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    gap: scale(KEY_GAP),
  },
  key: {
    width: scale(KEY_WIDTH),
    height: scale(KEY_HEIGHT),
    borderRadius: scale(12),
    backgroundColor: SEARCH_THEME.keyBg,
    alignItems: "center",
    justifyContent: "center",
  },
  keyWide: {
    width: scale(KEY_WIDTH_WIDE),
  },
  keyFocused: {
    backgroundColor: SEARCH_THEME.keyFocusBg,
    // Design: 0 12px 28px -10px rgba(0,0,0,.7).
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: scale(12) },
    shadowRadius: scale(14),
    shadowOpacity: 0.7,
    elevation: 8,
  },
  keyLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
  },
})
