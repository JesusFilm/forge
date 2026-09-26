import { useEffect, useRef, useState } from "react"
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native"

import { mayStartScrub } from "../../lib/scrubber"
import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_SCRUBBER_BAND,
  READER_SCRUBBER_TRACK_CENTER,
  READER_TOUCH_TARGET,
} from "../../lib/bible/reader/chrome"
import { verseAtProgress } from "../../lib/bible/reader/labels"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

export type VerseScrubberProps = {
  tokens: ReaderTokens
  /** The chapter's last verse number (KTD19); null while the text loads. */
  lastVerse: number | null
  /** The thumb's place, from 0 to 1 (`chapterProgress`). */
  progress: number
  /** The number above the thumb during a drag, such as "6-8". */
  labelFor: (verse: number) => string
  /** Each new verse under the thumb during a drag, so the verse follows. */
  onPreview: (verse: number) => void
  /** The drag ended: the last verse it showed, or null for a still press. */
  onEnd: (verse: number | null) => void
  /** The iOS back-swipe strip (lib/backSwipe.ts); 0 accepts every touch. */
  edgeGuardWidth: number
}

const TRACK_HEIGHT = 3
const THUMB = 12
/** The space between the band's top and the drag label. */
const LABEL_GAP = 12
const LABEL_WIDTH = 96

// R18's scrubber, after Still's design (KD7): a drag that starts on the thumb
// moves by whole verses, and the thumb moves from where it is, never to where
// the press lands. A tap on the track does nothing.
export function VerseScrubber(props: VerseScrubberProps) {
  const { tokens, lastVerse, progress, labelFor } = props
  const [width, setWidth] = useState(0)
  const [dragVerse, setDragVerse] = useState<number | null>(null)
  const latest = useRef({ ...props, width })
  useEffect(() => {
    latest.current = { ...props, width }
  })
  const drag = useRef<{ start: number; verse: number | null } | null>(null)

  const [responder] = useState(() => {
    const end = () => {
      const verse = drag.current?.verse ?? null
      drag.current = null
      setDragVerse(null)
      latest.current.onEnd(verse)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: (event) => {
        const current = latest.current
        return (
          current.lastVerse !== null &&
          current.width > 0 &&
          mayStartScrub(event.nativeEvent.pageX, current.edgeGuardWidth)
        )
      },
      // Only a press on the thumb starts a drag; a drag never starts mid-move.
      onMoveShouldSetPanResponder: () => false,
      onPanResponderGrant: () => {
        drag.current = { start: latest.current.progress, verse: null }
      },
      onPanResponderMove: (_event, gesture) => {
        const current = latest.current
        const active = drag.current
        if (!active || current.lastVerse === null || current.width <= 0) return
        const verse = verseAtProgress(
          active.start + gesture.dx / current.width,
          current.lastVerse,
        )
        if (verse === active.verse) return
        active.verse = verse
        setDragVerse(verse)
        current.onPreview(verse)
      },
      // Still's design: a release and an interruption both keep the verse.
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
      onPanResponderTerminationRequest: () => false,
    })
  })

  // An unmount can end a drag with no release. It keeps the verse too, so the
  // reader never holds a scrub that no release can end.
  useEffect(
    () => () => {
      const active = drag.current
      if (!active) return
      drag.current = null
      latest.current.onEnd(active.verse)
    },
    [],
  )

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width)
  }
  const thumbX = progress * width
  const showThumb = lastVerse !== null && width > 0

  return (
    <View
      testID="bible-verse-scrubber"
      style={styles.band}
      pointerEvents="box-none"
      onLayout={onLayout}
      // KTD14: the verse is the adjustable control that moves by verse, and
      // the pill reaches any verse, so the bar stays silent.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        pointerEvents="none"
        style={[styles.track, { backgroundColor: tokens.progressTrack }]}
      >
        <View
          testID="bible-reader-progress-fill"
          style={[
            styles.fill,
            {
              width: `${Math.round(progress * 1000) / 10}%`,
              backgroundColor: tokens.progressFill,
            },
          ]}
        />
      </View>
      {showThumb && (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                left: thumbX - THUMB / 2,
                backgroundColor: tokens.progressFill,
              },
            ]}
          />
          <View
            testID="bible-scrubber-thumb"
            style={[styles.target, { left: thumbX - READER_TOUCH_TARGET / 2 }]}
            {...responder.panHandlers}
          />
        </>
      )}
      {dragVerse !== null && (
        <View
          testID="bible-scrubber-label"
          pointerEvents="none"
          style={[styles.labelSlot, { left: thumbX - LABEL_WIDTH / 2 }]}
        >
          <Text
            style={[
              styles.label,
              { color: tokens.text, backgroundColor: tokens.buttonSurface },
            ]}
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          >
            {labelFor(dragVerse)}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  band: {
    height: READER_SCRUBBER_BAND,
    width: "100%",
  },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    top: READER_SCRUBBER_TRACK_CENTER - TRACK_HEIGHT / 2,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: "hidden",
  },
  fill: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: "absolute",
    top: READER_SCRUBBER_TRACK_CENTER - THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
  },
  // The band's full height, so the thumb's target is 44 x 44 (R36).
  target: {
    position: "absolute",
    top: 0,
    width: READER_TOUCH_TARGET,
    height: READER_SCRUBBER_BAND,
  },
  labelSlot: {
    position: "absolute",
    bottom: READER_SCRUBBER_BAND + LABEL_GAP,
    width: LABEL_WIDTH,
    alignItems: "center",
  },
  label: {
    overflow: "hidden",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    fontFamily: "System",
    fontVariant: ["tabular-nums"],
  },
})
