// The one run screen of the pause route (KTD4). It shows the Opening, then one
// component per R10 step, with the one close above every step. It keeps the
// screen awake on every step except Share (KTD10, R25).
import { useRouter } from "expo-router"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import { useEffect, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import { usePauseFonts } from "../../lib/dailyPause/fonts"
import { usePauseDay } from "../../lib/dailyPause/progress"
import { isVideoPart, useDailyPauseRun } from "../../lib/dailyPause/run"
import { usePauseSettings } from "../../lib/dailyPause/settings"
import { pauseColors } from "../../lib/dailyPause/theme"
import { useToday } from "../../lib/dailyPause/today"
import { CloseButton } from "./CloseButton"
import { useCloseDailyPause } from "./DailyPauseHost"
import { OpeningScreen } from "./OpeningScreen"
import { StepStandIn } from "./StepStandIn"
import { WatchScreen } from "./WatchScreen"

const KEEP_AWAKE_TAG = "daily-pause-run"
const CUSTOMIZE_HREF = "/pause/customize"

/** A keep-awake failure leaves the phone's own sleep timer; nothing to undo. */
function ignore() {}

export function RunScreen() {
  const router = useRouter()
  const close = useCloseDailyPause()
  const today = useToday()
  const settings = usePauseSettings()
  const day = usePauseDay(today.dayKey)
  const { ready: fontsReady, font } = usePauseFonts()
  const run = useDailyPauseRun()
  const { state } = run

  const holdAwake = state.step !== "share"
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
  } else {
    content = (
      <StepStandIn
        key={state.step}
        step={state.step}
        font={font}
        onContinue={run.advance}
      />
    )
  }

  return (
    <View style={styles.screen}>
      {content}
      <CloseButton
        onPress={close}
        placement={isVideoPart(state.step) ? "letterbox" : "screen"}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: pauseColors.background },
})
