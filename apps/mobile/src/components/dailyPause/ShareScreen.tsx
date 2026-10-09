// The Figma "Share" screen (R7, R20; v2 R16-R20, KTD5). Reaching it marks the
// run's day done, and "Share this video" offers the bundled video. Browse and
// Finish leave through the curtain, and the run's close leaves at once.
import { useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { useDevotionalVideo } from "../../lib/dailyPause/devotionals"
import { getPauseProgressStore } from "../../lib/dailyPause/progress"
import { shareDevotionalVideo } from "../../lib/dailyPause/shareVideo"
import {
  pauseColors,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import type { Today } from "../../lib/dailyPause/today"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { requestPauseExit } from "../../lib/pauseCurtain"
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

  // v2 KTD5: the store takes only the first exit, so a second tap does nothing.
  const browse = () =>
    requestPauseExit({ kind: "search", question: devotional.question })
  const finish = () => requestPauseExit({ kind: "home" })

  // The prompt scrolls at large text sizes, and the buttons stay on screen.
  return (
    <PauseBody>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.top} />
        <Text style={[styles.label, pauseText(font, pauseType.label)]}>
          SHARE
        </Text>
        <Text style={[styles.prompt, font("display")]}>{PROMPT}</Text>
        {video.status === "error" ? (
          <Text style={[styles.failed, pauseText(font, pauseType.message)]}>
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
      <PauseButton
        label="Browse suggested media"
        onPress={browse}
        font={font}
      />
      <PauseButton label="Finish" onPress={finish} font={font} />
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
  },
  buttonGap: { height: pauseSpacing.shareButtonGap },
})
