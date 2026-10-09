// The bridge between the Pause curtain and the router (KTD5; the exit: v2
// R16-R18, KTD5, KTD6). It sits inside the providers that the stage cannot
// read, beside the experience shell, because a shell swap remounts the shell.

import { useCallback, useEffect } from "react"
import { BackHandler } from "react-native"
import { useRouter, useSegments, type Href } from "expo-router"

import { useExperienceSelection } from "../../contexts/ExperienceSelectionProvider"
import { markTodaysDevotionalRead } from "../../lib/announcements"
import { stepTakeover } from "../../lib/explore/takeover"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import { routePattern } from "../../lib/miniPlayer/suppression"
import {
  getPauseExitTarget,
  getPausePhase,
  liftPause,
  setPauseRunOnTop,
  usePauseDirection,
  usePausePhase,
  type PauseExitTarget,
} from "../../lib/pauseCurtain"
import { beginPlaybackInterruption } from "../../lib/playbackInterruption"
import { getSearchIntentStore } from "../../lib/searchIntent"

/** How long a drawn curtain waits for the experience selection. The same
 *  bound as `LAPSE_REMINDER_TAP_DEADLINE_MS`, for the same stack remount. */
export const PAUSE_HANDOVER_DEADLINE_MS = 3_000
/** How long a drawn exit curtain waits for the segments to show its target.
 *  Past it the curtain lifts anyway, so it can never stay closed. */
export const PAUSE_EXIT_BACKSTOP_MS = 1_000

const RUN_HREF = "/pause"
const RUN_GROUP = "pause"
/** The run screen. Its customize sheet is "pause/customize". */
const RUN_SCREEN_PATTERN = "pause"

/** Where each exit pops to, and the route patterns that show it arrived. The
 *  router usually drops Home's trailing "index" (see `presentation.ts`). */
const EXIT_ROUTES: Record<
  PauseExitTarget["kind"],
  { href: Href; patterns: readonly string[] }
> = {
  home: { href: "/(tabs)", patterns: ["(tabs)", "(tabs)/index"] },
  search: { href: "/(tabs)/watch", patterns: ["(tabs)/watch"] },
}

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
  return useCallback(() => {
    // v2 KTD5: a screen reader can reach the close under an exit's curtain,
    // and a close there would send an exit to the search tab to Home.
    if (getPausePhase() !== "idle") return
    router.dismissTo("/(tabs)")
  }, [router])
}

export function DailyPauseHost(): null {
  const router = useRouter()
  const pattern = routePattern(useSegments())
  const { isReady, currentSlug } = useExperienceSelection()
  const phase = usePausePhase()
  const exiting = usePauseDirection() === "exit"
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
    markTodaysDevotionalRead()
    router.push(RUN_HREF)
  }, [router])

  useEffect(() => {
    if (phase !== "drawn" || exiting) return
    if (selectionReady) {
      handOver()
      return
    }
    const deadline = setTimeout(handOver, PAUSE_HANDOVER_DEADLINE_MS)
    return () => clearTimeout(deadline)
  }, [phase, exiting, selectionReady, handOver])

  // The exit leaves no player to take over and no bell to mark, and the stack
  // is already mounted under the run, so it does not wait for the selection.
  useEffect(() => {
    const target = getPauseExitTarget()
    if (phase !== "drawn" || !exiting || target == null) return
    // v2 KTD6: the put comes here and not at the tap, so the time limit runs
    // from the pop. A long time in the background cannot expire it.
    if (target.kind === "search") getSearchIntentStore().put(target.question)
    router.dismissTo(EXIT_ROUTES[target.kind].href)
    const backstop = setTimeout(liftPause, PAUSE_EXIT_BACKSTOP_MS)
    return () => clearTimeout(backstop)
  }, [phase, exiting, router])

  // iOS native tabs select a tab one render after the pop, and the lift is
  // black for only about 200 ms, so the lift waits until the target shows.
  useEffect(() => {
    const target = getPauseExitTarget()
    if (phase !== "drawn" || !exiting || target == null) return
    if (EXIT_ROUTES[target.kind].patterns.includes(pattern)) liftPause()
  }, [phase, exiting, pattern])

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
