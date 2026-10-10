import { useEffect, useRef, useState, type ReactNode } from "react"
import { PanResponder, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  claimSwipe,
  mayStartReaderSwipe,
  releaseSwipe,
  type ReaderTouchZones,
  type ScrollEdges,
  type SwipeAxis,
} from "../../lib/bible/movement/gesture"
import type { MoveDirection } from "../../lib/bible/movement/move"
import { READER_CHROME_MAX_FONT_SCALE } from "../../lib/bible/reader/chrome"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

export type ReaderGesturesProps = {
  tokens: ReaderTokens
  zones: ReaderTouchZones
  /** A long verse's scroll edges; read when a touch starts. */
  readScrollEdges: () => ScrollEdges | null
  onVerseSwipe: (direction: MoveDirection) => void
  onChapterSwipe: (direction: MoveDirection) => void
  /** R13: the chapter a sideways drag opens, or the words for a Bible end. */
  chapterPreview: (direction: MoveDirection) => string | null
  children: ReactNode
}

/** The claimed axis and the drag the claim took; the grant resets dx and dy. */
type Claim = { axis: SwipeAxis; dx: number; dy: number }

type Preview = { direction: MoveDirection; label: string }

/** R12: a drag to the left opens the next chapter. */
function chapterDirection(dx: number): MoveDirection {
  return dx < 0 ? "forward" : "back"
}

// KTD13: one capture-phase responder over the reader owns every swipe, after
// HomeScreen's hero swipe: claim on dominance, snapshot at the claim, commit
// on release. It declines a touch that starts where something else owns it.
export function ReaderGestures(props: ReaderGesturesProps) {
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  const edgesAtStart = useRef<ScrollEdges | null>(null)
  const claim = useRef<Claim | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)

  const [responder] = useState(() => {
    const showPreview = (dx: number) => {
      const direction = chapterDirection(dx)
      setPreview((previous) =>
        previous?.direction === direction
          ? previous
          : {
              direction,
              label: latest.current.chapterPreview(direction) ?? "",
            },
      )
    }
    const end = () => {
      claim.current = null
      setPreview(null)
    }
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        // "The next drag past the edge": the edge counts where a touch starts.
        edgesAtStart.current = latest.current.readScrollEdges()
        return false
      },
      onMoveShouldSetPanResponderCapture: (_event, gesture) => {
        const current = latest.current
        // Before the grant, dx and dy run from where the touch started.
        const start = {
          x: gesture.moveX - gesture.dx,
          y: gesture.moveY - gesture.dy,
        }
        if (!mayStartReaderSwipe(start, current.zones)) return false
        const axis = claimSwipe(gesture, edgesAtStart.current)
        if (!axis) return false
        claim.current = { axis, dx: gesture.dx, dy: gesture.dy }
        if (axis === "chapter") showPreview(gesture.dx)
        return true
      },
      onPanResponderMove: (_event, gesture) => {
        const current = claim.current
        if (current?.axis === "chapter") showPreview(current.dx + gesture.dx)
      },
      onPanResponderRelease: (_event, gesture) => {
        const current = claim.current
        end()
        if (!current) return
        const move = releaseSwipe(
          current.axis,
          { dx: current.dx + gesture.dx, dy: current.dy + gesture.dy },
          { vx: gesture.vx, vy: gesture.vy },
        )
        if (!move) return
        if (move.axis === "verse") latest.current.onVerseSwipe(move.direction)
        else latest.current.onChapterSwipe(move.direction)
      },
      onPanResponderTerminate: end,
      onPanResponderTerminationRequest: () => true,
    })
  })

  const { tokens } = props
  const next = preview?.direction === "forward"
  return (
    <View
      testID="bible-reader-gestures"
      style={StyleSheet.absoluteFill}
      {...responder.panHandlers}
    >
      {props.children}
      {preview && (
        <View
          testID="bible-chapter-preview"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.side, next ? styles.right : styles.left]}
        >
          <View
            style={[styles.preview, { backgroundColor: tokens.buttonSurface }]}
          >
            {!next && (
              <Ionicons name="chevron-back" size={18} color={tokens.text} />
            )}
            <Text
              style={[styles.label, { color: tokens.text }]}
              numberOfLines={2}
              maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
            >
              {preview.label}
            </Text>
            {next && (
              <Ionicons name="chevron-forward" size={18} color={tokens.text} />
            )}
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  side: {
    position: "absolute",
    top: 0,
    bottom: 0,
    maxWidth: "45%",
    justifyContent: "center",
  },
  left: {
    left: 16,
  },
  right: {
    right: 16,
  },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  label: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: "System",
  },
})
