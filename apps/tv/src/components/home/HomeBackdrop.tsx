// Full-screen ambient backdrop for the redesigned Home — absolutely
// positioned BEHIND all content (non-focusable, pointerEvents "none"; absolute
// decorative layers are fine, only focusables must stay in flow). Paints the
// focused card's artwork full-bleed with a ~600ms crossfade, beneath the
// design's three ambient gradients and a deep scrim whose opacity tracks the
// browse state ("top" 0 / "browse" 0.22 / "deep" 1, ~500ms).
//
// Crossfade: two stacked expo-image slots swapping opacity. The incoming slot
// fades in ONLY after its image reports onLoad — expo-image's own `transition`
// clears to blank between sources on a single layer, which is exactly the
// flash this two-slot dance avoids. Slot images are keyed by URL so a slot
// never shows a stale frame from two swaps ago. A generation counter
// invalidates loads/fades that a newer focus target supersedes.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { Animated, Platform, StyleSheet, View } from "react-native"

import { resolveImageUrl } from "../../lib/resolveImageUrl"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { deepScrimOpacity, type HomeBrowseState } from "./homeScrollState"

/** Artwork crossfade duration (design: `transition: opacity .6s ease`). */
const CROSSFADE_MS = 600
/** Deep-scrim opacity tween (design: `transition: opacity .5s ease`). */
const DEEP_SCRIM_MS = 500
/** Quick restore when a pending crossfade is cancelled or superseded. */
const CANCEL_FADE_MS = 200

// Android drops the ambient backdrop entirely: the Sabrina GPU can't composite
// its full-screen layers (artwork + 3 gradients + deep scrim) over the rail tree
// each frame (~150ms/redraw). Rails sit on the near-black base; tvOS keeps it.
const IS_ANDROID = Platform.OS === "android"

// The design's ambient scrim — three stacked gradients over the artwork, all
// on the WATCH_THEME near-black scrim base. Module-scope so the gradient
// props keep one identity across renders; WATCH_THEME.scrim(0) (never
// "transparent") avoids dark banding.
//
// The three ambient scrims + the deep-scrim color are exported so the hero
// pager (HeroPager) can paint pixel-matched scrims over its own sliding
// artwork. Export-only — the constants and this component's behavior are
// otherwise unchanged.
//
// linear-gradient(90deg, rgba(7,7,8,.9) 0%, rgba(7,7,8,.5) 36%, 0 at 62%)
export const LEFT_SCRIM_COLORS = [
  WATCH_THEME.scrim(0.9),
  WATCH_THEME.scrim(0.5),
  WATCH_THEME.scrim(0),
] as const
export const LEFT_SCRIM_LOCATIONS = [0, 0.36, 0.62] as const
export const LEFT_SCRIM_START = { x: 0, y: 0.5 }
export const LEFT_SCRIM_END = { x: 1, y: 0.5 }

// linear-gradient(0deg, rgba(7,7,8,.96) 6%, rgba(7,7,8,.55) 30%, 0 at 58%)
export const BOTTOM_SCRIM_COLORS = [
  WATCH_THEME.scrim(0.96),
  WATCH_THEME.scrim(0.55),
  WATCH_THEME.scrim(0),
] as const
export const BOTTOM_SCRIM_LOCATIONS = [0.06, 0.3, 0.58] as const
export const BOTTOM_SCRIM_START = { x: 0.5, y: 1 }
export const BOTTOM_SCRIM_END = { x: 0.5, y: 0 }

// linear-gradient(180deg, rgba(7,7,8,.55) 0%, 0 at 20%)
export const TOP_SCRIM_COLORS = [
  WATCH_THEME.scrim(0.55),
  WATCH_THEME.scrim(0),
] as const
export const TOP_SCRIM_LOCATIONS = [0, 0.2] as const
export const TOP_SCRIM_START = { x: 0.5, y: 0 }
export const TOP_SCRIM_END = { x: 0.5, y: 1 }

/** Deep scrim layer color (design `.deep-scrim`); its OPACITY is animated. */
export const DEEP_SCRIM_COLOR = "rgba(6,6,8,0.9)"

type SlotIndex = 0 | 1

type PendingCrossfade = {
  slot: SlotIndex
  url: string
  generation: number
}

type HomeBackdropProps = {
  /** The showcased card (null while the model loads — dark base only). */
  card: WatchHomeCard | null
  browseState: HomeBrowseState
}

export const HomeBackdrop = memo(function HomeBackdrop({
  card,
  browseState,
}: HomeBackdropProps) {
  // CMS-sourced URL is untrusted — sanitize before it reaches expo-image.
  const imageUrl = useMemo(
    () => (card?.imageUrl != null ? resolveImageUrl(card.imageUrl) : null),
    [card?.imageUrl],
  )

  // ── Two-slot crossfade machinery ──
  // State drives WHAT each slot renders; refs drive the orchestration so
  // animation callbacks never set state after unmount.
  const [slotUrls, setSlotUrls] = useState<[string | null, string | null]>([
    null,
    null,
  ])
  const slotUrlsRef = useRef<[string | null, string | null]>([null, null])
  const slotOpacitiesRef = useRef([
    new Animated.Value(1),
    new Animated.Value(0),
  ] as const)
  const frontIndexRef = useRef<SlotIndex>(0)
  const generationRef = useRef(0)
  const pendingRef = useRef<PendingCrossfade | null>(null)

  const startCrossfade = useCallback((slot: SlotIndex, generation: number) => {
    if (generation !== generationRef.current) return
    const opacities = slotOpacitiesRef.current
    const other: SlotIndex = slot === 0 ? 1 : 0
    // Mark intent eagerly: `slot` is the front from now on, even before the
    // fade finishes. A focus change that supersedes this fade then reads the
    // correct front/back and crossfades FROM the in-flight target rather than
    // snapping back to the prior front.
    frontIndexRef.current = slot
    Animated.parallel([
      Animated.timing(opacities[slot], {
        toValue: 1,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(opacities[other], {
        toValue: 0,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }),
    ]).start()
  }, [])

  // The incoming slot's image finished loading (or errored — degrade to
  // whatever the slot renders rather than stalling the fade forever).
  const handleSlotLoaded = useCallback(
    (slot: SlotIndex, url: string) => {
      const pending = pendingRef.current
      if (pending == null || pending.slot !== slot || pending.url !== url)
        return
      pendingRef.current = null
      startCrossfade(slot, pending.generation)
    },
    [startCrossfade],
  )

  useEffect(() => {
    // Android renders the single-slot path below — skip the two-slot dance.
    if (IS_ANDROID) return
    const opacities = slotOpacitiesRef.current
    const front = frontIndexRef.current
    const back: SlotIndex = front === 0 ? 1 : 0
    generationRef.current += 1
    const generation = generationRef.current

    if (slotUrlsRef.current[front] === imageUrl) {
      // Back to the already-displayed artwork (or still on it): abort any
      // pending crossfade and restore the resting opacities.
      pendingRef.current = null
      Animated.parallel([
        Animated.timing(opacities[front], {
          toValue: 1,
          duration: CANCEL_FADE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacities[back], {
          toValue: 0,
          duration: CANCEL_FADE_MS,
          useNativeDriver: true,
        }),
      ]).start()
      return
    }

    // Back slot ALREADY holds the target artwork (e.g. A->B->A): its Image is
    // mounted and loaded, so its URL-keyed onLoad will NOT fire again. Waiting
    // on pendingRef for that load would stall forever — the backdrop would
    // stay stuck on the front card while the billboard shows the target.
    // Crossfade to the back slot directly instead.
    if (imageUrl != null && slotUrlsRef.current[back] === imageUrl) {
      pendingRef.current = null
      startCrossfade(back, generation)
      return
    }

    // Load the incoming artwork into the hidden back slot.
    slotUrlsRef.current =
      back === 0
        ? [imageUrl, slotUrlsRef.current[1]]
        : [slotUrlsRef.current[0], imageUrl]
    setSlotUrls(slotUrlsRef.current)
    opacities[back].setValue(0)
    // The front may sit mid-fade from a superseded crossfade — bring it back
    // to full while the incoming artwork loads so the backdrop never dims.
    Animated.timing(opacities[front], {
      toValue: 1,
      duration: CANCEL_FADE_MS,
      useNativeDriver: true,
    }).start()

    if (imageUrl == null) {
      // No artwork: nothing to load — crossfade to the dark base now.
      pendingRef.current = null
      startCrossfade(back, generation)
    } else {
      pendingRef.current = { slot: back, url: imageUrl, generation }
    }
  }, [imageUrl, startCrossfade])

  // ── Deep scrim ──
  const deepScrim = useRef(
    new Animated.Value(deepScrimOpacity(browseState)),
  ).current
  useEffect(() => {
    const animation = Animated.timing(deepScrim, {
      toValue: deepScrimOpacity(browseState),
      duration: DEEP_SCRIM_MS,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [browseState, deepScrim])

  const opacities = slotOpacitiesRef.current

  // Android: no ambient backdrop (see IS_ANDROID comment) — rails on the near-black
  // screen base. All hooks above still run so the rules of hooks hold; the
  // two-slot effect already no-ops on Android.
  if (IS_ANDROID) return null

  return (
    <View
      style={styles.container}
      focusable={false}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {([0, 1] as const).map((slot) => (
        <Animated.View
          key={`backdrop-slot-${slot}`}
          style={[StyleSheet.absoluteFill, { opacity: opacities[slot] }]}
        >
          {slotUrls[slot] != null ? (
            <Image
              // Keyed by URL: a re-targeted slot remounts its Image so no
              // stale frame from a previous swap can paint mid-crossfade.
              key={slotUrls[slot]}
              source={{ uri: slotUrls[slot] ?? undefined }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              onLoad={() => {
                const url = slotUrlsRef.current[slot]
                if (url != null) handleSlotLoaded(slot, url)
              }}
              onError={() => {
                const url = slotUrlsRef.current[slot]
                if (url != null) handleSlotLoaded(slot, url)
              }}
            />
          ) : null}
        </Animated.View>
      ))}

      {/* collapsable={false} keeps the scrims discrete native views on
          Android TV. */}
      <LinearGradient
        colors={LEFT_SCRIM_COLORS}
        locations={LEFT_SCRIM_LOCATIONS}
        start={LEFT_SCRIM_START}
        end={LEFT_SCRIM_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        collapsable={false}
      />
      <LinearGradient
        colors={BOTTOM_SCRIM_COLORS}
        locations={BOTTOM_SCRIM_LOCATIONS}
        start={BOTTOM_SCRIM_START}
        end={BOTTOM_SCRIM_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        collapsable={false}
      />
      <LinearGradient
        colors={TOP_SCRIM_COLORS}
        locations={TOP_SCRIM_LOCATIONS}
        start={TOP_SCRIM_START}
        end={TOP_SCRIM_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        collapsable={false}
      />

      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.deepScrim,
          { opacity: deepScrim },
        ]}
        pointerEvents="none"
        collapsable={false}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    // Near-black base shows through before artwork loads and behind
    // crossfades to cards with no artwork.
    backgroundColor: WATCH_THEME.scrim(1),
    overflow: "hidden",
  },
  deepScrim: {
    backgroundColor: DEEP_SCRIM_COLOR,
  },
})
