// The Figma "Transition · Watch" screen (R10, R11), and the parts of the Pass 2
// frame that every run screen shares: the body column, the masthead, and the
// primary pill button.
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"
import type { ReactNode } from "react"
import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import {
  useSafeAreaInsets,
  type EdgeInsets,
} from "react-native-safe-area-context"

import type { PauseFace, PauseFontStyle } from "../../lib/dailyPause/fonts"
import type { MeditationLength } from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { Pulse } from "./Pulse"
import { StepperPills } from "./StepperPills"

export type PauseFont = (face: PauseFace) => PauseFontStyle

const PRESSED_OPACITY = 0.6

/** The body column's top and bottom padding. The frame draws no status bar,
 *  so the padding stays outside the safe area. */
export function pauseBodyPadding(insets: EdgeInsets): {
  top: number
  bottom: number
} {
  return {
    top: Math.max(pauseSpacing.screenTop, insets.top),
    bottom: Math.max(pauseSpacing.screenBottom, insets.bottom),
  }
}

/** The frame's body column. */
export function PauseBody({ children }: { children: ReactNode }) {
  const padding = pauseBodyPadding(useSafeAreaInsets())
  return (
    <View
      style={[
        styles.body,
        { paddingTop: padding.top, paddingBottom: padding.bottom },
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

export type PauseButtonVariant = "primary" | "outline" | "glass"

type PauseButtonProps = {
  label: string
  onPress: () => void
  font: PauseFont
  /** The outline is the frame's upcoming pill, for a second choice. The glass
   *  is iOS 26 Liquid Glass (the owner, 2026-10-06), else the primary pill. */
  variant?: PauseButtonVariant
}

/** iOS 26 Liquid Glass. isGlassEffectAPIAvailable guards iOS 26 betas that
 *  crash without it. */
function liquidGlass(): boolean {
  return (
    Platform.OS === "ios" &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable()
  )
}

/** The frame's primary pill button. */
export function PauseButton({
  label,
  onPress,
  font,
  variant = "primary",
}: PauseButtonProps) {
  if (variant === "glass" && liquidGlass()) {
    // No ancestor may fade this button: GlassView draws nothing there.
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <GlassView
          testID="pause-glass-button"
          style={styles.glassButton}
          glassEffectStyle="regular"
          colorScheme="dark"
          isInteractive
        >
          <Text
            style={[
              styles.buttonLabel,
              styles.glassLabel,
              font("sansSemiBold"),
            ]}
          >
            {label}
          </Text>
        </GlassView>
      </Pressable>
    )
  }
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
      <Pulse>
        <PauseButton
          label="Continue"
          onPress={onContinue}
          font={font}
          variant="glass"
        />
      </Pulse>
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
  glassButton: {
    maxWidth: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: pauseSpacing.buttonPaddingX,
    paddingVertical: pauseSpacing.buttonPaddingY,
    borderRadius: pauseRadii.button,
    overflow: "hidden",
  },
  glassLabel: { color: pauseColors.ink },
  buttonLabel: {
    color: pauseColors.background,
    fontSize: 18,
    textAlign: "center",
  },
  outlineLabel: { color: pauseColors.ink },
})
