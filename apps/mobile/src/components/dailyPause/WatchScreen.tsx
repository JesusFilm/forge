// The Figma "Transition · Watch" screen (R10, R11), and the parts of the Pass 2
// frame that every run screen shares: the body column, the masthead, and the
// primary pill button.
import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { PauseFace, PauseFontStyle } from "../../lib/dailyPause/fonts"
import type { MeditationLength } from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { StepperPills } from "./StepperPills"

export type PauseFont = (face: PauseFace) => PauseFontStyle

const PRESSED_OPACITY = 0.6

/** The frame's body column. The frame draws no status bar, so its top and
 *  bottom padding stay outside the safe area. */
export function PauseBody({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.body,
        {
          paddingTop: Math.max(pauseSpacing.screenTop, insets.top),
          paddingBottom: Math.max(pauseSpacing.screenBottom, insets.bottom),
        },
      ]}
    >
      {children}
    </View>
  )
}

/** "DAILY BIBLE PAUSE" over the minutes line (R31). */
export function PauseMasthead({
  meditationLength,
  font,
}: {
  meditationLength: MeditationLength
  font: PauseFont
}) {
  return (
    <>
      <Text style={[styles.eyebrow, font("sansMedium")]}>
        DAILY BIBLE PAUSE
      </Text>
      <Text style={[styles.minutes, font("sansMedium")]}>
        {`–  ${meditationLength} min  –`}
      </Text>
    </>
  )
}

type PauseButtonProps = {
  label: string
  onPress: () => void
  font: PauseFont
  /** The outline is the frame's upcoming pill, for a second choice. */
  variant?: "primary" | "outline"
}

/** The frame's primary pill button. */
export function PauseButton({
  label,
  onPress,
  font,
  variant = "primary",
}: PauseButtonProps) {
  const outline = variant === "outline"
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        outline && styles.outlineButton,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          outline && styles.outlineLabel,
          font("sansSemiBold"),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

type WatchScreenProps = {
  meditationLength: MeditationLength
  font: PauseFont
  onContinue: () => void
}

export function WatchScreen({
  meditationLength,
  font,
  onContinue,
}: WatchScreenProps) {
  return (
    <PauseBody>
      <PauseMasthead meditationLength={meditationLength} font={font} />
      <View style={styles.spacer} />
      <StepperPills arrival="watch" font={font} />
      <View style={styles.spacer} />
      <PauseButton label="Continue" onPress={onContinue} font={font} />
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: "center",
    gap: pauseSpacing.screenGap,
    paddingHorizontal: pauseSpacing.screenSide,
  },
  eyebrow: {
    color: pauseColors.ink,
    fontSize: 12,
    letterSpacing: 2.6,
    textAlign: "center",
  },
  minutes: {
    color: pauseColors.accent,
    fontSize: 15,
    letterSpacing: 1.1,
    textAlign: "center",
  },
  spacer: { flex: 1 },
  button: {
    maxWidth: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: pauseSpacing.buttonPaddingX,
    paddingVertical: pauseSpacing.buttonPaddingY,
    borderRadius: pauseRadii.button,
    backgroundColor: pauseColors.ink,
  },
  // One point of border comes off the padding, so both buttons are 54 tall.
  outlineButton: {
    paddingHorizontal: pauseSpacing.buttonPaddingX - 1,
    paddingVertical: pauseSpacing.buttonPaddingY - 1,
    borderWidth: 1,
    borderColor: pauseColors.pillBorder,
    backgroundColor: pauseColors.background,
  },
  pressed: { opacity: PRESSED_OPACITY },
  buttonLabel: {
    color: pauseColors.background,
    fontSize: 18,
    textAlign: "center",
  },
  outlineLabel: { color: pauseColors.ink },
})
