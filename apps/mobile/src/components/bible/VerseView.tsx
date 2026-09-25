import { useCallback, useEffect, useState, type ReactNode } from "react"
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
  planFit,
  type VerseFit,
} from "../../lib/bible/fit/fitVerse"
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
  /** The verse box's height (KTD16); the verse never grows past it. */
  areaHeight: number
  columnWidth: number
  /** KTD14: the verse is an adjustable control that moves the reader. */
  accessibilityMove?: VerseAccessibilityMove
  /** KTD13: a long verse reports its scroll edges; null when it fits. */
  onScrollEdges?: (edges: ScrollEdges | null) => void
  /** R19: a tap on a verse selects it. The gap note takes no tap. */
  onPress?: () => void
  /** R19: the verse is in the selection. */
  selected?: boolean
}

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

// The centered verse (R7, R20, R21, R32). It draws and fits the verse; U8's
// ReaderGestures wraps the verse area and moves the reader.
export function VerseView(props: VerseViewProps) {
  const { stop, tokens, onScrollEdges } = props
  const isGap = stop.kind === "gap"
  useEffect(() => {
    if (isGap) onScrollEdges?.(null)
  }, [isGap, onScrollEdges])
  if (stop.kind === "gap") {
    return (
      <Text
        testID="bible-missing-verse"
        accessible
        style={[styles.note, { color: tokens.secondaryText }]}
        {...adjustableProps(props.accessibilityMove)}
      >
        {READER_COPY.missingVerse(stop.number)}
      </Text>
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
  areaHeight,
  columnWidth,
  accessibilityMove,
  onScrollEdges,
  onPress,
  selected = false,
}: VerseViewProps & { verse: Verse }) {
  const { chosenSize, osFontScale } = appearance
  const plainText = verse.lines.map((line) => line.text).join(" ")
  const fontFamily = readingFontFamily(
    appearance.typeface,
    plainText,
    Platform.OS,
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
  const plan = planFit({ chosenSize, osFontScale, areaHeight, heights })

  // A smaller box that needs a new measure keeps the last fit of this verse
  // on screen, so a window that moves never blanks the verse.
  const [settled, setSettled] = useState<{ key: string; fit: VerseFit } | null>(
    null,
  )
  const doneFit = plan.status === "done" ? plan.fit : null
  useEffect(() => {
    if (!doneFit) return
    setSettled((previous) =>
      previous?.key === measureKey &&
      previous.fit.size === doneFit.size &&
      previous.fit.scroll === doneFit.scroll
        ? previous
        : { key: measureKey, fit: doneFit },
    )
  }, [measureKey, doneFit?.size, doneFit?.scroll])
  const fit = doneFit ?? (settled?.key === measureKey ? settled.fit : null)

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
    <>
      {plan.status === "measure" && (
        <View
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
          style={{ width: columnWidth, height: areaHeight }}
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
    </>
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
          testID="bible-verse-line"
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

const styles = StyleSheet.create({
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
