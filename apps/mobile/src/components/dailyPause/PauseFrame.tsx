// The parts of the Pass 2 frame that every run screen shares: the body
// column, the masthead, and the pill buttons.
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

import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import type { MeditationLength } from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseRadii,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"

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
      <Text style={[styles.eyebrow, pauseText(font, pauseType.eyebrow)]}>
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

/** iOS 26 Liquid Glass. isGlassEffectAPIAvailable guards iOS 26 betas that
 *  crash without it. */
function liquidGlass(): boolean {
  return (
    Platform.OS === "ios" &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable()
  )
}

/** The frame's pill button. Where iOS has Liquid Glass, every pill is glass
 *  (the owner, 2026-10-06): the primary is tinted cream, the outline clear. */
export function PauseButton({
  label,
  onPress,
  font,
  variant = "primary",
}: PauseButtonProps) {
  const outline = variant === "outline"
  const labelNode = (
    <Text
      style={[
        styles.buttonLabel,
        outline && styles.outlineLabel,
        pauseText(font, pauseType.button),
      ]}
    >
      {label}
    </Text>
  )
  if (liquidGlass()) {
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
          tintColor={outline ? undefined : pauseColors.ink}
          isInteractive
        >
          {labelNode}
        </GlassView>
      </Pressable>
    )
  }
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
      {labelNode}
    </Pressable>
  )
}

/** A tap before the pause ends does nothing (R16). */
function ignoreTap() {}

type HeldPauseButtonProps = {
  label: string
  spokenLabel: string
  font: PauseFont
}

/** The frame's button while a pause timer runs. It looks the same, takes no
 *  tap, and VoiceOver reads it as a dimmed button with `spokenLabel`. */
export function HeldPauseButton({
  label,
  spokenLabel,
  font,
}: HeldPauseButtonProps) {
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      accessibilityState={{ disabled: true }}
      pointerEvents="none"
    >
      <PauseButton label={label} onPress={ignoreTap} font={font} />
    </View>
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
    textAlign: "center",
  },
  minutes: {
    color: pauseColors.accent,
    fontSize: 15,
    letterSpacing: 1.1,
    textAlign: "center",
  },
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
  buttonLabel: {
    color: pauseColors.background,
    textAlign: "center",
  },
  outlineLabel: { color: pauseColors.ink },
})
