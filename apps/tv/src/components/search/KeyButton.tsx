import Ionicons from "@expo/vector-icons/Ionicons"
import { Animated, Pressable, StyleSheet, Text } from "react-native"
import type { View as ViewType } from "react-native"

import { scale } from "../../lib/scale"
import { useFocusVisual } from "../focus/useFocusVisual"
import type { KeyCell, KeyDims } from "./keyGrid"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  cell: KeyCell
  hasTVPreferredFocus: boolean
  onPress: () => void
  /** Per-keyboard size tokens (GRID_KEY_DIMS or LINEAR_KEY_DIMS). */
  dims: KeyDims
  /**
   * Exposes this key's native node so another surface can target it as a
   * D-pad `nextFocusUp` destination (the Apple TV stacked layout points the
   * results grid's top row back at the first key). Ref-as-state, like HomeCard.
   */
  nodeRef?: (node: ViewType | null) => void
}

/**
 * One focusable, animated keyboard key shared by the grid (Android) and
 * single-line (Apple TV) keyboards; sizing comes from `dims`. Focus pop via
 * useFocusAnimation, white-fill focus (SEARCH_THEME.keyFocusBg), Ionicons backspace.
 */
export function KeyButton({
  cell,
  hasTVPreferredFocus,
  onPress,
  dims,
  nodeRef,
}: Props) {
  // Shared focus module ("key" role): strongest pop, preset drop shadow.
  const { focused, setFocused, transform, focusedShadow } = useFocusVisual(
    "key",
    { nativeDriver: false },
  )

  const inkColor = focused ? SEARCH_THEME.keyFocusText : SEARCH_THEME.keyText

  return (
    <Pressable
      ref={nodeRef}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={cell.accessibilityLabel ?? cell.label}
      // Datadog RUM names TAP actions from accessibilityLabel by default — a
      // generic dd-action-name keeps typed search letters out of telemetry.
      {...{ "dd-action-name": "keyboard-key" }}
    >
      <Animated.View
        style={[
          styles.key,
          {
            width: scale(cell.wide === true ? dims.wideWidth : dims.size),
            height: scale(dims.size),
            borderRadius: scale(dims.radius),
          },
          focused && styles.keyFocused,
          focused && focusedShadow,
          { transform },
        ]}
      >
        {cell.action.kind === "backspace" || cell.action.kind === "mic" ? (
          <Ionicons
            name={
              cell.action.kind === "mic" ? "mic-outline" : "backspace-outline"
            }
            size={scale(dims.iconSize)}
            color={inkColor}
          />
        ) : (
          <Text
            style={[
              styles.keyLabel,
              {
                color: inkColor,
                fontSize: Math.round(scale(dims.labelFontSize)),
              },
            ]}
          >
            {cell.label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  key: {
    backgroundColor: SEARCH_THEME.keyBg,
    alignItems: "center",
    justifyContent: "center",
  },
  // Shadow comes from the shared "key" focus role.
  keyFocused: {
    backgroundColor: SEARCH_THEME.keyFocusBg,
  },
  keyLabel: {
    fontFamily: "System",
    fontWeight: "600",
  },
})
