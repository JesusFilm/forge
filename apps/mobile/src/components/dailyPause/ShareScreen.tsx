// The Figma "Share" screen (R7, R20, R22). Reaching it marks the run's day
// done, and "Share this video" offers the bundled video. The run screen draws
// the close, which is the only way to leave Share.
import { useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { useDevotionalVideo } from "../../lib/dailyPause/devotionals"
import { getPauseProgressStore } from "../../lib/dailyPause/progress"
import { shareDevotionalVideo } from "../../lib/dailyPause/shareVideo"
import { pauseColors, pauseSpacing } from "../../lib/dailyPause/theme"
import type { Today } from "../../lib/dailyPause/today"
import type { PauseFont } from "../../lib/dailyPause/fonts"
import { PauseBody, PauseButton } from "./PauseFrame"

const PROMPT =
  "Before we close, take a moment to consider a couple friends that you could share this truth with."

/** The sheet reports a cancel as a share, and a failure shows no message. */
function stayOnShare() {}

type ShareScreenProps = {
  /** The run's pinned day: its devotional, and the key of the done write. */
  pin: Today
  font: PauseFont
}

export function ShareScreen({ pin, font }: ShareScreenProps) {
  const { dayKey, devotional } = pin
  // A video that cannot be loaded offers Try again, which loads it again.
  const [attempt, setAttempt] = useState(0)
  const video = useDevotionalVideo(devotional, attempt)
  const sharing = useRef(false)

  // KTD11: the pinned key, so a run that crosses midnight marks its own day.
  useEffect(() => {
    getPauseProgressStore().markDone(dayKey)
  }, [dayKey])

  const share = () => {
    if (sharing.current || video.status !== "ready") return
    sharing.current = true
    void shareDevotionalVideo(devotional, video.uri)
      .catch(stayOnShare)
      .finally(() => {
        sharing.current = false
      })
  }

  // The prompt scrolls at large text sizes, and the button stays on screen.
  return (
    <PauseBody>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.top} />
        <Text style={[styles.label, font("sansSemiBold")]}>SHARE</Text>
        <Text style={[styles.prompt, font("display")]}>{PROMPT}</Text>
        {video.status === "error" ? (
          <Text style={[styles.failed, font("bodyLight")]}>
            This video could not be loaded.
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.buttonGap} />
      {video.status === "error" ? (
        <PauseButton
          label="Try again"
          onPress={() => setAttempt((count) => count + 1)}
          font={font}
        />
      ) : (
        <PauseButton label="Share this video" onPress={share} font={font} />
      )}
    </PauseBody>
  )
}

const styles = StyleSheet.create({
  // It takes the height of its content and shrinks only when that is too tall.
  scroll: { flexGrow: 0, flexShrink: 1, alignSelf: "stretch" },
  scrollContent: { alignItems: "center", gap: pauseSpacing.screenGap },
  top: { height: pauseSpacing.shareTop },
  label: {
    color: pauseColors.accent,
    fontSize: 12,
    letterSpacing: 1.8,
    textAlign: "center",
  },
  prompt: {
    alignSelf: "stretch",
    color: pauseColors.ink,
    fontSize: 28,
    lineHeight: 36,
  },
  failed: {
    alignSelf: "stretch",
    color: pauseColors.muted,
    fontSize: 16,
  },
  buttonGap: { height: pauseSpacing.shareButtonGap },
})
