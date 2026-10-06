// The one run screen of the pause route (KTD4). It shows the Opening, then one
// component per R10 step, with the one close above every step. It keeps the
// screen awake on every step except Share (KTD10, R25).
import { useIsFocused, useRouter } from "expo-router"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import { useEffect, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import type { DevotionalPart } from "../../lib/dailyPause/devotionals"
import { usePauseFonts } from "../../lib/dailyPause/fonts"
import { usePauseDay, type PauseStep } from "../../lib/dailyPause/progress"
import { isVideoPart, useDailyPauseRun } from "../../lib/dailyPause/run"
import { usePauseSettings } from "../../lib/dailyPause/settings"
import { pauseColors } from "../../lib/dailyPause/theme"
import { useToday } from "../../lib/dailyPause/today"
import { CloseButton } from "./CloseButton"
import { useCloseDailyPause } from "./DailyPauseHost"
import { DevSkipButton } from "./DevSkipButton"
import { OpeningScreen } from "./OpeningScreen"
import { PartPlayer } from "./PartPlayer"
import { PrayScreen } from "./PrayScreen"
import { ReflectScreen } from "./ReflectScreen"
import { ShareScreen } from "./ShareScreen"
import { WatchScreen } from "./WatchScreen"

const KEEP_AWAKE_TAG = "daily-pause-run"
const CUSTOMIZE_HREF = "/pause/customize"
/** The steps that hold the run for a time, which the developer Skip ends. */
const TIMED_STEPS: ReadonlySet<PauseStep> = new Set([
  "film",
  "teaching",
  "reflectScreen",
  "prayer",
  "prayScreen",
])

/** A keep-awake failure leaves the phone's own sleep timer; nothing to undo. */
function ignore() {}

/** The part a step plays. Behind Reflect, the prayer part waits at its start. */
function partForStep(step: PauseStep): DevotionalPart | null {
  switch (step) {
    case "film":
    case "teaching":
      return step
    case "reflectScreen":
    case "prayer":
      return "prayer"
    default:
      return null
  }
}

export function RunScreen() {
  const router = useRouter()
  const close = useCloseDailyPause()
  const today = useToday()
  const settings = usePauseSettings()
  const day = usePauseDay(today.dayKey)
  const { ready: fontsReady, font } = usePauseFonts()
  const run = useDailyPauseRun()
  const { state } = run

  // A screen above the run, such as a watch page, takes the screen's wake.
  const focused = useIsFocused()
  const holdAwake = focused && state.step !== "share"
  useEffect(() => {
    if (!holdAwake) return
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(ignore)
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(ignore)
    }
  }, [holdAwake])

  // Each read ends within its time limit, so the first frame shows the
  // settled length and the settled choice, never a change a moment later.
  const loaded =
    fontsReady && settings.status === "ready" && day.status === "ready"

  let content: ReactNode = null
  if (!loaded) {
    // The ground and the close only, for at most the longest read.
  } else if (state.step === "opening") {
    content = (
      <OpeningScreen
        devotional={today.devotional}
        meditationLength={settings.meditationLength}
        day={day}
        font={font}
        onBegin={() => run.begin(today)}
        onResume={(step) => run.resume(today, step)}
        onStartOver={() => run.startOver(today)}
        onCustomize={() => router.push(CUSTOMIZE_HREF)}
      />
    )
  } else if (state.step === "watchScreen") {
    content = (
      <WatchScreen
        meditationLength={settings.meditationLength}
        font={font}
        onContinue={run.advance}
      />
    )
  } else if (state.step === "reflectScreen") {
    content = (
      <ReflectScreen
        devotional={state.pin.devotional}
        meditationLength={settings.meditationLength}
        font={font}
        onContinue={run.advance}
      />
    )
  } else if (state.step === "prayScreen") {
    content = (
      <PrayScreen
        devotional={state.pin.devotional}
        meditationLength={settings.meditationLength}
        font={font}
        onContinue={run.advance}
      />
    )
  } else if (state.step === "share") {
    content = <ShareScreen pin={state.pin} font={font} />
  }

  const part = loaded && state.pin != null ? partForStep(state.step) : null

  return (
    <View style={styles.screen}>
      {/* One player from the film part to the prayer part (KTD7). It keeps
          this first place, so a step change never mounts it again. */}
      {part != null && state.pin != null ? (
        <PartPlayer
          devotional={state.pin.devotional}
          part={part}
          active={isVideoPart(state.step)}
          focused={focused}
          font={font}
          onEnded={run.advance}
        />
      ) : null}
      {content}
      <CloseButton
        onPress={close}
        placement={isVideoPart(state.step) ? "letterbox" : "screen"}
      />
      {__DEV__ && loaded && TIMED_STEPS.has(state.step) ? (
        <DevSkipButton
          onPress={run.advance}
          placement={isVideoPart(state.step) ? "letterbox" : "screen"}
          font={font}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: pauseColors.background },
})
