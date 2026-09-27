import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import {
  fitCandidates,
  planPlacedFit,
  type VerseArea,
  type VerseFit,
} from "../../lib/bible/fit/fitVerse"
import {
  unmeasuredBox,
  type VerseBox,
  type VerseBoxes,
} from "../../lib/bible/fit/verseBox"
import type { ScrollEdges } from "../../lib/bible/movement/gesture"
import { READER_COPY } from "../../lib/bible/reader/copy"
import { stopRange, verseRangeLabel } from "../../lib/bible/reader/labels"
import type {
  ReaderLineSpacing,
  ReaderTypeface,
} from "../../lib/bible/settings/snapshot"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"
import {
  readingFontFamily,
  verseLineHeight,
} from "../../lib/bible/theme/typography"
import type {
  ChapterPosition,
  TextDirection,
  Verse,
} from "../../lib/bible/text/types"

export type VerseAppearance = {
  /** The viewer's text size in points. */
  chosenSize: number
  /** The OS text scale; the fit applies it, so the Text ignores it. */
  osFontScale: number
  typeface: ReaderTypeface
  lineSpacing: ReaderLineSpacing
  verseNumbers: boolean
}

/** The screen reader's verse moves (KTD14). */
export type VerseAction =
  | "increment"
  | "decrement"
  | "nextChapter"
  | "previousChapter"

export type VerseAccessibilityMove = {
  /** Reads the verse, the total, and the chapter. */
  value: string
  onAction: (action: VerseAction) => void
}

export type VerseViewProps = {
  /** One reader stop: a verse, or a gap that shows the note (R21). */
  stop: ChapterPosition
  textDirection: TextDirection
  appearance: VerseAppearance
  tokens: ReaderTokens
  /** The verse boxes in the reader's coordinates (KTD16, KD27); the verse
   *  never grows past the box it uses. */
  boxes: VerseBoxes
  columnWidth: number
  /** KTD14: the verse is an adjustable control that moves the reader. */
  accessibilityMove?: VerseAccessibilityMove
  /** KTD13: a long verse reports its scroll edges; null when it fits. */
  onScrollEdges?: (edges: ScrollEdges | null) => void
  /** R19: a tap on a verse selects it. The gap note takes no tap. */
  onPress?: () => void
  /** R19: the verse is in the selection. */
  selected?: boolean
  /** The verse is visible in this box at this size; a slide copies it. */
  onShown?: (shown: ShownVerse) => void
}

/** What the viewer sees of a verse, so a still copy can match it. */
export type ShownVerse = { box: VerseBox; size: number; scroll: boolean }

const VERSE_ACTIONS: { name: VerseAction; label: string }[] = [
  { name: "increment", label: READER_COPY.movement.nextVerse },
  { name: "decrement", label: READER_COPY.movement.previousVerse },
  { name: "nextChapter", label: READER_COPY.movement.nextChapter },
  { name: "previousChapter", label: READER_COPY.movement.previousChapter },
]

function isVerseAction(name: string): name is VerseAction {
  return VERSE_ACTIONS.some((action) => action.name === name)
}

/** The adjustable role and actions, for the verse and for the gap note. */
function adjustableProps(move: VerseAccessibilityMove | undefined) {
  if (!move) return {}
  return {
    accessibilityRole: "adjustable" as const,
    accessibilityValue: { text: move.value },
    // TalkBack registers only declared actions; iOS also infers the first two.
    accessibilityActions: VERSE_ACTIONS,
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      const { actionName } = event.nativeEvent
      if (isVerseAction(actionName)) move.onAction(actionName)
    },
  }
}

/** Points of slack at each scroll edge, for a fractional offset. */
const EDGE_SLOP = 1

/** The box that holds the verse or the reader's message, centered in it. */
export function VerseAreaBox({
  box,
  testID = "bible-verse-area",
  children,
}: {
  box: VerseBox
  testID?: string
  children?: ReactNode
}) {
  return (
    <View
      testID={testID}
      style={[styles.area, { top: box.top, height: box.height }]}
    >
      {children}
    </View>
  )
}

// The centered verse (R7, R20, R21, R32). It draws and fits the verse; U8's
// ReaderGestures wraps the verse area and moves the reader.
export function VerseView(props: VerseViewProps) {
  const { stop, tokens, onScrollEdges, onShown } = props
  const isGap = stop.kind === "gap"
  const noteBox = unmeasuredBox(props.boxes)
  const { top: noteTop, height: noteHeight } = noteBox
  useEffect(() => {
    if (isGap) onScrollEdges?.(null)
  }, [isGap, onScrollEdges])
  useEffect(() => {
    if (!isGap) return
    onShown?.({
      box: { top: noteTop, height: noteHeight },
      size: 0,
      scroll: false,
    })
  }, [isGap, onShown, noteTop, noteHeight])
  if (stop.kind === "gap") {
    return (
      <VerseAreaBox box={noteBox}>
        <Text
          testID="bible-missing-verse"
          accessible
          style={[styles.note, { color: tokens.secondaryText }]}
          {...adjustableProps(props.accessibilityMove)}
        >
          {READER_COPY.missingVerse(stop.number)}
        </Text>
      </VerseAreaBox>
    )
  }
  return <FittedVerse {...props} verse={stop.verse} />
}

/** Heights by size, per measure key. Keys go oldest first. */
type Measured = ReadonlyMap<string, ReadonlyMap<number, number>>

const NO_HEIGHTS: ReadonlyMap<number, number> = new Map()
const NO_MEASURES: Measured = new Map()
/** A late onLayout from a verse the reader left keeps its own entry. */
const KEPT_MEASURE_KEYS = 3

function withHeight(
  measured: Measured,
  key: string,
  size: number,
  height: number,
): Measured {
  const heights = measured.get(key) ?? NO_HEIGHTS
  if (heights.get(size) === height) return measured
  const next = new Map(measured)
  next.delete(key)
  next.set(key, new Map(heights).set(size, height))
  for (const oldest of next.keys()) {
    if (next.size <= KEPT_MEASURE_KEYS) break
    next.delete(oldest)
  }
  return next
}

function FittedVerse({
  verse,
  stop,
  textDirection,
  appearance,
  tokens,
  boxes,
  columnWidth,
  accessibilityMove,
  onScrollEdges,
  onPress,
  selected = false,
  onShown,
}: VerseViewProps & { verse: Verse }) {
  const { chosenSize, osFontScale } = appearance
  const plainText = useMemo(
    () => verse.lines.map((line) => line.text).join(" "),
    [verse],
  )
  const fontFamily = useMemo(
    () => readingFontFamily(appearance.typeface, plainText, Platform.OS),
    [appearance.typeface, plainText],
  )
  // Everything that changes the text height at a given size.
  const measureKey = [
    verseRangeLabel(stop),
    plainText,
    columnWidth,
    fontFamily,
    appearance.lineSpacing,
    appearance.verseNumbers,
    chosenSize,
    osFontScale,
    textDirection,
  ].join("|")

  const [measured, setMeasured] = useState<Measured>(NO_MEASURES)
  const heights = measured.get(measureKey) ?? NO_HEIGHTS
  const plan = planPlacedFit({
    chosenSize,
    osFontScale,
    centeredHeight: boxes.centered.height,
    freeHeight: boxes.free.height,
    heights,
  })

  // A smaller box that needs a new measure keeps the last fit of this verse
  // on screen, so a window that moves never blanks the verse.
  const [settled, setSettled] = useState<{
    key: string
    fit: VerseFit
    area: VerseArea
  } | null>(null)
  const done = plan.status === "done" ? plan : null
  useEffect(() => {
    if (!done) return
    setSettled((previous) =>
      previous?.key === measureKey &&
      previous.fit.size === done.fit.size &&
      previous.fit.scroll === done.fit.scroll &&
      previous.area === done.area
        ? previous
        : { key: measureKey, fit: done.fit, area: done.area },
    )
  }, [measureKey, done?.fit.size, done?.fit.scroll, done?.area])
  const kept = settled?.key === measureKey ? settled : null
  const fit = done?.fit ?? kept?.fit ?? null
  const box = boxes[done?.area ?? kept?.area ?? "centered"]
  const { top: boxTop, height: boxHeight } = box
  const fitSize = fit?.size ?? null
  const fitScroll = fit?.scroll ?? false
  // A new verse can settle at the same size, so the key re-reports it too.
  useEffect(() => {
    if (fitSize === null) return
    onShown?.({
      box: { top: boxTop, height: boxHeight },
      size: fitSize,
      scroll: fitScroll,
    })
  }, [fitSize, fitScroll, boxTop, boxHeight, measureKey, onShown])

  // A new scroll view starts at its top; a verse that fits reports null.
  const scrolls = fit?.scroll === true
  useEffect(() => {
    onScrollEdges?.(scrolls ? { atTop: true, atBottom: false } : null)
  }, [scrolls, measureKey, onScrollEdges])
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    onScrollEdges?.({
      atTop: contentOffset.y <= EDGE_SLOP,
      atBottom:
        contentOffset.y + layoutMeasurement.height >=
        contentSize.height - EDGE_SLOP,
    })
  }

  const record = useCallback(
    (size: number, height: number) =>
      setMeasured((previous) => withHeight(previous, measureKey, size, height)),
    [measureKey],
  )

  const body = (size: number) => (
    <VerseBody
      verse={verse}
      stop={stop}
      size={size}
      fontFamily={fontFamily}
      lineSpacing={appearance.lineSpacing}
      verseNumbers={appearance.verseNumbers}
      textDirection={textDirection}
      tokens={tokens}
      selected={selected}
    />
  )
  const selection = { onPress, selected }
  const shownSize =
    fit?.size ?? fitCandidates(chosenSize, osFontScale)[0] ?? chosenSize
  const { first, last } = stopRange(stop)
  const accessibilityLabel = READER_COPY.verse(first, last, plainText)

  return (
    <VerseAreaBox box={box}>
      {plan.status === "measure" && (
        // A native view reports onLayout only for a new frame, so a new key
        // with the old frame never gets a height. New views always report.
        <View
          key={measureKey}
          style={styles.measuring}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {plan.sizes.map((size) => (
            <View
              key={size}
              testID={`bible-verse-measure-${size}`}
              style={[styles.copy, { width: columnWidth }]}
              onLayout={(event: LayoutChangeEvent) =>
                record(size, event.nativeEvent.layout.height)
              }
            >
              {body(size)}
            </View>
          ))}
        </View>
      )}
      {fit?.scroll ? (
        <ScrollView
          // A new verse starts at its top, not at the last verse's offset.
          key={measureKey}
          testID="bible-verse-scroll"
          style={{ width: columnWidth, height: box.height }}
          showsVerticalScrollIndicator
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <VerseColumn
            accessibilityLabel={accessibilityLabel}
            accessibilityMove={accessibilityMove}
            visible
            width={columnWidth}
            {...selection}
          >
            {body(fit.size)}
          </VerseColumn>
        </ScrollView>
      ) : (
        <VerseColumn
          accessibilityLabel={accessibilityLabel}
          accessibilityMove={accessibilityMove}
          visible={fit !== null}
          width={columnWidth}
          {...selection}
        >
          {body(shownSize)}
        </VerseColumn>
      )}
    </VerseAreaBox>
  )
}

type VerseColumnProps = {
  accessibilityLabel: string
  accessibilityMove: VerseAccessibilityMove | undefined
  /** Hidden until the fit settles, so the verse never flickers through sizes. */
  visible: boolean
  width: number
  onPress?: () => void
  selected: boolean
  children: ReactNode
}

// A tap reaches the verse: the swipe layer claims a touch only after it moves
// (KTD13). A screen reader's double-tap presses the verse too.
function VerseColumn({
  accessibilityLabel,
  accessibilityMove,
  visible,
  width,
  onPress,
  selected,
  children,
}: VerseColumnProps) {
  const style: StyleProp<ViewStyle> = { width, opacity: visible ? 1 : 0 }
  const hint = selected
    ? READER_COPY.selection.removeHint
    : READER_COPY.selection.selectHint
  return (
    <Pressable
      testID="bible-verse"
      style={style}
      onPress={visible ? onPress : undefined}
      accessible={visible}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={onPress ? hint : undefined}
      accessibilityState={onPress ? { selected } : undefined}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      {...adjustableProps(accessibilityMove)}
    >
      {children}
    </Pressable>
  )
}

type VerseBodyProps = {
  verse: Verse
  stop: ChapterPosition
  size: number
  fontFamily: string
  lineSpacing: ReaderLineSpacing
  verseNumbers: boolean
  textDirection: TextDirection
  tokens: ReaderTokens
  selected: boolean
  lineTestID?: string
}

/** One Text per line, so each poetry line breaks where the source breaks. */
function VerseBody({
  verse,
  stop,
  size,
  fontFamily,
  lineSpacing,
  verseNumbers,
  textDirection,
  tokens,
  selected,
  lineTestID = "bible-verse-line",
}: VerseBodyProps) {
  const lineStyle: TextStyle = {
    fontSize: size,
    lineHeight: verseLineHeight(size, lineSpacing),
    fontFamily,
    color: tokens.text,
    // R32: right-to-left text aligns right; left-to-right text is centered.
    textAlign: textDirection === "rtl" ? "right" : "center",
    writingDirection: textDirection,
    // R19, after Still: an underline marks a selected verse.
    ...(selected ? { textDecorationLine: "underline" as const } : null),
  }
  return (
    <>
      {verse.lines.map((line, index) => (
        <Text
          key={`${verse.number}-${index}`}
          testID={lineTestID}
          allowFontScaling={false}
          style={lineStyle}
        >
          {index === 0 && verseNumbers ? (
            <Text
              allowFontScaling={false}
              style={{
                fontSize: Math.round(size * 0.5),
                color: tokens.secondaryText,
                textDecorationLine: "none",
              }}
            >
              {`${verseRangeLabel(stop)} `}
            </Text>
          ) : null}
          {line.text}
        </Text>
      ))}
    </>
  )
}

export type VerseSnapshotProps = Pick<
  VerseViewProps,
  "stop" | "textDirection" | "appearance" | "tokens" | "columnWidth"
> & {
  shown: ShownVerse
  selected: boolean
}

/** A still copy of a shown verse, for the slide out. It has no fit, no touch,
 *  and nothing a screen reader reads. A scrolled verse shows from its top. */
export function VerseSnapshot({
  stop,
  textDirection,
  appearance,
  tokens,
  columnWidth,
  shown,
  selected,
}: VerseSnapshotProps) {
  const plainText =
    stop.kind === "verse"
      ? stop.verse.lines.map((line) => line.text).join(" ")
      : ""
  const fontFamily = readingFontFamily(
    appearance.typeface,
    plainText,
    Platform.OS,
  )
  return (
    <VerseAreaBox box={shown.box} testID="bible-verse-outgoing">
      {stop.kind === "gap" ? (
        <Text style={[styles.note, { color: tokens.secondaryText }]}>
          {READER_COPY.missingVerse(stop.number)}
        </Text>
      ) : (
        <View
          style={[
            { width: columnWidth },
            shown.scroll && styles.snapshotScroll,
            shown.scroll && { height: shown.box.height },
          ]}
        >
          <VerseBody
            verse={stop.verse}
            stop={stop}
            size={shown.size}
            fontFamily={fontFamily}
            lineSpacing={appearance.lineSpacing}
            verseNumbers={appearance.verseNumbers}
            textDirection={textDirection}
            tokens={tokens}
            selected={selected}
            lineTestID="bible-verse-outgoing-line"
          />
        </View>
      )}
    </VerseAreaBox>
  )
}

const styles = StyleSheet.create({
  snapshotScroll: {
    overflow: "hidden",
  },
  area: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    fontSize: 18,
    lineHeight: 26,
    fontStyle: "italic",
    fontFamily: "System",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  measuring: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0,
  },
  copy: {
    position: "absolute",
    top: 0,
    alignSelf: "center",
  },
})
