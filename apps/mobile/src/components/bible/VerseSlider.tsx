import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"

import {
  advanceStage,
  changeReady,
  changeTiming,
  endChange,
  endWait,
  forceChange,
  initialStage,
  interruptChange,
  needsInterrupt,
  reportFit,
  slideCurves,
  stageStill,
  type SlideCurve,
  type StageVerse,
  type VerseStage,
} from "../../lib/bible/movement/verseStage"
import type { VerseSlide } from "../../lib/bible/movement/useReaderMovement"
import {
  VerseSnapshot,
  type VerseSnapshotProps,
  VerseView,
  type ShownVerse,
  type VerseAppearance,
  type VerseViewProps,
} from "./VerseView"

export {
  VERSE_SCRUB_SLIDE_MS,
  VERSE_SLIDE_MS,
} from "../../lib/bible/movement/verseStage"
/** A verse that never reports its fit still changes after this wait. */
export const VERSE_SLIDE_START_LIMIT_MS = 150
/** The old verse waits this long for the next chapter to load. It matches
 *  the reader's loading delay, so it never shows with the loading mark. */
export const VERSE_SLIDE_HOLD_MS = 300

/** The band the verses move in, in the reader's coordinates. */
export type VerseSlideClip = {
  top: number
  height: number
  containerHeight: number
}

/** The verse on screen, or null while its chapter loads or fails. */
export type LiveVerse = StageVerse<VerseViewProps>

type Stage = VerseStage<VerseViewProps, ShownVerse>

export type VerseSliderProps = {
  live: LiveVerse | null
  /** The next verse's translation or chapter is loading; only then does the
   *  old verse wait. */
  loading: boolean
  slide: VerseSlide | null
  /** The thumb is down: each new verse changes at the scrub pace. */
  scrubbing: boolean
  reduceMotion: boolean
  clip: VerseSlideClip
  /** The still copy draws with these, like the live verse. */
  appearance: VerseAppearance
  tokens: VerseViewProps["tokens"]
  columnWidth: number
}

// A verse change fades the old verse out and the new verse in, and each moves
// a few points: up for the next verse, down for the one before. The old verse
// is a still copy, so only one live verse exists. Reduce Motion changes in place.
export function VerseSlider({
  live,
  loading,
  slide,
  scrubbing,
  reduceMotion,
  clip,
  appearance,
  tokens,
  columnWidth,
}: VerseSliderProps) {
  const input = { live, loading, slide, scrubbing, reduceMotion }
  const [saved, setStage] = useState<Stage>(() => initialStage(input))
  const stage = advanceStage(saved, input, sameSource)
  if (stage !== saved) setStage(stage)

  const { change, shown } = stage
  const changeId = change?.id ?? null
  const shownKey = shown?.key ?? null
  const ready = changeReady(stage)
  const awaiting = !live && stage.waiting !== null
  const timing = change ? changeTiming(change) : { duration: 0, split: 0 }

  // The load may end with no verse; a failure already ended the move.
  useEffect(() => {
    if (!awaiting) return
    const timer = setTimeout(
      () => setStage((current) => endWait(current)),
      VERSE_SLIDE_HOLD_MS,
    )
    return () => clearTimeout(timer)
  }, [awaiting])

  const onShown = useCallback(
    (next: ShownVerse) => {
      if (shownKey === null) return
      setStage((current) => reportFit(current, shownKey, next, sameShown))
    },
    [shownKey],
  )

  // A ref, not state: a scroll reports every frame. The still copy reads it
  // once, as it appears, so a swipe past the end leaves from where it stood.
  const scrollOffsets = useRef(new Map<string, number>())
  const onScrollOffset = useCallback(
    (y: number) => {
      if (shownKey !== null) scrollOffsets.current.set(shownKey, y)
    },
    [shownKey],
  )
  const readScrollY = (key: string) => scrollOffsets.current.get(key) ?? 0
  const still = stageStill(stage, input)
  const leavingKey = still?.leaving.verse.key ?? null
  // One offset per verse: an interrupt remounts the copy after the next verse
  // has written its own offset. Keep only the verses on screen.
  useEffect(() => {
    for (const key of [...scrollOffsets.current.keys()]) {
      if (key !== shownKey && key !== leavingKey) {
        scrollOffsets.current.delete(key)
      }
    }
  }, [shownKey, leavingKey])

  // Each change mounts its layers on a new value at 0. A reset of one shared
  // value reached the native side a frame late: the old copy mounted hidden,
  // and both verses were gone for that frame (iPhone 17 Pro Max, 2026-09-28).
  const [clock, setClock] = useState(() => newClock(changeId))
  let progress = clock.progress
  if (clock.id !== changeId) {
    const next = newClock(changeId)
    progress = next.progress
    setClock(next)
  }

  // iOS ignores React's opacity and transform on a view that native Animated
  // has driven, so the layer shows a new verse at rest until its change starts.
  // A plain view hides the verse until the change's first native frame.
  const [drawn, setDrawn] = useState<number | null>(null)
  const gated = changeId !== null && drawn !== changeId

  // JS cannot read a native-driven value at once, so the progress of the
  // running change comes from its start time; the animation is linear.
  const started = useRef<{ id: number; at: number } | null>(null)
  const interrupting = needsInterrupt(stage, live)
  useLayoutEffect(() => {
    if (!interrupting || !live || changeId === null) return
    const run = started.current
    const elapsed = run?.id === changeId ? performance.now() - run.at : 0
    const done = Math.min(1, elapsed / timing.duration)
    setStage((current) =>
      current.change?.id === changeId
        ? interruptChange(current, live, done)
        : current,
    )
  }, [interrupting, live, changeId, timing.duration])

  useEffect(() => {
    if (changeId === null || ready) return
    const timer = setTimeout(
      () => setStage((current) => forceChange(current, changeId)),
      VERSE_SLIDE_START_LIMIT_MS,
    )
    return () => clearTimeout(timer)
  }, [changeId, ready])
  useEffect(() => {
    if (changeId === null || !ready) return
    // Linear: each curve carries its own easing.
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: timing.duration,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    started.current = { id: changeId, at: performance.now() }
    // Native sends this value only after it has drawn the frame.
    let listening = true
    const stopListening = () => {
      if (listening) progress.removeListener(firstFrame)
      listening = false
    }
    const firstFrame = progress.addListener(() => {
      stopListening()
      setDrawn(changeId)
    })
    // A stopped change reports `finished: false`, and a late report from an
    // old change does not match the running id.
    animation.start(({ finished }) => {
      if (finished) setStage((current) => endChange(current, changeId))
    })
    return () => {
      stopListening()
      animation.stop()
    }
  }, [changeId, ready, progress, timing.duration])

  const direction = change?.direction ?? "forward"
  const axis = change?.axis ?? "verse"
  const fromOpacity = change?.from?.opacity ?? 0
  const fromX = change?.from?.x ?? 0
  const fromY = change?.from?.y ?? 0
  const layers = useMemo(() => {
    const place = { opacity: fromOpacity, x: fromX, y: fromY }
    const curves = slideCurves(direction, axis, place, timing.split)
    const along = (curve: SlideCurve) =>
      progress.interpolate({ ...curve, extrapolate: "clamp" })
    const style = (layer: {
      opacity: SlideCurve
      translateX: SlideCurve
      translateY: SlideCurve
    }) => ({
      opacity: along(layer.opacity),
      transform: [
        { translateX: along(layer.translateX) },
        { translateY: along(layer.translateY) },
      ],
    })
    return {
      incoming: style(curves.incoming),
      outgoing: style(curves.outgoing),
    }
  }, [direction, axis, fromOpacity, fromX, fromY, timing.split, progress])

  // Until the interrupt lands, the shown verse keeps its view.
  const view =
    live && shown ? (shown.key === live.key ? live.view : shown.view) : null
  return (
    <View
      pointerEvents="box-none"
      style={[styles.clip, { top: clip.top, height: clip.height }]}
    >
      <View
        pointerEvents="box-none"
        style={[styles.stage, { top: -clip.top, height: clip.containerHeight }]}
      >
        {view && (
          <Animated.View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFill, layers.incoming]}
          >
            <View
              testID="bible-verse-gate"
              collapsable={false}
              pointerEvents="box-none"
              style={[StyleSheet.absoluteFill, gated && styles.gated]}
            >
              <VerseView
                {...view}
                onShown={onShown}
                onScrollOffset={onScrollOffset}
              />
            </View>
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
              still.moving ? layers.outgoing : null,
            ]}
          >
            <StillVerse
              readScrollY={() => readScrollY(still.leaving.verse.key)}
              stop={still.leaving.verse.view.stop}
              textDirection={still.leaving.verse.view.textDirection}
              appearance={appearance}
              tokens={tokens}
              columnWidth={columnWidth}
              shown={still.leaving.fit}
              selected={still.leaving.verse.view.selected ?? false}
            />
          </Animated.View>
        )}
      </View>
    </View>
  )
}

// The live scroll view unmounts in the same commit, so its bounce back never
// plays; the copy holds the offset it had, overscroll included, and fades.
function StillVerse({
  readScrollY,
  ...snapshot
}: Omit<VerseSnapshotProps, "scrollY"> & { readScrollY: () => number }) {
  const [scrollY] = useState(readScrollY)
  return <VerseSnapshot {...snapshot} scrollY={scrollY} />
}

function newClock(changeId: number | null) {
  return {
    id: changeId,
    progress: new Animated.Value(changeId === null ? 1 : 0),
  }
}

/** What the still copy draws from the live verse's props. */
function sameSource(a: VerseViewProps, b: VerseViewProps): boolean {
  return (
    a.stop === b.stop &&
    a.textDirection === b.textDirection &&
    (a.selected ?? false) === (b.selected ?? false)
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
  gated: {
    opacity: 0,
  },
})
