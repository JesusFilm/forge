// One selectable row in the on-page Audio Language / Subtitles sheets, ported
// from the Claude Design handoff (`renderMenu` → `.menu-item`). Matches the
// mockup exactly: no resting background, a leading glyph, the label (+ optional
// native-name note), and a trailing red check on the active row — and on focus
// the whole row inverts to a white fill with near-black ink (the same tvOS-HIG
// white-fill treatment DetailsActionRow's pills already use, driven by the same
// useFocusAnimation progress so it glides rather than snaps).
//
// Three states:
//   - selected  → red check (→ ink when that row is focused),
//   - disabled  → a plain, NON-focusable, muted View with an "Unavailable" tag
//     (an unplayable dub: the D-pad skips it so it can't be picked),
//   - default   → focusable, white-fill-on-focus.

import { useMemo } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type Ionicons from "@expo/vector-icons/Ionicons"

import { scale } from "../../lib/scale"
import { WATCH_THEME } from "./watchDetailTheme"
import { focusTransform, useFocusAnimation } from "./useFocusAnimation"
import { AnimatedFocusIcon } from "./AnimatedFocusIcon"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

const ICON_SIZE = Math.round(scale(26))

export function WatchOptionRow({
  icon,
  label,
  note,
  selected = false,
  disabled = false,
  onPress,
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

  // Unplayable dub: a plain View (never a Pressable) so the D-pad skips it and
  // the viewer can't select an unplayable language. Muted + "Unavailable" tag.
  if (disabled) {
    return (
      <View
        style={[styles.row, styles.disabledRow]}
        accessibilityLabel={`${accessibilityLabel ?? label}, unavailable`}
      >
        {icon ? (
          <AnimatedFocusIcon
            name={icon}
            progress={progress}
            size={ICON_SIZE}
            restColor={WATCH_THEME.text50}
          />
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
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(16),
    paddingVertical: scale(16),
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
    fontWeight: "600",
    color: WATCH_THEME.text50,
  },
  check: {
    fontFamily: "System",
    fontSize: Math.round(scale(26)),
    fontWeight: "700",
  },
})
