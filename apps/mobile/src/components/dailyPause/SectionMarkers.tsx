// The section markers of a video part (v2 plan R2-R5, KTD4): WATCH, REFLECT,
// and PRAY in the close's row, with the part's own section in gold. The row
// takes no touch, so a tap on it pauses or resumes the part (R4).
import { StyleSheet, Text, View } from "react-native"

import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { pauseColors, pauseType } from "../../lib/dailyPause/theme"
import { TARGET_SIZE as CLOSE_TARGET_SIZE } from "./CloseButton"
import { STAGES, type StepperStage } from "./StepperPills"
import { useTopRowTop } from "./useTopRowTop"

/** The close's target height, so the row and the close share one center. */
const ROW_HEIGHT = CLOSE_TARGET_SIZE
const MARKER_GAP = 24
/** The row does not grow with the text past this scale, so it stays clear of
 *  the close on a narrow phone. VoiceOver reads the section in full. */
export const MARKER_MAX_SCALE = 1.3

type SectionMarkersProps = {
  /** The section of the part that shows now. */
  section: StepperStage
  font: PauseFont
}

export function SectionMarkers({ section, font }: SectionMarkersProps) {
  const top = useTopRowTop("letterbox", ROW_HEIGHT)
  const name = STAGES.find(({ stage }) => stage === section)?.name

  return (
    <View
      testID="section-markers"
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${name} section`}
      style={[styles.row, { top }]}
    >
      {STAGES.map(({ stage, label }) => (
        <Text
          key={stage}
          maxFontSizeMultiplier={MARKER_MAX_SCALE}
          style={[
            pauseText(font, pauseType.label),
            stage === section ? styles.current : styles.other,
          ]}
        >
          {label}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: MARKER_GAP,
  },
  current: { color: pauseColors.accent },
  other: { color: pauseColors.ink },
})
