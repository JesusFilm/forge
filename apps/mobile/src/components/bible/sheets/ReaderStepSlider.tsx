import Slider from "@react-native-community/slider"
import { useEffect, useRef, type ReactNode } from "react"
import { Platform, StyleSheet, Text, View } from "react-native"

import { READER_TOUCH_TARGET } from "../../../lib/bible/reader/chrome"
import { readerSheetControlColors } from "../../../lib/bible/sheets/theme"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"

export type ReaderStepSliderProps = {
  tokens: ReaderTokens
  /** The group label; the screen reader reads it as the slider's name. */
  label: string
  /** What the screen reader says for each step, with `unit` after it. One
   *  entry per step, so the length is the step count. */
  spokenValues: readonly number[]
  /** A plural unit, such as "points". */
  unit: string
  /** A step index from 0. */
  value: number
  onChange: (step: number) => void
  /** Small glyphs at the two ends of the track. */
  start: ReactNode
  end: ReactNode
  testID: string
}

const END_SLOT = 32

// A step slider for the settings sheet (owner, 2026-09-28). It is the native
// slider, because a JS slider in a sheet loses its touch when the finger
// drifts about 10 pt up or down: iOS gives the touch to the sheet.
export function ReaderStepSlider({
  tokens,
  label,
  spokenValues,
  unit,
  value,
  onChange,
  start,
  end,
  testID,
}: ReaderStepSliderProps) {
  const controls = readerSheetControlColors(tokens)
  const last = spokenValues.length - 1
  // The native slider reports each move; only a new step is a change.
  const sent = useRef(value)
  useEffect(() => {
    sent.current = value
  }, [value])

  const onValueChange = (raw: number) => {
    const step = Math.min(Math.max(Math.round(raw), 0), last)
    if (step === sent.current) return
    sent.current = step
    onChange(step)
  }

  return (
    <View style={styles.row}>
      <View
        style={styles.endSlot}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {start}
      </View>
      <Slider
        testID={testID}
        style={styles.slider}
        minimumValue={0}
        maximumValue={last}
        step={1}
        value={value}
        onValueChange={onValueChange}
        tapToSeek
        minimumTrackTintColor={controls.switchOn}
        maximumTrackTintColor={controls.switchOff}
        // iOS keeps its own white thumb; Android's default is the theme color.
        thumbTintColor={
          Platform.OS === "android" ? controls.switchOn : undefined
        }
        accessibilityLabel={label}
        accessibilityUnits={unit}
        accessibilityIncrements={spokenValues.map(String)}
      />
      <View
        style={styles.endSlot}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {end}
      </View>
    </View>
  )
}

/** An "A" at a fixed size, so the two ends show the smallest and largest. */
export function SizeGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Text
      allowFontScaling={false}
      style={[styles.sizeGlyph, { fontSize: size, color }]}
    >
      A
    </Text>
  )
}

/** Three short lines, close or apart, for the two ends of line spacing. */
export function SpacingGlyph({ gap, color }: { gap: number; color: string }) {
  return (
    <View style={[styles.spacingGlyph, { gap }]}>
      {[0, 1, 2].map((line) => (
        <View
          key={line}
          style={[styles.spacingLine, { backgroundColor: color }]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  endSlot: {
    width: END_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  slider: {
    flex: 1,
    height: READER_TOUCH_TARGET,
  },
  sizeGlyph: {
    fontFamily: "System",
    fontWeight: "500",
  },
  spacingGlyph: {
    width: 16,
  },
  spacingLine: {
    height: 2,
    borderRadius: 1,
  },
})
