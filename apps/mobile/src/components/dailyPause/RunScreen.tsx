// The one run screen of the pause route (KTD4). It shows the Opening, then one
// component per R10 step, under the one close, and keeps the screen awake until
// Share (KTD10, R25). v2 plan: each video part shows its section (R2, KTD4).
import { useIsFocused, useRouter } from "expo-router"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import { useCallback, useEffect, useRef, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import {
  cancelClosePrompt,
  dismissClosePrompt,
  openClosePrompt,
  useClosePromptOpen,
} from "../../lib/dailyPause/closePrompt"
import type { DevotionalPart } from "../../lib/dailyPause/devotionals"
import { usePauseFonts } from "../../lib/dailyPause/fonts"
import { usePauseDay, type PauseStep } from "../../lib/dailyPause/progress"
import {
  isVideoPart,
  partStepForSection,
  type RunStep,
  sectionStartStep,
  type StepperStage,
  sectionForStep,
  useDailyPauseRun,
} from "../../lib/dailyPause/run"
import { usePauseSettings } from "../../lib/dailyPause/settings"
import { pauseColors } from "../../lib/dailyPause/theme"
import { localDay, useToday } from "../../lib/dailyPause/today"
import { requestPauseExit, useEntryRequestsOnTop } from "../../lib/pauseCurtain"
import { CloseButton } from "./CloseButton"
import { CLOSE_PROMPT_FADE_MS, ClosePrompt } from "./ClosePrompt"
import { DevSkipButton } from "./DevSkipButton"
import { OpeningScreen } from "./OpeningScreen"
import { PartPlayer } from "./PartPlayer"
import { PrayScreen } from "./PrayScreen"
import { ReflectScreen } from "./ReflectScreen"
import { SectionMarkers } from "./SectionMarkers"
import { ShareScreen } from "./ShareScreen"
import { useFadeOut } from "./useFadeOut"
import { useStepDip } from "./useStepDip"
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
  const today = useToday()
  const settings = usePauseSettings()
  const day = usePauseDay(today.dayKey)
  const { ready: fontsReady, font } = usePauseFonts()
  const run = useDailyPauseRun()
  const { state } = run
  const prompting = useClosePromptOpen()
  // A prompt left open must not show again on the next run.
  useEffect(() => dismissClosePrompt, [])
  const reduceMotion = useReduceMotion()
  const promptView = useFadeOut(
    prompting,
    "prompt",
    reduceMotion ? 0 : CLOSE_PROMPT_FADE_MS,
  )

  // Every step change dips through the ground, so no step cuts to the next.
  const { dip, veil: dipVeil } = useStepDip(reduceMotion)
  // Stable callbacks, so the memoized stepper does not render again on each
  // tick of the Reflect and Pray timers.
  const runRef = useRef(run)
  runRef.current = run
  const advance = useCallback(() => dip(() => runRef.current.advance()), [dip])
  const jumpTo = useCallback(
    (step: RunStep) => dip(() => runRef.current.jump(step), "jump"),
    [dip],
  )
  const selectSection = useCallback(
    (section: StepperStage) => jumpTo(sectionStartStep(section)),
    [jumpTo],
  )

  // An entry point names today. A run pinned to an earlier day, such as one
  // left open overnight, goes back to the Opening and today's devotional.
  const entryRequests = useEntryRequestsOnTop()
  const seenEntryRequests = useRef(entryRequests)
  useEffect(() => {
    if (entryRequests === seenEntryRequests.current) return
    seenEntryRequests.current = entryRequests
    if (state.pin != null && state.pin.dayKey !== localDay(new Date())) {
      run.reset()
    }
  }, [entryRequests, state.pin, run])

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
        onBegin={() => dip(() => run.begin(today))}
        onResume={(step) => dip(() => run.resume(today, step))}
        onStartOver={() => dip(() => run.startOver(today))}
        onCustomize={() => router.push(CUSTOMIZE_HREF)}
      />
    )
  } else if (state.step === "watchScreen") {
    content = (
      <WatchScreen
        meditationLength={settings.meditationLength}
        font={font}
        onContinue={advance}
      />
    )
  } else if (state.step === "reflectScreen") {
    content = (
      <ReflectScreen
        devotional={state.pin.devotional}
        meditationLength={settings.meditationLength}
        font={font}
        onContinue={advance}
        onSelectSection={selectSection}
      />
    )
  } else if (state.step === "prayScreen") {
    content = (
      <PrayScreen
        devotional={state.pin.devotional}
        meditationLength={settings.meditationLength}
        font={font}
        onContinue={advance}
        onSelectSection={selectSection}
      />
    )
  } else if (state.step === "share") {
    content = <ShareScreen pin={state.pin} font={font} />
  }

  const part = loaded && state.pin != null ? partForStep(state.step) : null
  // From the step, not the player's part: the prayer part waits behind Reflect.
  const section = sectionForStep(state.step)

  return (
    <View style={styles.screen}>
      {/* A screen reader reaches only the close prompt while it shows. */}
      <View
        style={styles.screen}
        accessibilityElementsHidden={prompting}
        importantForAccessibility={prompting ? "no-hide-descendants" : "auto"}
      >
        {/* One player from the film part to the prayer part (KTD7). It keeps
            this first place, so a step change never mounts it again. */}
        {part != null && state.pin != null ? (
          <PartPlayer
            devotional={state.pin.devotional}
            part={part}
            active={isVideoPart(state.step)}
            focused={focused && !prompting}
            font={font}
            onEnded={advance}
          />
        ) : null}
        {content}
        {/* Keyed by section, so each part plays its own marker arrival. */}
        {section != null ? (
          <SectionMarkers
            key={section}
            section={section}
            font={font}
            onSelect={(other) => jumpTo(partStepForSection(other))}
          />
        ) : null}
        <CloseButton onPress={openClosePrompt} />
        {__DEV__ && loaded && TIMED_STEPS.has(state.step) ? (
          <DevSkipButton
            onPress={() => dip(() => runRef.current.advance(), "jump")}
            font={font}
          />
        ) : null}
        {dipVeil}
      </View>
      {promptView.mounted ? (
        <ClosePrompt
          // A prompt opened again during its fade-out starts a new fade-in.
          key={promptView.show}
          finished={state.step === "share"}
          leaving={promptView.leaving}
          reduceMotion={reduceMotion}
          font={font}
          // The owner, 2026-10-12: Close leaves through the curtain and the
          // logo, as Finish does. The prompt stays up under the curtain, so
          // the run never shows unblurred; the unmount clears it.
          onClose={() => requestPauseExit({ kind: "home" })}
          onCancel={cancelClosePrompt}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: pauseColors.background },
})
