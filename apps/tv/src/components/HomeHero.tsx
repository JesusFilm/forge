import { useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Text,
  // @ts-expect-error TVFocusGuideView is provided by react-native-tvos but not in base RN types
  TVFocusGuideView,
  View,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"

import { COLORS, hexToRgba } from "../lib/colors"
import { scale } from "../lib/scale"
import { validateStreamingUrl } from "../lib/validateUrl"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55

// Crossfade duration for the media layers. Kept short so focus-driven
// swaps feel responsive on TV hardware.
const CROSSFADE_MS = 250

export type HomeHeroData = {
  id: string
  title: string
  subtitle?: string | null
  streamingUrl?: string | null
  posterUrl?: string | null
  onExplore?: () => void
}

type HomeHeroProps = {
  hero: HomeHeroData | null
}

/**
 * TV home hero with stacked-layer crossfade.
 *
 * - Two absolute-positioned media layers (previous + current) that
 *   cross-dissolve on `hero.id` change. Each layer owns its own
 *   `useVideoPlayer` via `MediaLayer` so the native player lifecycle
 *   matches the layer's mount lifecycle.
 * - Text overlay (title + subtitle + Explore CTA) is stable — it is
 *   NOT inside a crossfading layer. This preserves the identity of
 *   the Explore `Pressable` so (a) `hasTVPreferredFocus` only fires
 *   on first mount and (b) focus doesn't pong to Explore on every
 *   hero swap.
 * - Respects `AccessibilityInfo.isReduceMotionEnabled()` — snap
 *   between layers without animation when reduce-motion is on.
 */
export function HomeHero({ hero }: HomeHeroProps) {
  const [exploreFocused, setExploreFocused] = useState(false)
  const exploreRef = useRef<View>(null)

  // First-mount-only focus claim. Preserved across hero swaps because
  // the Pressable lives in the stable text overlay, not in a layer
  // that remounts on hero.id change.
  const [shouldClaimInitialFocus, setShouldClaimInitialFocus] = useState(true)
  useEffect(() => {
    setShouldClaimInitialFocus(false)
  }, [])

  // Accessibility: reduce-motion subscription.
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled)
    })
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    )
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  // Layer state: previous hero fades out, current hero fades in.
  const [prevHero, setPrevHero] = useState<HomeHeroData | null>(null)
  const [currentHero, setCurrentHero] = useState<HomeHeroData | null>(hero)
  const prevOpacity = useRef(new Animated.Value(0)).current
  const currentOpacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (hero?.id === currentHero?.id) return

    if (reduceMotion) {
      // Snap: no animation, skip mounting the previous layer entirely.
      setPrevHero(null)
      setCurrentHero(hero)
      prevOpacity.setValue(0)
      currentOpacity.setValue(1)
      return
    }

    setPrevHero(currentHero)
    setCurrentHero(hero)
    prevOpacity.setValue(1)
    currentOpacity.setValue(0)
    const anim = Animated.parallel([
      Animated.timing(prevOpacity, {
        toValue: 0,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(currentOpacity, {
        toValue: 1,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }),
    ])
    anim.start(({ finished }) => {
      if (finished) setPrevHero(null)
    })
    return () => anim.stop()
    // Intentionally compares hero?.id inside the effect instead of
    // listing currentHero as a dep, to avoid re-running when the effect
    // itself updates currentHero via setState.
  }, [hero?.id, reduceMotion])

  const accessibilityLabel = hero
    ? [hero.title, hero.subtitle].filter(Boolean).join(". ")
    : undefined

  return (
    <View
      style={styles.container}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="header"
    >
      {/* Previous media layer — fades out */}
      {prevHero ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: prevOpacity }]}
          pointerEvents="none"
        >
          <MediaLayer hero={prevHero} />
        </Animated.View>
      ) : null}

      {/* Current media layer — fades in */}
      {currentHero ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: currentOpacity }]}
          pointerEvents="none"
        >
          <MediaLayer hero={currentHero} />
        </Animated.View>
      ) : (
        <View
          style={[StyleSheet.absoluteFill, styles.fallbackBg]}
          pointerEvents="none"
        />
      )}

      {/* Shared gradient (always visible, static) */}
      <LinearGradient
        colors={[hexToRgba(COLORS.surface, 0), COLORS.surface]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Text overlay — stable, never unmounted on hero swap */}
      <TVFocusGuideView
        style={styles.textContainer}
        destinations={
          exploreRef.current
            ? [findNodeHandle(exploreRef.current)!].filter(Boolean)
            : undefined
        }
      >
        {currentHero ? (
          <>
            <Text style={styles.title} numberOfLines={2}>
              {currentHero.title}
            </Text>
            {currentHero.subtitle ? (
              <Text style={styles.subtitle} numberOfLines={2}>
                {currentHero.subtitle}
              </Text>
            ) : null}
            {currentHero.onExplore ? (
              <Pressable
                ref={exploreRef}
                onPress={currentHero.onExplore}
                onFocus={() => setExploreFocused(true)}
                onBlur={() => setExploreFocused(false)}
                style={[
                  styles.exploreButton,
                  exploreFocused && styles.exploreButtonFocused,
                ]}
                hasTVPreferredFocus={shouldClaimInitialFocus}
                accessibilityLabel={`Explore ${currentHero.title}`}
                accessibilityRole="button"
              >
                <Text style={styles.exploreText}>Explore</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </TVFocusGuideView>
    </View>
  )
}

/**
 * Single media layer — video when a valid streaming URL is present,
 * poster image when only an image is available, solid fallback surface
 * otherwise. Each layer owns its own `useVideoPlayer` so native
 * resources track the React component lifecycle cleanly.
 *
 * To avoid a black flash during HLS source init (Android TV `VideoView`
 * punches through the RN hierarchy, tvOS's `AVPlayerLayer` is black
 * until first frame), the poster image is always rendered first and
 * the `VideoView` is only mounted once the player reports
 * `readyToPlay`. A short crossfade hands the painted frames off from
 * the poster to the video once it arrives.
 */
function MediaLayer({ hero }: { hero: HomeHeroData }) {
  const streamingUrl =
    typeof hero.streamingUrl === "string" &&
    validateStreamingUrl(hero.streamingUrl)
      ? hero.streamingUrl
      : null
  const hasValidStream = streamingUrl !== null

  const player = useVideoPlayer(streamingUrl, (p) => {
    p.muted = true
    p.loop = true
  })

  // Track whether the player's source has loaded and is ready to render
  // its first frame. Used to gate mounting the native VideoView.
  const [videoReady, setVideoReady] = useState(false)
  const videoOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!hasValidStream) {
      setVideoReady(false)
      return
    }

    // Initial check — if the player is already ready when we subscribe,
    // we still want to flip to ready.
    if (player.status === "readyToPlay") {
      setVideoReady(true)
    }

    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") {
        setVideoReady(true)
      } else if (status === "error" || status === "idle") {
        setVideoReady(false)
      }
    })
    return () => sub.remove()
  }, [player, hasValidStream])

  useEffect(() => {
    if (!hasValidStream) return
    try {
      player.play()
    } catch {
      // Native player already released; benign.
    }
  }, [player, hasValidStream])

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released; benign.
      }
    }
  }, [player])

  // Fade the video on top of the poster once it's ready.
  useEffect(() => {
    Animated.timing(videoOpacity, {
      toValue: videoReady ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start()
  }, [videoReady, videoOpacity])

  const posterUri = hero.posterUrl ?? null

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Base layer — poster image or solid fallback, always painted
          first so no black flash appears while the native video
          surface initializes. */}
      {posterUri ? (
        <Image
          source={{ uri: posterUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`hero-poster-${hero.id}`}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}

      {/* Video surface — mounted only after the player reports
          readyToPlay, and faded in over the poster. */}
      {hasValidStream && videoReady ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: videoOpacity }]}
        >
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
            focusable={false}
          />
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: HERO_HEIGHT,
    position: "relative",
    overflow: "hidden",
  },
  fallbackBg: {
    backgroundColor: COLORS.surfaceContainer,
  },
  textContainer: {
    position: "absolute",
    bottom: scale(48),
    left: scale(80),
    right: scale(80),
  },
  title: {
    fontFamily: "System",
    fontSize: scale(44),
    fontWeight: "bold",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: "System",
    fontSize: scale(20),
    color: COLORS.muted,
    marginTop: scale(8),
  },
  exploreButton: {
    marginTop: scale(20),
    alignSelf: "flex-start",
    backgroundColor: COLORS.primary,
    paddingHorizontal: scale(40),
    paddingVertical: scale(14),
    borderRadius: scale(8),
  },
  exploreButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: COLORS.primary,
    shadowRadius: scale(30),
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
  },
  exploreText: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.text,
  },
})
