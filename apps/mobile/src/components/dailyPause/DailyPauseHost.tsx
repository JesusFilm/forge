/**
 * The bridge that hands the Pause curtain over to the run route (KTD5). The
 * stage sits outside every provider, so it cannot read the router or the
 * experience selection. This host sits inside them, beside the experience
 * shell and never in it, because the shell's swap remounts its subtree.
 */

import { useCallback, useEffect } from "react"
import { BackHandler } from "react-native"
import { useRouter, useSegments } from "expo-router"

import { useExperienceSelection } from "../../contexts/ExperienceSelectionProvider"
import { getPauseProgressStore } from "../../lib/dailyPause/progress"
import { localDay } from "../../lib/dailyPause/today"
import { stepTakeover } from "../../lib/explore/takeover"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import { routePattern } from "../../lib/miniPlayer/suppression"
import {
  getPausePhase,
  liftPause,
  setPauseRunOnTop,
  usePausePhase,
} from "../../lib/pauseCurtain"
import { beginPlaybackInterruption } from "../../lib/playbackInterruption"

/** How long a drawn curtain waits for the experience selection. The same
 *  bound as `LAPSE_REMINDER_TAP_DEADLINE_MS`, for the same stack remount. */
export const PAUSE_HANDOVER_DEADLINE_MS = 3_000

const RUN_HREF = "/pause"
const RUN_GROUP = "pause"
/** The run screen. Its customize sheet is "pause/customize". */
const RUN_SCREEN_PATTERN = "pause"

/** KTD6, R46: the same one-shot step as Explore's focus. A floating window
 *  ends as dismissed; under picture-in-picture only the root player pauses. */
function takeOverPlayer(): void {
  const sessions = getMiniPlayerStore()
  const step = stepTakeover({
    snapshot: sessions.getSnapshot(),
    focused: true,
    pending: null,
  })
  // The run never resumes that video, so the resume handle is dropped.
  if (step.pauseRoot) beginPlaybackInterruption()
  if (step.dismiss) sessions.requestDismiss()
}

/** R21, R22: the close leaves the run for Home. `dismissTo` pops to the tab
 *  navigator below and selects Home; `navigate` would push a second one. */
export function useCloseDailyPause(): () => void {
  const router = useRouter()
  return useCallback(() => router.dismissTo("/(tabs)"), [router])
}

export function DailyPauseHost(): null {
  const router = useRouter()
  const pattern = routePattern(useSegments())
  const { isReady, currentSlug } = useExperienceSelection()
  const phase = usePausePhase()
  const close = useCloseDailyPause()

  const runOnTop = pattern.split("/")[0] === RUN_GROUP
  const selectionReady = isReady && currentSlug != null

  useEffect(() => {
    setPauseRunOnTop(runOnTop)
    return () => setPauseRunOnTop(false)
  }, [runOnTop])

  const handOver = useCallback(() => {
    // The phase check and the lift are one synchronous step, so a second
    // effect run (StrictMode, or the deadline) finds the entry taken.
    if (getPausePhase() !== "drawn") return
    liftPause()
    takeOverPlayer()
    getPauseProgressStore().markBellRead(localDay(new Date()))
    router.push(RUN_HREF)
  }, [router])

  useEffect(() => {
    if (phase !== "drawn") return
    if (selectionReady) {
      handOver()
      return
    }
    const deadline = setTimeout(handOver, PAUSE_HANDOVER_DEADLINE_MS)
    return () => clearTimeout(deadline)
  }, [phase, selectionReady, handOver])

  // KTD4: Android back on the run screen closes the run, as the close does.
  useEffect(() => {
    if (pattern !== RUN_SCREEN_PATTERN) return
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        close()
        return true
      },
    )
    return () => subscription.remove()
  }, [pattern, close])

  return null
}
