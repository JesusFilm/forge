// The Figma "Transition · Watch" screen (R10, R11), and the parts of the Pass 2
// frame that every run screen shares: the body column, the masthead, and the
// primary pill button.
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"
import type { ReactNode } from "react"
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native"
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

type PauseButtonProps = {
  label: string
  onPress: () => void
  font: PauseFont
  /** The outline is the frame's upcoming pill, for a second choice. */
  variant?: "primary" | "outline"
  /** The button keeps this label's width when its own label is narrower, so
   *  a changing label never moves its edges (the owner, 2026-10-06). */
  widthLabel?: string
}

/** The label, and an invisible copy of `widthLabel` with no height that holds
 *  the width. The width follows the font and its size. */
function ButtonLabel({
  label,
  widthLabel,
  style,
}: {
  label: string
  widthLabel?: string
  style: StyleProp<TextStyle>
}) {
  if (widthLabel == null) return <Text style={style}>{label}</Text>
  return (
    <View style={styles.labelBox}>
      <Text style={[style, styles.steadyDigits]}>{label}</Text>
      <Text
        testID="pause-button-width"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[style, styles.widthHolder]}
      >
        {widthLabel}
      </Text>
    </View>
  )
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
  widthLabel,
}: PauseButtonProps) {
  const outline = variant === "outline"
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
          <ButtonLabel
            label={label}
            widthLabel={widthLabel}
            style={[
              styles.buttonLabel,
              outline && styles.outlineLabel,
              font("sansSemiBold"),
            ]}
          />
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
      <ButtonLabel
        label={label}
        widthLabel={widthLabel}
        style={[
          styles.buttonLabel,
          outline && styles.outlineLabel,
          font("sansSemiBold"),
        ]}
      />
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
        <PauseButton label="Continue" onPress={onContinue} font={font} />
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
  labelBox: { alignItems: "center" },
  // Equal-width digits, so a count does not move inside the button.
  steadyDigits: { fontVariant: ["tabular-nums"] },
  widthHolder: { height: 0, opacity: 0 },
  buttonLabel: {
    color: pauseColors.background,
    fontSize: 18,
    textAlign: "center",
  },
  outlineLabel: { color: pauseColors.ink },
})
