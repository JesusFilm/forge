// The Home billboard hero — copy block + actions for whichever card the
// showcase reducer last committed, laid over the full-screen HomeBackdrop.
// Replaces ShowcaseCanvas: same non-focusable copy, but the actions row
// (Play / More Info) is focusable chrome that routes to the focused card.
//
// Layout: the hero region is the design's 700/1080 of the screen minus the
// in-flow top bar, with the billboard bottom-anchored via flexbox
// (justifyContent flex-end — never position:absolute on a subtree containing
// focusables). The description is clamped to EXACTLY two lines with a fixed
// height so the layout never jumps as cards swap.
//
// While focus is in the rails the actions GHOST (opacity 0, ~300ms) but stay
// mounted and focusable, so D-pad up from row 0 lands on Play and fades the
// row back in.

import { memo, useEffect, useMemo, useRef } from "react"
import Ionicons from "@expo/vector-icons/Ionicons"
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { TOP_BAR_HEIGHT } from "./HomeTopBar"

/** The design's hero region: 700px of the 1080px canvas. */
const HERO_DESIGN_RATIO = 700 / 1080

/**
 * The top bar sits in flow above the scroll feed, so the in-content hero
 * region is the design height minus the bar — the billboard bottom still
 * lands 700-36 from the screen top at scroll 0.
 */
const HERO_REGION_HEIGHT =
  Math.round(Dimensions.get("window").height * HERO_DESIGN_RATIO) -
  TOP_BAR_HEIGHT

const ACTIONS_GHOST_MS = 300

/** Description line metrics: fontSize 25 × 1.45 line-height, two lines. */
const DESCRIPTION_LINE_HEIGHT = Math.round(scale(36))

type HomeBillboardProps = {
  /** Null only for the first frame before the showcase seeds. */
  card: WatchHomeCard | null
  /** True while focus is in the rails — actions fade out but stay focusable. */
  actionsGhosted: boolean
  /** Either action gaining focus pins the screen to its "top" state. */
  onChromeFocus: () => void
  /** Both actions route via the existing resolveHomeCardPath at the caller. */
  onCardPress: (card: WatchHomeCard) => void
}

export const HomeBillboard = memo(function HomeBillboard({
  card,
  actionsGhosted,
  onChromeFocus,
  onCardPress,
}: HomeBillboardProps) {
  const ghostProgress = useRef(
    new Animated.Value(actionsGhosted ? 1 : 0),
  ).current
  useEffect(() => {
    const animation = Animated.timing(ghostProgress, {
      toValue: actionsGhosted ? 1 : 0,
      duration: ACTIONS_GHOST_MS,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [actionsGhosted, ghostProgress])
  const ghostStyle = useMemo(
    () => ({
      opacity: ghostProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
    }),
    [ghostProgress],
  )

  return (
    <View style={styles.hero}>
      {card != null ? (
        <View style={styles.billboard}>
          <View pointerEvents="none" collapsable={false}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              {card.label}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {card.title}
            </Text>
            {/* Fixed two-line block (empty when no description) so the
                actions row never jumps as the showcase swaps cards. */}
            <Text style={styles.description} numberOfLines={2}>
              {card.description ?? ""}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {card.metaLabel ?? ""}
            </Text>
          </View>

          <Animated.View style={[styles.actions, ghostStyle]}>
            <PlayButton
              card={card}
              onPress={onCardPress}
              onChromeFocus={onChromeFocus}
            />
            <MoreInfoButton
              card={card}
              onPress={onCardPress}
              onChromeFocus={onChromeFocus}
            />
          </Animated.View>
        </View>
      ) : null}
    </View>
  )
})

// ── Actions ─────────────────────────────────────────────────────────
//
// Focus eases in via useFocusAnimation's 0→1 `progress`: lift -4 + magnify
// 1.06. Play gains a white ring (constant-width transparent border →
// animated borderColor, no layout shift) over a deepened accent shadow; More
// Info inverts glass → white fill with dark ink (tvOS HIG, same scheme as
// the watch screen's SecondaryPill).

const PLAY_ICON_SIZE = Math.round(scale(30))

type ActionButtonProps = {
  card: WatchHomeCard
  onPress: (card: WatchHomeCard) => void
  onChromeFocus: () => void
}

function PlayButton({ card, onPress, onChromeFocus }: ActionButtonProps) {
  const { setFocused, progress } = useFocusAnimation()
  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const animatedStyle = useMemo(
    () => ({
      borderColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,0.85)"],
      }),
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.45, 0.75],
      }),
      transform: focusTransform(progress, { lift: scale(4), magnify: 1.06 }),
    }),
    [progress],
  )
  return (
    <Pressable
      onPress={() => onPress(card)}
      onFocus={() => {
        setFocused(true)
        onChromeFocus()
      }}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`Play, ${card.title}`}
    >
      <Animated.View style={[styles.playButton, animatedStyle]}>
        <Ionicons
          name="play"
          size={PLAY_ICON_SIZE}
          color={WATCH_THEME.accentText}
        />
        <View style={styles.playCaption}>
          <Text style={styles.playLabel}>Play</Text>
          <Text style={styles.playSub} numberOfLines={1}>
            {card.label}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
}

function MoreInfoButton({ card, onPress, onChromeFocus }: ActionButtonProps) {
  const { setFocused, progress } = useFocusAnimation()
  const ink = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
      }),
    [progress],
  )
  const animatedStyle = useMemo(
    () => ({
      backgroundColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
      }),
      borderColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0.06)", "rgba(255,255,255,0.16)"],
      }),
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.5],
      }),
      transform: focusTransform(progress, { lift: scale(4), magnify: 1.06 }),
    }),
    [progress],
  )
  return (
    <Pressable
      onPress={() => onPress(card)}
      onFocus={() => {
        setFocused(true)
        onChromeFocus()
      }}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`More info, ${card.title}`}
    >
      <Animated.View style={[styles.infoPill, animatedStyle]}>
        <Animated.Text style={[styles.infoLabel, { color: ink }]}>
          More Info
        </Animated.Text>
      </Animated.View>
    </Pressable>
  )
}

const BUTTON_HEIGHT = scale(76)
const BUTTON_RADIUS = scale(18)

const styles = StyleSheet.create({
  hero: {
    height: HERO_REGION_HEIGHT,
    justifyContent: "flex-end",
    paddingLeft: scale(80),
    paddingBottom: scale(36),
  },
  billboard: {
    maxWidth: scale(1100),
  },

  // ── Copy block ──
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(19)),
    fontWeight: "700",
    // .18em of the 19px eyebrow.
    letterSpacing: scale(3.4),
    textTransform: "uppercase",
    color: WATCH_THEME.accent,
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(80)),
    lineHeight: Math.round(scale(82)),
    fontWeight: "800",
    letterSpacing: -scale(1.5),
    color: WATCH_THEME.text,
    marginTop: scale(12),
    maxWidth: scale(1060),
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: scale(4) },
    textShadowRadius: scale(30),
  },
  description: {
    fontFamily: "System",
    fontSize: Math.round(scale(25)),
    lineHeight: DESCRIPTION_LINE_HEIGHT,
    fontWeight: "400",
    color: WATCH_THEME.text74,
    marginTop: scale(18),
    maxWidth: scale(920),
    height: DESCRIPTION_LINE_HEIGHT * 2,
  },
  meta: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
    marginTop: scale(12),
  },

  // ── Actions ──
  actions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: scale(18),
    marginTop: scale(30),
  },
  playButton: {
    height: BUTTON_HEIGHT,
    paddingLeft: scale(32),
    paddingRight: scale(40),
    borderRadius: BUTTON_RADIUS,
    backgroundColor: WATCH_THEME.accent,
    // Constant-width transparent border becomes the white focus ring
    // (animating borderColor avoids any layout shift).
    borderWidth: scale(5),
    flexDirection: "row",
    alignItems: "center",
    gap: scale(16),
    shadowColor: WATCH_THEME.accent,
    shadowRadius: scale(20),
    shadowOffset: { width: 0, height: scale(10) },
  },
  playCaption: {
    alignItems: "flex-start",
    justifyContent: "center",
  },
  playLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    lineHeight: Math.round(scale(29)),
    fontWeight: "700",
    color: WATCH_THEME.accentText,
  },
  playSub: {
    fontFamily: "System",
    fontSize: Math.round(scale(15)),
    fontWeight: "600",
    color: "rgba(255,255,255,0.82)",
    marginTop: scale(2),
    letterSpacing: scale(0.1),
  },
  infoPill: {
    height: BUTTON_HEIGHT,
    paddingHorizontal: scale(30),
    borderRadius: BUTTON_RADIUS,
    borderWidth: scale(1),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowRadius: scale(22),
    shadowOffset: { width: 0, height: scale(14) },
  },
  infoLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(23)),
    fontWeight: "600",
  },
})
