// The hero pager — a screen-level layer that pages the hero slides. The ARTWORK
// slides (Apple-TV page-flip: the incoming image slides in over the current,
// from the right on "next" / from the left on "previous"); the COPY
// crossfades (a separate dissolve layer), so text and image transition with
// distinct motions. On ANDROID the artwork crossfades too (opacity dissolve, the
// IS_ANDROID path in runSlide) — a full-screen slide steps visibly at ~24fps.
//
// Layered ABOVE the ambient HomeBackdrop and BELOW the ScrollView, so the hero
// action row (See more + chevron, in the ScrollView flow) stays pinned on top
// while only the art + copy animate. HomeBackdrop is untouched and keeps
// driving rail-browse art; this layer fades out (`visible=false`) when a rail is
// focused so the backdrop's rail-card art shows, and fades back in on return.
//
// Artwork = a two-cell ring. The front cell rests at translateX 0; the back
// cell parks off-screen on the side the incoming slide will enter from. An
// advance paints the incoming card into the back cell, waits for its image to
// load (or a short fallback), slides it to 0 over the front, then in the SAME
// frame flips the front face and reparks the old front off-screen — so no frame
// ever shows old art. Advances are SERIALIZED: a press arriving mid-slide
// records the new target and the slide chains to the latest index on commit
// (coalescing skipped slides), so rapid paging never snaps a cell mid-travel. A
// generation counter guards stale commits; everything is cancelled on unmount.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  StyleSheet,
  View,
} from "react-native"

import { resolveImageUrl } from "../../lib/resolveImageUrl"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import {
  BOTTOM_SCRIM_COLORS,
  BOTTOM_SCRIM_END,
  BOTTOM_SCRIM_LOCATIONS,
  BOTTOM_SCRIM_START,
  DEEP_SCRIM_COLOR,
  LEFT_SCRIM_COLORS,
  LEFT_SCRIM_END,
  LEFT_SCRIM_LOCATIONS,
  LEFT_SCRIM_START,
  TOP_SCRIM_COLORS,
  TOP_SCRIM_END,
  TOP_SCRIM_LOCATIONS,
  TOP_SCRIM_START,
} from "./HomeBackdrop"
import { backFace, shouldSkipSlide } from "./heroPagerState"
import {
  HERO_COPY_PADDING_BOTTOM,
  HERO_PADDING_LEFT,
  HERO_REGION_HEIGHT,
} from "./heroLayout"
import { HeroCopyBlock } from "./HeroCopyBlock"
import { TOP_BAR_HEIGHT } from "./HomeTopBar"
import { deepScrimOpacity } from "./homeScrollState"

/** Artwork page-flip slide duration; transform-only, native driver (tvOS). */
const SLIDE_MS = 420
/** Android: replace the artwork slide with an opacity crossfade. A full-screen
 *  slide steps visibly at the Sabrina SoC's ~24fps; a native-driven opacity
 *  dissolve reads far softer. Matches the copy crossfade so they move as one. */
const IS_ANDROID = Platform.OS === "android"
const ARTWORK_FADE_MS = 300
/** Copy crossfade duration — the incoming copy fades IN while the outgoing
 *  fades OUT (a true crossfade, so the text is never fully blank). Roughly the
 *  slide budget so copy and artwork read as one transition. */
const COPY_FADE_MS = 280
/** Slide-layer fade on hero↔rail handoff. */
const VISIBLE_FADE_MS = 220
/** Start the slide even if the incoming image's onLoad is slow, so a press
 *  never feels dead on a cold cache. */
const LOAD_FALLBACK_MS = 250
/** Off-screen park distance — the real window width (incl. any overscan), never
 *  a scaled design constant, so the parked cell can't peek on an edge. */
const PARK_X = Dimensions.get("window").width

/** Browse-state deep wash baked static (the hero is always in "browse" while
 *  the pager is visible) so the pager matches the backdrop's darkening. */
const DEEP_WASH_OPACITY = deepScrimOpacity("browse")

type Slot = WatchHomeCard | null
type PendingSlide = { back: 0 | 1; url: string; gen: number }

type HeroPagerProps = {
  slides: WatchHomeCard[]
  /** Which slide to display. A change advances the ring. */
  index: number
  /** +1 = the incoming slide enters from the right (next); -1 = from the left
   *  (previous). Updated together with `index` by the screen. */
  direction: number
  /** False while a rail is focused — fade out to reveal the backdrop's art. */
  visible: boolean
}

export const HeroPager = memo(function HeroPager({
  slides,
  index,
  direction,
  visible,
}: HeroPagerProps) {
  const first = slides[index] ?? slides[0] ?? null

  // ── Artwork two-cell ring ──
  const [slotCards, setSlotCards] = useState<[Slot, Slot]>([first, null])
  const [frontFace, setFrontFace] = useState<0 | 1>(0)
  // Ref mirrors so animation callbacks read settled values, not stale closures.
  const slotCardsRef = useRef<[Slot, Slot]>([first, null])
  const frontRef = useRef<0 | 1>(0)
  // Android stacks both cells at x=0 and crossfades via opRef; tvOS parks the
  // back cell off-screen and slides it via txRef.
  const txRef = useRef([
    new Animated.Value(0),
    new Animated.Value(IS_ANDROID ? 0 : PARK_X),
  ] as const)
  const opRef = useRef([
    new Animated.Value(1),
    new Animated.Value(IS_ANDROID ? 0 : 1),
  ] as const)
  const genRef = useRef(0)
  const pendingRef = useRef<PendingSlide | null>(null)
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slidingRef = useRef(false)
  // Latest target/direction/slides for the commit-time chain (a press arriving
  // mid-slide updates these; the slide coalesces to them when it lands).
  const indexRef = useRef(index)
  const directionRef = useRef(direction)
  const slidesRef = useRef(slides)
  slidesRef.current = slides
  // beginSlide ↔ runSlide reference each other; a ref breaks the cycle.
  const beginSlideRef = useRef<() => void>(() => {})

  const paint = useCallback((cell: 0 | 1, card: Slot) => {
    const next: [Slot, Slot] =
      cell === 0
        ? [card, slotCardsRef.current[1]]
        : [slotCardsRef.current[0], card]
    slotCardsRef.current = next
    setSlotCards(next)
  }, [])

  const runSlide = useCallback((back: 0 | 1, gen: number) => {
    if (gen !== genRef.current) return
    if (fallbackRef.current != null) {
      clearTimeout(fallbackRef.current)
      fallbackRef.current = null
    }
    pendingRef.current = null
    // Android: fade the incoming cell IN over the resting front (dissolve).
    // tvOS: slide the incoming cell across to x=0 over the front.
    const transition = IS_ANDROID
      ? Animated.timing(opRef.current[back], {
          toValue: 1,
          duration: ARTWORK_FADE_MS,
          useNativeDriver: true,
        })
      : Animated.timing(txRef.current[back], {
          toValue: 0,
          duration: SLIDE_MS,
          easing: Easing.bezier(0.22, 0.61, 0.36, 1),
          useNativeDriver: true,
        })
    transition.start(({ finished }) => {
      if (!finished || gen !== genRef.current) return
      // Commit under the now-opaque incoming cell: flip the front face and hide
      // the old front in the SAME frame (Android: opacity 0; tvOS: repark
      // off-screen) — never clear its source first (would expose a frame).
      const oldFront = frontRef.current
      frontRef.current = back
      setFrontFace(back)
      if (IS_ANDROID) {
        opRef.current[oldFront].setValue(0)
      } else {
        txRef.current[oldFront].setValue(PARK_X)
      }
      slidingRef.current = false
      // Coalesce: if newer presses moved the target past this slide, chain to
      // the latest index now (skipping the intermediates we never rendered).
      const latest = slidesRef.current[indexRef.current] ?? null
      const newFront = slotCardsRef.current[back]
      if (latest != null && latest.id !== newFront?.id) beginSlideRef.current()
    })
  }, [])

  const beginSlide = useCallback(() => {
    const incoming = slidesRef.current[indexRef.current] ?? null
    if (incoming == null) return
    const front = frontRef.current
    if (shouldSkipSlide(incoming.id, slotCardsRef.current[front]?.id)) return

    genRef.current += 1
    const gen = genRef.current
    const back = backFace(front)
    slidingRef.current = true
    // Stage the incoming cell hidden, then paint it (unless it already shows
    // this card — e.g. an A→B→A wrap — whose image is mounted + loaded and won't
    // fire onLoad again). Android: opacity 0 at x=0. tvOS: parked off-screen.
    if (IS_ANDROID) {
      opRef.current[back].setValue(0)
    } else {
      txRef.current[back].setValue(directionRef.current >= 0 ? PARK_X : -PARK_X)
    }
    const alreadyShowing = slotCardsRef.current[back]?.id === incoming.id
    if (!alreadyShowing) paint(back, incoming)

    const url =
      incoming.imageUrl != null ? resolveImageUrl(incoming.imageUrl) : null
    if (alreadyShowing || url == null) {
      runSlide(back, gen)
      return
    }
    pendingRef.current = { back, url, gen }
    if (fallbackRef.current != null) clearTimeout(fallbackRef.current)
    fallbackRef.current = setTimeout(
      () => runSlide(back, gen),
      LOAD_FALLBACK_MS,
    )
  }, [paint, runSlide])
  beginSlideRef.current = beginSlide

  // A cell's image finished loading — start the pending slide if it's the one
  // we're waiting on (URL-keyed so a stale load can't trigger a slide).
  const handleCellLoaded = useCallback(
    (cell: 0 | 1, url: string) => {
      const pending = pendingRef.current
      if (pending == null || pending.back !== cell || pending.url !== url)
        return
      runSlide(cell, pending.gen)
    },
    [runSlide],
  )

  // Advance whenever `index` points at a new slide. A press mid-slide only
  // records the latest target/direction; the in-flight slide chains to it on
  // commit (no mid-travel re-park).
  useEffect(() => {
    indexRef.current = index
    directionRef.current = direction
    if (slidingRef.current) return
    beginSlide()
  }, [index, direction, beginSlide])

  // ── Visible (hero↔rail) fade ──
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current
  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: VISIBLE_FADE_MS,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [visible, opacity])

  // Cancel slides + the fallback timer on unmount so callbacks can't fire into
  // a dead tree (navigating to /search or a detail mid-slide).
  useEffect(() => {
    const tx = txRef.current
    const op = opRef.current
    return () => {
      tx[0].stopAnimation()
      tx[1].stopAnimation()
      op[0].stopAnimation()
      op[1].stopAnimation()
      if (fallbackRef.current != null) clearTimeout(fallbackRef.current)
    }
  }, [])

  if (slides.length === 0) return null

  return (
    <Animated.View
      style={[styles.root, { opacity }]}
      focusable={false}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {([0, 1] as const).map((cell) => (
        <HeroArtworkCell
          key={`hero-cell-${cell}`}
          card={slotCards[cell]}
          translateX={txRef.current[cell]}
          opacity={opRef.current[cell]}
          // The incoming (back) cell paints ON TOP of the resting front.
          onTop={cell !== frontFace}
          onLoaded={handleCellLoaded}
          cell={cell}
        />
      ))}
      <HeroCopyLayer card={slides[index] ?? first} />
    </Animated.View>
  )
})

// One artwork cell: full-bleed image + the ambient scrims + a static deep wash.
// No copy — the copy is a separate crossfade layer so it doesn't slide.
function HeroArtworkCell({
  card,
  translateX,
  opacity,
  onTop,
  onLoaded,
  cell,
}: {
  card: Slot
  translateX: Animated.Value
  opacity: Animated.Value
  onTop: boolean
  onLoaded: (cell: 0 | 1, url: string) => void
  cell: 0 | 1
}) {
  const url = useMemo(
    () => (card?.imageUrl != null ? resolveImageUrl(card.imageUrl) : null),
    [card?.imageUrl],
  )
  const cellStyle = useMemo(
    // Android drives the crossfade via opacity; tvOS slides and never animates
    // opacity, so omit it there to keep the cell on its original style (no layer).
    () =>
      IS_ANDROID
        ? { transform: [{ translateX }], opacity, zIndex: onTop ? 2 : 1 }
        : { transform: [{ translateX }], zIndex: onTop ? 2 : 1 },
    [translateX, opacity, onTop],
  )

  if (card == null) {
    return <Animated.View style={[StyleSheet.absoluteFill, cellStyle]} />
  }

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, cellStyle]}
      collapsable={false}
      pointerEvents="none"
    >
      {url != null ? (
        <Image
          // URL-keyed so a re-staged cell remounts and fires a fresh onLoad.
          key={url}
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={url}
          onLoad={() => onLoaded(cell, url)}
        />
      ) : null}

      <LinearGradient
        colors={LEFT_SCRIM_COLORS}
        locations={LEFT_SCRIM_LOCATIONS}
        start={LEFT_SCRIM_START}
        end={LEFT_SCRIM_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={BOTTOM_SCRIM_COLORS}
        locations={BOTTOM_SCRIM_LOCATIONS}
        start={BOTTOM_SCRIM_START}
        end={BOTTOM_SCRIM_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={TOP_SCRIM_COLORS}
        locations={TOP_SCRIM_LOCATIONS}
        start={TOP_SCRIM_START}
        end={TOP_SCRIM_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.deepWash} pointerEvents="none" />
    </Animated.View>
  )
}

// The hero copy (eyebrow/title/description/meta) as a TRUE crossfade layer: two
// stacked cells whose opacities swap — the incoming fades IN while the outgoing
// fades OUT, so the copy is NEVER fully blank. (A through-blank dissolve reads
// as the text disappearing, and THRASHES toward 0 under rapid paging because
// each page restarts the fade-out.) Serialized like the artwork: a change
// mid-crossfade only updates the target and the in-flight crossfade chains to
// the latest on completion, so fast scrubbing coalesces onto the final copy
// instead of flickering. Sits above the artwork cells at the hero copy
// geometry, so it lands where the pinned action row expects it.
function HeroCopyLayer({ card }: { card: Slot }) {
  const [slots, setSlots] = useState<[Slot, Slot]>([card, null])
  const slotsRef = useRef<[Slot, Slot]>([card, null])
  const frontRef = useRef<0 | 1>(0)
  const opRef = useRef([new Animated.Value(1), new Animated.Value(0)] as const)
  const targetRef = useRef<Slot>(card)
  const animatingRef = useRef(false)
  const runRef = useRef<() => void>(() => {})

  const paint = useCallback((cell: 0 | 1, next: Slot) => {
    const slotsNext: [Slot, Slot] =
      cell === 0 ? [next, slotsRef.current[1]] : [slotsRef.current[0], next]
    slotsRef.current = slotsNext
    setSlots(slotsNext)
  }, [])

  const run = useCallback(() => {
    const f = frontRef.current
    const target = targetRef.current
    if ((target?.id ?? null) === (slotsRef.current[f]?.id ?? null)) {
      animatingRef.current = false
      return
    }
    animatingRef.current = true
    const b: 0 | 1 = f === 0 ? 1 : 0
    paint(b, target)
    opRef.current[b].setValue(0)
    Animated.parallel([
      Animated.timing(opRef.current[b], {
        toValue: 1,
        duration: COPY_FADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(opRef.current[f], {
        toValue: 0,
        duration: COPY_FADE_MS,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      // Interrupted (only on unmount today, when both op values are stopped):
      // clear the gate so it can never strand and silence a later card change.
      if (!finished) {
        animatingRef.current = false
        return
      }
      frontRef.current = b
      // Coalesce: if newer copies arrived during the fade, chain to the latest.
      if (
        (targetRef.current?.id ?? null) !== (slotsRef.current[b]?.id ?? null)
      ) {
        runRef.current()
      } else {
        animatingRef.current = false
      }
    })
  }, [paint])
  runRef.current = run

  useEffect(() => {
    targetRef.current = card
    // Same card on the front, or a press mid-crossfade: nothing to start now
    // (the in-flight crossfade will chain to the latest target on completion).
    if (
      (card?.id ?? null) === (slotsRef.current[frontRef.current]?.id ?? null) ||
      animatingRef.current
    ) {
      return
    }
    run()
  }, [card, run])

  useEffect(() => {
    const op = opRef.current
    return () => {
      op[0].stopAnimation()
      op[1].stopAnimation()
    }
  }, [])

  return (
    <View style={styles.copyRegion} pointerEvents="none">
      {([0, 1] as const).map((cell) =>
        slots[cell] != null ? (
          <Animated.View
            key={`copy-cell-${cell}`}
            style={[styles.copyCell, { opacity: opRef.current[cell] }]}
            collapsable={false}
          >
            <HeroCopyBlock card={slots[cell]} />
          </Animated.View>
        ) : null,
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  deepWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DEEP_SCRIM_COLOR,
    opacity: DEEP_WASH_OPACITY,
  },
  // Positioned container for the two crossfading copy cells: mirrors
  // HomeBillboard's hero region (offset down by the in-flow top bar). zIndex
  // above BOTH artwork cells (zIndex 1/2) so the copy paints over the art.
  copyRegion: {
    position: "absolute",
    top: TOP_BAR_HEIGHT,
    left: 0,
    right: 0,
    height: HERO_REGION_HEIGHT,
    zIndex: 3,
  },
  // Each crossfade cell fills the region and bottom-anchors its copy so the two
  // cells overlap pixel-for-pixel (the geometry the pinned action row expects).
  copyCell: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingLeft: HERO_PADDING_LEFT,
    paddingBottom: HERO_COPY_PADDING_BOTTOM,
  },
})
