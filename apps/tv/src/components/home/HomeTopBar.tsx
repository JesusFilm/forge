// Home's top chrome (centered Search/Home tabs · clock; left slot is an empty spacer); replaces HomeHeader/SearchChip on Home only.
// Sticky first child of the ScrollView in normal flex flow — never position:absolute on focusables (tvOS focus engine skips them).
// Hides (opacity 0, translateY -18, ~400ms) while deep in the feed. TODO: add Collections / Saved tabs when those screens ship.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"

import { scale } from "../../lib/scale"
import { AnimatedFocusIcon } from "../watch/AnimatedFocusIcon"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { useFocusVisual } from "../focus/useFocusVisual"
import { formatClock } from "./clockFormat"

/**
 * In-flow bar height: paddingTop 40 + tab bar (8 padding ×2 + 60 tab).
 * HomeBillboard subtracts this from the 700px hero region so the billboard
 * bottom lands where the mockup puts it.
 */
export const TOP_BAR_HEIGHT = scale(40) + scale(8) * 2 + scale(60)

const HIDE_MS = 400
const CLOCK_TICK_MS = 15_000

const TAB_INK_REST = "rgba(255,255,255,0.72)"
const TAB_SELECTED_BG = "rgba(255,255,255,0.12)"
// hexToRgba is for hex inputs; this literal zero-alpha white (never the
// string "transparent") keeps the focus bg interpolation hue-stable.
const TAB_BG_REST = "rgba(255,255,255,0)"

type HomeTopBarProps = {
  /** Deep-in-feed: fade the bar out and make its tabs unfocusable. */
  hidden: boolean
  onSearchPress: () => void
  /** Any tab gaining focus pins the screen to its "top" state. */
  onChromeFocus: () => void
  /**
   * Receives the Search tab's native node so the hero/featured rail can wire it as `nextFocusUp`
   * (centered bar doesn't overlap the left-anchored hero buttons). The reverse (Down to hero) is NOT
   * wired here: `nextFocusDown` on sticky-header tabs is dropped; the hero owns that bridge via TVFocusGuideView — see app/index.tsx.
   */
  onSearchTabNode?: (node: ViewType | null) => void
  /** Reports the focused tab's node so the screen can re-focus it after a nav
   *  push/pop — subsumes the old back-from-/search restore (last focus = Search tab). */
  onFocusNode?: (node: ViewType | null) => void
}

export const HomeTopBar = memo(function HomeTopBar({
  hidden,
  onSearchPress,
  onChromeFocus,
  onSearchTabNode,
  onFocusNode,
}: HomeTopBarProps) {
  // ── Hide animation ──
  const hideProgress = useRef(new Animated.Value(hidden ? 1 : 0)).current
  useEffect(() => {
    const animation = Animated.timing(hideProgress, {
      toValue: hidden ? 1 : 0,
      duration: HIDE_MS,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [hidden, hideProgress])
  const hideStyle = useMemo(
    () => ({
      opacity: hideProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
      transform: [
        {
          translateY: hideProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -scale(18)],
          }),
        },
      ],
    }),
    [hideProgress],
  )

  // ── Clock (updates every 15s; interval cleaned up on unmount) ──
  const [clock, setClock] = useState(() => formatClock(new Date()))
  useEffect(() => {
    const id = setInterval(() => {
      const next = formatClock(new Date())
      setClock((prev) => (prev === next ? prev : next))
    }, CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <Animated.View
      style={[styles.bar, hideStyle]}
      pointerEvents={hidden ? "none" : "box-none"}
      accessibilityElementsHidden={hidden}
    >
      {/* Empty left spacer — balances the centered tab bar against the
          right-side clock (the FORGE brandmark was removed). */}
      <View style={styles.sideLeft} pointerEvents="none" />

      <View style={styles.tabBar}>
        <TopBarTab
          testID="home-topbar-search-tab"
          iconName="search"
          accessibilityLabel="Search"
          accessibilityHint="Opens the search screen"
          onPress={onSearchPress}
          onChromeFocus={onChromeFocus}
          focusable={!hidden}
          nodeRef={onSearchTabNode}
          onFocusNode={onFocusNode}
        />
        <TopBarTab
          testID="home-topbar-home-tab"
          label="Home"
          selected
          accessibilityLabel="Home"
          onPress={NO_ACTION}
          onChromeFocus={onChromeFocus}
          focusable={!hidden}
          onFocusNode={onFocusNode}
        />
        {/* TODO: Collections / Saved tabs (in the design) once those
            surfaces exist in the app. */}
      </View>

      <View style={styles.sideRight} pointerEvents="none">
        <Text style={styles.clock} numberOfLines={1}>
          {clock}
        </Text>
      </View>
    </Animated.View>
  )
})

// Home is the current screen — its tab is focusable for D-pad continuity but
// pressing it does nothing.
const NO_ACTION = () => {}

const SEARCH_ICON_SIZE = Math.round(scale(24))

type TopBarTabProps = {
  /** Stable id for D-pad sim automation (mirrors HomeCard's testID pattern). */
  testID: string
  /** Icon-only tab (60×60) when set; label tab otherwise. */
  iconName?: "search"
  label?: string
  /** The design's "sel" state — translucent white fill, white ink at rest. */
  selected?: boolean
  accessibilityLabel: string
  accessibilityHint?: string
  onPress: () => void
  onChromeFocus: () => void
  focusable: boolean
  /** Lifts this tab's native node up so the hero can target it via nextFocusUp. */
  nodeRef?: (node: ViewType | null) => void
  /** Reports this tab's node on focus so the screen can re-focus it after a nav push/pop. */
  onFocusNode?: (node: ViewType | null) => void
}

function TopBarTab({
  testID,
  iconName,
  label,
  selected = false,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  onChromeFocus,
  focusable,
  nodeRef,
  onFocusNode,
}: TopBarTabProps) {
  const { setFocused, progress, transform } = useFocusVisual("tab", {
    nativeDriver: false,
  })
  // Own this tab's host node so onFocus can report it, while still forwarding to
  // nodeRef (Search tab lifts its node up to the hero's nextFocusUp).
  const localRef = useRef<ViewType | null>(null)
  const setRef = useCallback(
    (node: ViewType | null) => {
      localRef.current = node
      nodeRef?.(node)
    },
    [nodeRef],
  )

  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const fillStyle = useMemo(
    () => ({
      backgroundColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [
          selected ? TAB_SELECTED_BG : TAB_BG_REST,
          WATCH_THEME.focusFill,
        ],
      }),
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.7],
      }),
      transform,
    }),
    [progress, selected, transform],
  )
  const ink = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [
          selected ? WATCH_THEME.text : TAB_INK_REST,
          WATCH_THEME.focusInk,
        ],
      }),
    [progress, selected],
  )

  return (
    <Pressable
      ref={setRef}
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onChromeFocus()
        onFocusNode?.(localRef.current)
      }}
      onBlur={() => setFocused(false)}
      focusable={focusable}
      testID={testID}
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
    >
      <Animated.View
        style={[styles.tab, iconName != null && styles.tabIconOnly, fillStyle]}
      >
        {iconName != null ? (
          <AnimatedFocusIcon
            name={iconName}
            progress={progress}
            size={SEARCH_ICON_SIZE}
            restColor={TAB_INK_REST}
            focusColor={WATCH_THEME.focusInk}
          />
        ) : (
          <Animated.Text style={[styles.tabLabel, { color: ink }]}>
            {label}
          </Animated.Text>
        )}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: scale(40),
    paddingHorizontal: scale(80),
    height: TOP_BAR_HEIGHT,
  },
  sideLeft: {
    flex: 1,
    alignItems: "flex-start",
  },
  sideRight: {
    flex: 1,
    alignItems: "flex-end",
  },

  // ── Tab bar ──
  // No expo-blur dependency on TV, so the design's blur(30px) glass is
  // approximated with a slightly more opaque fill than the mockup's .4.
  tabBar: {
    flexDirection: "row",
    gap: scale(8),
    padding: scale(8),
    borderRadius: scale(24),
    backgroundColor: "rgba(18,18,20,0.55)",
    borderWidth: scale(1),
    borderColor: "rgba(255,255,255,0.08)",
  },
  tab: {
    height: scale(60),
    paddingHorizontal: scale(28),
    borderRadius: scale(17),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(10),
    shadowColor: "#000000",
    shadowRadius: scale(20),
    shadowOffset: { width: 0, height: scale(14) },
  },
  tabIconOnly: {
    width: scale(60),
    paddingHorizontal: 0,
  },
  tabLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(23)),
    fontWeight: "600",
  },

  // ── Clock ──
  clock: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
    fontVariant: ["tabular-nums"],
  },
})
