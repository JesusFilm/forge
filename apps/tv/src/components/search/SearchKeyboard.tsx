import Ionicons from "@expo/vector-icons/Ionicons"
import { useMemo, useRef, useState } from "react"
import { Animated, Easing, Pressable, StyleSheet, Text } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import {
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

  const dispatch = (action: StripKeyAction) => {
    switch (action.kind) {
      case "char":
        onChange(value + action.char)
        return
      case "space":
        // No leading space — matches the design's guard and avoids a
        // whitespace-only query flipping the results region to an
        // idle-state grid.
        if (value.length === 0) return
        onChange(value + " ")
        return
      case "backspace":
        if (value.length === 0) return
        onChange(value.slice(0, -1))
        return
      case "submit":
        onSubmit()
        return
      default: {
        // Compile-time exhaustiveness check: a future StripKeyAction
        // variant errors at tsc until the new `case` is handled above.
        const _exhaustive: never = action
        return _exhaustive
      }
    }
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
  // onFocus/onBlur + state pattern (react-native-tvos exposes `focused`
  // at runtime but not in the upstream Pressable types).
  const [isFocused, setIsFocused] = useState(false)

  // Focus pop to 1.12 — native-driver timing approximating the design's
  // .15s ease-out transition.
  const focusAnim = useRef(new Animated.Value(0)).current
  const animateTo = (toValue: number) => {
    Animated.timing(focusAnim, {
      toValue,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }
  const keyScale = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  })

  const inkColor = isFocused ? SEARCH_THEME.keyFocusText : SEARCH_THEME.keyText

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setIsFocused(true)
        animateTo(1)
      }}
      onBlur={() => {
        setIsFocused(false)
        animateTo(0)
      }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={cell.accessibilityLabel ?? cell.label}
    >
      <Animated.View
        style={[
          styles.key,
          cell.wide && styles.keyWide,
          isFocused && styles.keyFocused,
          { transform: [{ scale: keyScale }] },
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
    fontSize: scale(24),
    fontWeight: "600",
  },
})
