import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"

import type { MoveDirection } from "../../lib/bible/movement/move"
import type { VerseSlide } from "../../lib/bible/movement/useReaderMovement"
import {
  VerseSnapshot,
  VerseView,
  type ShownVerse,
  type VerseAppearance,
  type VerseViewProps,
} from "./VerseView"

/** The owner asked for a 0.3 s slide (2026-09-25). */
export const VERSE_SLIDE_MS = 300
/** A verse that never reports its fit still slides in after this wait. */
export const VERSE_SLIDE_START_LIMIT_MS = 150
/** The old verse waits this long for the next chapter to load. It matches
 *  the reader's loading delay, so it never shows with the loading mark. */
export const VERSE_SLIDE_HOLD_MS = 300

/** The band the verses slide through, in the reader's coordinates. */
export type VerseSlideClip = {
  top: number
  height: number
  containerHeight: number
}

/** The verse on screen, or null while its chapter loads or fails. */
export type LiveVerse = { verseKey: string; view: VerseViewProps }

type Source = {
  stop: VerseViewProps["stop"]
  textDirection: VerseViewProps["textDirection"]
  selected: boolean
}

type Tracked = { key: string | null; source: Source | null; slideId: number }

type Outgoing = {
  id: number
  direction: MoveDirection
  source: Source
  shown: ShownVerse
}

export type VerseSliderProps = {
  live: LiveVerse | null
  /** The next verse's chapter is loading; only then does the old verse wait. */
  loading: boolean
  slide: VerseSlide | null
  reduceMotion: boolean
  clip: VerseSlideClip
  /** The still copy draws with these, like the live verse. */
  appearance: VerseAppearance
  tokens: VerseViewProps["tokens"]
  columnWidth: number
}

// A verse move slides the old verse out and the new verse in, up for the next
// verse and down for the one before. The old verse is a still copy, so only
// one live verse exists. With Reduce Motion, the verse changes in place.
export function VerseSlider({
  live,
  loading,
  slide,
  reduceMotion,
  clip,
  appearance,
  tokens,
  columnWidth,
}: VerseSliderProps) {
  const slideId = slide?.id ?? 0
  const liveKey = live?.verseKey ?? null
  const source: Source | null = live
    ? {
        stop: live.view.stop,
        textDirection: live.view.textDirection,
        selected: live.view.selected ?? false,
      }
    : null
  const [tracked, setTracked] = useState<Tracked>({
    key: liveKey,
    source,
    slideId,
  })
  const [shown, setShown] = useState<{
    key: string
    shown: ShownVerse
  } | null>(null)
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null)
  const [expired, setExpired] = useState<number | null>(null)

  // A verse move whose new verse is not on screen yet; its chapter may load.
  const pending =
    slide !== null &&
    slideId !== tracked.slideId &&
    !reduceMotion &&
    expired !== slideId &&
    tracked.source !== null &&
    shown !== null &&
    shown.key === tracked.key
      ? {
          id: slideId,
          direction: slide.direction,
          source: tracked.source,
          shown: shown.shown,
        }
      : null

  // Derived in render, so the copy and the new verse commit together. While
  // the chapter loads, `tracked` keeps the old verse for the slide.
  if (live && source && tracked.key !== live.verseKey) {
    setTracked({ key: live.verseKey, source, slideId })
    setOutgoing(pending)
  } else if (live && source && !sameSource(tracked.source, source)) {
    setTracked({ ...tracked, source })
  }
  const holding = !live && loading && pending !== null

  useEffect(() => {
    if (!holding) return
    const timer = setTimeout(() => setExpired(slideId), VERSE_SLIDE_HOLD_MS)
    return () => clearTimeout(timer)
  }, [holding, slideId])

  const onShown = useCallback(
    (next: ShownVerse) => {
      if (liveKey === null) return
      setShown((previous) =>
        previous?.key === liveKey && sameShown(previous.shown, next)
          ? previous
          : { key: liveKey, shown: next },
      )
    },
    [liveKey],
  )

  const [progress] = useState(() => new Animated.Value(1))
  useLayoutEffect(() => {
    progress.setValue(outgoing ? 0 : 1)
  }, [outgoing, progress])

  const [forced, setForced] = useState<number | null>(null)
  const ready =
    outgoing !== null && (shown?.key === liveKey || forced === outgoing.id)
  useEffect(() => {
    if (!outgoing || ready) return
    const id = outgoing.id
    const timer = setTimeout(() => setForced(id), VERSE_SLIDE_START_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [outgoing, ready])
  useEffect(() => {
    if (!outgoing || !ready) return
    const id = outgoing.id
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: VERSE_SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished) {
        setOutgoing((current) => (current?.id === id ? null : current))
      }
    })
    return () => animation.stop()
  }, [outgoing, ready, progress])

  // Forward is the next verse: the old one leaves at the top.
  const sign = outgoing?.direction === "back" ? 1 : -1
  const distance = clip.height
  const outgoingY = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, sign * distance],
      }),
    [progress, sign, distance],
  )
  const incomingY = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-sign * distance, 0],
      }),
    [progress, sign, distance],
  )

  const still = live ? outgoing : holding ? pending : null
  return (
    <View
      pointerEvents="box-none"
      style={[styles.clip, { top: clip.top, height: clip.height }]}
    >
      <View
        pointerEvents="box-none"
        style={[styles.stage, { top: -clip.top, height: clip.containerHeight }]}
      >
        {live && (
          <Animated.View
            pointerEvents="box-none"
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateY: incomingY }] },
            ]}
          >
            <VerseView {...live.view} onShown={onShown} />
          </Animated.View>
        )}
        {still && (
          <Animated.View
            key={still.id}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              StyleSheet.absoluteFill,
              live ? { transform: [{ translateY: outgoingY }] } : null,
            ]}
          >
            <VerseSnapshot
              stop={still.source.stop}
              textDirection={still.source.textDirection}
              appearance={appearance}
              tokens={tokens}
              columnWidth={columnWidth}
              shown={still.shown}
              selected={still.source.selected}
            />
          </Animated.View>
        )}
      </View>
    </View>
  )
}

function sameSource(a: Source | null, b: Source): boolean {
  return (
    a !== null &&
    a.stop === b.stop &&
    a.textDirection === b.textDirection &&
    a.selected === b.selected
  )
}

function sameShown(a: ShownVerse, b: ShownVerse): boolean {
  return (
    a.size === b.size &&
    a.scroll === b.scroll &&
    a.box.top === b.box.top &&
    a.box.height === b.box.height
  )
}

const styles = StyleSheet.create({
  clip: {
    position: "absolute",
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  stage: {
    position: "absolute",
    left: 0,
    right: 0,
  },
})
