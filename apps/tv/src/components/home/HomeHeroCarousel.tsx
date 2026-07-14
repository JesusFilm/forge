// Home hero controls (Apple-TV top-shelf); HeroPager owns slide artwork + copy.
// This owns the pinned action row (See more CTA ↔ next chevron) + dots and signals
// onRequestAdvance. Auto-advance runs only while focused so the index can't drift.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  // @ts-expect-error useTVEventHandler is provided by react-native-tvos but not in the base RN types CI type-checks against.
  useTVEventHandler,
} from "react-native"
import type { View as ViewType } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { AnimatedFocusIcon } from "../watch/AnimatedFocusIcon"
import { useFocusAnimation, useFocusVisual } from "../focus/useFocusVisual"
import { HomeBillboard } from "./HomeBillboard"

const AUTO_ADVANCE_MS = 7000
const CTA_ICON_SIZE = Math.round(scale(24))
const CHEVRON_ICON_SIZE = Math.round(scale(30))

type HomeHeroCarouselProps = {
  /** The curated hero set (model.featured). */
  slides: WatchHomeCard[]
  /** Which slide is active (owned by the screen, mirrored to HeroPager). */
  index: number
  /** Land initial D-pad focus on the See more CTA on cold mount. */
  hasTVPreferredFocus?: boolean
  /** Select on the See more CTA opens the active slide. */
  onSelect: (card: WatchHomeCard) => void
  /** Hero focus gained/lost — the screen pins the feed to 0 and sets browse
   *  state (and the pager stays visible). */
  onFocusChange: (focused: boolean) => void
  /** Page the hero: +1 next (chevron Select / Right / auto-advance), -1
   *  previous (See more Left). */
  onRequestAdvance: (delta: number) => void
  /** Exposes the See more CTA's node so the first section rail can wire it as
   *  the D-pad-up destination for ALL its cards. */
  onCtaNode?: (node: ViewType | null) => void
  /** Top bar's Search tab node — the D-pad-up destination for BOTH hero buttons.
   *  Centered tabs don't overlap the left-anchored row, so geometry dead-ends Up;
   *  this explicit destination bridges Up from the hero to the top bar. */
  upFocusTarget?: ViewType | null
  /** Reports the focused hero button's node so the screen can re-focus it after
   *  a nav push/pop (the See more CTA is a valid "last focused element"). */
  onFocusNode?: (node: ViewType | null) => void
}

export function HomeHeroCarousel({
  slides,
  index,
  hasTVPreferredFocus,
  onSelect,
  onFocusChange,
  onRequestAdvance,
  onCtaNode,
  upFocusTarget,
  onFocusNode,
}: HomeHeroCarouselProps) {
  const count = slides.length
  const safeIndex = count > 0 ? ((index % count) + count) % count : 0
  const current = slides[safeIndex] ?? null

  // Hero focus = either action button focused (drives auto-advance + the
  // parent's feed pin). Refs mirror focus for the global key handler.
  const [seeMoreFocused, setSeeMoreFocused] = useState(false)
  const [chevronFocused, setChevronFocused] = useState(false)
  const seeMoreFocusedRef = useRef(false)
  const chevronFocusedRef = useRef(false)
  // A directional key that moves focus also fires the global handler. Any focus
  // change flags this so the handler skips the causing key and clears the flag —
  // only a key with focus already settled pages, regardless of how focus arrived.
  const focusMovedRef = useRef(false)
  const heroFocused = seeMoreFocused || chevronFocused

  // Self-target nextFocus on each end button so a D-pad press toward its empty
  // side stays put (never escapes the hero); the capture pages instead.
  const [seeMoreNode, setSeeMoreNode] = useState<ViewType | null>(null)
  const [chevronNode, setChevronNode] = useState<ViewType | null>(null)
  // Mirror the node in a ref so onFocus reports a synchronously-current node —
  // the state set via the ref callback may not have committed on first focus
  // (same dual-ref pattern as HomeCard).
  const seeMoreNodeRef = useRef<ViewType | null>(null)
  const chevronNodeRef = useRef<ViewType | null>(null)

  // Report hero focus to the screen only when it actually changes (moving See
  // more ↔ chevron keeps it true, so the feed never re-pins between buttons).
  useEffect(() => {
    onFocusChange(heroFocused)
  }, [heroFocused, onFocusChange])

  // Auto-advance (next) only while the hero is focused; re-arm on each slide so
  // a manual press resets the dwell, and pause when focus leaves the hero.
  useEffect(() => {
    if (!heroFocused || count <= 1) return
    const timer = setTimeout(() => onRequestAdvance(1), AUTO_ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [heroFocused, safeIndex, count, onRequestAdvance])

  // RIGHT on the chevron → next; LEFT on See more → previous. A key that just
  // changed focus is skipped (focusMovedRef), so the press that LANDS focus on a
  // button doesn't also page — only a press with focus already there does.
  const onTVEvent = useCallback(
    (
      event: { eventType?: string; eventKeyAction?: number } | null | undefined,
    ) => {
      if (event == null) return
      // Android TV emits each D-pad press TWICE (key-down=0 + key-up=1) with the
      // same eventType; drop the Android key-up so a press pages once. Gated to
      // Android so a non-zero action value on tvOS can't suppress a real key.
      if (Platform.OS === "android" && event.eventKeyAction === 1) return

      // On iOS onFocus runs BEFORE this handler, so focusMovedRef suppresses the
      // focus-move press (letting the first settled key page). On Android the key
      // arrives BEFORE the focus move (focus-ref gate handles it) so the flag is ignored.
      const moved = focusMovedRef.current
      focusMovedRef.current = false
      if (Platform.OS !== "android" && moved) return
      const type = event.eventType
      if (
        (type === "right" || type === "swipeRight") &&
        chevronFocusedRef.current
      ) {
        onRequestAdvance(1)
      } else if (
        (type === "left" || type === "swipeLeft") &&
        seeMoreFocusedRef.current
      ) {
        onRequestAdvance(-1)
      }
    },
    [onRequestAdvance],
  )
  useTVEventHandler(onTVEvent)

  const handleSeeMoreFocus = useCallback(() => {
    seeMoreFocusedRef.current = true
    focusMovedRef.current = true
    setSeeMoreFocused(true)
    onFocusNode?.(seeMoreNodeRef.current)
  }, [onFocusNode])
  const handleSeeMoreBlur = useCallback(() => {
    seeMoreFocusedRef.current = false
    focusMovedRef.current = true
    setSeeMoreFocused(false)
  }, [])
  const handleChevronFocus = useCallback(() => {
    chevronFocusedRef.current = true
    focusMovedRef.current = true
    setChevronFocused(true)
    onFocusNode?.(chevronNodeRef.current)
  }, [onFocusNode])
  const handleChevronBlur = useCallback(() => {
    chevronFocusedRef.current = false
    focusMovedRef.current = true
    setChevronFocused(false)
  }, [])

  // See more's node feeds BOTH the rail's D-pad-up wiring (onCtaNode) and the
  // self-target nextFocusLeft below.
  const handleSeeMoreNode = useCallback(
    (node: ViewType | null) => {
      seeMoreNodeRef.current = node
      onCtaNode?.(node)
      setSeeMoreNode(node)
    },
    [onCtaNode],
  )
  const handleChevronNode = useCallback((node: ViewType | null) => {
    chevronNodeRef.current = node
    setChevronNode(node)
  }, [])

  return (
    <View>
      <HomeBillboard
        action={
          current != null ? (
            <View style={styles.actionRow}>
              <HeroCtaButton
                label="See more"
                onPress={() => onSelect(current)}
                onFocus={handleSeeMoreFocus}
                onBlur={handleSeeMoreBlur}
                hasTVPreferredFocus={hasTVPreferredFocus}
                onNode={handleSeeMoreNode}
                selfNode={seeMoreNode}
                upFocusTarget={upFocusTarget}
              />
              <HeroChevronButton
                onPress={() => onRequestAdvance(1)}
                onFocus={handleChevronFocus}
                onBlur={handleChevronBlur}
                onNode={handleChevronNode}
                selfNode={chevronNode}
                upFocusTarget={upFocusTarget}
              />
            </View>
          ) : null
        }
      />
      {count > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {slides.map((slide, i) => (
            <View
              key={slide.id}
              style={[styles.dot, i === safeIndex && styles.dotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

// Crimson CTA matching the watch detail's Play pill: a solid-red button that
// gains a white ring on focus — the ring alone marks focus, no scale change.
function HeroCtaButton({
  label,
  onPress,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  onNode,
  selfNode,
  upFocusTarget,
}: {
  label: string
  onPress: () => void
  onFocus: () => void
  onBlur: () => void
  hasTVPreferredFocus?: boolean
  onNode?: (node: ViewType | null) => void
  selfNode: ViewType | null
  upFocusTarget?: ViewType | null
}) {
  const { setFocused, progress } = useFocusAnimation()
  const animatedStyle = useMemo(
    () => ({
      borderColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,0.9)"],
      }),
    }),
    [progress],
  )
  return (
    <Pressable
      ref={onNode}
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocus()
      }}
      onBlur={() => {
        setFocused(false)
        onBlur()
      }}
      // Stay on See more on Left (no real neighbour) so the capture turns Left
      // into a previous-slide instead of letting focus escape the hero.
      nextFocusLeft={selfNode ?? undefined}
      // Up bridges to the top bar's Search tab — geometry alone dead-ends here
      // (left-anchored button, centered tabs, no horizontal overlap).
      nextFocusUp={upFocusTarget ?? undefined}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.cta, animatedStyle]}>
        <Text style={styles.ctaLabel}>{label}</Text>
        <Ionicons
          name="chevron-forward"
          size={CTA_ICON_SIZE}
          color={WATCH_THEME.accentText}
        />
      </Animated.View>
    </Pressable>
  )
}

// Square next-slide button using the standardized invert-on-focus look (matches
// the watch hero's secondary pills): dark glass + white chevron at rest, flipping
// to a white fill + near-black chevron on focus. No ring — the fill is the cue.
function HeroChevronButton({
  onPress,
  onFocus,
  onBlur,
  onNode,
  selfNode,
  upFocusTarget,
}: {
  onPress: () => void
  onFocus: () => void
  onBlur: () => void
  onNode: (node: ViewType | null) => void
  selfNode: ViewType | null
  upFocusTarget?: ViewType | null
}) {
  const { setFocused, progress, transform } = useFocusVisual("pill", {
    nativeDriver: false,
  })
  const fillStyle = useMemo(
    () => ({
      backgroundColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
      }),
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.5],
      }),
      transform,
    }),
    [progress, transform],
  )
  return (
    <Pressable
      ref={onNode}
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocus()
      }}
      onBlur={() => {
        setFocused(false)
        onBlur()
      }}
      // Stay on the chevron on Right (no real neighbour) so the capture can turn
      // Right into an advance rather than letting focus escape the hero.
      nextFocusRight={selfNode ?? undefined}
      // Up bridges to the top bar's Search tab — same offset-geometry dead-end
      // as See more (both hero buttons share the one Up destination).
      nextFocusUp={upFocusTarget ?? undefined}
      accessibilityRole="button"
      accessibilityLabel="Next featured title"
    >
      <Animated.View style={[styles.chevron, fillStyle]}>
        <AnimatedFocusIcon
          name="chevron-forward"
          progress={progress}
          size={CHEVRON_ICON_SIZE}
        />
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(14),
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
    height: scale(62),
    paddingLeft: scale(30),
    paddingRight: scale(22),
    // Rounded rectangle matching the home cards (radius 16), not a pill.
    borderRadius: scale(16),
    backgroundColor: WATCH_THEME.accent,
    borderWidth: scale(3),
    // Resting crimson glow so the button reads as the hero's anchor action.
    shadowColor: WATCH_THEME.accent,
    shadowRadius: scale(16),
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: scale(6) },
  },
  ctaLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(25)),
    fontWeight: "700",
    color: WATCH_THEME.accentText,
  },
  // Square next-slide button, same height/radius as the See more CTA. backgroundColor +
  // shadowOpacity are animated in HeroChevronButton (dark glass → white fill on focus);
  // the static dark drop shadow is revealed by the focus shadowOpacity ramp.
  chevron: {
    width: scale(62),
    height: scale(62),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: scale(16),
    shadowColor: "#000000",
    shadowRadius: scale(14),
    shadowOffset: { width: 0, height: scale(6) },
  },
  // Page indicator: bottom-center of the hero region, just above the peeking
  // first rail.
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: scale(22),
    flexDirection: "row",
    justifyContent: "center",
    gap: scale(14),
  },
  dot: {
    width: scale(12),
    height: scale(12),
    borderRadius: scale(6),
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  dotActive: {
    backgroundColor: WATCH_THEME.text,
  },
})
