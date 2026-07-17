// Settings screen (D-pad list, WATCH_THEME). v1 content is Showcase Mode only:
// a start action + the launch-only auto-start toggle, both persisted on device.

import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useMemo, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { scale } from "../../lib/scale"
import { useShowcasePrefs } from "../../lib/showcaseMode/useShowcasePrefs"
import { createFocusMemory, type FocusMemory } from "../home/focusMemory"
import { useFocusVisual } from "../focus/useFocusVisual"
import { AnimatedFocusIcon } from "../watch/AnimatedFocusIcon"
import { WATCH_THEME } from "../watch/watchDetailTheme"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

const ICON_SIZE = Math.round(scale(26))

export function SettingsScreen() {
  const router = useRouter()
  const { prefs, hydrated, setAutoStart } = useShowcasePrefs()

  // tvos#852: a stack pop drops focus to the top-left default. Remember the
  // focused row and re-focus it on re-entry (mirrors Home's focusMemory wiring).
  const focusMemoryRef = useRef<FocusMemory | null>(null)
  if (focusMemoryRef.current == null) {
    focusMemoryRef.current = createFocusMemory()
  }
  const captureFocusedNode = useCallback((node: ViewType | null) => {
    focusMemoryRef.current?.capture(node)
  }, [])

  // Restore only on genuine re-entry — a prior blur proves it; first mount
  // belongs to Start Showcase's hasTVPreferredFocus. rAF defers past the
  // pop's commit so the target node is mounted before we focus it.
  const hasBlurredRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      let raf: number | null = null
      if (hasBlurredRef.current) {
        raf = requestAnimationFrame(() => {
          focusMemoryRef.current?.restore()
        })
      }
      return () => {
        if (raf != null) cancelAnimationFrame(raf)
        hasBlurredRef.current = true
      }
    }, []),
  )

  const handleStartPress = useCallback(() => {
    router.push("/showcase")
  }, [router])

  const handleAutoStartPress = useCallback(() => {
    setAutoStart(!prefs.autoStart)
  }, [prefs.autoStart, setAutoStart])

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Showcase Mode</Text>
        <Text style={styles.sectionNote}>
          Plays films back to back, unattended. Any button on the remote stops
          the reel and brings you back here. Auto-start only runs when the app
          opens — stopping the reel never turns it off.
        </Text>

        <SettingsRow
          testID="settings-start-showcase-row"
          icon="play-circle-outline"
          label="Start Showcase"
          onPress={handleStartPress}
          onFocusNode={captureFocusedNode}
          hasTVPreferredFocus
        />
        <SettingsRow
          testID="settings-auto-start-row"
          icon="power-outline"
          label="Auto-start when the app opens"
          // Until the read resolves, the row would otherwise claim "Off" and a
          // press would write that guess back over a stored On.
          checked={prefs.autoStart}
          disabled={!hydrated}
          onPress={handleAutoStartPress}
          onFocusNode={captureFocusedNode}
        />
      </View>
    </View>
  )
}

type SettingsRowProps = {
  /** Stable id for D-pad sim automation (mirrors HomeCard's testID pattern). */
  testID: string
  icon: IconName
  label: string
  /** Toggle row when set (switch role + trailing On/Off); action row otherwise. */
  checked?: boolean
  /** Inert while prefs hydrate — focusable stays true so the D-pad path is stable. */
  disabled?: boolean
  onPress: () => void
  /** Reports this row's node on focus so the screen can re-focus it after a pop. */
  onFocusNode?: (node: ViewType | null) => void
  hasTVPreferredFocus?: boolean
}

function SettingsRow({
  testID,
  icon,
  label,
  checked,
  disabled = false,
  onPress,
  onFocusNode,
  hasTVPreferredFocus,
}: SettingsRowProps) {
  // nativeDriver: false — the fill/ink interpolations below are colors, which
  // the native driver cannot animate.
  const { setFocused, progress, transform } = useFocusVisual("option", {
    nativeDriver: false,
  })
  const localRef = useRef<ViewType | null>(null)
  const setRef = useCallback((node: ViewType | null) => {
    localRef.current = node
  }, [])

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
  const valueInk = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [
          checked === true ? WATCH_THEME.accent : WATCH_THEME.text50,
          WATCH_THEME.focusInk,
        ],
      }),
    [progress, checked],
  )
  const animatedRow = useMemo(
    () => ({ backgroundColor: bg, transform }),
    [bg, transform],
  )

  return (
    <Pressable
      ref={setRef}
      onPress={onPress}
      disabled={disabled}
      onFocus={() => {
        setFocused(true)
        onFocusNode?.(localRef.current)
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      testID={testID}
      accessibilityRole={checked == null ? "button" : "switch"}
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
    >
      <Animated.View
        style={[styles.row, disabled && styles.rowDisabled, animatedRow]}
      >
        <AnimatedFocusIcon name={icon} progress={progress} size={ICON_SIZE} />
        <Animated.Text style={[styles.rowLabel, { color: ink }]}>
          {label}
        </Animated.Text>
        {checked != null ? (
          <Animated.Text style={[styles.rowValue, { color: valueInk }]}>
            {checked ? "On" : "Off"}
          </Animated.Text>
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WATCH_THEME.below,
    paddingHorizontal: scale(80),
    paddingTop: scale(78),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(48)),
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
  section: {
    marginTop: scale(48),
    // Rows bleed past the section's text block by their own padding, so the
    // heading and the resting row labels still share one optical left edge.
    marginHorizontal: -scale(20),
  },
  sectionHeading: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    fontWeight: "600",
    color: WATCH_THEME.text82,
    paddingHorizontal: scale(20),
  },
  sectionNote: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "400",
    lineHeight: Math.round(scale(30)),
    color: WATCH_THEME.text50,
    maxWidth: scale(760),
    paddingHorizontal: scale(20),
    marginTop: scale(10),
    marginBottom: scale(22),
  },

  // Design `.menu-item`: gap 16, padding 20, radius 14, transparent at rest.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(16),
    height: scale(72),
    paddingHorizontal: scale(20),
    borderRadius: scale(14),
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowLabel: {
    flex: 1,
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "500",
  },
  rowValue: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "600",
  },
})
