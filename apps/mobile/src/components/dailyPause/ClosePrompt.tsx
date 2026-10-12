// The run's close prompt (the owner, 2026-10-12). It blurs and darkens the
// whole run and asks before the run closes. It is not a native alert, so it
// keeps the run's fonts and pill buttons. It fades in and out.
import { useEffect, useState } from "react"
import { Animated, Easing, StyleSheet, Text, View } from "react-native"

import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import {
  pauseColors,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import { PlatformBlur } from "../ui/PlatformBlur"
import { PauseButton, type PauseButtonFade } from "./PauseFrame"

export const CLOSE_PROMPT_FADE_MS = 250
export const CLOSE_PROMPT_TITLE = "Close the devotional?"
export const CLOSE_PROMPT_RESUME =
  "You can pick up where you left off the next time you open it."
/** Share marks the day done, so the next open starts over. */
export const CLOSE_PROMPT_FINISHED = "You finished today’s devotional."
/** Android has no reliable blur, so PlatformBlur dims it flat instead. */
const ANDROID_DIM = "rgba(0, 0, 0, 0.6)"

type ClosePromptProps = {
  /** True on Share, where nothing is left to resume. */
  finished: boolean
  /** True while the prompt fades out. It takes no touch then. */
  leaving: boolean
  /** From the run screen, which read it long before the prompt mounts. */
  reduceMotion: boolean
  font: PauseFont
  onClose: () => void
  onCancel: () => void
}

export function ClosePrompt({
  finished,
  leaving,
  reduceMotion,
  font,
  onClose,
  onCancel,
}: ClosePromptProps) {
  const durationMs = reduceMotion ? 0 : CLOSE_PROMPT_FADE_MS
  const [opacity] = useState(() => new Animated.Value(0))
  // The glass mounts with no material, and the fade starts two frames later.
  // iOS animates no change in the frame that first draws the glass.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const shown = entered && !leaving

  useEffect(() => {
    if (!entered) return
    const animation = Animated.timing(opacity, {
      toValue: shown ? 1 : 0,
      duration: durationMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [opacity, entered, shown, durationMs])

  const fade: PauseButtonFade = { opacity, shown, durationMs }

  return (
    <View
      testID={leaving ? "close-prompt-leaving" : "close-prompt"}
      style={styles.fill}
      pointerEvents={leaving ? "none" : "auto"}
      accessibilityViewIsModal={!leaving}
      // The VoiceOver escape gesture cancels, as Android back does.
      onAccessibilityEscape={leaving ? undefined : onCancel}
      accessibilityElementsHidden={leaving}
      importantForAccessibility={leaving ? "no-hide-descendants" : "auto"}
    >
      <Animated.View
        testID="close-prompt-backdrop"
        style={[styles.fill, { opacity }]}
      >
        <PlatformBlur
          style={styles.fill}
          intensity={60}
          tint="dark"
          androidDim={ANDROID_DIM}
        />
        <View style={[styles.fill, styles.dim]} />
      </Animated.View>
      <View style={styles.content}>
        <Animated.View
          testID="close-prompt-text"
          style={[styles.text, { opacity }]}
        >
          <Text
            accessibilityRole="header"
            style={[styles.title, font("display")]}
          >
            {CLOSE_PROMPT_TITLE}
          </Text>
          <Text style={[styles.subtitle, pauseText(font, pauseType.message)]}>
            {finished ? CLOSE_PROMPT_FINISHED : CLOSE_PROMPT_RESUME}
          </Text>
        </Animated.View>
        {/* No opacity here: GlassView draws nothing under a fading ancestor,
            so each button fades itself. */}
        <View testID="close-prompt-buttons" style={styles.buttons}>
          {/* Side by side (the owner, 2026-10-12), with Cancel first, as in
              iOS and Android dialogs. */}
          <View style={styles.button}>
            <PauseButton
              label="Cancel"
              onPress={onCancel}
              font={font}
              variant="outline"
              fade={fade}
            />
          </View>
          <View style={styles.button}>
            <PauseButton
              label="Close"
              onPress={onClose}
              font={font}
              fade={fade}
            />
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill },
  // Dark enough that a blurred cream pill under the text cannot cut its contrast.
  dim: { backgroundColor: "rgba(0, 0, 0, 0.6)" },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: pauseSpacing.screenGap,
    paddingHorizontal: pauseSpacing.screenSide,
  },
  text: { alignSelf: "stretch", gap: pauseSpacing.screenGap },
  title: {
    color: pauseColors.ink,
    fontSize: 28,
    lineHeight: 36,
    textAlign: "center",
  },
  subtitle: {
    color: pauseColors.muted,
    textAlign: "center",
  },
  // A row of two buttons with one width.
  buttons: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: pauseSpacing.screenGap,
    marginTop: pauseSpacing.shareButtonGap,
  },
  button: { flex: 1 },
})
