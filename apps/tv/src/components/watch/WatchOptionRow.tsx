// One row in the Audio Language / Subtitles sheets: leading glyph, label (+ optional
// native-name note), trailing red check on the active row; focus inverts to white fill /
// near-black ink via useFocusAnimation. States: selected, disabled (inert), default.

import { useMemo } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { scale } from "../../lib/scale"
import { WATCH_THEME } from "./watchDetailTheme"
import { focusTransform, useFocusAnimation } from "./useFocusAnimation"
import { AnimatedFocusIcon } from "./AnimatedFocusIcon"
// Deterministic single-line row height so virtualized lists compute offsets
// without measuring: text pins lineHeight to ROW_LINE_HEIGHT + numberOfLines={1}.
// Tokens live in watchMenuLayout.ts (React-free, unit-tested).
import { ROW_LINE_HEIGHT, WATCH_OPTION_ROW_HEIGHT } from "./watchMenuLayout"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

const ICON_SIZE = Math.round(scale(26))

export function WatchOptionRow({
  icon,
  label,
  note,
  selected = false,
  disabled = false,
  onPress,
  onFocus,
  hasTVPreferredFocus,
  accessibilityLabel,
}: {
  /** Leading glyph (globe for audio, captions for subtitles). */
  icon?: IconName
  label: string
  /** Native language name, shown dimmed after the label (audio rows). */
  note?: string | null
  /** Currently-selected option → trailing red check. */
  selected?: boolean
  /** Unplayable dub → inert, non-focusable, muted "Unavailable" row. */
  disabled?: boolean
  onPress: () => void
  /** Chained after the row's own focus handling (used to disarm one-shot
   *  preferred focus in the virtualized lists). */
  onFocus?: () => void
  hasTVPreferredFocus?: boolean
  accessibilityLabel?: string
}) {
  // Called unconditionally (hooks rule); the disabled branch below renders a
  // plain View and never drives `progress`.
  const { setFocused, progress } = useFocusAnimation()

  const bg = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,1)"],
      }),
    [progress],
  )
  const ink = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
      }),
    [progress],
  )
  const noteInk = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text50, "rgba(0,0,0,0.5)"],
      }),
    [progress],
  )
  const checkInk = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.accent, WATCH_THEME.focusInk],
      }),
    [progress],
  )
  const iconOpacity = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.85, 1],
      }),
    [progress],
  )
  const animatedRow = useMemo(
    () => ({
      backgroundColor: bg,
      // Design `.menu-item[data-focused]`: scale(1.015), no lift — the white
      // fill is the focus signal, not a magnify-and-rise like the pills.
      transform: focusTransform(progress, { lift: 0, magnify: 1.015 }),
    }),
    [bg, progress],
  )

  // Unplayable dub: plain View (never Pressable) so the D-pad skips it. Static
  // Ionicons not AnimatedFocusIcon — the row can never focus, so the cross-fade
  // would be dead Animated infra, material waste across thousands of dub rows.
  if (disabled) {
    return (
      <View
        style={[styles.row, styles.disabledRow]}
        accessibilityLabel={`${accessibilityLabel ?? label}, unavailable`}
        accessibilityState={{ disabled: true }}
      >
        {icon ? (
          <Ionicons name={icon} size={ICON_SIZE} color={WATCH_THEME.text50} />
        ) : null}
        <Text style={[styles.label, styles.disabledText]} numberOfLines={1}>
          {label}
          {note ? `  ·  ${note}` : ""}
        </Text>
        <Text style={styles.unavailable}>Unavailable</Text>
      </View>
    )
  }

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocus?.()
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
    >
      <Animated.View style={[styles.row, animatedRow]}>
        {icon ? (
          <Animated.View style={{ opacity: iconOpacity }}>
            <AnimatedFocusIcon
              name={icon}
              progress={progress}
              size={ICON_SIZE}
            />
          </Animated.View>
        ) : null}
        <Text style={[styles.label, styles.labelWrap]} numberOfLines={1}>
          <Animated.Text style={{ color: ink }}>{label}</Animated.Text>
          {note ? (
            <Animated.Text
              style={{ color: noteInk }}
            >{`  ·  ${note}`}</Animated.Text>
          ) : null}
        </Text>
        {selected ? (
          <Animated.Text style={[styles.check, { color: checkInk }]}>
            {"✓"}
          </Animated.Text>
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Design `.menu-item`: gap 16, padding 16/20, radius 14, transparent at rest.
  // Fixed-height single-line rows (see WATCH_OPTION_ROW_HEIGHT above).
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(16),
    height: WATCH_OPTION_ROW_HEIGHT,
    paddingHorizontal: scale(20),
    borderRadius: scale(14),
  },
  disabledRow: {
    opacity: 0.4,
  },
  // Design `.menu-item` text: 24px / 500. Colour is supplied per-state by the
  // nested Animated.Text (focusable) or disabledText (disabled).
  label: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    lineHeight: ROW_LINE_HEIGHT,
    fontWeight: "500",
  },
  labelWrap: {
    flex: 1,
  },
  disabledText: {
    color: WATCH_THEME.text50,
  },
  unavailable: {
    fontFamily: "System",
    fontSize: Math.round(scale(16)),
    lineHeight: ROW_LINE_HEIGHT,
    fontWeight: "600",
    color: WATCH_THEME.text50,
  },
  check: {
    fontFamily: "System",
    fontSize: Math.round(scale(26)),
    lineHeight: ROW_LINE_HEIGHT,
    fontWeight: "700",
  },
})
