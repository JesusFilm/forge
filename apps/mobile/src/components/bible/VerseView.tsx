import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import {
  fitCandidates,
  planFit,
  type VerseFit,
} from "../../lib/bible/fit/fitVerse"
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

export type VerseViewProps = {
  /** One reader stop: a verse, or a gap that shows the note (R21). */
  stop: ChapterPosition
  textDirection: TextDirection
  appearance: VerseAppearance
  tokens: ReaderTokens
  /** The verse box's height (KTD16); the verse never grows past it. */
  areaHeight: number
  columnWidth: number
}

// The centered verse (R7, R20, R21, R32). It only draws and fits; U8 wraps
// the verse area around it for its gestures.
export function VerseView(props: VerseViewProps) {
  const { stop, tokens } = props
  if (stop.kind === "gap") {
    return (
      <Text
        testID="bible-missing-verse"
        style={[styles.note, { color: tokens.secondaryText }]}
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
    />
  )
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
          testID="bible-verse-scroll"
          style={{ width: columnWidth, height: areaHeight }}
          showsVerticalScrollIndicator
        >
          <VerseColumn
            accessibilityLabel={accessibilityLabel}
            visible
            width={columnWidth}
          >
            {body(fit.size)}
          </VerseColumn>
        </ScrollView>
      ) : (
        <VerseColumn
          accessibilityLabel={accessibilityLabel}
          visible={fit !== null}
          width={columnWidth}
        >
          {body(shownSize)}
        </VerseColumn>
      )}
    </>
  )
}

type VerseColumnProps = {
  accessibilityLabel: string
  /** Hidden until the fit settles, so the verse never flickers through sizes. */
  visible: boolean
  width: number
  children: ReactNode
}

function VerseColumn({
  accessibilityLabel,
  visible,
  width,
  children,
}: VerseColumnProps) {
  const style: StyleProp<ViewStyle> = { width, opacity: visible ? 1 : 0 }
  return (
    <View
      testID="bible-verse"
      style={style}
      accessible={visible}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      {children}
    </View>
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
}: VerseBodyProps) {
  const lineStyle: TextStyle = {
    fontSize: size,
    lineHeight: verseLineHeight(size, lineSpacing),
    fontFamily,
    color: tokens.text,
    // R32: right-to-left text aligns right; left-to-right text is centered.
    textAlign: textDirection === "rtl" ? "right" : "center",
    writingDirection: textDirection,
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
