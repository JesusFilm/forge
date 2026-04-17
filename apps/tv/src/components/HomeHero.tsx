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

// Crossfade duration for the outer media layers (prev video → new
// poster). Kept short so focus-driven swaps feel responsive on TV
// hardware.
const CROSSFADE_MS = 250

// After the incoming hero's video reports ready, hold the poster
// visible for this long before fading it out. Gives the eye a
// stable still image between the outgoing video and the new video
// instead of rapid-fire "video → still → still → video".
const POSTER_HOLD_MS = 500

// Duration of the final poster-to-video crossfade once the hold ends.
const POSTER_FADE_MS = 500

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

  // Layer stack: a list of hero entries rendered in order (oldest first,
  // newest on top). Each entry has its own persistent Animated opacity so
  // the React subtree stays mounted across commits — keyed by hero.id in
  // render so the outgoing MediaLayer is preserved and its VideoView
  // keeps painting the last frame of the previous experience during the
  // crossfade (instead of flashing back to that experience's poster).
  type HeroEntry = {
    hero: HomeHeroData
    opacity: Animated.Value
  }
  const [entries, setEntries] = useState<HeroEntry[]>(() =>
    hero ? [{ hero, opacity: new Animated.Value(1) }] : [],
  )
  const activeHeroId = entries[entries.length - 1]?.hero.id ?? null

  useEffect(() => {
    if (!hero) return
    if (hero.id === activeHeroId) return

    if (reduceMotion) {
      setEntries([{ hero, opacity: new Animated.Value(1) }])
      return
    }

    const newEntry: HeroEntry = {
      hero,
      opacity: new Animated.Value(0),
    }

    // Snapshot prior entries for fade-out animation.
    const outgoing = entries

    setEntries([...outgoing, newEntry])

    const anim = Animated.parallel([
      Animated.timing(newEntry.opacity, {
        toValue: 1,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }),
      ...outgoing.map((e) =>
        Animated.timing(e.opacity, {
          toValue: 0,
          duration: CROSSFADE_MS,
          useNativeDriver: true,
        }),
      ),
    ])

    anim.start(({ finished }) => {
      if (!finished) return
      // Prune any entries that are no longer the active hero once the
      // crossfade completes — their native video players get released
      // via MediaLayer's unmount cleanup.
      setEntries((prev) => prev.filter((e) => e.hero.id === newEntry.hero.id))
    })

    return () => anim.stop()
    // activeHeroId derives from entries; listing it would double-trigger.
  }, [hero?.id, reduceMotion])

  const activeHero =
    entries.find((e) => e.hero.id === activeHeroId)?.hero ?? hero
  const accessibilityLabel = activeHero
    ? [activeHero.title, activeHero.subtitle].filter(Boolean).join(". ")
    : undefined

  return (
    <View
      style={styles.container}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="header"
    >
      {/* Stacked media layers. Keyed by hero.id so React preserves
          outgoing MediaLayer subtrees across commits — the previous
          experience's VideoView keeps painting its last-playing frame
          during the fade instead of reverting to its own poster. */}
      {entries.length > 0 ? (
        entries.map((entry) => {
          const isActive = entry.hero.id === activeHeroId
          return (
            <Animated.View
              key={entry.hero.id}
              style={[StyleSheet.absoluteFill, { opacity: entry.opacity }]}
              pointerEvents="none"
            >
              <MediaLayer
                hero={entry.hero}
                isActive={isActive}
                reduceMotion={reduceMotion}
              />
            </Animated.View>
          )
        })
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
        {activeHero ? (
          <>
            <Text style={styles.title} numberOfLines={2}>
              {activeHero.title}
            </Text>
            {activeHero.subtitle ? (
              <Text style={styles.subtitle} numberOfLines={2}>
                {activeHero.subtitle}
              </Text>
            ) : null}
            {activeHero.onExplore ? (
              <Pressable
                ref={exploreRef}
                onPress={activeHero.onExplore}
                onFocus={() => setExploreFocused(true)}
                onBlur={() => setExploreFocused(false)}
                style={[
                  styles.exploreButton,
                  exploreFocused && styles.exploreButtonFocused,
                ]}
                hasTVPreferredFocus={shouldClaimInitialFocus}
                accessibilityLabel={`Explore ${activeHero.title}`}
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
 * Timing sequence when a new hero commits:
 * 1. Outgoing layer (`isActive=false`): pause the native player so its
 *    last painted frame freezes — no reversion to the outgoing
 *    experience's poster image while fading out.
 * 2. Incoming layer (`isActive=true`): show the poster image as a
 *    base layer. The VideoView is only mounted after the player
 *    reports `readyToPlay`, avoiding the black-flash window during
 *    HLS init.
 * 3. Once the video is ready AND the incoming layer is active, hold
 *    the poster visible for `POSTER_HOLD_MS` so the eye gets a stable
 *    still between the outgoing and incoming videos, then fade the
 *    video in over `POSTER_FADE_MS`. When Reduce Motion is on, skip
 *    the hold and snap instantly.
 */
function MediaLayer({
  hero,
  isActive,
  reduceMotion,
}: {
  hero: HomeHeroData
  isActive: boolean
  reduceMotion: boolean
}) {
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

  // Play when active, pause on deactivate so the outgoing layer
  // freezes on its last frame instead of continuing to play during the
  // crossfade (and instead of reverting to its own poster image).
  useEffect(() => {
    if (!hasValidStream) return
    try {
      if (isActive) {
        player.play()
      } else {
        player.pause()
      }
    } catch {
      // Native player already released; benign.
    }
  }, [player, hasValidStream, isActive])

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released; benign.
      }
    }
  }, [player])

  // Drive the poster-hold → video-fade-in sequence on the active layer.
  // The outgoing layer's videoOpacity is left alone: when React unmounts
  // it after the outer crossfade completes, whatever value it holds
  // (typically already 1, since the previous hero's video was the one
  // that was playing) was being painted by the VideoView anyway.
  useEffect(() => {
    if (!isActive) return

    if (reduceMotion) {
      videoOpacity.setValue(videoReady ? 1 : 0)
      return
    }

    if (!videoReady) {
      videoOpacity.setValue(0)
      return
    }

    const anim = Animated.sequence([
      Animated.delay(POSTER_HOLD_MS),
      Animated.timing(videoOpacity, {
        toValue: 1,
        duration: POSTER_FADE_MS,
        useNativeDriver: true,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [isActive, videoReady, reduceMotion, videoOpacity])

  const posterUri = hero.posterUrl ?? null

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Base: poster image (or solid fallback) — always painted first
          so no black flash appears while the native video surface
          initializes. */}
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

      {/* Video — mounted once ready, held invisible over the poster for
          POSTER_HOLD_MS, then crossfaded in over POSTER_FADE_MS. */}
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
